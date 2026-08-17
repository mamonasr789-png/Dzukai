import "server-only";

import type {
  AIProvider,
  AIProviderStepRequest,
  ProviderToolResult,
} from "./aiProvider.ts";
import type { ProviderStep } from "./providerTooling.ts";
import { tProduct } from "../../product-translations.ts";
import {
  menuCategoryForMessage,
  messageRequestsAnotherRecommendation,
} from "./stateExtraction.ts";
import {
  allergyCaution,
  billRequested,
  buildVoiceContext,
  cartAddedGeneric,
  cartEmpty,
  cartShown,
  detectSmallTalk,
  greeting,
  modifierUnsure,
  noMatch,
  recommendIntro,
  rotationOffset,
  smallTalk,
  turnSeed,
  unknownRedirect,
  waiterCalled,
  whichItem,
  whichVariant,
  type VoiceContext,
} from "./waiterVoice.ts";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function referencedOrdinal(message: string): number {
  const numeric = message.match(
    /(?:recommendation|pasiul\w*|предлож)[^\d]{0,12}([1-9])|([1-9])[^\d]{0,12}(?:recommendation|pasiul\w*|предлож)/u
  );
  if (numeric) return Number(numeric[1] ?? numeric[2]) - 1;
  if (/\b(antr\w*|second)\b|втор/u.test(message)) return 1;
  if (/\b(treci\w*|third)\b|трет/u.test(message)) return 2;
  return 0;
}

function recommendationCategory(request: AIProviderStepRequest): {
  category: string | undefined;
  contextualFollowUp: boolean;
  explicitCategory: boolean;
} {
  const explicitCategory = menuCategoryForMessage(
    request.context.customerMessage
  );
  const contextualFollowUp = messageRequestsAnotherRecommendation(
    request.context.customerMessage
  );
  if (explicitCategory) {
    return {
      category: explicitCategory,
      contextualFollowUp,
      explicitCategory: true,
    };
  }
  if (!contextualFollowUp) {
    return {
      category: undefined,
      contextualFollowUp: false,
      explicitCategory: false,
    };
  }

  const storedCategory =
    request.context.state.temporaryPreferences.preferredCategories.at(-1) ??
    request.context.state.preferences.preferredCategories.at(-1);
  const referencedCategories = request.context.state.latestReferencedProductIds
    .map((productId) =>
      request.context.relevantProducts.find(
        (product) => product.productId === productId
      )?.category
    )
    .filter((category): category is string => Boolean(category));

  return {
    category: storedCategory ?? referencedCategories[0],
    contextualFollowUp,
    explicitCategory: false,
  };
}

function voiceFor(request: AIProviderStepRequest): VoiceContext {
  const { context } = request;
  const seedSource = context.clientTurnId ?? context.customerMessage;
  return buildVoiceContext({
    language: context.language,
    sessionId: seedSource,
    turn: turnSeed(context.customerMessage, context.clientTurnId),
    message: context.customerMessage,
  });
}

function copyFor(voice: VoiceContext) {
  return {
    clarifyReference: whichItem(voice),
    clarifyVariant: whichVariant(voice),
    clarifyModifier: modifierUnsure(voice),
    allergy: allergyCaution(voice),
    noResults: noMatch(voice),
    added: cartAddedGeneric(voice),
    viewedCart: cartShown(voice),
    generic: unknownRedirect(voice),
  };
}

/** Candidate pool size; the provider tool contract caps this at 5. */
const RECOMMENDATION_POOL = 5;

function desiredRecommendationCount(message: string): number {
  return /\b(du|dvi|two)\b|\bдва\b|\bдве\b/u.test(normalize(message)) ? 2 : 3;
}

function successfulProducts(results: ProviderToolResult[]) {
  for (const item of results) {
    if (!item.result.ok) continue;
    if (
      item.result.toolName === "recommend_products" ||
      item.result.toolName === "search_menu"
    ) {
      return item.result.data.products;
    }
  }
  return [];
}

function resultStep(
  request: AIProviderStepRequest,
  results: ProviderToolResult[]
): ProviderStep {
  const voice = voiceFor(request);
  const copy = copyFor(voice);
  const products = successfulProducts(results);
  if (products.length > 0) {
    // The tool returns a candidate pool in menu order. Always taking its head
    // made every guest hear the same three dishes, so rotate a window instead.
    const wanted = Math.min(
      desiredRecommendationCount(request.context.customerMessage),
      products.length
    );
    const offset =
      products.length > wanted
        ? rotationOffset(voice, products.length - wanted + 1)
        : 0;
    const shown = products.slice(offset, offset + wanted);
    return {
      kind: "final",
      message: recommendIntro(voice),
      referencedProductIds: shown.map((product) => product.productId),
      claims: shown.map((product) => ({
        claimType: "product_price" as const,
        productId: product.productId,
        proposedValue: Math.round(product.officialUnitPrice * 100),
        provenance: "official_menu" as const,
      })),
      stateUpdate: { stage: "recommending" },
    };
  }
  const cartResult = results.find(
    (item) =>
      item.result.ok &&
      [
        "add_to_cart",
        "update_cart_item",
        "remove_from_cart",
        "clear_cart",
      ].includes(item.toolName)
  );
  if (cartResult?.result.ok) {
    return {
      kind: "final",
      message: copy.added,
      referencedProductIds: [],
      stateUpdate: { stage: "cart_review" },
    };
  }
  const staffResult = results.find(
    (item) =>
      item.result.ok &&
      ["request_waiter", "request_bill"].includes(item.toolName)
  );
  if (staffResult) {
    return {
      kind: "final",
      message:
        staffResult.toolName === "request_bill"
          ? billRequested(voice)
          : waiterCalled(voice),
      referencedProductIds: [],
      stateUpdate: { stage: "service_request" },
    };
  }
  const viewCartResult = results.find(
    (item) => item.result.ok && item.toolName === "view_cart"
  );
  if (viewCartResult?.result.ok) {
    const lines =
      viewCartResult.result.toolName === "view_cart"
        ? viewCartResult.result.data.cart.lines
        : [];
    return {
      kind: "final",
      message: lines.length
        ? `${copy.viewedCart} ${lines
            .map(
              (line) =>
                `${tProduct(
                  line.productId,
                  voice.language,
                  "name",
                  line.product.name
                )} × ${line.quantity}`
            )
            .join(", ")}`
        : cartEmpty(voice),
      referencedProductIds: [],
      stateUpdate: { stage: "cart_review" },
    };
  }
  const error = results.find((item) => !item.result.ok);
  if (error && !error.result.ok) {
    const requiredVariant = error.result.error.code === "required_variant_missing";
    const modifier =
      error.result.error.code === "unsupported_modifier" ||
      error.result.error.code === "requires_staff_confirmation";
    return {
      kind: "clarification",
      message: requiredVariant
        ? copy.clarifyVariant
        : modifier
          ? copy.clarifyModifier
          : copy.clarifyReference,
      unresolvedQuestion: {
        kind: requiredVariant
          ? "product_reference"
          : modifier
            ? "modifier_confirmation"
            : "other",
        promptKey: requiredVariant
          ? "required_variant"
          : modifier
            ? "unsupported_modifier"
            : "tool_error",
        relatedProductIds: request.context.state.latestReferencedProductIds,
      },
      ambiguity: request.context.state.ambiguity,
      stateUpdate: { stage: "clarifying" },
    };
  }
  return {
    kind: "clarification",
    message: copy.noResults,
    unresolvedQuestion: {
      kind: "other",
      promptKey: "no_grounded_match",
      relatedProductIds: [],
    },
    ambiguity: null,
    stateUpdate: { stage: "clarifying" },
  };
}

export class DeterministicFallbackProvider implements AIProvider {
  readonly providerId = "deterministic-fallback";

  isAvailable(): boolean {
    return true;
  }

  generateStep(request: AIProviderStepRequest): Promise<unknown> {
    const lastExchange = request.exchanges.at(-1);
    if (lastExchange) {
      return Promise.resolve(resultStep(request, lastExchange.results));
    }

    const { context } = request;
    const voice = voiceFor(request);
    const copy = copyFor(voice);
    const message = normalize(context.customerMessage);
    const categoryRequest = recommendationCategory(request);
    if (/\b(saskait\w*|bill)\b|сч[её]т/u.test(message)) {
      return Promise.resolve({
        kind: "tool_requests",
        toolCalls: [
          { callId: "fallback_bill", toolName: "request_bill", input: {} },
        ],
      } satisfies ProviderStep);
    }
    if (/\b(padavej\w*|waiter)\b|официант/u.test(message)) {
      return Promise.resolve({
        kind: "tool_requests",
        toolCalls: [
          {
            callId: "fallback_waiter",
            toolName: "request_waiter",
            input: {},
          },
        ],
      } satisfies ProviderStep);
    }
    if (
      /(?:\b(parodyk|show|view)\b|покаж)[^.!?]{0,40}(?:\b(krepsel\w*|cart)\b|корзин)/u.test(
        message
      )
    ) {
      return Promise.resolve({
        kind: "tool_requests",
        toolCalls: [
          { callId: "fallback_view_cart", toolName: "view_cart", input: {} },
        ],
      } satisfies ProviderStep);
    }
    if (
      /(?:\b(isvalyk|istustink|clear|empty)\b|очист|опустош)[^.!?]{0,30}(?:\b(krepsel\w*|cart)\b|корзин)/u.test(
        message
      )
    ) {
      return Promise.resolve({
        kind: "tool_requests",
        toolCalls: [
          {
            callId: "fallback_clear",
            toolName: "clear_cart",
            input: { confirm: true },
          },
        ],
      } satisfies ProviderStep);
    }
    if (/\b(pakeisk|atnaujink|update|change)\b|измен|обнов/u.test(message)) {
      const secondLine = /\b(antr\w*|second)\b|втор/u.test(message);
      const line = secondLine ? context.cart.lines[1] : context.cart.lines[0];
      const quantityMatch = message.match(/\b(\d{1,2})\b/u);
      const quantity = quantityMatch ? Number(quantityMatch[1]) : null;
      if (!line || !quantity || quantity < 1 || quantity > 20) {
        return Promise.resolve({
          kind: "clarification",
          message: copy.clarifyReference,
          unresolvedQuestion: {
            kind: "cart_line_reference",
            promptKey: "missing_cart_line_or_quantity",
            relatedProductIds: [],
          },
          ambiguity: null,
          stateUpdate: { stage: "clarifying" },
        } satisfies ProviderStep);
      }
      return Promise.resolve({
        kind: "tool_requests",
        toolCalls: [
          {
            callId: "fallback_update",
            toolName: "update_cart_item",
            input: { lineId: line.lineId, quantity },
          },
        ],
      } satisfies ProviderStep);
    }
    if (/\b(pasalink|isimk|remove)\b|удал|убер/u.test(message)) {
      const secondLine = /\b(antr\w*|second)\b|втор/u.test(message);
      const line = secondLine ? context.cart.lines[1] : context.cart.lines[0];
      if (!line) {
        return Promise.resolve({
          kind: "clarification",
          message: copy.clarifyReference,
          unresolvedQuestion: {
            kind: "cart_line_reference",
            promptKey: "missing_cart_line",
            relatedProductIds: [],
          },
          ambiguity: null,
          stateUpdate: { stage: "clarifying" },
        } satisfies ProviderStep);
      }
      return Promise.resolve({
        kind: "tool_requests",
        toolCalls: [
          {
            callId: "fallback_remove",
            toolName: "remove_from_cart",
            input: { lineId: line.lineId },
          },
        ],
      } satisfies ProviderStep);
    }
    const foodSafetyOrSelection =
      /\b(valgyti|patiekal|maist|eat|food|dish|safe|saug\w*|recommend|pasiulyk|noriu)\b|ед|блюд|безопас|рекоменд|хочу/u.test(
        message
      );
    if (
      (context.state.allergies.length > 0 && foodSafetyOrSelection) ||
      /\b(alerg\w*|allerg\w*)\b|аллерг/u.test(message)
    ) {
      return Promise.resolve({
        kind: "staff_escalation",
        message: copy.allergy,
        recommendedAction: "none",
        stateUpdate: { stage: "clarifying" },
      } satisfies ProviderStep);
    }
    if (
      /\b(be |without|papildomai |extra |gerai iske|well[- ]done)\S+|без\s+\S+|добав(?:ьте|ь)?\s+ещ[её]/u.test(
        message
      )
    ) {
      return Promise.resolve({
        kind: "clarification",
        message: copy.clarifyModifier,
        unresolvedQuestion: {
          kind: "modifier_confirmation",
          promptKey: "unsupported_modifier",
          relatedProductIds: context.state.latestReferencedProductIds,
        },
        ambiguity: context.state.ambiguity,
        stateUpdate: { stage: "clarifying" },
      } satisfies ProviderStep);
    }

    const same =
      /\b(tok[iy] pat|same)\b|тако[йе]\s+же/u.test(message);
    const add = /\b(pridek|add|imsiu|take)\b|добав|полож/u.test(message);
    const reference =
      context.state.latestReferencedProductIds[referencedOrdinal(message)];
    if ((add || same) && reference) {
      const grounded = context.relevantProducts.find(
        (product) => product.productId === reference
      );
      if (grounded?.orderability.status === "requires_variant") {
        return Promise.resolve({
          kind: "clarification",
          message: copy.clarifyVariant,
          unresolvedQuestion: {
            kind: "product_reference",
            promptKey: "required_variant",
            relatedProductIds: [reference],
          },
          ambiguity: null,
          stateUpdate: { stage: "clarifying" },
        } satisfies ProviderStep);
      }
      return Promise.resolve({
        kind: "tool_requests",
        toolCalls: [
          {
            callId: "fallback_add",
            toolName: "add_to_cart",
            input: {
              productId: reference,
              quantity: 1,
              modifiers: [],
              customerNote:
                context.customerMessage.match(
                  /(?:pastaba|note|примечание)\s*:\s*([^.!?\n]{1,180})/iu
                )?.[1]?.trim() ?? null,
            },
          },
        ],
      } satisfies ProviderStep);
    }
    if (add || same) {
      return Promise.resolve({
        kind: "clarification",
        message: copy.clarifyReference,
        unresolvedQuestion: {
          kind: "product_reference",
          promptKey: "missing_reference",
          relatedProductIds: [],
        },
        ambiguity: context.state.ambiguity,
        stateUpdate: { stage: "clarifying" },
      } satisfies ProviderStep);
    }

    if (
      (/\b(labas|sveiki|hello|hi|hey)\b/u.test(message) ||
        /привет|здравств/u.test(message)) &&
      !/\b(noriu|want|recommend|pasiulyk|parodyk|something|kazko)\b|хочу|рекоменд|покаж/u.test(
        message
      )
    ) {
      return Promise.resolve({
        kind: "final",
        message: greeting(voice),
        referencedProductIds: [],
        stateUpdate: { stage: "discovering_preferences" },
      } satisfies ProviderStep);
    }

    const recommendationRequested =
      categoryRequest.explicitCategory ||
      (categoryRequest.contextualFollowUp &&
        (Boolean(categoryRequest.category) ||
          context.state.latestReferencedProductIds.length > 0)) ||
      /\b(noriu|want|recommend|rekomend\w*|pasiulyk|parodyk|something|kazko|vegetar\w*|beef|jautien\w*|nenoriu|nemegstu|nepatinka|dont like|do not like)\b|хочу|рекоменд|посовет|покаж|вегетари|говядин|не\s+люблю|не\s+хочу/u.test(
        message
      );

    if (recommendationRequested) {
      return Promise.resolve({
        kind: "tool_requests",
        toolCalls: [
          {
            callId: "fallback_recommend",
            toolName: "recommend_products",
            input: {
              ...(categoryRequest.category
                ? { category: categoryRequest.category }
                : {}),
              ...(context.state.budget
                ? { maxPrice: context.state.budget }
                : {}),
              excludeProductIds:
                context.state.latestReferencedProductIds,
              dietaryRequirements: context.state.dietaryRequirements,
              allergies: context.state.allergies,
              limit: RECOMMENDATION_POOL,
            },
          },
        ],
      } satisfies ProviderStep);
    }

    const chat = detectSmallTalk(context.customerMessage);
    if (chat) {
      return Promise.resolve({
        kind: "final",
        message: smallTalk(chat, voice),
        referencedProductIds: [],
        stateUpdate: { stage: "discovering_preferences" },
      } satisfies ProviderStep);
    }

    if (context.restaurantKnowledge.length > 0) {
      return Promise.resolve({
        kind: "final",
        message:
          context.language === "lt"
            ? "Štai ką galiu pasakyti:"
            : context.language === "en"
              ? "Here's what I can tell you:"
              : "Вот что могу сказать:",
        referencedProductIds: [],
        claims: context.restaurantKnowledge.map((record) => ({
          claimType: "restaurant_fact" as const,
          proposedValue: record.value,
          provenance: "restaurant_knowledge" as const,
        })),
      } satisfies ProviderStep);
    }

    return Promise.resolve({
      kind: "final",
      message: copy.generic,
      referencedProductIds: [],
      stateUpdate: { stage: "discovering_preferences" },
    } satisfies ProviderStep);
  }
}
