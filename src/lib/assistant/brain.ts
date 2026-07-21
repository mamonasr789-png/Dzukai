/**
 * Brain — the main orchestrator.
 *
 * Flow for every user message:
 *   1. Detect intent (intentEngine)
 *   2. Determine conversation mode
 *   3. Update memory/preferences (memory)
 *   4. Route by mode to appropriate sub-flow
 *   5. Validate category correctness
 *   6. Build and return response (responseBuilder)
 *   7. Update conversation state
 *
 * Designed for future extensibility: each step can be replaced or enhanced
 * without changing the orchestration logic.
 */

import { detectIntent } from "./intentEngine.ts";
import { determineConversationMode } from "./conversationMode.ts";
import { validateResponse } from "./responseValidator.ts";
import { updateMemory } from "./memory.ts";
import {
  createState,
  recordTurn,
  setRecommended,
  resetShownProducts,
} from "./conversationState.ts";
import {
  recommend,
  recommendDrinks,
  recommendDesserts,
  recommendKids,
  recommendPopular,
} from "./recommendationEngine.ts";
import {
  pairForFood,
  pairForCategory,
  defaultPairing,
} from "./pairingEngine.ts";
import { buildResponse } from "./responseBuilder.ts";
import { getFullInfo, getHours } from "./knowledgeBase.ts";
import { findById, findDishReference, findProductByInflectedName, matchProductName, FOOD_CATEGORIES, DRINK_CATEGORIES, allProducts, categoriesForProtein, byCategory } from "./menuSearch.ts";
import { normalizeText } from "./synonyms.ts";
import { isAlcoholicProduct } from "./restrictionEngine.ts";
import { answerAvailability } from "./availabilitySearch.ts";
import {
  setPendingSuggestion,
  clearPendingSuggestion,
  isConfirmationIntent,
} from "./confirmationContext.ts";
import { resolveCartAction } from "./actionResolver.ts";
import { keywordSearch, pickKeywordResults } from "./keywordSearch.ts";
import { applyFilters, applyHardFilters } from "./filterEngine.ts";
import type { AssistantAction, ConversationMode, ConversationState, NLUResult } from "./types.ts";
import type { Category, Product } from "../data.ts";
import { tProduct } from "../product-translations.ts";

export type { ConversationState };
export { createState };

/**
 * Process a single user message and return the assistant reply.
 * Mutates `state` in place.
 */
export function processMessage(input: string, state: ConversationState): string {
  state.pendingActions = [];

  const previousRecommendationIds = [...state.lastRecommendedIds];

  // 1. Detect intent
  const nlu = detectIntent(input, state);

  // Clear stale pending suggestion when user moves to a new topic or declines
  if (state.awaitingConfirmation) {
    if (!isConfirmationIntent(nlu.intent) || nlu.intent === "negative_answer") {
      clearPendingSuggestion(state);
    }
  }

  // 2. Determine mode before product search
  const mode = determineConversationMode(nlu, state);

  // 3. Update memory (sets preferredProtein, diet flags, etc.)
  const restrictionUpdate = updateMemory(state, nlu);

  // 4. General cart action resolution — runs AFTER NLU so entities are available.
  //    Handles: "taip", "noriu degustacijos", "šitą", "dar vieną", etc.
  const cartResolution = nlu.intent === "add_to_cart"
    ? null
    : resolveCartAction(
        nlu.normalizedInput,
        nlu.entities,
        state,
        state.currentLanguage
      );
  if (cartResolution) {
    state.pendingActions = cartResolution.actions;
    recordTurn(state, "user", input, nlu.intent);
    recordTurn(state, "assistant", cartResolution.text, undefined, state.lastRecommendedIds);
    state.currentIntent = nlu.intent;
    return cartResolution.text;
  }

  // 5. Route by mode and validate category correctness
  const availability = answerAvailability(input, state);
  const reply = availability
    ? handleAvailabilityResult(availability, state)
    : restrictionUpdate.alcoholRestricted && hadAlcoholRecommendation(previousRecommendationIds)
    ? handleAlcoholRestrictionCorrection(state)
    : routeWithValidation(mode, nlu, state);

  // 6. Record conversation turn
  recordTurn(state, "user", input, nlu.intent);
  recordTurn(state, "assistant", reply, undefined, state.lastRecommendedIds);
  state.currentIntent = nlu.intent;

  return reply;
}

// ── Router ────────────────────────────────────────────────────────────────────

const CART_INTENTS = new Set(["add_to_cart", "remove_from_cart", "cart_summary", "clear_cart", "greeting"]);

function routeWithValidation(
  mode: ConversationMode,
  nlu: NLUResult,
  state: ConversationState
): string {
  const reply = route(mode, nlu, state);
  // Cart intents don't produce food/drink recommendations — skip category validation
  if (CART_INTENTS.has(nlu.intent)) return reply;
  if (validateResponse(mode, state)) return reply;
  return fallbackForMode(mode, state);
}

function route(
  mode: ConversationMode,
  nlu: NLUResult,
  state: ConversationState
): string {
  if (nlu.intent === "greeting") {
    const lang = state.currentLanguage;
    return lang === "en"
      ? "Hello! What are you in the mood for today — something hearty, light, or maybe a drink?"
      : lang === "ru"
      ? "Здравствуйте! Что вам сегодня по настроению — сытное, лёгкое или, может, напиток?"
      : "Sveiki! Ko šiandien norėtumėte — ko nors sotaus, lengvo, o gal gėrimo?";
  }
  if (nlu.intent === "opening_hours") {
    return buildResponse({ intent: "opening_hours", infoText: getHours(state.currentLanguage) }, state);
  }
  if (nlu.intent === "restaurant_info") {
    return buildResponse({ intent: "restaurant_info", infoText: getFullInfo(state.currentLanguage) }, state);
  }

  if (nlu.intent === "add_to_cart") return handleAddToCart(nlu, state);
  if (nlu.intent === "remove_from_cart") return handleRemoveFromCart(nlu, state);
  if (nlu.intent === "cart_summary") return handleCartSummary(state);
  if (nlu.intent === "clear_cart") return handleClearCart(state);

  switch (mode) {
    case "DRINK_PAIRING":
      return handleDrinkPairing(nlu, state);
    case "DESSERT":
      return handleDessert(state, nlu.normalizedInput);
    case "ALLERGY":
      return handleAllergy(nlu, state);
    case "INGREDIENTS":
      return handleIngredients(nlu, state);
    case "PRICE":
      return handlePrice(nlu, state);
    case "MENU_SEARCH":
      return handleMenuSearch(nlu, state);
    case "BUDGET":
      return handleBudget(nlu, state);
    case "CHILDREN":
      return handleChildren(state);
    case "FOLLOW_UP":
      return handleFollowUp(nlu, state);
    case "FOOD_RECOMMENDATION":
    default:
      return handleFoodRecommendation(nlu, state);
  }
}

function handleFoodRecommendation(nlu: NLUResult, state: ConversationState): string {
  // ── 1. Selection from context (e.g. "tą pirmą") ─────────────────────────
  if (!nlu.entities.protein && !nlu.entities.category) {
    const selectedFromContext = findSelectionFromLastRecommendations(nlu.normalizedInput, state);
    if (selectedFromContext) {
      state.selectedDishId = selectedFromContext.id;
      state.activeDishId = selectedFromContext.id;
      state.lastFoodDishId = selectedFromContext.id;
      return buildResponse({ intent: "confirmation" }, state);
    }
  }

  // ── 2. Exact dish alias (e.g. "lašiša", "šonkauliai") ───────────────────
  const directDish = findSpecificDishMention(nlu.normalizedInput);
  if (directDish && FOOD_CATEGORIES.includes(directDish.category as Category)) {
    const result = { products: [directDish], poolExhausted: false };
    setFoodRecommendations([directDish.id], false, state, directDish.category as Category);
    return buildResponse({ intent: "food_recommendation", result }, state);
  }

  // ── 3. Popular dishes shortcut ───────────────────────────────────────────
  if (nlu.intent === "popular_dishes") {
    const result = recommendPopular(state);
    setFoodRecommendations(result.products.map((p) => p.id), result.poolExhausted, state, nlu.entities.category);
    return buildResponse({ intent: "popular_dishes", result }, state);
  }

  // ── 4. Keyword search (Priority 1–3 of the search strategy) ─────────────
  // When the user names a category THIS TURN ("ne, vis dėlto picos"), the pool
  // is locked to that category — stray words must not hijack the search.
  // Otherwise two-tier: search both the narrowed pool and full pool, use
  // whichever scores higher ("Gyoza koldūnų su aviena" with protein=lamb still
  // finds k4 in koldumai because the full pool scores it higher).
  const narrowPool = nlu.entities.category
    ? byCategory(nlu.entities.category)
    : byFoodCategory(state);
  const narrowResult = keywordSearch(nlu.normalizedInput, narrowPool);
  const fullResult = !nlu.entities.category && narrowResult.topScore > 0
    ? keywordSearch(nlu.normalizedInput, byCategory(FOOD_CATEGORIES))
    : { products: [], topScore: 0, terms: narrowResult.terms };
  const kwResult = fullResult.topScore > narrowResult.topScore ? fullResult : narrowResult;

  if (kwResult.topScore > 0) {
    // Apply state constraints (allergens, diet, budget) to the ranked results
    const filtered = applyFilters(kwResult.products.map((r) => r.product), state);
    const picked = filtered.length > 0
      ? pickKeywordResults({ ...kwResult, products: kwResult.products.filter((r) => filtered.includes(r.product)) }, 3, state.lastRecommendedIds)
      : null;

    if (picked && picked.length > 0) {
      const result = { products: picked, poolExhausted: false };
      setFoodRecommendations(picked.map((p) => p.id), false, state, picked[0].category as Category);
      return buildResponse({ intent: "food_recommendation", result }, state);
    }
  }

  // ── 5. Fallback: category-based recommendation ───────────────────────────
  const result = recommend(state, { categoryOverride: nlu.entities.category, requireFresh: true });
  setFoodRecommendations(result.products.map((p) => p.id), result.poolExhausted, state, nlu.entities.category);
  const reply = buildResponse({ intent: "food_recommendation", result }, state);

  // "Ar turite sushi?" with zero keyword matches — be honest that we don't have it
  // instead of silently recommending unrelated dishes.
  if (kwResult.topScore === 0 && /\b(ar\s+)?(turite|turit|yra)\b/.test(nlu.normalizedInput)) {
    const lang = state.currentLanguage;
    const sorry =
      lang === "en"
        ? "Unfortunately we don't have that on the menu. Maybe one of these instead?"
        : lang === "ru"
        ? "К сожалению, этого нет в нашем меню. Может, что-то из этого?"
        : "Deja, tokio patiekalo mūsų meniu nėra. Gal vietoj to patiktų:";
    return `${sorry}\n${reply}`;
  }
  return reply;
}

/** All food products under the current protein/category preference (or all food). */
function byFoodCategory(state: ConversationState): Product[] {
  if (state.preferredCategory) {
    return byCategory(state.preferredCategory as Category);
  }
  if (state.preferredProtein) {
    return byCategory(categoriesForProtein(state.preferredProtein));
  }
  return byCategory(FOOD_CATEGORIES);
}

function handleDrinkPairing(nlu: NLUResult, state: ConversationState): string {
  const dish = findDishForTurn(nlu, state);
  if (dish && FOOD_CATEGORIES.includes(dish.category as Category)) {
    state.lastFoodDishId = dish.id;
    const pairing = pairForFood(dish, state);
    setRecommended(state, pairing.drinks.map((p) => p.id));
    return buildResponse({ intent: "pairing_request", pairing, result: { products: pairing.drinks, poolExhausted: false } }, state);
  }

  if (state.preferredCategory) {
    const pairing = pairForCategory(state.preferredCategory, state);
    setRecommended(state, pairing.drinks.map((p) => p.id));
    return buildResponse({ intent: "pairing_request", pairing, result: { products: pairing.drinks, poolExhausted: false } }, state);
  }

  const pairing = defaultPairing(state);
  setRecommended(state, pairing.drinks.map((p) => p.id));
  return buildResponse({ intent: "pairing_request", pairing, result: { products: pairing.drinks, poolExhausted: false } }, state);
}

function handleDessert(state: ConversationState, input?: string): string {
  // Try keyword search within desserts first (e.g. "noriu šokoladinio deserto")
  if (input) {
    const dessertPool = byCategory("desertai" as Category);
    const kwResult = keywordSearch(input, dessertPool);
    if (kwResult.topScore > 0) {
      const filtered = applyHardFilters(kwResult.products.map((r) => r.product), state);
      const picked = filtered.length > 0
        ? pickKeywordResults({ ...kwResult, products: kwResult.products.filter((r) => filtered.includes(r.product)) }, 3, state.lastRecommendedIds)
        : null;
      if (picked && picked.length > 0) {
        const result = { products: picked, poolExhausted: false };
        setRecommended(state, picked.map((p) => p.id));
        return buildResponse({ intent: "dessert_recommendation", result }, state);
      }
    }
  }
  const result = recommendDesserts(state);
  setRecommended(state, result.products.map((p) => p.id));
  return buildResponse({ intent: "dessert_recommendation", result }, state);
}

function handleAllergy(nlu: NLUResult, state: ConversationState): string {
  // "Turi ką be grybų?" is a FILTER request ("show me mushroom-free options"),
  // not a safety question about one dish — skip the specific-dish branch.
  const isFilterRequest = !!nlu.entities.dislike || /\bbe\s+\w+/.test(nlu.normalizedInput);
  const specificProduct = isFilterRequest ? undefined : findDishForTurn(nlu, state);
  if (specificProduct && nlu.intent === "allergy_question" && isSpecificDishSafetyQuestion(nlu.normalizedInput)) {
    state.lastFoodDishId = specificProduct.id;
    return buildResponse({ intent: "allergy_question", specificProduct }, state);
  }
  const result = recommend(state, { categoryOverride: nlu.entities.category, requireFresh: true });
  setFoodRecommendations(result.products.map((p) => p.id), result.poolExhausted, state, nlu.entities.category);
  return buildResponse({ intent: "food_recommendation", result }, state);
}

function handleIngredients(nlu: NLUResult, state: ConversationState): string {
  const specificProduct = findDishForTurn(nlu, state);
  if (specificProduct) state.lastFoodDishId = specificProduct.id;
  return buildResponse({ intent: "ingredient_question", specificProduct }, state);
}

function handlePrice(nlu: NLUResult, state: ConversationState): string {
  const product = findDishForTurn(nlu, state);
  if (!product) return buildResponse({ intent: "unknown" }, state);
  const lang = state.currentLanguage;
  state.lastRecommendedIds = [];
  if (FOOD_CATEGORIES.includes(product.category as Category)) state.lastFoodDishId = product.id;
  const productName = tProduct(product.id, lang, "name", product.name);
  const price = product.price > 0
    ? `${product.price.toFixed(2)} €`
    : lang === "en"
    ? "ask your waiter"
    : lang === "ru"
    ? "уточните у официанта"
    : "teirautis padavėjo";
  const priceNote = lang === "lt" && product.priceNote ? ` (${product.priceNote})` : "";
  return lang === "en"
    ? `**${productName}** costs ${price}${priceNote}.`
    : lang === "ru"
    ? `**${productName}** стоит ${price}${priceNote}.`
    : `**${productName}** kainuoja ${price}${priceNote}.`;
}

function handleMenuSearch(nlu: NLUResult, state: ConversationState): string {
  const drinkType = normalizeDrinkType(nlu);

  // Keyword search within the relevant drink pool first.
  // Handles e.g. "noriu alaus degustacijos" → finds the tasting board specifically.
  const drinkPool = drinkType
    ? byCategory(drinkTypeToCategories(drinkType))
    : byCategory(DRINK_CATEGORIES);
  const kwResult = keywordSearch(nlu.normalizedInput, drinkPool);
  if (kwResult.topScore > 0) {
    const filtered = applyHardFilters(kwResult.products.map((r) => r.product), state);
    const picked = filtered.length > 0
      ? pickKeywordResults({ ...kwResult, products: kwResult.products.filter((r) => filtered.includes(r.product)) }, 3, state.lastRecommendedIds)
      : null;
    if (picked && picked.length > 0) {
      const result = { products: picked, poolExhausted: false };
      setRecommended(state, picked.map((p) => p.id));
      const intent = drinkType === "beer" ? "beer_recommendation" : drinkType === "wine" ? "wine_recommendation" : drinkType === "cocktail" ? "cocktail_recommendation" : "drink_recommendation";
      // Beer path sets the tasting board as a pending suggestion — unless
      // alcohol is restricted ("Taip" must never add alcohol then).
      if ((drinkType === "beer" || intent === "beer_recommendation") && !alcoholRestricted(state)) {
        const tasting = allProducts.find((p) => normalizeText(p.name).includes("degustacija"));
        if (tasting) setPendingSuggestion(state, tasting.id);
      }
      return buildResponse({ intent, result }, state);
    }
  }

  if (nlu.intent === "drink_recommendation") {
    const result = recommendDrinks(state, drinkType);
    setRecommended(state, result.products.map((p) => p.id));
    return buildResponse({ intent: "drink_recommendation", result }, state);
  }
  if (drinkType) {
    const result = recommendDrinks(state, drinkType);
    setRecommended(state, result.products.map((p) => p.id));
    const intent = drinkType === "beer" ? "beer_recommendation" : drinkType === "wine" ? "wine_recommendation" : drinkType === "cocktail" ? "cocktail_recommendation" : "drink_recommendation";
    const reply = buildResponse({ intent, result }, state);
    if ((drinkType === "beer" || intent === "beer_recommendation") && !alcoholRestricted(state)) {
      const tasting = allProducts.find((p) => normalizeText(p.name).includes("degustacija"));
      if (tasting) setPendingSuggestion(state, tasting.id);
    }
    return reply;
  }
  return handleFoodRecommendation(nlu, state);
}

function alcoholRestricted(state: ConversationState): boolean {
  return state.allowAlcohol === false || state.ageGroup === "minor" || state.preferredDrink === "nonAlcoholic";
}

function drinkTypeToCategories(drinkType: string): Category[] {
  const map: Record<string, Category[]> = {
    beer:        ["alus"],
    wine:        ["vynas", "sampanas"],
    cocktail:    ["kokteiliai", "alus-kokteiliai"],
    cider:       ["sidras"],
    lemonade:    ["limonadai"],
    coffee:      ["kava"],
    juice:       ["gerimai"],
    water:       ["gerimai"],
    soft:        ["gerimai"],
    nonAlcoholic:["limonadai", "gerimai", "nealko-alus", "kava"],
  };
  return map[drinkType] ?? DRINK_CATEGORIES;
}

function handleBudget(nlu: NLUResult, state: ConversationState): string {
  if (nlu.intent === "expensive_food") {
    const savedBudget = state.budget;
    state.budget = null;
    const result = recommend(state, { categoryOverride: nlu.entities.category, requireFresh: true });
    state.budget = savedBudget;
    setFoodRecommendations(result.products.map((p) => p.id), result.poolExhausted, state, nlu.entities.category);
    return buildResponse({ intent: "food_recommendation", result }, state);
  }
  const result = recommend(state, { categoryOverride: nlu.entities.category, requireFresh: true });
  setFoodRecommendations(result.products.map((p) => p.id), result.poolExhausted, state, nlu.entities.category);
  return buildResponse({ intent: "cheap_food", result }, state);
}

function handleChildren(state: ConversationState): string {
  const result = recommendKids(state);
  setRecommended(state, result.products.map((p) => p.id));
  return buildResponse({ intent: "kids_menu", result }, state);
}

function handleAddToCart(nlu: NLUResult, state: ConversationState): string {
  const lang = state.currentLanguage;
  const nameMatch = matchProductName(nlu.normalizedInput);
  if (nameMatch.kind === "ambiguous") {
    const names = nameMatch.products
      .map((product) => `**${tProduct(product.id, lang, "name", product.name)}**`)
      .join(", ");
    return lang === "en"
      ? `Which one did you mean: ${names}?`
      : lang === "ru"
      ? `Какой вариант вы имели в виду: ${names}?`
      : `Kurį variantą turėjote omenyje: ${names}?`;
  }

  const hasExplicitProductWords = nlu.normalizedInput
    .replace(/\b(add|put|place|please|one|the|a|an|to|into|in|on|my|cart|basket|bag|pridek|prideti|idek|ideti|dek|prasau|viena|i|mano|krepseli|krepselis)\b/g, " ")
    .trim().length > 0;
  const dish = nameMatch.kind === "match"
    ? nameMatch.product
    : !hasExplicitProductWords
    ? findDishForTurn(nlu, state)
    : undefined;

  if (!dish) {
    const alternatives = nameMatch.kind === "none" ? nameMatch.alternatives : [];
    const alternativeList = alternatives.length > 0
      ? `\n${alternatives.map((product) => `• **${tProduct(product.id, lang, "name", product.name)}**`).join("\n")}`
      : "";
    return lang === "en"
      ? alternatives.length > 0
        ? `I couldn't find that exact item. The closest options are:${alternativeList}`
        : "I couldn't find that item on the menu."
      : lang === "ru"
      ? alternatives.length > 0
        ? `Точной позиции в меню нет. Ближайшие варианты:${alternativeList}`
        : "Не нашёл такую позицию в меню."
      : alternatives.length > 0
      ? `Tokio tikslaus produkto meniu neradau. Artimiausi variantai:${alternativeList}`
      : "Tokio produkto meniu neradau.";
  }
  if (FOOD_CATEGORIES.includes(dish.category as Category)) {
    state.lastFoodDishId = dish.id;
    state.activeDishId = dish.id;
  }
  state.lastMentionedProductId = dish.id;
  state.lastCartAddedProductId = dish.id;
  state.hasUnclaimedRecommendation = false;
  const action: AssistantAction = { type: "ADD_TO_CART", productId: dish.id, quantity: 1 };
  state.pendingActions = [action];
  const dishName = tProduct(dish.id, lang, "name", dish.name);
  return lang === "en"
    ? `**${dishName}** has been added to your cart! 🛒`
    : lang === "ru"
    ? `**${dishName}** добавлен в корзину! 🛒`
    : `**${dishName}** pridėta į krepšelį! 🛒`;
}

function handleRemoveFromCart(nlu: NLUResult, state: ConversationState): string {
  const lang = state.currentLanguage;
  // Named product wins; fall back to most recently added/mentioned
  const namedProduct =
    findDishReference(nlu.normalizedInput) ??
    findProductByInflectedName(nlu.normalizedInput);
  const product =
    namedProduct ??
    (state.lastCartAddedProductId ? findById(state.lastCartAddedProductId) : undefined) ??
    (state.lastMentionedProductId ? findById(state.lastMentionedProductId) : undefined);

  if (!product) {
    return lang === "en"
      ? "Which item would you like to remove?"
      : lang === "ru"
      ? "Что убрать из корзины?"
      : "Kurį produktą pašalinti iš krepšelio?";
  }

  state.pendingActions = [{ type: "REMOVE_FROM_CART", productId: product.id }];
  state.lastCartAddedProductId = undefined;
  const productName = tProduct(product.id, lang, "name", product.name);

  return lang === "en"
    ? `**${productName}** removed from your cart.`
    : lang === "ru"
    ? `**${productName}** убран из корзины.`
    : `**${productName}** pašalintas iš krepšelio.`;
}

function handleCartSummary(state: ConversationState): string {
  const lang = state.currentLanguage;
  const items = state.cartItems ?? [];

  if (items.length === 0) {
    return lang === "en"
      ? "Your cart is empty. Want me to recommend something?"
      : lang === "ru"
      ? "Ваша корзина пуста. Порекомендовать что-нибудь?"
      : "Jūsų krepšelis tuščias. Rekomenduoti ką nors?";
  }

  const total = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const lines = items.map(
    (i) => `• **${tProduct(i.productId, lang, "name", i.name)}** ×${i.quantity} — ${(i.price * i.quantity).toFixed(2)}€`
  );
  const header =
    lang === "en" ? "Your cart:" : lang === "ru" ? "Ваша корзина:" : "Jūsų krepšelyje:";
  const totalLabel =
    lang === "en" ? "Total" : lang === "ru" ? "Итого" : "Viso";

  return `${header}\n${lines.join("\n")}\n${totalLabel}: **${total.toFixed(2)}€**`;
}

function handleClearCart(state: ConversationState): string {
  const lang = state.currentLanguage;
  state.pendingActions = [{ type: "CLEAR_CART" }];
  state.cartItems = [];
  state.lastCartAddedProductId = undefined;
  state.lastMentionedProductId = undefined;
  state.hasUnclaimedRecommendation = false;

  return lang === "en"
    ? "Cart cleared. Starting fresh — what would you like?"
    : lang === "ru"
    ? "Корзина очищена. Начнём заново — что желаете?"
    : "Krepšelis išvalytas. Pradedame iš naujo — ko norėtumėte?";
}

function handleFollowUp(nlu: NLUResult, state: ConversationState): string {
  // Try explicit product name first (handles genitive forms like "noriu degustacijos")
  const namedProduct = findProductByInflectedName(nlu.normalizedInput);
  if (namedProduct) {
    setRecommended(state, [namedProduct.id]);
    if (FOOD_CATEGORIES.includes(namedProduct.category as Category)) {
      state.lastFoodDishId = namedProduct.id;
      state.activeDishId = namedProduct.id;
    }
    return buildResponse({
      intent: "food_recommendation",
      result: { products: [namedProduct], poolExhausted: false },
    }, state);
  }

  const selectedFromContext = findSelectionFromLastRecommendations(nlu.normalizedInput, state);
  if (selectedFromContext) {
    state.selectedDishId = selectedFromContext.id;
    state.activeDishId = selectedFromContext.id;
    state.lastFoodDishId = selectedFromContext.id;
    return buildResponse({ intent: "confirmation" }, state);
  }

  if (nlu.intent === "positive_answer" || nlu.intent === "confirmation") {
    return buildResponse({ intent: "confirmation" }, state);
  }

  if (lastRecommendationsAreDrinks(state)) {
    const result = recommendDrinks(state, state.preferredDrink ?? undefined);
    setRecommended(state, result.products.map((p) => p.id));
    return buildResponse({ intent: "drink_recommendation", result }, state);
  }

  if (lastRecommendationsAreDesserts(state)) {
    return handleDessert(state);
  }

  const result = recommend(state, {
    categoryOverride: state.preferredCategory ?? undefined,
    requireFresh: true,
  });
  setFoodRecommendations(result.products.map((p) => p.id), result.poolExhausted, state, state.preferredCategory ?? undefined);

  if (nlu.intent === "negative_answer") {
    const negReply = buildResponse({ intent: "negative_answer" }, state);
    const altReply = buildResponse({ intent: "change_recommendation", result }, state);
    return `${negReply}\n${altReply}`;
  }
  return buildResponse({ intent: "change_recommendation", result }, state);
}

function handleAlcoholRestrictionCorrection(state: ConversationState): string {
  const result = recommendDrinks(state, "nonAlcoholic");
  setRecommended(state, result.products.map((p) => p.id));
  const response = buildResponse({ intent: "drink_recommendation", result }, state);
  return `Teisingai, tada alkoholio nesiūlau.\n${response}`;
}

function handleAvailabilityResult(
  availability: NonNullable<ReturnType<typeof answerAvailability>>,
  state: ConversationState
): string {
  const products = availability.found.length > 0 ? availability.found : availability.alternatives;
  setRecommended(state, products.map((p) => p.id));
  const firstFood = products.find((p) => FOOD_CATEGORIES.includes(p.category as Category));
  if (firstFood) {
    state.lastFoodDishId = firstFood.id;
    state.activeDishId = firstFood.id;
  }
  return availability.reply;
}

function hadAlcoholRecommendation(ids: string[]): boolean {
  return ids
    .map(findById)
    .some((p) => p !== undefined && isAlcoholicProduct(p));
}

function fallbackForMode(mode: ConversationMode, state: ConversationState): string {
  if (mode === "DRINK_PAIRING") {
    const pairing = defaultPairing(state);
    setRecommended(state, pairing.drinks.map((p) => p.id));
    return buildResponse({ intent: "pairing_request", pairing, result: { products: pairing.drinks, poolExhausted: false } }, state);
  }
  if (mode === "DESSERT") return handleDessert(state);
  const result = recommend(state, { requireFresh: true });
  setFoodRecommendations(result.products.map((p) => p.id), result.poolExhausted, state, undefined);
  return buildResponse({ intent: "food_recommendation", result }, state);
}

function setFoodRecommendations(ids: string[], poolExhausted: boolean, state: ConversationState, category?: Category): void {
  if (poolExhausted) resetShownProducts(state);
  setRecommended(state, ids);
  const first = ids[0] ? findById(ids[0]) : undefined;
  if (first && FOOD_CATEGORIES.includes(first.category as Category)) {
    state.lastFoodDishId = first.id;
    state.activeDishId = first.id;
  }
  if (category) state.preferredCategory = category;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Try to identify the dish being asked about from input + context */
function findDishForTurn(
  nlu: NLUResult,
  state: ConversationState
): Product | undefined {
  if (/\b(jos|jo|ju|sito|sio|to|tam|siam)\b/i.test(nlu.normalizedInput) && (state.activeDishId || state.lastFoodDishId)) {
    return findById(state.activeDishId ?? state.lastFoodDishId!);
  }

  const referenced = findDishReference(nlu.normalizedInput);
  if (referenced) return referenced;

  // Pronouns and short follow-ups use current dish context.
  if (state.activeDishId) return findById(state.activeDishId);
  if (state.lastFoodDishId) return findById(state.lastFoodDishId);
  const lastFood = state.lastRecommendedIds
    .map(findById)
    .find((p) => p && FOOD_CATEGORIES.includes(p.category as Category));
  if (lastFood) return lastFood;

  return undefined;
}

function findSpecificDishMention(input: string): Product | undefined {
  if (!/\b(lasis|sonkaul|sonin|bulvin(?:iai|iu)?\s+blyn|didzkukul|cepelin)/i.test(input)) {
    return undefined;
  }
  return findDishReference(input);
}

function findSelectionFromLastRecommendations(input: string, state: ConversationState): Product | undefined {
  if (state.lastRecommendedIds.length === 0) return undefined;
  const candidates = state.lastRecommendedIds
    .map(findById)
    .filter((p): p is Product => p !== undefined && FOOD_CATEGORIES.includes(p.category as Category));
  if (candidates.length === 0) return undefined;

  const categoryHints: [RegExp, Category][] = [
    [/\bbulvin|blyn|cepelin|kukul/i, "bulviniai"],
    [/\bkiaul|sonin|sonkaul/i, "kiauliena"],
    [/\bvistien|sparnel/i, "vistiena"],
    [/\bzuv|lasis|tunas|menk/i, "zuvis"],
    [/\bjautien|steik|antrekot/i, "jautiena"],
    [/\bsalot|cezar/i, "salotos"],
    [/\bpica|pizza|pepperoni/i, "picos"],
  ];

  for (const [pattern, category] of categoryHints) {
    if (pattern.test(input)) {
      const match = candidates.find((p) => p.category === category);
      if (match) return match;
    }
  }

  return candidates.find((p) => input.length > 3 && normalizeText(p.name).includes(input));
}

function normalizeDrinkType(nlu: NLUResult): string | undefined {
  const text = nlu.normalizedInput;
  if (nlu.entities.drinkType) return nlu.entities.drinkType;
  if (/\bsidr/i.test(text)) return "cider";
  if (/\b(kava|coffee|espresso|cappuccino|latte)\b/i.test(text)) return "coffee";
  if (/\b(arbata|tea)\b/i.test(text)) return "coffee";
  if (/\b(sult|juice)\b/i.test(text)) return "juice";
  if (/\b(vand|water)\b/i.test(text)) return "water";
  if (/\b(gaiv|cola|coca|sprite|fanta|soft)\b/i.test(text)) return "soft";
  return undefined;
}

function isSpecificDishSafetyQuestion(input: string): boolean {
  return /\b(ar|ar yra|yra|turi|sudet|sudety|ingredient|alergen|is ko|kas yra)\b/i.test(input);
}

function lastRecommendationsAreDrinks(state: ConversationState): boolean {
  if (state.lastRecommendedIds.length === 0) return false;
  return state.lastRecommendedIds
    .map(findById)
    .every((p) => p && DRINK_CATEGORIES.includes(p.category as Category));
}

function lastRecommendationsAreDesserts(state: ConversationState): boolean {
  if (state.lastRecommendedIds.length === 0) return false;
  return state.lastRecommendedIds
    .map(findById)
    .every((p) => p?.category === "desertai");
}
