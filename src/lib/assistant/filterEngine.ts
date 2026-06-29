/**
 * Filter engine — applies all active constraints from conversation state
 * to a product pool. Every recommendation passes through this filter.
 * NEVER shows allergen or strongly disliked dishes.
 */

import type { Product } from "../data.ts";
import type { ConversationState } from "./types.ts";
import { normalizeText } from "./synonyms.ts";
import { productViolatesRestrictions } from "./restrictionEngine.ts";

/** Meat ingredient keywords used for vegetarian filtering */
const MEAT_INGREDIENTS = [
  "jautiena", "kiauliena", "aviena", "vištiena", "antiena",
  "kumpio", "šoninė", "lašiniai", "kumpis", "mėsa",
  "beef", "pork", "chicken", "lamb", "meat",
];

/** Dairy ingredient keywords used for vegan/lactose filtering */
const DAIRY_INGREDIENTS = [
  "pienas", "sūris", "grietinė", "grietinėlė", "sviestas",
  "cream", "butter", "cheese", "milk", "yogurt",
];

/** Egg ingredient keywords */
const EGG_INGREDIENTS = ["kiaušinis", "kiaušiniai", "egg", "eggs"];

const DISLIKE_STEMS: Record<string, string[]> = {
  grybai: ["gryb", "baravyk", "pievagryb"],
  gryb: ["gryb", "baravyk", "pievagryb"],
  svogunai: ["svogun"],
  svogun: ["svogun"],
};

/**
 * Apply all active state constraints to a product pool.
 * Returns products that satisfy all constraints.
 */
export function applyFilters(pool: Product[], state: ConversationState): Product[] {
  let result = pool;

  // ── Hard exclusions: allergens ─────────────────────────────────────────
  if (state.allergies.length > 0) {
    result = result.filter((p) => {
      const pAlg = p.allergens.map((a) => a.toLowerCase());
      return !state.allergies.some((a) => pAlg.includes(a.toLowerCase()));
    });
  }

  // ── Gluten free ────────────────────────────────────────────────────────
  if (state.glutenFree) {
    result = result.filter((p) => !p.allergens.some((a) =>
      a.toLowerCase().includes("glitim") || a.toLowerCase().includes("gluten")
    ));
  }

  // ── Lactose free ───────────────────────────────────────────────────────
  if (state.lactoseFree) {
    result = result.filter((p) => !p.allergens.some((a) =>
      a.toLowerCase().includes("pienas") || a.toLowerCase().includes("milk") ||
      a.toLowerCase().includes("cream")
    ));
  }

  // ── Vegan: no meat AND no dairy AND no eggs ────────────────────────────
  if (state.vegan) {
    result = result.filter((p) => {
      const ingLower = p.ingredients.map((i) => i.toLowerCase()).join(" ");
      const algLower = p.allergens.map((a) => a.toLowerCase()).join(" ");
      const hasMeat = MEAT_INGREDIENTS.some((m) => ingLower.includes(m));
      const hasDairy = DAIRY_INGREDIENTS.some((d) => ingLower.includes(d) || algLower.includes(d));
      const hasEgg = EGG_INGREDIENTS.some((e) => ingLower.includes(e) || algLower.includes(e));
      return !hasMeat && !hasDairy && !hasEgg;
    });
  }

  // ── Vegetarian: no meat ────────────────────────────────────────────────
  else if (state.vegetarian) {
    const meatCategories = new Set(["kiauliena", "jautiena", "vistiena", "grilinis"]);
    result = result.filter((p) => {
      if (meatCategories.has(p.category)) return false;
      const ingLower = p.ingredients.map((i) => i.toLowerCase()).join(" ");
      return !MEAT_INGREDIENTS.some((m) => ingLower.includes(m));
    });
  }

  // ── Disliked ingredients ───────────────────────────────────────────────
  if (state.dislikedIngredients.length > 0) {
    result = result.filter((p) => {
      const haystack = normalizeText([p.name, p.description, ...p.ingredients].join(" "));
      return !state.dislikedIngredients.some((d) => {
        const disliked = normalizeText(d);
        const stems = DISLIKE_STEMS[disliked] ?? [disliked];
        return stems.some((stem) => haystack.includes(stem));
      });
    });
  }

  // ── Budget ────────────────────────────────────────────────────────────
  if (state.budget != null) {
    const maxPrice = state.budget;
    result = result.filter((p) => p.price <= maxPrice && p.price > 0);
  }

  // ── Mood adjustments ──────────────────────────────────────────────────
  if (state.wantsSpicyFood) {
    const spicyPool = result.filter((p) => {
      const desc = (p.name + " " + p.description).toLowerCase();
      return desc.includes("aštr") || desc.includes("čili") || desc.includes("spicy") || desc.includes("pikant");
    });
    if (spicyPool.length >= 2) result = spicyPool;
  } else if (state.wantsLightFood) {
    const lightCats = new Set(["salotos", "sriubos", "zuvis", "lietiniai"]);
    const lightPool = result.filter((p) => lightCats.has(p.category));
    if (lightPool.length >= 2) result = lightPool;
  } else if (state.wantsFillingFood) {
    const fillingCats = new Set(["kiauliena", "jautiena", "grilinis", "bulviniai", "wok", "koldumai"]);
    const fillingPool = result.filter((p) => fillingCats.has(p.category));
    if (fillingPool.length >= 2) result = fillingPool;
  }

  return result.filter((p) => !productViolatesRestrictions(p, state));
}

/**
 * Apply only hard exclusions (allergens, gluten, lactose).
 * Used for drink/dessert filtering where mood filters don't apply.
 */
export function applyHardFilters(pool: Product[], state: ConversationState): Product[] {
  let result = pool;

  if (state.allergies.length > 0) {
    result = result.filter((p) => {
      const pAlg = p.allergens.map((a) => a.toLowerCase());
      return !state.allergies.some((a) => pAlg.includes(a.toLowerCase()));
    });
  }

  if (state.glutenFree) {
    result = result.filter((p) => !p.allergens.some((a) =>
      a.toLowerCase().includes("glitim") || a.toLowerCase().includes("gluten")
    ));
  }

  if (state.lactoseFree) {
    result = result.filter((p) => !p.allergens.some((a) =>
      a.toLowerCase().includes("pienas") || a.toLowerCase().includes("milk")
    ));
  }

  return result.filter((p) => !productViolatesRestrictions(p, state));
}

/** Check if a single product passes all hard filters */
export function productPassesFilters(product: Product, state: ConversationState): boolean {
  return applyFilters([product], state).length > 0;
}
