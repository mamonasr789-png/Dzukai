/**
 * Pairing engine — intelligent food→drink, food→dessert, food→side pairings.
 * All rules are data-driven. Pairings use actual products from the menu.
 */

import type { Product, Category } from "../data.ts";
import type { ConversationState, PairingResult } from "./types.ts";
import { byCategory, DRINK_CATEGORIES, DESSERT_CATEGORIES, allProducts, shuffle } from "./menuSearch.ts";
import { applyHardFilters } from "./filterEngine.ts";

// ── Pairing rules ─────────────────────────────────────────────────────────────

interface PairingRule {
  /** Food categories this rule applies to */
  foodCategories: Category[];
  /** Keywords in food name/description that trigger this rule */
  foodKeywords?: string[];
  /** Preferred drink categories in priority order */
  drinkCategories: Category[];
  /** Specific preferred product IDs (highest priority) */
  preferredDrinkIds?: string[];
  /** Explanation text (LT) */
  explanationLt: string;
  /** Explanation text (EN) */
  explanationEn?: string;
  /** Explanation text (RU) */
  explanationRu?: string;
}

const pairingRules: PairingRule[] = [
  // Fish & seafood → white wine, wheat beer, sparkling water, lemonade
  {
    foodCategories: ["zuvis"],
    drinkCategories: ["vynas", "alus", "limonadai", "gerimai"],
    preferredDrinkIds: ["al3"], // Kviecinis (wheat beer)
    explanationLt: "Prie žuvies puikiai tinka baltas vynas arba mūsų kvietinis alus — jis subtiliai papildo žuvies skonį.",
    explanationEn: "Fish pairs best with white wine or our wheat beer — it complements the delicate flavours.",
    explanationRu: "К рыбе идеально подходит белое вино или наш пшеничный эль.",
  },
  // Steak / beef → red wine, dark beer
  {
    foodCategories: ["jautiena"],
    drinkCategories: ["vynas", "alus"],
    preferredDrinkIds: ["al2", "al6"], // Šposas, Slyvinis Porteris
    explanationLt: "Prie jautienos rekomenduočiau raudoną vyną arba mūsų tamsų **Šposas** — jis atskleidžia mėsos gylį.",
    explanationEn: "Beef calls for red wine or our dark **Šposas** — it brings out the depth of the meat.",
    explanationRu: "К говядине — красное вино или тёмный **Šposas**.",
  },
  // BBQ / grill / pork ribs → IPA, lager, cola
  {
    foodCategories: ["kiauliena", "grilinis"],
    drinkCategories: ["alus", "gerimai"],
    preferredDrinkIds: ["al1", "al5"], // Čystas, Spakainas IPA
    explanationLt: "Prie BBQ ir šonkaulių — **Čystas** lageris arba IPA **Spakainas**. Jei be alkoholio — kola.",
    explanationEn: "BBQ ribs love our lager **Čystas** or IPA **Spakainas**. Prefer soft drinks? Cola works great.",
    explanationRu: "К BBQ — лагер **Čystas** или IPA **Spakainas**. Без алкоголя — кола.",
  },
  // Chicken → lager, IPA, lemonade
  {
    foodCategories: ["vistiena"],
    drinkCategories: ["alus", "limonadai"],
    preferredDrinkIds: ["al1", "al5"],
    explanationLt: "Prie vištienos tinka **Čystas** lageris arba gaivus limonadas.",
    explanationEn: "Chicken goes well with our **Čystas** lager or a refreshing lemonade.",
    explanationRu: "К курице — лагер **Čystas** или лимонад.",
  },
  // Pizza → lager, IPA
  {
    foodCategories: ["picos"],
    drinkCategories: ["alus", "limonadai", "gerimai"],
    preferredDrinkIds: ["al1", "al4"], // Čystas, Razumnas
    explanationLt: "Pica klasikiškai derinama su lageriu — **Čystas** arba šiek tiek stipresnis **Razumnas**.",
    explanationEn: "Pizza goes classically with lager — **Čystas** or slightly stronger **Razumnas**.",
    explanationRu: "Пицца классически сочетается с лагером **Čystas** или **Razumnas**.",
  },
  // Potato dishes (cepelinai, blynai) → gira, wheat beer, kefyr
  {
    foodCategories: ["bulviniai"],
    drinkCategories: ["alus", "gerimai"],
    preferredDrinkIds: ["al3"], // Kviecinis
    explanationLt: "Prie tradicinių bulvinių patiekalų — kvietinis **Kviecinis** alus arba gaivus gėrimas.",
    explanationEn: "For traditional potato dishes — wheat **Kviecinis** beer or a soft drink.",
    explanationRu: "К традиционным блюдам из картошки — пшеничный **Kviecinis** или безалкогольный напиток.",
  },
  // Salads / soups / light food → white wine, lemonade, sparkling water
  {
    foodCategories: ["salotos", "sriubos"],
    drinkCategories: ["vynas", "limonadai", "gerimai"],
    explanationLt: "Prie lengvų patiekalų rekomenduočiau baltą vyną arba gaivų limonadą.",
    explanationEn: "Light dishes pair well with white wine or a fresh lemonade.",
    explanationRu: "К лёгким блюдам — белое вино или лимонад.",
  },
  // Desserts → coffee, tea, dessert wine
  {
    foodCategories: ["desertai"],
    drinkCategories: ["kava", "vynas"],
    explanationLt: "Prie deserto — espresso arba šilta arbata. Šampanas taip pat puikiai tinka.",
    explanationEn: "With dessert — espresso or warm tea. Champagne also pairs beautifully.",
    explanationRu: "К десерту — эспрессо или тёплый чай. Шампанское тоже отлично подойдёт.",
  },
  // Starters / beer snacks → beer
  {
    foodCategories: ["uzkandziai", "prie-alaus"],
    drinkCategories: ["alus", "limonadai"],
    preferredDrinkIds: ["al1", "al3"],
    explanationLt: "Užkandžiams — mūsų daryklos alus. **Čystas** arba **Kviecinis** yra populiariausi pasirinkimai.",
    explanationEn: "For starters — our craft beer. **Čystas** or **Kviecinis** are the top picks.",
    explanationRu: "К закускам — наше крафтовое пиво **Čystas** или **Kviecinis**.",
  },
  // WOK / Asian food → light beer, lemonade
  {
    foodCategories: ["wok"],
    drinkCategories: ["alus", "limonadai", "gerimai"],
    preferredDrinkIds: ["al3", "al1"],
    explanationLt: "Prie wok patiekalų — kvietinis **Kviecinis** arba gaivus citrusinis limonadas.",
    explanationEn: "With wok dishes — wheat **Kviecinis** or a citrusy lemonade.",
    explanationRu: "К вок-блюдам — пшеничный **Kviecinis** или цитрусовый лимонад.",
  },
];

// ── Spicy food override ───────────────────────────────────────────────────────

const SPICY_PAIRING: Omit<PairingRule, "foodCategories"> = {
  drinkCategories: ["alus", "limonadai", "gerimai"],
  preferredDrinkIds: ["al1", "al3"],
  explanationLt: "Prie aštraus patiekalo — šaltas **Čystas** lageris arba gaivus limonadas. Jie puikiai atvėsina gomurį.",
  explanationEn: "Spicy food pairs with cold **Čystas** lager or a refreshing lemonade — they cool the palate.",
  explanationRu: "К острому — холодный лагер **Čystas** или лимонад.",
};

// ── Public API ────────────────────────────────────────────────────────────────

/** Get pairing suggestions for a given food product */
export function pairForFood(
  foodProduct: Product,
  state: ConversationState
): PairingResult {
  const isSpicy = isSpicyDish(foodProduct);
  const rule = isSpicy ? null : findRule(foodProduct);

  const drinkCats = isSpicy
    ? SPICY_PAIRING.drinkCategories
    : (rule?.drinkCategories ?? (["alus", "limonadai"] as Category[]));

  const preferredIds = isSpicy
    ? SPICY_PAIRING.preferredDrinkIds
    : rule?.preferredDrinkIds;

  const allDrinks = byCategory(drinkCats as Category[]);
  const filteredDrinks = withNonAlcoholFallback(
    applyHardFilters(filterDrinkPreference(filterAlcoholPreference(allDrinks, state), state), state),
    state
  );

  // Build drink list: preferred products first, then shuffled rest
  const drinks = buildPreferredFirst(filteredDrinks, preferredIds ?? [], 3);

  // Desserts (always coffee/tea + something sweet if not already a dessert)
  const dessertPool = applyHardFilters(byCategory("desertai"), state);
  const dessertsPool = shuffle(dessertPool).slice(0, 2);

  // Find coffee/tea for pairing note
  const coffee = allProducts.find((p) => p.id === "k1") ??
                 byCategory("kava").find((p) => p.name.toLowerCase().includes("espresso"));

  const explanation = isAlcoholRestricted(state)
    ? nonAlcoholicExplanation(foodProduct.category, state.currentLanguage)
    : isSpicy
      ? (SPICY_PAIRING[`explanation${langKey(state.currentLanguage)}`] ?? SPICY_PAIRING.explanationLt)
      : (rule?.[`explanation${langKey(state.currentLanguage)}`] ?? rule?.explanationLt ?? genericExplanation(state.currentLanguage));

  return { drinks, desserts: dessertsPool, explanation };
}

/** Get pairing suggestions when only a category is known (e.g. "žuvis") */
export function pairForCategory(
  category: Category,
  state: ConversationState
): PairingResult {
  const rule = pairingRules.find((r) => r.foodCategories.includes(category));
  if (!rule) return defaultPairing(state);

  const allDrinks = byCategory(rule.drinkCategories as Category[]);
  const filteredDrinks = withNonAlcoholFallback(
    applyHardFilters(filterDrinkPreference(filterAlcoholPreference(allDrinks, state), state), state),
    state
  );
  const drinks = buildPreferredFirst(filteredDrinks, rule.preferredDrinkIds ?? [], 3);

  const dessertPool = applyHardFilters(byCategory("desertai"), state);

  return {
    drinks,
    desserts: shuffle(dessertPool).slice(0, 2),
    explanation: isAlcoholRestricted(state)
      ? nonAlcoholicExplanation(category, state.currentLanguage)
      : (rule[`explanation${langKey(state.currentLanguage)}`] ?? rule.explanationLt),
  };
}

/** General drink recommendation without food context */
export function defaultPairing(state: ConversationState): PairingResult {
  const beers = applyHardFilters(filterAlcoholPreference(byCategory("alus"), state), state);
  const lemonades = applyHardFilters(byCategory("limonadai"), state);
  const wines = applyHardFilters(filterAlcoholPreference(byCategory("vynas"), state), state);

  const drinks = [
    ...shuffle(beers).slice(0, 2),
    ...shuffle(lemonades).slice(0, 1),
    ...shuffle(wines).slice(0, 1),
  ].slice(0, 4);

  const explanation: Record<string, string> = {
    lt: "Turime savo daryklos 6 rūšių alų, gerą vyno pasirinkimą ir naminius limonados.",
    en: "We have 6 house craft beers, a good wine selection, and homemade lemonades.",
    ru: "У нас 6 сортов крафтового пива, хороший выбор вин и домашние лимонады.",
  };

  return {
    drinks,
    desserts: [],
    explanation: explanation[state.currentLanguage] ?? explanation.lt,
  };
}

function filterAlcoholPreference(pool: Product[], state: ConversationState): Product[] {
  if (!isAlcoholRestricted(state)) return pool;
  return pool.filter((p) => {
    if (["limonadai", "gerimai", "nealko-alus", "kava"].includes(p.category)) return true;
    const text = `${p.name} ${p.description}`.toLowerCase();
    return text.includes("nealkohol") || text.includes("non-alcohol");
  });
}

function filterDrinkPreference(pool: Product[], state: ConversationState): Product[] {
  if (!state.preferredDrink || state.preferredDrink === "nonAlcoholic") return pool;
  const preferredCategories: Record<string, string[]> = {
    beer: ["alus"],
    wine: ["vynas"],
    cider: ["sidras"],
    cocktail: ["kokteiliai", "alus-kokteiliai"],
    lemonade: ["limonadai"],
    coffee: ["kava"],
    juice: ["gerimai"],
    water: ["gerimai"],
    soft: ["gerimai"],
  };
  const cats = preferredCategories[state.preferredDrink];
  if (!cats) return pool;
  const filtered = pool.filter((p) => cats.includes(p.category));
  return filtered.length > 0 ? filtered : pool;
}

function withNonAlcoholFallback(pool: Product[], state: ConversationState): Product[] {
  if (pool.length > 0 || !isAlcoholRestricted(state)) return pool;
  return applyHardFilters([
    ...byCategory("limonadai"),
    ...byCategory("gerimai"),
    ...byCategory("nealko-alus"),
    ...byCategory("kava"),
  ], state);
}

function isAlcoholRestricted(state: ConversationState): boolean {
  return state.preferredDrink === "nonAlcoholic" || state.allowAlcohol === false || state.ageGroup === "minor";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function findRule(product: Product): PairingRule | undefined {
  return pairingRules.find((r) => r.foodCategories.includes(product.category));
}

function isSpicyDish(product: Product): boolean {
  const text = (product.name + " " + product.description).toLowerCase();
  return text.includes("aštr") || text.includes("čili") || text.includes("spicy") || text.includes("karstą");
}

function buildPreferredFirst(pool: Product[], preferredIds: string[], n: number): Product[] {
  const preferred = preferredIds
    .map((id) => pool.find((p) => p.id === id))
    .filter((p): p is Product => p !== undefined);

  const rest = shuffle(pool.filter((p) => !preferredIds.includes(p.id)));
  const combined = [...preferred, ...rest];
  return combined.slice(0, n);
}

function langKey(lang: string): "Lt" | "En" | "Ru" {
  if (lang === "en") return "En";
  if (lang === "ru") return "Ru";
  return "Lt";
}

function genericExplanation(lang: string): string {
  const map: Record<string, string> = {
    lt: "Prie šio patiekalo rekomenduočiau mūsų daryklos alų arba vyną.",
    en: "I'd recommend our craft beer or wine with this dish.",
    ru: "К этому блюду рекомендую крафтовое пиво или вино.",
  };
  return map[lang] ?? map.lt;
}

function nonAlcoholicExplanation(category: Category, lang: string): string {
  const map: Record<string, Record<string, string>> = {
    zuvis: {
      lt: "Prie žuvies siūlyčiau gaivų limonadą, mineralinį vandenį arba sultis.",
      en: "With fish, I'd suggest a refreshing lemonade, sparkling water, or juice.",
      ru: "К рыбе предложу лимонад, минеральную воду или сок.",
    },
    bulviniai: {
      lt: "Prie bulvinių patiekalų tinka gira, limonadas arba vanduo.",
      en: "Potato dishes go well with kvass, lemonade, or water.",
      ru: "К картофельным блюдам подойдут квас, лимонад или вода.",
    },
    vistiena: {
      lt: "Prie vištienos siūlyčiau limonadą, sultis arba vandenį.",
      en: "With chicken, I'd suggest lemonade, juice, or water.",
      ru: "К курице предложу лимонад, сок или воду.",
    },
    picos: {
      lt: "Prie picos gerai tinka limonadas, kola arba vanduo.",
      en: "Pizza goes well with lemonade, cola, or water.",
      ru: "К пицце хорошо подойдут лимонад, кола или вода.",
    },
    default: {
      lt: "Prie šio patiekalo siūlyčiau nealkoholinį gėrimą — limonadą, sultis ar vandenį.",
      en: "With this dish, I'd suggest a non-alcoholic drink like lemonade, juice, or water.",
      ru: "К этому блюду предложу безалкогольный напиток: лимонад, сок или воду.",
    },
  };

  const key = category in map ? category : "default";
  return map[key][lang] ?? map[key].lt;
}
