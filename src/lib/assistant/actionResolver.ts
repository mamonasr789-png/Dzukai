/**
 * General cart action resolver.
 *
 * Runs AFTER NLU so entities are available for semantic-content guards.
 * Returns a CartResolution when a clear ordering intent + product context exists,
 * or null to let the normal recommendation flow continue.
 *
 * Priority:
 *   1. Named product (inflected) + ordering verb + unclaimed recommendation context
 *   2. Repeat trigger ("dar vieną") + recent cart-added product
 *   3. Pronoun reference ("šitą") + unclaimed recommendation + no pairing/question keywords
 *   4. Pure ordering signal + no new semantic content + unclaimed recommendation
 */

import type { AssistantAction, ConversationState, NLUResult } from "./types.ts";
import { findById, findProductByInflectedName, FOOD_CATEGORIES } from "./menuSearch.ts";
import { clearPendingSuggestion } from "./confirmationContext.ts";
import type { Category } from "../data.ts";

export interface CartResolution {
  text: string;
  actions: AssistantAction[];
}

// ── Patterns ──────────────────────────────────────────────────────────────────

const ORDERING_TRIGGERS =
  /\b(taip|jo|gerai|ok|okay|tinka|noriu|paimsu|paimsiu|imsiu|dedam|uzsakau|uzsisakau|prasom|imk|sure|yes|да|хорошо|возьму)\b/i;

const REPEAT_TRIGGERS =
  /\b(dar viena\b|dar vienu\b|tokio pat|toki pat)\b/i;

// Standalone pronoun references (without pairing/question context)
const PRONOUN_REFS = /\b(sita|sito)\b/i;

// Words that signal a question or pairing request — block pronoun cart-add
const PAIRING_GUARD =
  /\b(prie|gerti|atsig|valgyti|rekomenduot|kas|ka|koki|kur|kodel|kiek|ar yra|ar turi)\b/i;

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasNewSemanticContent(entities: NLUResult["entities"]): boolean {
  return !!(entities.protein || entities.category || entities.drinkType);
}

function isOrderingIntent(input: string): boolean {
  return ORDERING_TRIGGERS.test(input);
}

/** Resolve which product the user is referring to: pending suggestion takes priority. */
function resolveContextProduct(
  state: ConversationState
): ReturnType<typeof findById> {
  if (state.awaitingConfirmation && state.pendingSuggestion) {
    return findById(state.pendingSuggestion.productId);
  }
  if (state.lastMentionedProductId) {
    return findById(state.lastMentionedProductId);
  }
  return undefined;
}

function buildResolution(
  product: NonNullable<ReturnType<typeof findById>>,
  quantity: number,
  lang: string,
  state: ConversationState
): CartResolution {
  // Update food context so follow-up pairing / ingredient questions still work
  if (FOOD_CATEGORIES.includes(product.category as Category)) {
    state.lastFoodDishId = product.id;
    state.activeDishId = product.id;
  }
  state.lastMentionedProductId = product.id;
  state.lastCartAddedProductId = product.id;
  state.hasUnclaimedRecommendation = false;
  clearPendingSuggestion(state);

  const actions: AssistantAction[] = [{ type: "ADD_TO_CART", productId: product.id, quantity }];
  const text =
    lang === "en"
      ? `**${product.name}** added to your cart! 🛒 Anything else?`
      : lang === "ru"
      ? `**${product.name}** добавлен в корзину! 🛒 Что-нибудь ещё?`
      : `**${product.name}** pridėta į krepšelį! 🛒 Ar reikia ko nors dar?`;

  return { text, actions };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function resolveCartAction(
  normalizedInput: string,
  entities: NLUResult["entities"],
  state: ConversationState,
  lang: string
): CartResolution | null {
  // 1. Named product (inflected) + ordering verb + active recommendation context
  //    Only fires if hasUnclaimedRecommendation — prevents cold-start cart adds
  //    and prevents adding on random "noriu X" when X is a category browse word.
  if (state.hasUnclaimedRecommendation || (state.awaitingConfirmation && state.pendingSuggestion)) {
    const namedProduct = findProductByInflectedName(normalizedInput);
    if (namedProduct && isOrderingIntent(normalizedInput)) {
      return buildResolution(namedProduct, 1, lang, state);
    }
  }

  // 2. Repeat request ("dar vieną", "tokio pat") — add the same product again
  if (REPEAT_TRIGGERS.test(normalizedInput) && state.lastCartAddedProductId) {
    const product = findById(state.lastCartAddedProductId);
    if (product) return buildResolution(product, 1, lang, state);
  }

  // 3. Pronoun reference ("šitą") without question/pairing keywords
  if (
    PRONOUN_REFS.test(normalizedInput) &&
    !PAIRING_GUARD.test(normalizedInput) &&
    state.hasUnclaimedRecommendation
  ) {
    const product = resolveContextProduct(state);
    if (product) return buildResolution(product, 1, lang, state);
  }

  // 4. Pure ordering signal + no new semantic content + fresh recommendation exists.
  //    PAIRING_GUARD blocks "ką prie jo gerti?" where "jo" is a genitive pronoun,
  //    not a confirmation word.
  if (
    ORDERING_TRIGGERS.test(normalizedInput) &&
    !PAIRING_GUARD.test(normalizedInput) &&
    !hasNewSemanticContent(entities) &&
    state.hasUnclaimedRecommendation
  ) {
    const product = resolveContextProduct(state);
    if (product) return buildResolution(product, 1, lang, state);
  }

  return null;
}
