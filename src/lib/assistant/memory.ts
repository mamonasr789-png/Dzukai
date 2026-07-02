/**
 * Memory module — extracts user preferences from NLU results and persists them
 * in the conversation state. This is what makes the assistant "remember" things.
 */

import type { NLUResult, ConversationState } from "./types.ts";
import { extractBudget, matchesGroup } from "./synonyms.ts";
import { applySemanticRestrictions, type RestrictionUpdate } from "./restrictionEngine.ts";

/**
 * Apply a NLU result to update the conversation state memory.
 * Called after every user message.
 */
export function updateMemory(state: ConversationState, nlu: NLUResult): RestrictionUpdate {
  const { entities, normalizedInput: n } = nlu;
  const semanticUpdate = applySemanticRestrictions(state, nlu.rawInput);

  // Restriction cancellation — "nesu vegetaras", "valgau viską", "I eat everything".
  // Must run BEFORE diet-flag setting, and its result suppresses re-setting flags
  // this turn ("nesu vegetaras" contains "vegetaras" which the synonym group matches).
  const dietCancelled = clearCancelledRestrictions(state, n);

  // Budget
  if (entities.budget != null && !semanticUpdate.budgetChanged) {
    state.budget = entities.budget;
  }

  // Mood
  if (entities.moodFilling) {
    state.wantsFillingFood = true;
    state.wantsLightFood = false; // mutually exclusive
  }
  if (entities.moodLight) {
    state.wantsLightFood = true;
    state.wantsFillingFood = false;
  }
  if (entities.moodSpicy) state.wantsSpicyFood = true;

  // Diet flags
  if (entities.vegetarian && !dietCancelled) {
    state.vegetarian = true;
    state.diet = state.diet === "vegan" ? "vegan" : "vegetarian";
    state.noMeat = true;
  }
  if (entities.vegan && !dietCancelled) {
    state.vegan = true;
    state.vegetarian = true; // vegan implies vegetarian
    state.diet = "vegan";
    state.noMeat = true;
    state.noAnimalProducts = true;
  }
  if (entities.glutenFree) state.glutenFree = true;
  if (entities.lactoseFree) state.lactoseFree = true;

  // Protein preference
  if (entities.protein) {
    state.preferredProtein = entities.protein;
    // A fresh protein request supersedes a stale category preference
    // ("noriu picos" … "o dabar kiaulienos" must not stay locked to pizzas).
    if (!entities.category) state.preferredCategory = null;
  }

  // "be alkoholio" / "no alcohol" is a hard restriction, not just a preference —
  // otherwise a later "alaus" request silently resets it.
  if (isNoAlcohol(n)) state.allowAlcohol = false;

  const drinkPreference = inferDrinkPreference(n, entities.drinkType);
  if (drinkPreference) {
    state.preferredDrink = state.allowAlcohol === false && isAlcoholPreference(drinkPreference)
      ? "nonAlcoholic"
      : drinkPreference;
  }

  // Category preference
  if (entities.category) state.preferredCategory = entities.category;

  // Allergen
  if (entities.allergen) {
    if (!state.allergies.includes(entities.allergen)) {
      state.allergies.push(entities.allergen);
    }
  }

  // Disliked ingredient
  if (entities.dislike) {
    if (!state.dislikedIngredients.includes(entities.dislike)) {
      state.dislikedIngredients.push(entities.dislike);
    }
  }

  // Additional "be X" (without X) patterns not caught by entities
  extractAdditionalDislikes(state, n);
  extractAdditionalAllergies(state, n);

  // Language updates
  if (isEnglish(n)) state.currentLanguage = "en";
  else if (isRussian(n)) state.currentLanguage = "ru";

  // Budget reduction: "dar pigiau" etc. — only when no explicit amount was given
  if (matchesGroup(n, "CHEAPER") && !entities.budget && !semanticUpdate.budgetChanged) {
    state.budget = state.budget != null ? Math.max(5, state.budget - 3) : 12;
  }

  return semanticUpdate;
}

/**
 * Detect explicit cancellation of diet restrictions and clear the flags.
 * Returns true when a cancellation was detected (caller must not re-set flags this turn).
 */
function clearCancelledRestrictions(state: ConversationState, n: string): boolean {
  const cancelDiet =
    /\b(nesu|nebesu|jau ne)\s+(vegetar\w*|vegan\w*)/.test(n) ||
    /\b(valgau (viska|mesa)|galiu valgyti mesa|apsigalvojau del (mesos|dietos))\b/.test(n) ||
    /\b(not (a )?(vegetarian|vegan)|i eat (everything|meat))\b/.test(n) ||
    /(не вегетарианец|ем мясо|ем вс[её])/.test(n);

  if (cancelDiet) {
    state.vegetarian = false;
    state.vegan = false;
    state.diet = null;
    state.noMeat = false;
    state.noAnimalProducts = false;
    return true;
  }
  return false;
}

/** Extract "be X" (without X) patterns for uncommon dislikes */
function extractAdditionalDislikes(state: ConversationState, n: string): void {
  const bePatterns: [RegExp, string][] = [
    [/be\s+grybu/i, "grybai"],
    [/be\s+svogunu/i, "svogūnas"],
    [/be\s+pomidoru/i, "pomidoras"],
    [/be\s+surio/i, "sūris"],
    [/be\s+cili/i, "čili"],
    [/be\s+riesutu/i, "riešutai"],
    [/be\s+mesos/i, "_vegetarian"],
    [/nemegstu\s+grybu/i, "grybai"],
    [/nemegstu\s+svogunu/i, "svogūnas"],
    [/nemegstu\s+pomidoru/i, "pomidoras"],
    [/nemegstu\s+surio/i, "sūris"],
    [/no\s+mushrooms/i, "grybai"],
    [/no\s+onions/i, "svogūnas"],
    [/no\s+tomatoes/i, "pomidoras"],
    [/no\s+cheese/i, "sūris"],
  ];

  for (const [re, ingredient] of bePatterns) {
    if (re.test(n)) {
      if (ingredient === "_vegetarian") {
        state.vegetarian = true;
      } else if (!state.dislikedIngredients.includes(ingredient)) {
        state.dislikedIngredients.push(ingredient);
      }
    }
  }
}

function extractAdditionalAllergies(state: ConversationState, n: string): void {
  const allergyPatterns: [RegExp, string][] = [
    [/alergija\s+(?:prie\s+)?(?:pieno|pienui|pienas)/i, "Pienas"],
    [/alergija\s+(?:prie\s+)?(?:glitimo|glitimui)/i, "Glitimas"],
    [/alergija\s+(?:prie\s+)?(?:riesutu|riesutams|riesutai)/i, "Riešutai"],
    [/alergija\s+(?:prie\s+)?(?:kiausiniu|kiausiniams)/i, "Kiaušiniai"],
    [/alergija\s+(?:prie\s+)?(?:zuvies|zuviai)/i, "Žuvis"],
    [/netoleruoju\s+(?:pieno|pienas)/i, "Pienas"],
    [/netoleruoju\s+(?:glitimo|glitima)/i, "Glitimas"],
    [/netoleruoju\s+(?:riesutu|riesutus)/i, "Riešutai"],
    [/алл[её]ргия\s+(?:на\s+)?(?:молоко|молочные)/i, "Pienas"],
    [/алл[её]ргия\s+(?:на\s+)?(?:глютен)/i, "Glitimas"],
    [/алл[её]ргия\s+(?:на\s+)?(?:орехи)/i, "Riešutai"],
  ];

  for (const [re, allergen] of allergyPatterns) {
    if (re.test(n)) {
      if (!state.allergies.includes(allergen)) {
        state.allergies.push(allergen);
      }
    }
  }
}

function isEnglish(text: string): boolean {
  const englishWords = ["what", "recommend", "want", "please", "can", "would", "like", "food", "drink"];
  const lower = text.toLowerCase();
  return englishWords.filter((w) => lower.includes(w)).length >= 2;
}

function isRussian(text: string): boolean {
  return /[а-яёА-ЯЁ]/.test(text);
}

function isNoAlcohol(text: string): boolean {
  return /\b(no alcohol|be alkoholio|nealkohol|non.?alcohol|без алкоголя)\b/i.test(text);
}

function inferDrinkPreference(text: string, detected?: string): string | null {
  if (isNoAlcohol(text)) return "nonAlcoholic";
  if (detected) return detected;
  if (/\bsidr/i.test(text)) return "cider";
  if (/\b(arbata|tea|kava|coffee|espresso|cappuccino|latte)\b/i.test(text)) return "coffee";
  if (/\b(sult|sulciu|juice)\b/i.test(text)) return "juice";
  if (/\b(vand|water)\b/i.test(text)) return "water";
  if (/\b(gaiv|cola|coca|sprite|fanta|soft)\b/i.test(text)) return "soft";
  return null;
}

function isAlcoholPreference(preference: string): boolean {
  return ["beer", "wine", "cider", "cocktail"].includes(preference);
}

/** Summarize active constraints for debug/display */
export function summarizeMemory(state: ConversationState): string {
  const parts: string[] = [];
  if (state.vegetarian) parts.push("vegetarian");
  if (state.vegan) parts.push("vegan");
  if (state.glutenFree) parts.push("gluten-free");
  if (state.lactoseFree) parts.push("lactose-free");
  if (state.allergies.length) parts.push(`allergies: ${state.allergies.join(", ")}`);
  if (state.dislikedIngredients.length) parts.push(`dislikes: ${state.dislikedIngredients.join(", ")}`);
  if (state.budget) parts.push(`budget: €${state.budget}`);
  if (state.wantsFillingFood) parts.push("filling");
  if (state.wantsLightFood) parts.push("light");
  if (state.wantsSpicyFood) parts.push("spicy");
  if (state.preferredProtein) parts.push(`protein: ${state.preferredProtein}`);
  return parts.join(" | ");
}
