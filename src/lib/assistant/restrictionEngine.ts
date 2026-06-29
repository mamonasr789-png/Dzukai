import type { Product } from "../data.ts";
import type { ConversationState } from "./types.ts";
import { normalizeText } from "./normalizer.ts";
import { extractBudget } from "./synonyms.ts";
import {
  allergenKnowledge,
  animalProductStems,
  dislikeKnowledge,
  isAlcoholicProduct,
  matchesAnyPattern,
  meatStems,
  porkStems,
  productText,
  restrictionConcepts,
  shellfishStems,
} from "./restrictionKnowledge.ts";

export interface RestrictionUpdate {
  matchedConcepts: string[];
  alcoholRestricted: boolean;
  allergiesAdded: string[];
  dislikesAdded: string[];
  budgetChanged: boolean;
}

const allergyTriggers = [
  /\balerg/i,
  /\bnetoleruoju\b/i,
  /\bnegaliu\s+valgyti\b/i,
  /\bman\s+negalima\b/i,
  /\bblogai\s+nuo\b/i,
  /\breakcija\s+nuo\b/i,
];

const dislikeTriggers = [
  /\bnemegstu\b/i,
  /\bnepatinka\b/i,
  /\bnenoriu\b/i,
  /\bbe\b/i,
  /\bnevalgau\b/i,
  /\bnegaliu\s+pakesti\b/i,
];

const wordBudgets: [RegExp, number][] = [
  [/\b(?:iki|biudzetas|turiu|noriu\s+iki)\s+desimt\b/i, 10],
  [/\b(?:iki|biudzetas|turiu|noriu\s+iki)\s+penkiolika\b/i, 15],
  [/\b(?:iki|biudzetas|turiu|noriu\s+iki)\s+dvidesimt\b/i, 20],
];

export function applySemanticRestrictions(state: ConversationState, rawInput: string): RestrictionUpdate {
  const text = normalizeText(rawInput);
  const beforeAllowAlcohol = state.allowAlcohol;
  const update: RestrictionUpdate = {
    matchedConcepts: [],
    alcoholRestricted: false,
    allergiesAdded: [],
    dislikesAdded: [],
    budgetChanged: false,
  };

  for (const [concept, patterns] of Object.entries(restrictionConcepts)) {
    if (!matchesAnyPattern(text, patterns)) continue;
    update.matchedConcepts.push(concept);
    if (concept === "minor") {
      state.ageGroup = "minor";
      state.allowAlcohol = false;
      state.preferredDrink = "nonAlcoholic";
    } else if (concept === "noAlcohol") {
      state.allowAlcohol = false;
      state.preferredDrink = "nonAlcoholic";
    } else if (concept === "vegetarian") {
      state.diet = state.diet === "vegan" ? "vegan" : "vegetarian";
      state.vegetarian = true;
      state.noMeat = true;
    } else if (concept === "vegan") {
      state.diet = "vegan";
      state.vegan = true;
      state.vegetarian = true;
      state.noMeat = true;
      state.noAnimalProducts = true;
      state.lactoseFree = true;
    } else if (concept === "noPork") {
      state.noPork = true;
    } else if (concept === "halal") {
      state.noPork = true;
      state.allowAlcohol = false;
      state.preferredDrink = "nonAlcoholic";
      state.religiousRestriction = "halal";
    } else if (concept === "kosher") {
      state.noPork = true;
      state.avoidShellfish = true;
      state.religiousRestriction = "kosher";
    }
  }

  detectAllergies(state, text, update);
  detectDislikes(state, text, update);
  detectSemanticBudget(state, rawInput, text, update);

  update.alcoholRestricted = beforeAllowAlcohol !== false && state.allowAlcohol === false;
  return update;
}

function detectAllergies(state: ConversationState, text: string, update: RestrictionUpdate): void {
  if (!matchesAnyPattern(text, allergyTriggers)) return;
  for (const item of allergenKnowledge) {
    if (!matchesAnyPattern(text, item.patterns)) continue;
    if (!state.allergies.includes(item.allergen)) {
      state.allergies.push(item.allergen);
      update.allergiesAdded.push(item.allergen);
    }
    if (item.allergen === "Glitimas") state.glutenFree = true;
    if (item.allergen === "Pienas") state.lactoseFree = true;
  }
}

function detectDislikes(state: ConversationState, text: string, update: RestrictionUpdate): void {
  if (!matchesAnyPattern(text, dislikeTriggers)) return;
  for (const item of dislikeKnowledge) {
    if (!matchesAnyPattern(text, item.patterns)) continue;
    if (item.ingredient === "kiauliena") {
      state.noPork = true;
    }
    if (item.ingredient === "žuvis" && /\bnevalgau\b|\bnemegstu\b|\bbe\s+zuv/i.test(text)) {
      addDislike(state, item.ingredient, update);
      continue;
    }
    addDislike(state, item.ingredient, update);
  }
}

function addDislike(state: ConversationState, ingredient: string, update: RestrictionUpdate): void {
  if (!state.dislikedIngredients.includes(ingredient)) {
    state.dislikedIngredients.push(ingredient);
    update.dislikesAdded.push(ingredient);
  }
}

function detectSemanticBudget(
  state: ConversationState,
  rawInput: string,
  text: string,
  update: RestrictionUpdate
): void {
  let budget = extractBudget(rawInput);
  if (budget == null) {
    const numeric = text.match(/\b(?:biudzetas|turiu|noriu\s+iki)\s+(\d+(?:[.,]\d+)?)\b/i);
    if (numeric) budget = parseFloat(numeric[1].replace(",", "."));
  }
  if (budget == null) {
    for (const [pattern, amount] of wordBudgets) {
      if (pattern.test(text)) {
        budget = amount;
        break;
      }
    }
  }
  if (budget != null) {
    state.budget = budget;
    update.budgetChanged = true;
  }
}

export function productViolatesRestrictions(product: Product, state: ConversationState): boolean {
  if ((state.ageGroup === "minor" || state.allowAlcohol === false) && isAlcoholicProduct(product)) {
    return true;
  }

  const text = productText(product);

  if (state.allergies.some((allergen) => productHasAllergenRisk(product, allergen))) {
    return true;
  }
  if (state.vegan || state.noAnimalProducts) {
    return hasAnyStem(text, animalProductStems);
  }
  if (state.vegetarian || state.noMeat) {
    return hasAnyStem(text, meatStems);
  }
  if (state.noPork && hasAnyStem(text, porkStems)) {
    return true;
  }
  if (state.avoidShellfish && hasAnyStem(text, shellfishStems)) {
    return true;
  }
  if (state.dislikedIngredients.some((ingredient) => productHasDislikedRisk(product, ingredient))) {
    return true;
  }
  if (state.budget != null && product.price > 0 && product.price > state.budget) {
    return true;
  }
  return false;
}

export function productHasAllergenRisk(product: Product, allergen: string): boolean {
  const productAllergens = product.allergens.map(normalizeText);
  const normalizedAllergen = normalizeText(allergen);
  if (productAllergens.some((a) => a.includes(normalizedAllergen))) return true;

  const knowledge = allergenKnowledge.find((item) => normalizeText(item.allergen) === normalizedAllergen);
  if (!knowledge) return false;
  return hasAnyStem(productText(product), knowledge.riskStems);
}

export function productHasDislikedRisk(product: Product, ingredient: string): boolean {
  const normalized = normalizeText(ingredient);
  const knowledge = dislikeKnowledge.find((item) => normalizeText(item.ingredient) === normalized);
  const stems = knowledge?.riskStems ?? [normalized];
  return hasAnyStem(productText(product), stems);
}

export function hasAnyStem(text: string, stems: string[]): boolean {
  return stems.some((stem) => text.includes(normalizeText(stem)));
}

export { isAlcoholicProduct };
