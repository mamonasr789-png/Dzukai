/**
 * Confirmation context — tracks pending suggestions awaiting user confirmation.
 *
 * When the assistant suggests a specific product (e.g. the beer tasting board
 * mentioned in a beer recommendation tail), it calls setPendingSuggestion.
 * On the next turn, tryResolveConfirmation checks whether the user confirmed
 * and executes the pending action — without any new search or NLU routing.
 *
 * This is purely memory management: no intent detection, no product search.
 */

import type { AssistantAction, ConversationState } from "./types.ts";
import { findById } from "./menuSearch.ts";
import { normalizeText } from "./synonyms.ts";
import { tProduct } from "../product-translations.ts";

// ── Patterns ──────────────────────────────────────────────────────────────────

const POSITIVE = /^(taip|jo|gerai|ok|okay|tinka|tinkamas|puiku|noriu|paimsu|imsiu|uzsakau|uzsisakau|prasom|imk|yes|sure|yep|da|horoshow|vozmу|voz'mu)\b/i;
const NEGATIVE = /^(ne|nope|nereikia|netinka|nenoriu|nieko|no|нет|не надо)\b/i;

// ── Public API ────────────────────────────────────────────────────────────────

/** Register a product as a pending suggestion awaiting confirmation. */
export function setPendingSuggestion(state: ConversationState, productId: string): void {
  state.pendingSuggestion = { productId, action: "add_to_cart" };
  state.awaitingConfirmation = true;
}

/** Discard any pending suggestion without executing it. */
export function clearPendingSuggestion(state: ConversationState): void {
  state.pendingSuggestion = undefined;
  state.awaitingConfirmation = false;
}

/**
 * Check if user's input resolves the pending confirmation.
 *
 * Positive answer  → executes the pending action, returns { resolved: true }
 * Negative answer  → clears pending suggestion, returns { resolved: false }
 *                    so normal negative-answer flow continues
 * Anything else    → returns { resolved: false } leaving suggestion pending
 *
 * Never performs intent detection or product search — pure memory check.
 */
export function tryResolveConfirmation(
  rawInput: string,
  state: ConversationState
): { resolved: true; text: string; actions: AssistantAction[] } | { resolved: false } {
  if (!state.awaitingConfirmation || !state.pendingSuggestion) {
    return { resolved: false };
  }

  const normalized = normalizeText(rawInput);

  if (NEGATIVE.test(normalized)) {
    clearPendingSuggestion(state);
    return { resolved: false };
  }

  if (!POSITIVE.test(normalized)) {
    return { resolved: false };
  }

  const product = findById(state.pendingSuggestion.productId);
  if (!product) {
    clearPendingSuggestion(state);
    return { resolved: false };
  }

  clearPendingSuggestion(state);
  const actions: AssistantAction[] = [{ type: "ADD_TO_CART", productId: product.id, quantity: 1 }];
  const lang = state.currentLanguage;
  const productName = tProduct(product.id, lang, "name", product.name);
  const text =
    lang === "en"
      ? `**${productName}** added to your cart! 🛒 Anything else?`
      : lang === "ru"
      ? `**${productName}** добавлен в корзину! 🛒 Что-нибудь ещё?`
      : `**${productName}** pridėta į krepšelį! 🛒 Ar reikia ko nors dar?`;

  return { resolved: true, text, actions };
}

/** Returns true for intent names that are clearly non-confirmation (new topic). */
export function isConfirmationIntent(intent: string): boolean {
  return (
    intent === "positive_answer" ||
    intent === "confirmation" ||
    intent === "negative_answer" ||
    intent === "change_recommendation"
  );
}
