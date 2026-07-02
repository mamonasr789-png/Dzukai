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
import { normalizeText } from "./synonyms.ts";
import { clearPendingSuggestion } from "./confirmationContext.ts";
import type { Category } from "../data.ts";

export interface CartResolution {
  text: string;
  actions: AssistantAction[];
}

// ── Patterns ──────────────────────────────────────────────────────────────────

// NOTE: \b does not work for Cyrillic in JS regex (word chars are ASCII-only),
// so Russian triggers live in a separate boundary-free pattern below.
const ORDERING_TRIGGERS_LATIN =
  /\b(taip|jo|gerai|ok|okay|tinka|noriu|noreciau|noréciau|paimsu|paimsiu|imsiu|dedam|uzsakau|uzsisakau|prasom|prasau|imk|sure|yes|take|have)\b|\bi'?ll\b/i;

const ORDERING_TRIGGERS_CYRILLIC =
  /(возьму|беру|давай|закажу|хочу|хорошо|ладно)|(^|\s)да($|[\s,.!?])/i;

function isOrderingTrigger(input: string): boolean {
  return ORDERING_TRIGGERS_LATIN.test(input) || ORDERING_TRIGGERS_CYRILLIC.test(input);
}

const REPEAT_TRIGGERS =
  /\b(dar viena\b|dar vienu\b|tokio pat|toki pat|ta pati|ta pat\b)\b/i;

// Standalone pronoun references (without pairing/question context)
// "šitą/šito" (this one), "tą" (that one) — all normalized
const PRONOUN_REFS = /\b(sita|sito|ta\b)\b/i;

// Words that signal a question or pairing request — block pronoun cart-add
const PAIRING_GUARD =
  /\b(prie|gerti|atsig|valgyti|rekomenduot|kas|ka|koki|kur|kodel|kiek|ar yra|ar turi)\b/i;

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasNewSemanticContent(entities: NLUResult["entities"]): boolean {
  return !!(
    entities.protein ||
    entities.category ||
    entities.drinkType ||
    entities.moodFilling ||
    entities.moodLight ||
    entities.moodSpicy ||
    entities.vegetarian ||
    entities.vegan
  );
}

function isOrderingIntent(input: string): boolean {
  return isOrderingTrigger(input);
}

// ── Ordinal / superlative selection from last recommendations ────────────────

/** Parse "pirmą/antrą/…", "first/second/…", "первое/второе/…" → 0-based index, or
 *  "pigiausią/cheapest" / "brangiausią/most expensive" → price-based pick. */
function selectFromRecommendations(
  input: string,
  state: ConversationState
): ReturnType<typeof findById> {
  if (state.lastRecommendedIds.length === 0) return undefined;
  const candidates = state.lastRecommendedIds
    .map(findById)
    .filter((p): p is NonNullable<ReturnType<typeof findById>> => p !== undefined);
  if (candidates.length === 0) return undefined;

  const ordinals: [RegExp, number][] = [
    [/\b(pirm\w*|first)\b|перв/i, 0],
    [/\b(antr\w*|second)\b|втор/i, 1],
    [/\b(trec\w*|third)\b|трет/i, 2],
    [/\b(ketvirt\w*|fourth)\b|четверт/i, 3],
    [/\b(penkt\w*|fifth)\b|пят/i, 4],
  ];
  for (const [re, idx] of ordinals) {
    if (re.test(input)) return candidates[idx]; // undefined if out of range → caller skips
  }

  if (/\b(paskutin\w*|last one|last)\b|последн/i.test(input)) {
    return candidates[candidates.length - 1];
  }
  if (/\b(pigiaus\w*|cheapest)\b|дешев/i.test(input)) {
    return [...candidates].sort((a, b) => a.price - b.price)[0];
  }
  if (/\b(brangiaus\w*|most expensive|priciest)\b|дорог/i.test(input)) {
    return [...candidates].sort((a, b) => b.price - a.price)[0];
  }
  return undefined;
}

// ── Specific-name guard ───────────────────────────────────────────────────────

/** Generic protein/category words that indicate browsing, not a specific order. */
const GENERIC_FOOD_TOKEN =
  /^(kiaulien\w*|jautien\w*|vistien\w*|verslien\w*|avien\w*|zuv\w*|mes[ao]s?|maisto|patiekal\w*)$/;

/**
 * True when the input contains at least one non-generic word that actually
 * appears (stem-wise) in the matched product's name. Prevents "noriu kiaulienos"
 * from adding an arbitrary pork product to the cart.
 */
function hasSpecificNameToken(
  input: string,
  product: NonNullable<ReturnType<typeof findById>>
): boolean {
  const name = normalizeText(product.name);
  return input.split(/\s+/).some((w) => {
    if (w.length < 5 || GENERIC_FOOD_TOKEN.test(w)) return false;
    const stem = w.slice(0, Math.max(4, w.length - 2));
    return name.includes(stem);
  });
}

// ── Quantity parsing ──────────────────────────────────────────────────────────

/** "dvi picas", "tris", "2", "two", "две" → quantity (default 1, capped at 10). */
function parseQuantity(input: string): number {
  const digit = input.match(/\b([2-9]|10)\b/);
  if (digit) return parseInt(digit[1], 10);
  const words: [RegExp, number][] = [
    [/\b(du|dvi|dvieju|two)\b|(^|\s)(два|две)($|\s)/i, 2],
    [/\b(tris|triju|three)\b|(^|\s)три($|\s)/i, 3],
    [/\b(keturis|keturiu|four)\b|(^|\s)четыре($|\s)/i, 4],
    [/\b(penkis|penkiu|five)\b|(^|\s)пять($|\s)/i, 5],
  ];
  for (const [re, n] of words) {
    if (re.test(input)) return n;
  }
  return 1;
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
  const qty = quantity > 1 ? ` ×${quantity}` : "";
  const text =
    lang === "en"
      ? `**${product.name}**${qty} added to your cart! 🛒 Anything else?`
      : lang === "ru"
      ? `**${product.name}**${qty} добавлен в корзину! 🛒 Что-нибудь ещё?`
      : `**${product.name}**${qty} pridėta į krepšelį! 🛒 Ar reikia ko nors dar?`;

  return { text, actions };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function resolveCartAction(
  normalizedInput: string,
  entities: NLUResult["entities"],
  state: ConversationState,
  lang: string
): CartResolution | null {
  // NEGATION GUARD — "ne šitą", "ne, nenoriu", "not this one" must NEVER add
  // to cart. The only exception is the mind-change swap ("ne, palauk, geriau
  // antrą") which is handled by case 0a below and explicitly requires a
  // swap keyword.
  const startsNegative =
    /^\s*((nu|na|o|ai|tai|e)\s+)?(ne|nea|no|nope|not|нет)\b/i.test(normalizedInput) ||
    /\b(nenoriu|nereikia|netinka|not this|not that)\b/i.test(normalizedInput);
  const hasSwapKeyword = /\b(geriau|verciau|pakeisk|palauk)\b|лучше|замени/i.test(normalizedInput);
  if (startsNegative && !hasSwapKeyword) return null;

  const containsOrdinalWord =
    /\b(pirm\w*|antr\w*|trec\w*|ketvirt\w*|penkt\w*|paskutin\w*|pigiaus\w*|brangiaus\w*|first|second|third|fourth|fifth|last|cheapest)\b|перв|втор|трет|последн|дешев|дорог/i.test(
      normalizedInput
    );

  // 0a. Swap: "ne, palauk, geriau antrą" — replace the just-added product with
  //     an ordinal pick from the still-visible recommendation list.
  if (
    state.lastCartAddedProductId &&
    /\b(geriau|verciau|pakeisk|palauk)\b|лучше|замени/i.test(normalizedInput)
  ) {
    const pick = selectFromRecommendations(normalizedInput, state);
    if (pick && pick.id !== state.lastCartAddedProductId) {
      const old = findById(state.lastCartAddedProductId);
      if (old) {
        const swap = buildResolution(pick, parseQuantity(normalizedInput), lang, state);
        swap.actions.unshift({ type: "REMOVE_FROM_CART", productId: old.id });
        swap.text =
          lang === "en"
            ? `Swapped **${old.name}** for **${pick.name}**! 🛒 Anything else?`
            : lang === "ru"
            ? `Заменил **${old.name}** на **${pick.name}**! 🛒 Что-нибудь ещё?`
            : `Pakeičiau: **${old.name}** → **${pick.name}**! 🛒 Ar reikia ko nors dar?`;
        return swap;
      }
    }
  }

  // 0. Ordinal / superlative selection from the shown list — "tą antrą", "pigiausią",
  //    "the first one", "возьму первое". Ordering verb OR bare ordinal both work
  //    when a fresh recommendation is on the table.
  if (
    state.hasUnclaimedRecommendation &&
    !PAIRING_GUARD.test(normalizedInput) &&
    !hasNewSemanticContent(entities)
  ) {
    const ordinalPick = selectFromRecommendations(normalizedInput, state);
    if (ordinalPick) {
      return buildResolution(ordinalPick, parseQuantity(normalizedInput), lang, state);
    }
    // Ordinal word present but out of range ("imsiu penktą" with 3 shown) —
    // don't blind-add the context product via case 4 below.
    if (containsOrdinalWord) return null;
  }

  // 1. Named product (inflected) + ordering verb + active recommendation context
  //    Only fires if hasUnclaimedRecommendation — prevents cold-start cart adds.
  //    Guard: "noriu kiaulienos" is a category BROWSE, not an order for a specific
  //    product — require a non-generic name token before adding to cart.
  if (state.hasUnclaimedRecommendation || (state.awaitingConfirmation && state.pendingSuggestion)) {
    const namedProduct = findProductByInflectedName(normalizedInput);
    if (
      namedProduct &&
      isOrderingIntent(normalizedInput) &&
      hasSpecificNameToken(normalizedInput, namedProduct)
    ) {
      return buildResolution(namedProduct, parseQuantity(normalizedInput), lang, state);
    }
  }

  // 2. Repeat request ("dar vieną", "tokio pat")
  //    If a specific product is named ("dar vieną limonadą"), add it.
  //    Otherwise repeat the last cart-added product.
  if (REPEAT_TRIGGERS.test(normalizedInput)) {
    const namedProduct = findProductByInflectedName(normalizedInput);
    if (namedProduct) return buildResolution(namedProduct, 1, lang, state);
    if (state.lastCartAddedProductId) {
      const product = findById(state.lastCartAddedProductId);
      if (product) return buildResolution(product, 1, lang, state);
    }
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
  //    not a confirmation word. isPureConfirmation blocks "noriu kažko soatus"
  //    (typo'd content word) from blind-adding the context product.
  if (
    isOrderingTrigger(normalizedInput) &&
    !PAIRING_GUARD.test(normalizedInput) &&
    !hasNewSemanticContent(entities) &&
    isPureConfirmation(normalizedInput) &&
    state.hasUnclaimedRecommendation
  ) {
    const product = resolveContextProduct(state);
    if (product) return buildResolution(product, parseQuantity(normalizedInput), lang, state);
  }

  return null;
}

// Words allowed in a "pure confirmation" — triggers, fillers, pronouns, quantities.
const CONFIRMATION_FILLER =
  /^(taip|jo|gerai|ok|okay|okey|tinka|noriu|noreciau|paimsu|paimsiu|imsiu|imk|dedam|uzsakau|uzsisakau|prasom|prasau|sure|yes|take|have|ill|i'll|it|the|one|да|возьму|беру|давай|хорошо|ладно|хочу|nu|na|ai|tai|tada|siandien|dabar|kazka|kazko|sita|sito|ta|to|tą|si|gal|dar|viena|vieno|du|dvi|tris|and|ir|of|a)$/;

/**
 * True when the message contains ONLY confirmation/filler words — nothing that
 * looks like new (possibly misspelled) content. "Taip, imsiu" → true.
 * "Noriu kažko soatus" → false ("soatus" is unrecognized content).
 */
function isPureConfirmation(normalizedInput: string): boolean {
  return normalizedInput
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .every((w) => w.length <= 2 || CONFIRMATION_FILLER.test(w.replace(/[.,!?]+$/, "")));
}
