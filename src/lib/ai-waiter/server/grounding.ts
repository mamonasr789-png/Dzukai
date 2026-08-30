import "server-only";

import { restaurantInfo } from "../../assistant/knowledgeBase.ts";
import type {
  Cart,
  ConversationState,
  ProductDetails,
} from "../schemas.ts";
import type {
  GroundedProductProvenance,
  GroundedRestaurantRecord,
  GroundedWaiterContext,
} from "./aiProvider.ts";
import type { MenuRepository } from "./menuRepository.ts";
import {
  menuCategoryForMessage,
  messageLooksLikeMenuHelp,
  messageUsesPriorReference,
} from "./stateExtraction.ts";
import { WAITER_POLICY_VERSION } from "./waiterPolicy.ts";
import { summarizeCart } from "./aiProvider.ts";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function categoryFor(message: string, state: ConversationState): string | undefined {
  return (
    menuCategoryForMessage(message) ??
    state.temporaryPreferences.preferredCategories.at(-1) ??
    state.preferences.preferredCategories.at(-1)
  );
}

function knowledgeFor(
  message: string,
  language: ConversationState["language"]
): GroundedRestaurantRecord[] {
  const value = normalize(message);
  const keys: string[] = [];
  if (/\b(adres|address|kur|where)\b|адрес|где/u.test(value)) keys.push("address");
  if (/\b(valand|hours|open|dirb)\b|час|открыт|работ/u.test(value)) keys.push("hours");
  if (/\b(park|parking)\b|парков/u.test(value)) keys.push("parking");
  if (/\b(alaus darykl|brewery|alus|beer)\b|пивовар|пив/u.test(value)) keys.push("brewery");
  if (keys.length === 0 && (/\b(restoran|restaurant)\b/u.test(value) || /ресторан/u.test(value))) {
    keys.push("name");
  }
  return [...new Set(keys)].slice(0, 3).map((key) => ({
    key,
    value: restaurantInfo[key]?.[language] ?? restaurantInfo[key]?.lt ?? "",
  }));
}

async function relevantProducts(
  message: string,
  state: ConversationState,
  cart: Cart,
  menuRepository: MenuRepository
): Promise<{
  products: ProductDetails[];
  provenance: GroundedProductProvenance[];
}> {
  const byId = new Map<string, ProductDetails>();
  const provenance = new Map<string, GroundedProductProvenance["provenance"]>();
  if (messageUsesPriorReference(message)) {
    const references = await Promise.all(
      state.latestReferencedProductIds
        .slice(0, 4)
        .map((productId) =>
          menuRepository.getProductDetails(productId, state.language)
        )
    );
    for (const product of references) {
      if (!product) continue;
      byId.set(product.productId, product);
      provenance.set(product.productId, "explicit_prior_reference");
    }
  }

  for (const line of cart.lines) {
    const product = await menuRepository.getProductDetails(
      line.productId,
      state.language
    );
    if (!product) continue;
    byId.set(product.productId, product);
    provenance.set(product.productId, "cart");
  }

  const normalizedMessage = normalize(message);
  const shouldRetrieveCandidates =
    messageLooksLikeMenuHelp(message) ||
    /\b(noriu|want|recommend|pasiul\w*|parodyk|show|maist|food|patiekal|dish|burger|pica|pizza|jautien|beef|vistien|chicken|kiaulien|pork|zuv|fish|silk|desert|dessert|alus|beer|pridek|add|imsiu|take|sot|hungry|vegetar|vegan)\w*\b|хочу|рекоменд|посовет|покаж|ед|блюд|бургер|пицц|говядин|куриц|свинин|рыб|сел[её]д|десерт|пив|добав|сыт|голод|вегетари|веган/u.test(
      normalizedMessage
    );
  const candidates = shouldRetrieveCandidates
    ? await menuRepository.getRecommendationCandidates(
        {
          category: categoryFor(message, state),
          maxPrice: state.budget ?? undefined,
          excludeProductIds: [],
          dietaryRequirements: state.dietaryRequirements,
          allergies: state.allergies,
          preferredProteins: [
            ...state.preferences.preferredProteins,
            ...state.temporaryPreferences.preferredProteins,
          ],
          limit: 6,
        },
        state.language
      )
    : [];
  for (const product of candidates) {
    if (byId.size >= 8) break;
    byId.set(product.productId, product);
    if (!provenance.has(product.productId)) {
      provenance.set(product.productId, "current_query");
    }
  }
  const products = [...byId.values()].slice(0, 8);
  return {
    products,
    provenance: products.map((product) => ({
      productId: product.productId,
      provenance: provenance.get(product.productId) ?? "current_query",
    })),
  };
}

export async function buildGroundedWaiterContext(command: {
  state: ConversationState;
  cart: Cart;
  customerMessage: string;
  clientTurnId: string | null;
  menuRepository: MenuRepository;
}): Promise<GroundedWaiterContext> {
  const grounded = await relevantProducts(
    command.customerMessage,
    command.state,
    command.cart,
    command.menuRepository
  );
  return {
    policyVersion: WAITER_POLICY_VERSION,
    language: command.state.language,
    customerMessage: command.customerMessage,
    clientTurnId: command.clientTurnId,
    state: {
      stage: command.state.stage,
      preferences: command.state.preferences,
      temporaryPreferences: command.state.temporaryPreferences,
      dislikedIngredients: command.state.dislikedIngredients,
      dietaryRequirements: command.state.dietaryRequirements,
      allergies: command.state.allergies,
      budget: command.state.budget,
      budgetScope: command.state.budgetScope,
      hungerLevel: command.state.hungerLevel,
      latestReferencedProductIds:
        command.state.latestReferencedProductIds,
      unresolvedQuestion: command.state.unresolvedQuestion,
      ambiguity: command.state.ambiguity,
    },
    cart: summarizeCart(command.cart),
    relevantProducts: grounded.products,
    productProvenance: grounded.provenance,
    restaurantKnowledge: knowledgeFor(
      command.customerMessage,
      command.state.language
    ),
  };
}
