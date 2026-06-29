import type { Category } from "../data.ts";
import type { ConversationMode, ConversationState } from "./types.ts";
import { findById, DRINK_CATEGORIES, FOOD_CATEGORIES } from "./menuSearch.ts";
import { productViolatesRestrictions } from "./restrictionEngine.ts";

const foodSet = new Set<Category>(FOOD_CATEGORIES);
const drinkSet = new Set<Category>(DRINK_CATEGORIES);
const dessertSet = new Set<Category>(["desertai"]);

export function validateResponse(mode: ConversationMode, state: ConversationState): boolean {
  const ids = state.lastRecommendedIds;
  if (ids.length === 0) return true;
  const products = ids.map(findById).filter((p) => p !== undefined);
  if (products.length !== ids.length) return false;
  if (products.some((p) => productViolatesRestrictions(p, state))) return false;

  if (mode === "DRINK_PAIRING") {
    return products.every((p) => drinkSet.has(p.category));
  }
  if (mode === "DESSERT") {
    return products.every((p) => dessertSet.has(p.category));
  }
  if (mode === "FOLLOW_UP") {
    const allowed = new Set<Category>([...FOOD_CATEGORIES, ...DRINK_CATEGORIES, "desertai"]);
    return products.every((p) => allowed.has(p.category));
  }
  if (mode === "FOOD_RECOMMENDATION" || mode === "BUDGET" || mode === "CHILDREN") {
    return products.every((p) => foodSet.has(p.category));
  }
  return true;
}
