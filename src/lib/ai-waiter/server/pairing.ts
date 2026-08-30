import "server-only";

import { products, type Product } from "../../data.ts";
import {
  DEFAULT_PREP_MINUTES_BY_GROUP,
  foodGroupForCategory,
  type FoodGroup,
} from "../../foodGroups.ts";

export function normalizePairingText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/gu, "");
}

const STOPWORDS = new Set([
  "prie",
  "su",
  "be",
  "ir",
  "ar",
  "arba",
  "ka",
  "kas",
  "ko",
  "kam",
  "kuo",
  "kiek",
  "koks",
  "kokia",
  "noriu",
  "noreciau",
  "prasau",
  "pasiulysi",
  "pasiulyk",
  "rekomenduoji",
  "rekomenduok",
  "parodyk",
  "pridek",
  "prideti",
  "imsiu",
  "galiu",
  "galima",
  "gerti",
  "gerim",
  "atsigerti",
  "isgerti",
  "valgyti",
  "valgyt",
  "uzkandziauti",
  "patiekal",
  "maisto",
  "maistas",
  "meniu",
  "the",
  "with",
  "what",
  "to",
  "for",
  "and",
  "or",
  "a",
  "an",
  "some",
  "any",
  "please",
  "want",
  "would",
  "like",
  "drink",
  "drinks",
  "eat",
  "food",
  "dish",
  "meal",
  "side",
  "sides",
  "recommend",
  "suggest",
  "show",
  "add",
  "take",
  "something",
  "goes",
  "pair",
  "pairing",
  "how",
  "long",
  "wait",
  "does",
  "contain",
  "contains",
  "have",
  "has",
  "is",
  "in",
  "of",
  "from",
  "our",
  "menu",
  "что",
  "чем",
  "как",
  "хочу",
]);

const DRINK_CATEGORY_IDS = new Set([
  "limonadai",
  "nealko-alus",
  "kava",
  "gerimai",
  "alus",
  "sidras",
  "alus-kokteiliai",
  "kokteiliai",
  "stiprieji",
  "sampanas",
  "vynas",
]);

const SIDE_CATEGORIES = ["uzkandziai", "salotos", "prie-alaus"] as const;

/** Complementary drink categories for a food category at this restaurant. */
const DRINK_TARGETS: Record<string, readonly string[]> = {
  sriubos: ["gerimai", "limonadai", "alus"],
  salotos: ["limonadai", "gerimai", "vynas"],
  uzkandziai: ["alus", "limonadai"],
  "prie-alaus": ["alus"],
  grilinis: ["alus"],
  vistiena: ["alus"],
  kiauliena: ["alus"],
  jautiena: ["alus"],
  zuvis: ["vynas", "alus"],
  picos: ["alus"],
  bulviniai: ["alus"],
  koldumai: ["alus"],
  lietiniai: ["kava", "gerimai"],
  wok: ["gerimai", "alus"],
  vaikiskas: ["gerimai", "limonadai"],
  desertai: ["kava"],
};

/** Complementary food categories when the guest named a drink. */
const FOOD_TARGETS: Record<string, readonly string[]> = {
  alus: ["prie-alaus"],
  sidras: ["prie-alaus"],
  "nealko-alus": ["prie-alaus"],
  "alus-kokteiliai": ["prie-alaus"],
  vynas: ["uzkandziai", "salotos"],
  sampanas: ["uzkandziai"],
  kokteiliai: ["uzkandziai"],
  stiprieji: ["prie-alaus"],
  kava: ["desertai"],
  gerimai: ["uzkandziai", "sriubos"],
  limonadai: ["uzkandziai", "sriubos"],
};

const BEER_SNACK_PATTERN =
  /\bprie\s+alaus\b|\b(?:beer|pub)\s+snacks?\b|\bwith\s+(?:a\s+|the\s+)?beer\b|к\s+пиву|под\s+пиво/u;

const DRINK_REQUEST_PATTERN =
  /\b(atsigert\w*|isgert\w*|gert\w*|gerim\w*|drinks?|beverages?)\b|what to drink|drink with|выпит|напит|к\s+чему\s+выпить|что\s+(?:выпить|пить)\s+к/u;

const FOOD_EAT_PATTERN =
  /\b(valgyti|valgyt|uzkand\w*|uzkas\w*|eat|food|snacks?|dish|sides?|garnyr\w*)\b|ед|закуск|блюд|гарнир/u;

const PAIRING_PATTERN =
  /\bprie\s+[a-z]{3,}|what (?:to drink |goes )?with|drink with\b|goes with|(?:выпить|пить)\s+к|к\s+чему|под\s+/u;

const SIDES_PATTERN =
  /\b(sides?|garnyr\w*|priedas|priedai|uzkand\w* prie)\b|гарнир|закуск\w*\s+к/u;

export const WAIT_TIME_PATTERN =
  /\b(kiek laukt\w*|kiek uztruks|kada bus|how long|wait time|preparation time)\b|сколько\s+ждать|как\s+долго/u;

export const PORTION_PATTERN =
  /\b(stiklin\w*|butel\w*|taure|taureje|0[.,]3|0[.,]5|\b1l\b|didel\w*|mazas|maza|glass|bottle|small|large)\b|стакан|бутил|бокал/u;

export const INGREDIENT_PATTERN =
  /\b(sudet\w*|ingredient\w*|kas yra|kas ide\w*|made of|made with|what's in|whats in)\b|состав|из\s+чего/u;

export const ALLERGEN_CONTENT_PATTERN =
  /\b(alergen\w*|allerg\w*|glitim\w*|gluten|pieno|laktoz\w*|kiausin\w*|riesut\w*|contains?)\b|аллерг|глютен|молок/u;

export const PAY_REQUEST_PATTERN =
  /\b(saskait\w*|bill|check please|moket\w*|sumoket\w*|apmok\w*|pay(?:ment|ing)?)\b|сч[её]т|оплат/u;

export type PairingKind = "drinks_for_food" | "food_for_drink" | "sides";

export interface CatalogDish {
  productId: string;
  name: string;
  category: string;
  soldOut: boolean;
}

export function isDrinkCategory(category: string): boolean {
  return DRINK_CATEGORY_IDS.has(category);
}

export function messageTokens(message: string): string[] {
  return normalizePairingText(message)
    .split(/[^a-z0-9]+/u)
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word));
}

function stemsOverlap(left: string, right: string): boolean {
  const n = Math.min(4, left.length, right.length);
  if (n < 4) return false;
  return left.slice(0, n) === right.slice(0, n);
}

function catalog(source?: readonly Product[]): readonly Product[] {
  return source ?? products;
}

export function mentionsCatalogDish(
  message: string,
  source?: readonly Product[]
): boolean {
  return resolveMentionedDishes(message, source).length > 0;
}

/**
 * Resolve dishes the guest named against the real catalog.
 * Stem-matches inflected Lithuanian/EN/RU wording. Never invents names.
 */
export function resolveMentionedDishes(
  message: string,
  source?: readonly Product[]
): CatalogDish[] {
  const words = messageTokens(message);
  if (words.length === 0) return [];
  const scored: Array<{ product: Product; score: number }> = [];
  for (const product of catalog(source)) {
    const tokens = normalizePairingText(product.name)
      .split(/[^a-z0-9]+/u)
      .filter((token) => token.length >= 4);
    if (tokens.length === 0) continue;
    let score = 0;
    let matches = 0;
    for (const token of tokens) {
      let best = 0;
      for (const word of words) {
        if (!stemsOverlap(word, token)) continue;
        best = Math.max(best, Math.min(word.length, token.length));
      }
      if (best > 0) {
        matches += 1;
        score += best;
      }
    }
    if (matches === 0) continue;
    if (words.length >= 2 && matches < 2 && score < 8) continue;
    if (score < 4) continue;
    scored.push({ product, score });
  }
  if (scored.length === 0) return [];
  const best = Math.max(...scored.map((item) => item.score));
  return scored
    .filter((item) => item.score === best)
    .slice(0, 8)
    .map((item) => ({
      productId: item.product.id,
      name: item.product.name,
      category: item.product.category,
      soldOut: Boolean(item.product.soldOut),
    }));
}

export function detectPairingKind(message: string): PairingKind | null {
  const normalized = normalizePairingText(message);
  if (BEER_SNACK_PATTERN.test(normalized)) {
    if (DRINK_REQUEST_PATTERN.test(normalized) && !FOOD_EAT_PATTERN.test(normalized)) {
      return "drinks_for_food";
    }
    return "food_for_drink";
  }
  if (SIDES_PATTERN.test(normalized) && mentionsCatalogDish(message)) {
    const dishes = resolveMentionedDishes(message);
    if (dishes.some((dish) => !isDrinkCategory(dish.category))) return "sides";
  }
  if (
    DRINK_REQUEST_PATTERN.test(normalized) ||
    (PAIRING_PATTERN.test(normalized) &&
      mentionsCatalogDish(message) &&
      !FOOD_EAT_PATTERN.test(normalized))
  ) {
    return "drinks_for_food";
  }
  if (
    PAIRING_PATTERN.test(normalized) &&
    FOOD_EAT_PATTERN.test(normalized) &&
    mentionsCatalogDish(message)
  ) {
    const dishes = resolveMentionedDishes(message);
    if (dishes.some((dish) => isDrinkCategory(dish.category))) {
      return "food_for_drink";
    }
    if (dishes.some((dish) => !isDrinkCategory(dish.category))) return "sides";
  }
  return null;
}

export function pairingCategoriesFor(
  sourceCategory: string,
  kind: PairingKind
): string[] {
  if (kind === "drinks_for_food") {
    return [...(DRINK_TARGETS[sourceCategory] ?? ["gerimai", "alus"])];
  }
  if (kind === "food_for_drink") {
    return [...(FOOD_TARGETS[sourceCategory] ?? ["prie-alaus", "uzkandziai"])];
  }
  if (isDrinkCategory(sourceCategory)) {
    return [...(FOOD_TARGETS[sourceCategory] ?? SIDE_CATEGORIES)];
  }
  return [...SIDE_CATEGORIES];
}

/** Best official category to recommend as a pairing for this guest wording. */
export function pairingCategoryForMessage(
  message: string,
  source?: readonly Product[]
): string | null {
  const kind = detectPairingKind(message);
  if (!kind) return null;
  const dishes = resolveMentionedDishes(message, source);
  const sourceDish =
    kind === "drinks_for_food" || kind === "sides"
      ? dishes.find((dish) => !isDrinkCategory(dish.category)) ?? dishes[0]
      : dishes.find((dish) => isDrinkCategory(dish.category)) ?? dishes[0];
  if (!sourceDish) {
    if (kind === "food_for_drink") return "prie-alaus";
    if (kind === "sides") return "uzkandziai";
    return "gerimai";
  }
  return pairingCategoriesFor(sourceDish.category, kind)[0] ?? null;
}

export function isAvailableForPairing(product: {
  soldOut?: boolean;
  orderability?: { status: string };
}): boolean {
  if (product.soldOut) return false;
  if (product.orderability?.status === "unavailable") return false;
  return true;
}

export function filterPairingCandidates<T extends {
  soldOut?: boolean;
  orderability?: { status: string };
}>(candidates: readonly T[], limit = 3): T[] {
  return candidates.filter(isAvailableForPairing).slice(0, Math.min(3, Math.max(1, limit)));
}

export function skuFamilyId(productId: string): string {
  return productId.replace(/-(?:05|1l|d|b|3|v)$/u, "");
}

export function siblingSkus(
  productId: string,
  source?: readonly Product[]
): CatalogDish[] {
  const family = skuFamilyId(productId);
  return catalog(source)
    .filter((product) => skuFamilyId(product.id) === family)
    .filter((product) => !product.soldOut)
    .map((product) => ({
      productId: product.id,
      name: product.name,
      category: product.category,
      soldOut: Boolean(product.soldOut),
    }));
}

export function detectWaitTimeQuestion(message: string): boolean {
  return WAIT_TIME_PATTERN.test(normalizePairingText(message));
}

export function detectPortionQuestion(message: string): boolean {
  return PORTION_PATTERN.test(normalizePairingText(message));
}

export function detectIngredientQuestion(message: string): boolean {
  const normalized = normalizePairingText(message);
  return INGREDIENT_PATTERN.test(normalized);
}

export function detectAllergenContentQuestion(message: string): boolean {
  const normalized = normalizePairingText(message);
  if (!ALLERGEN_CONTENT_PATTERN.test(normalized)) return false;
  if (
    /\b(esu alerg|as alerg|man alerg|i am allerg|im allerg|i'm allerg)|у\s+меня\s+аллерг|я\s+аллерг/u.test(
      normalized
    )
  ) {
    return false;
  }
  return true;
}

export function detectPayRequest(message: string): boolean {
  return PAY_REQUEST_PATTERN.test(normalizePairingText(message));
}

export function waitEstimateForCategory(category: string): {
  group: FoodGroup;
  minutes: number;
} {
  const group = foodGroupForCategory(category);
  return { group, minutes: DEFAULT_PREP_MINUTES_BY_GROUP[group] };
}

export function waitEstimateOverview(): Array<{
  group: FoodGroup;
  minutes: number;
}> {
  return (["starters", "mains", "kids", "drinks", "desserts"] as const).map(
    (group) => ({ group, minutes: DEFAULT_PREP_MINUTES_BY_GROUP[group] })
  );
}

/** Remaining content words suitable as a search_menu query. */
export function pairingSearchQuery(message: string): string {
  return messageTokens(message).slice(0, 4).join(" ");
}
