/**
 * Recommendation engine — selects the best products for the user's current context.
 * Uses rotation to avoid recommending the same dishes twice in a row.
 * Never invents products — everything comes from the local menu.
 */

import type { Product, Category } from "../data.ts";
import type { ConversationState, RecommendationResult } from "./types.ts";
import {
  byCategory,
  categoriesForProtein,
  FOOD_CATEGORIES,
  MAIN_CATEGORIES,
  STARTER_CATEGORIES,
  DRINK_CATEGORIES,
  allProducts,
  shuffle,
  pickFresh,
} from "./menuSearch.ts";
import { applyFilters, applyHardFilters } from "./filterEngine.ts";

const DEFAULT_BATCH = 3;

// ── Main recommendation function ─────────────────────────────────────────────

/**
 * Recommend products based on conversation state.
 * Respects all constraints and rotates to avoid repeating suggestions.
 */
export function recommend(
  state: ConversationState,
  opts: {
    n?: number;
    categoryOverride?: Category | Category[];
    excludeIds?: string[];
    requireFresh?: boolean;  // exclude lastRecommendedIds if true
  } = {}
): RecommendationResult {
  const n = opts.n ?? DEFAULT_BATCH;
  const exclude = opts.requireFresh !== false
    ? [...(opts.excludeIds ?? []), ...state.lastRecommendedIds]
    : (opts.excludeIds ?? []);

  // 1. Determine candidate pool based on preferences
  let pool = buildCandidatePool(state, opts.categoryOverride);

  // 2. Apply all active filters (allergens, diet, budget, mood)
  let filtered = applyFilters(pool, state);

  // 3. If filter leaves nothing, relax mood filters and try again
  if (filtered.length === 0) {
    filtered = applyFiltersRelaxed(pool, state);
  }

  // 4. If still nothing, use full food menu with only hard filters
  if (filtered.length === 0) {
    filtered = applyHardFilters(byCategory(FOOD_CATEGORIES), state);
  }

  // 5. Pick fresh (unused) items from the filtered pool
  const { items, poolExhausted } = pickFresh(filtered, n, exclude);

  return {
    products: items,
    poolExhausted,
  };
}

/** Recommend for drinks specifically */
export function recommendDrinks(
  state: ConversationState,
  drinkType?: string
): RecommendationResult {
  let pool: Product[];

  if (drinkType === "beer") {
    pool = byCategory("alus");
  } else if (drinkType === "wine") {
    pool = byCategory("vynas");
  } else if (drinkType === "cocktail") {
    pool = [...byCategory("kokteiliai"), ...byCategory("alus-kokteiliai")];
  } else if (drinkType === "cider") {
    pool = byCategory("sidras");
  } else if (drinkType === "lemonade") {
    pool = byCategory("limonadai");
  } else if (drinkType === "coffee") {
    pool = byCategory("kava");
  } else if (drinkType === "juice" || drinkType === "water" || drinkType === "soft") {
    pool = byCategory("gerimai");
  } else if (drinkType === "nonAlcoholic" || state.preferredDrink === "nonAlcoholic") {
    pool = nonAlcoholicDrinks();
  } else {
    pool = byCategory([...DRINK_CATEGORIES]);
  }

  const filtered = applyHardFilters(
    state.preferredDrink === "nonAlcoholic" ? pool.filter(isNonAlcoholicDrink) : pool,
    state
  );
  const safeFiltered = filtered.length > 0
    ? filtered
    : (state.allowAlcohol === false || state.ageGroup === "minor")
      ? applyHardFilters(nonAlcoholicDrinks(), state)
      : filtered;
  const { items, poolExhausted } = pickFresh(
    safeFiltered,
    drinkType ? 4 : 3,
    state.lastRecommendedIds
  );

  return { products: items, poolExhausted };
}

function nonAlcoholicDrinks(): Product[] {
  return [
    ...byCategory("limonadai"),
    ...byCategory("gerimai"),
    ...byCategory("nealko-alus"),
    ...byCategory("kava"),
    ...byCategory("kokteiliai").filter(isNonAlcoholicDrink),
    ...byCategory("sampanas").filter(isNonAlcoholicDrink),
  ];
}

function isNonAlcoholicDrink(product: Product): boolean {
  if (["limonadai", "gerimai", "nealko-alus", "kava"].includes(product.category)) return true;
  const text = `${product.name} ${product.description}`.toLowerCase();
  return text.includes("nealkohol") || text.includes("non-alcohol");
}

/** Recommend desserts */
export function recommendDesserts(state: ConversationState): RecommendationResult {
  const pool = byCategory("desertai");
  const filtered = applyHardFilters(pool, state);
  const { items, poolExhausted } = pickFresh(filtered, 3, state.lastRecommendedIds);
  return { products: items, poolExhausted };
}

/** Recommend kids menu */
export function recommendKids(state: ConversationState): RecommendationResult {
  const pool = byCategory("vaikiskas");
  const filtered = applyHardFilters(pool, state);
  const { items } = pickFresh(filtered, filtered.length, []);
  return { products: items, poolExhausted: false };
}

/** Recommend popular/featured dishes */
export function recommendPopular(state: ConversationState): RecommendationResult {
  const featured = allProducts.filter((p) => p.featured && FOOD_CATEGORIES.includes(p.category as Category));
  const filtered = applyFilters(featured, state);
  const fallback = filtered.length >= 2 ? filtered : applyFilters(byCategory(MAIN_CATEGORIES), state);
  const { items, poolExhausted } = pickFresh(fallback, DEFAULT_BATCH, state.lastRecommendedIds);
  return { products: items, poolExhausted };
}

/** Build a full meal recommendation (starter + main + dessert) */
export function recommendFullMeal(state: ConversationState): {
  starter?: Product;
  main?: Product;
  dessert?: Product;
} {
  const starters = applyFilters(byCategory(STARTER_CATEGORIES), state);
  const mains    = applyFilters(byCategory(MAIN_CATEGORIES), state);
  const desserts = applyHardFilters(byCategory("desertai"), state);

  return {
    starter: shuffle(starters)[0],
    main:    shuffle(mains)[0],
    dessert: shuffle(desserts)[0],
  };
}

// ── Pool building ─────────────────────────────────────────────────────────────

function buildCandidatePool(
  state: ConversationState,
  categoryOverride?: Category | Category[]
): Product[] {
  // Explicit category override (e.g. user asked for "zuvis")
  if (categoryOverride) {
    const cats = Array.isArray(categoryOverride) ? categoryOverride : [categoryOverride];
    return byCategory(cats);
  }

  // Category preference in state
  if (state.preferredCategory) {
    return byCategory(state.preferredCategory);
  }

  // Protein preference
  if (state.preferredProtein) {
    const cats = categoriesForProtein(state.preferredProtein);
    return byCategory(cats);
  }

  // Default: all food categories
  return byCategory(FOOD_CATEGORIES);
}

/** Relax mood filters but keep diet/allergen filters */
function applyFiltersRelaxed(pool: Product[], state: ConversationState): Product[] {
  const relaxed: ConversationState = {
    ...state,
    wantsFillingFood: false,
    wantsLightFood: false,
    wantsSpicyFood: false,
  };
  return applyFilters(pool, relaxed);
}
