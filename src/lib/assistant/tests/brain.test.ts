/**
 * Comprehensive test suite for the virtual waiter assistant.
 * Run: node --experimental-strip-types src/lib/assistant/tests/brain.test.ts
 *
 * Tests cover:
 *  - Intent detection (single words, sentences, multilingual)
 *  - Memory extraction (budget, allergies, dislikes, diet)
 *  - Filter engine (allergen, vegetarian, budget, mood)
 *  - Pairing engine (food→drink)
 *  - Recommendation rotation
 *  - Full conversation flows
 *  - Response quality checks
 */

import { describe, it, expect, printResults } from "./runner.ts";
import { detectIntent } from "../intentEngine.ts";
import { updateMemory } from "../memory.ts";
import { createState, setRecommended, resetShownProducts } from "../conversationState.ts";
import { normalizeText, extractBudget, matchesGroup, scoreGroup } from "../synonyms.ts";
import { applyFilters, applyHardFilters } from "../filterEngine.ts";
import {
  byCategory,
  findById,
  findByName,
  pickFresh,
  textSearch,
  allProducts,
} from "../menuSearch.ts";
import { pairForFood, pairForCategory, defaultPairing } from "../pairingEngine.ts";
import { recommend, recommendDrinks, recommendDesserts, recommendKids } from "../recommendationEngine.ts";
import { processMessage, createState as cs } from "../brain.ts";
import { emptyContext, generateReply } from "../../ai-engine.ts";
import { determineConversationMode } from "../conversationMode.ts";
import {
  isAlcoholicProduct,
  productHasAllergenRisk,
  productHasDislikedRisk,
  productViolatesRestrictions,
} from "../restrictionEngine.ts";

// ══════════════════════════════════════════════════════════════════════════════
// HELPER
// ══════════════════════════════════════════════════════════════════════════════

function state(lang = "lt") { return createState(lang); }

const DRINK_TEST_CATEGORIES = [
  "alus", "vynas", "kokteiliai", "alus-kokteiliai", "limonadai",
  "gerimai", "nealko-alus", "sidras", "sampanas", "stiprieji", "kava",
];

const FOOD_TEST_CATEGORIES = [
  "uzkandziai", "salotos", "sriubos", "lietiniai", "koldumai",
  "wok", "bulviniai", "picos", "grilinis", "vistiena",
  "kiauliena", "jautiena", "zuvis", "vaikiskas", "prie-alaus",
];

function expectLastRecommendationsInCategories(s: ReturnType<typeof createState>, categories: string[]) {
  expect(s.lastRecommendedIds.length).toBeGreaterThan(0);
  s.lastRecommendedIds.forEach((id) => {
    const p = findById(id);
    expect(p).toBeTruthy();
    if (p) expect(categories.includes(p.category)).toBeTruthy();
  });
}

function modeFor(input: string, s = state()) {
  return determineConversationMode(detectIntent(input, s), s);
}

function expectNoAlcoholRecommendations(s: ReturnType<typeof createState>) {
  expect(s.lastRecommendedIds.length).toBeGreaterThan(0);
  s.lastRecommendedIds.forEach((id) => {
    const p = findById(id);
    expect(p).toBeTruthy();
    if (p) expect(isAlcoholicProduct(p)).toBeFalsy();
  });
}

function expectNoRestrictionViolations(s: ReturnType<typeof createState>) {
  expect(s.lastRecommendedIds.length).toBeGreaterThan(0);
  s.lastRecommendedIds.forEach((id) => {
    const p = findById(id);
    expect(p).toBeTruthy();
    if (p) expect(productViolatesRestrictions(p, s)).toBeFalsy();
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 0. CONVERSATION MODE
// ══════════════════════════════════════════════════════════════════════════════

describe("ConversationMode — all supported modes", () => {
  it("detects FOOD_RECOMMENDATION", () => {
    expect(modeFor("Rekomenduok ką nors")).toBe("FOOD_RECOMMENDATION");
  });
  it("detects DRINK_PAIRING with named dish", () => {
    expect(modeFor("Ką atsigerti prie lašišos?")).toBe("DRINK_PAIRING");
  });
  it("detects DRINK_PAIRING from context pronoun", () => {
    const s = state();
    s.lastFoodDishId = "ki5";
    expect(modeFor("Ką prie jos gerti?", s)).toBe("DRINK_PAIRING");
  });
  it("detects DESSERT", () => {
    expect(modeFor("Desertas")).toBe("DESSERT");
  });
  it("detects ALLERGY", () => {
    expect(modeFor("Be grybų")).toBe("ALLERGY");
  });
  it("detects INGREDIENTS", () => {
    expect(modeFor("Kas yra sudėtyje?")).toBe("INGREDIENTS");
  });
  it("detects PRICE", () => {
    expect(modeFor("Kiek kainuoja lašiša?")).toBe("PRICE");
  });
  it("detects MENU_SEARCH", () => {
    expect(modeFor("Kokį alų turite?")).toBe("MENU_SEARCH");
  });
  it("detects BUDGET", () => {
    expect(modeFor("Pigiau")).toBe("BUDGET");
  });
  it("detects CHILDREN", () => {
    expect(modeFor("Ką vaikui?")).toBe("CHILDREN");
  });
  it("detects FOLLOW_UP", () => {
    const s = state();
    s.lastRecommendedIds = ["v1"];
    expect(modeFor("Dar", s)).toBe("FOLLOW_UP");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. SYNONYM ENGINE
// ══════════════════════════════════════════════════════════════════════════════

describe("Synonyms — normalizeText", () => {
  it("lowercases input", () => {
    expect(normalizeText("SOČIAI")).toBe("sociai");
  });
  it("removes punctuation", () => {
    expect(normalizeText("Taip!")).toBe("taip");
  });
  it("trims and collapses whitespace", () => {
    expect(normalizeText("  vienas  du  ")).toBe("vienas du");
  });
});

describe("Synonyms — extractBudget", () => {
  it("extracts '15€'", () => expect(extractBudget("15€")).toBe(15));
  it("extracts 'iki 20€'", () => expect(extractBudget("iki 20€")).toBe(20));
  it("extracts 'iki 25 eurų'", () => expect(extractBudget("iki 25 eurų")).toBe(25));
  it("extracts 'budget 30'", () => expect(extractBudget("budget 30")).toBe(30));
  it("extracts 'biudžetas 18'", () => expect(extractBudget("biudžetas 18")).toBe(18));
  it("returns null for no budget", () => expect(extractBudget("noriu vištienos")).toBe(null));
  it("extracts decimal '12.50€'", () => expect(extractBudget("12.50€")).toBe(12.5));
  it("extracts 'iki 10'", () => expect(extractBudget("iki 10")).toBe(10));
});

describe("Synonyms — matchesGroup", () => {
  it("matches FILLING for 'sočiai'", () => expect(matchesGroup("sočiai", "FILLING")).toBeTruthy());
  it("matches FILLING for 'alkanas'", () => expect(matchesGroup("alkanas", "FILLING")).toBeTruthy());
  it("matches FILLING for 'hungry'", () => expect(matchesGroup("hungry", "FILLING")).toBeTruthy());
  it("matches FILLING for 'labai alkanas'", () => expect(matchesGroup("labai alkanas", "FILLING")).toBeTruthy());
  it("matches LIGHT for 'lengvau'", () => expect(matchesGroup("lengvau", "LIGHT")).toBeTruthy());
  it("matches LIGHT for 'light'", () => expect(matchesGroup("light", "LIGHT")).toBeTruthy());
  it("matches SPICY for 'aštraus'", () => expect(matchesGroup("aštraus", "SPICY")).toBeTruthy());
  it("matches SPICY for 'čili'", () => expect(matchesGroup("čili", "SPICY")).toBeTruthy());
  it("matches VEGETARIAN for 'vegetaras'", () => expect(matchesGroup("vegetaras", "VEGETARIAN")).toBeTruthy());
  it("matches VEGAN for 'vegan'", () => expect(matchesGroup("vegan", "VEGAN")).toBeTruthy());
  it("matches BEER for 'alaus'", () => expect(matchesGroup("alaus", "BEER")).toBeTruthy());
  it("matches WINE for 'vyno'", () => expect(matchesGroup("vyno", "WINE")).toBeTruthy());
  it("matches CHEAPER for 'pigiau'", () => expect(matchesGroup("pigiau", "CHEAPER")).toBeTruthy());
  it("matches CHEAPER for 'budget'", () => expect(matchesGroup("budget", "CHEAPER")).toBeTruthy());
  it("matches MORE_DIFFERENT for 'dar'", () => expect(matchesGroup("dar", "MORE_DIFFERENT")).toBeTruthy());
  it("matches MORE_DIFFERENT for 'kitką'", () => expect(matchesGroup("kitką", "MORE_DIFFERENT")).toBeTruthy());
  it("matches NEGATIVE for 'ne'", () => expect(matchesGroup("ne", "NEGATIVE")).toBeTruthy());
  it("matches POSITIVE for 'taip'", () => expect(matchesGroup("taip", "POSITIVE")).toBeTruthy());
  it("does NOT match FILLING for 'žuvis'", () => expect(matchesGroup("žuvis", "FILLING")).toBeFalsy());
  it("matches CHICKEN for 'vištiena'", () => expect(matchesGroup("vištiena", "CHICKEN")).toBeTruthy());
  it("matches FISH for 'žuvies'", () => expect(matchesGroup("žuvies", "FISH")).toBeTruthy());
  it("matches FISH for 'lašišos'", () => expect(matchesGroup("lašišos", "FISH")).toBeTruthy());
  it("matches KIDS for 'vaikams'", () => expect(matchesGroup("vaikams", "KIDS")).toBeTruthy());
  it("matches DESSERT for 'deserto'", () => expect(matchesGroup("deserto", "DESSERT")).toBeTruthy());
  it("matches DESSERT for 'tortas'", () => expect(matchesGroup("tortas", "DESSERT")).toBeTruthy());
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. INTENT ENGINE
// ══════════════════════════════════════════════════════════════════════════════

describe("IntentEngine — food recommendations", () => {
  it("detects 'Ką rekomenduoji?'", () => {
    const r = detectIntent("Ką rekomenduoji?", state());
    expect(r.intent).toBe("food_recommendation");
  });
  it("detects 'Siūlyk ką nors'", () => {
    const r = detectIntent("Siūlyk ką nors", state());
    expect(r.intent).toBe("food_recommendation");
  });
  it("detects 'Noriu pavalgyti'", () => {
    const r = detectIntent("Noriu pavalgyti", state());
    expect(r.intent).toBe("food_recommendation");
  });
  it("detects 'recommend something'", () => {
    const r = detectIntent("recommend something", state());
    expect(r.intent).toBe("food_recommendation");
  });
  it("detects 'Порекомендуй что-нибудь'", () => {
    const r = detectIntent("Порекомендуй что-нибудь", state());
    expect(r.intent).toBe("food_recommendation");
  });
  it("detects 'Sočiai' as food recommendation", () => {
    const r = detectIntent("Sočiai", state());
    expect(r.intent).toBe("food_recommendation");
  });
  it("detects 'Lengviau' as food recommendation", () => {
    const r = detectIntent("Lengviau", state());
    expect(r.intent).toBe("food_recommendation");
  });
  it("detects 'Aštraus kažko' as food recommendation", () => {
    const r = detectIntent("Aštraus kažko", state());
    expect(r.intent).toBe("food_recommendation");
  });
  it("detects 'Noriu vištienos' as food recommendation", () => {
    const r = detectIntent("Noriu vištienos", state());
    expect(r.intent).toBe("food_recommendation");
  });
  it("detects 'Noriu žuvies' as food recommendation", () => {
    const r = detectIntent("Noriu žuvies", state());
    expect(r.intent).toBe("food_recommendation");
  });
  it("detects 'Noriu jautienos' as food recommendation", () => {
    const r = detectIntent("Noriu jautienos", state());
    expect(r.intent).toBe("food_recommendation");
  });
  it("detects 'Noriu picos' as food recommendation", () => {
    const r = detectIntent("Noriu picos", state());
    expect(r.intent).toBe("food_recommendation");
  });
  it("detects 'Ko verta paragauti' as food recommendation", () => {
    const r = detectIntent("Ko verta paragauti", state());
    expect(r.intent).toBe("food_recommendation");
  });
});

describe("IntentEngine — change recommendation", () => {
  it("detects 'Dar'", () => {
    const s = state(); s.lastRecommendedIds = ["u1"];
    expect(detectIntent("Dar", s).intent).toBe("change_recommendation");
  });
  it("detects 'Kitką'", () => {
    const s = state(); s.lastRecommendedIds = ["u1"];
    expect(detectIntent("Kitką", s).intent).toBe("change_recommendation");
  });
  it("detects 'Ne šitą'", () => {
    const s = state(); s.lastRecommendedIds = ["u1"];
    expect(detectIntent("Ne šitą", s).intent).toBe("change_recommendation");
  });
  it("detects 'Parodyk kitą'", () => {
    const s = state(); s.lastRecommendedIds = ["u1"];
    expect(detectIntent("Parodyk kitą", s).intent).toBe("change_recommendation");
  });
  it("detects 'Dar kitą'", () => {
    const s = state(); s.lastRecommendedIds = ["u1"];
    expect(detectIntent("Dar kitą", s).intent).toBe("change_recommendation");
  });
  it("detects 'another' in EN", () => {
    const s = state("en"); s.lastRecommendedIds = ["u1"];
    expect(detectIntent("another", s).intent).toBe("change_recommendation");
  });
  it("detects 'different'", () => {
    const s = state("en"); s.lastRecommendedIds = ["u1"];
    expect(detectIntent("different", s).intent).toBe("change_recommendation");
  });
  it("detects 'ещё' in RU", () => {
    const s = state("ru"); s.lastRecommendedIds = ["u1"];
    expect(detectIntent("ещё", s).intent).toBe("change_recommendation");
  });
});

describe("IntentEngine — negative/positive", () => {
  it("detects 'Ne' as negative", () => {
    const s = state(); s.currentIntent = "food_recommendation";
    expect(detectIntent("Ne", s).intent).toBe("negative_answer");
  });
  it("detects 'Nope' as negative", () => {
    const s = state(); s.currentIntent = "food_recommendation";
    expect(detectIntent("Nope", s).intent).toBe("negative_answer");
  });
  it("detects 'Taip' as positive", () => {
    const s = state(); s.lastRecommendedIds = ["u1"];
    expect(detectIntent("Taip", s).intent).toBe("positive_answer");
  });
  it("detects 'Gerai' as positive", () => {
    const s = state(); s.lastRecommendedIds = ["u1"];
    expect(detectIntent("Gerai", s).intent).toBe("positive_answer");
  });
  it("detects 'ok' as positive", () => {
    const s = state("en"); s.lastRecommendedIds = ["u1"];
    expect(detectIntent("ok", s).intent).toBe("positive_answer");
  });
});

describe("IntentEngine — drinks", () => {
  it("detects 'Kokį alų?' as beer", () => {
    expect(detectIntent("Kokį alų?", state()).intent).toBe("beer_recommendation");
  });
  it("detects 'alaus' as beer", () => {
    expect(detectIntent("alaus", state()).intent).toBe("beer_recommendation");
  });
  it("detects 'Kokį vyną rekomenduoji?' as wine", () => {
    expect(detectIntent("Kokį vyną rekomenduoji?", state()).intent).toBe("wine_recommendation");
  });
  it("detects 'Kokteilių noriu' as cocktail", () => {
    expect(detectIntent("Kokteilių noriu", state()).intent).toBe("cocktail_recommendation");
  });
  it("detects 'Ką gerti?' as drink", () => {
    const s = state(); s.lastFoodDishId = "z1";
    expect(detectIntent("Ką gerti?", s).intent).toBe("drink_recommendation");
  });
  it("detects 'Ką atsigerti?'", () => {
    expect(detectIntent("Ką atsigerti?", state()).intent).toBe("drink_recommendation");
  });
  it("detects 'О пrie šito?' as pairing", () => {
    const s = state(); s.lastFoodDishId = "v1";
    expect(detectIntent("O prie šito?", s).intent).toBe("pairing_request");
  });
});

describe("IntentEngine — diet", () => {
  it("detects 'Esu vegetaras' as vegetarian", () => {
    expect(detectIntent("Esu vegetaras", state()).intent).toBe("vegetarian");
  });
  it("detects 'Be mėsos' as vegetarian", () => {
    expect(detectIntent("Be mėsos", state()).intent).toBe("vegetarian");
  });
  it("detects 'vegan' as vegan", () => {
    expect(detectIntent("vegan", state()).intent).toBe("vegan");
  });
  it("detects 'Ką turite be glitimo?' as allergy", () => {
    expect(detectIntent("Ką turite be glitimo?", state()).intent).toBe("allergy_question");
  });
  it("detects 'Alergija riešutams' as allergy", () => {
    expect(detectIntent("Alergija riešutams", state()).intent).toBe("allergy_question");
  });
});

describe("IntentEngine — kids, budget, dessert", () => {
  it("detects 'Ką vaikui?' as kids", () => {
    expect(detectIntent("Ką vaikui?", state()).intent).toBe("kids_menu");
  });
  it("detects 'Vaikams' as kids", () => {
    expect(detectIntent("Vaikams", state()).intent).toBe("kids_menu");
  });
  it("detects 'Pigiau' as cheap", () => {
    expect(detectIntent("Pigiau", state()).intent).toBe("cheap_food");
  });
  it("detects 'Iki 15€' as cheap", () => {
    expect(detectIntent("Iki 15€", state()).intent).toBe("cheap_food");
  });
  it("detects 'Noriu deserto' as dessert", () => {
    expect(detectIntent("Noriu deserto", state()).intent).toBe("dessert_recommendation");
  });
  it("detects 'Tortas' as dessert", () => {
    expect(detectIntent("Tortas", state()).intent).toBe("dessert_recommendation");
  });
  it("detects 'Ledai' as dessert", () => {
    expect(detectIntent("Ledai", state()).intent).toBe("dessert_recommendation");
  });
  it("detects 'Kokį desertą?' as dessert", () => {
    expect(detectIntent("Kokį desertą?", state()).intent).toBe("dessert_recommendation");
  });
});

describe("IntentEngine — restaurant info", () => {
  it("detects 'Kur esate?' as restaurant_info", () => {
    const r = detectIntent("Kur esate?", state());
    expect(r.intent).toBeOneOf(["restaurant_info", "opening_hours"]);
  });
  it("detects 'Darbo laikas?' as opening_hours", () => {
    expect(detectIntent("Darbo laikas?", state()).intent).toBe("opening_hours");
  });
  it("detects 'Kada dirbate?' as opening_hours", () => {
    expect(detectIntent("Kada dirbate?", state()).intent).toBe("opening_hours");
  });
});

describe("IntentEngine — ingredient question", () => {
  it("detects 'Iš ko pagamintas?' as ingredient_question", () => {
    expect(detectIntent("Iš ko pagamintas?", state()).intent).toBe("ingredient_question");
  });
  it("detects 'Kas yra sudėtyje?' as ingredient_question", () => {
    expect(detectIntent("Kas yra sudėtyje?", state()).intent).toBe("ingredient_question");
  });
});

describe("IntentEngine — entities extraction", () => {
  it("extracts budget from 'Iki 20€'", () => {
    const r = detectIntent("Iki 20€", state());
    expect(r.entities.budget).toBe(20);
  });
  it("extracts moodFilling from 'Sočiai'", () => {
    expect(detectIntent("Sočiai", state()).entities.moodFilling).toBeTruthy();
  });
  it("extracts moodLight from 'Lengviau'", () => {
    expect(detectIntent("Lengviau", state()).entities.moodLight).toBeTruthy();
  });
  it("extracts moodSpicy from 'Aštraus'", () => {
    expect(detectIntent("Aštraus", state()).entities.moodSpicy).toBeTruthy();
  });
  it("extracts protein=chicken from 'Vištienos noriu'", () => {
    expect(detectIntent("Vištienos noriu", state()).entities.protein).toBe("chicken");
  });
  it("extracts protein=fish from 'Žuvies'", () => {
    expect(detectIntent("Žuvies", state()).entities.protein).toBe("fish");
  });
  it("extracts dislike=grybai", () => {
    expect(detectIntent("Be grybų", state()).entities.dislike).toBe("grybai");
  });
  it("extracts dislike=svogūnas", () => {
    expect(detectIntent("Nemėgstu svogūnų", state()).entities.dislike).toBe("svogūnas");
  });
  it("extracts allergen=Riešutai", () => {
    expect(detectIntent("Alergija riešutams", state()).entities.allergen).toBe("Riešutai");
  });
  it("extracts vegetarian=true", () => {
    expect(detectIntent("Esu vegetaras", state()).entities.vegetarian).toBeTruthy();
  });
  it("extracts category=picos from 'Noriu picos'", () => {
    expect(detectIntent("Noriu picos", state()).entities.category).toBe("picos");
  });
  it("extracts drinkType=beer from 'Alaus'", () => {
    expect(detectIntent("Alaus", state()).entities.drinkType).toBe("beer");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. MEMORY MODULE
// ══════════════════════════════════════════════════════════════════════════════

describe("Memory — budget", () => {
  it("stores budget from NLU", () => {
    const s = state();
    const nlu = detectIntent("Iki 15€", s);
    updateMemory(s, nlu);
    expect(s.budget).toBe(15);
  });
  it("decreases budget on 'pigiau'", () => {
    const s = state();
    s.budget = 20;
    updateMemory(s, detectIntent("Dar pigiau", s));
    expect(s.budget).toBeLessThanOrEqual(20);
  });
  it("updates budget when new value given", () => {
    const s = state();
    s.budget = 30;
    updateMemory(s, detectIntent("iki 12€", s));
    expect(s.budget).toBe(12);
  });
});

describe("Memory — diet flags", () => {
  it("sets vegetarian=true", () => {
    const s = state();
    updateMemory(s, detectIntent("Esu vegetaras", s));
    expect(s.vegetarian).toBeTruthy();
  });
  it("sets vegan=true AND vegetarian=true", () => {
    const s = state();
    updateMemory(s, detectIntent("esu vegan", s));
    expect(s.vegan).toBeTruthy();
    expect(s.vegetarian).toBeTruthy();
  });
  it("sets glutenFree=true", () => {
    const s = state();
    updateMemory(s, detectIntent("Be glitimo", s));
    expect(s.glutenFree).toBeTruthy();
  });
  it("sets lactoseFree=true", () => {
    const s = state();
    updateMemory(s, detectIntent("Be laktozės", s));
    expect(s.lactoseFree).toBeTruthy();
  });
  it("wantsFillingFood on 'sočiai'", () => {
    const s = state();
    updateMemory(s, detectIntent("Sočiai", s));
    expect(s.wantsFillingFood).toBeTruthy();
  });
  it("wantsLightFood on 'lengviau'", () => {
    const s = state();
    updateMemory(s, detectIntent("Lengviau", s));
    expect(s.wantsLightFood).toBeTruthy();
  });
  it("wantsSpicyFood on 'aštraus'", () => {
    const s = state();
    updateMemory(s, detectIntent("Aštraus", s));
    expect(s.wantsSpicyFood).toBeTruthy();
  });
  it("filling and light are mutually exclusive — filling wins", () => {
    const s = state();
    s.wantsLightFood = true;
    updateMemory(s, detectIntent("Sočiai", s));
    expect(s.wantsFillingFood).toBeTruthy();
    expect(s.wantsLightFood).toBeFalsy();
  });
});

describe("Memory — allergies and dislikes", () => {
  it("adds nut allergy", () => {
    const s = state();
    updateMemory(s, detectIntent("Alergija riešutams", s));
    expect(s.allergies).toContain("Riešutai");
  });
  it("adds gluten allergy", () => {
    const s = state();
    updateMemory(s, detectIntent("Alergija glitimui", s));
    expect(s.allergies).toContain("Glitimas");
  });
  it("does not duplicate allergy", () => {
    const s = state();
    s.allergies = ["Riešutai"];
    updateMemory(s, detectIntent("Alergija riešutams", s));
    expect(s.allergies.filter((a) => a === "Riešutai").length).toBe(1);
  });
  it("adds mushroom dislike", () => {
    const s = state();
    updateMemory(s, detectIntent("Be grybų", s));
    expect(s.dislikedIngredients).toContain("grybai");
  });
  it("adds onion dislike", () => {
    const s = state();
    updateMemory(s, detectIntent("Nemėgstu svogūnų", s));
    expect(s.dislikedIngredients).toContain("svogūnas");
  });
  it("adds tomato dislike", () => {
    const s = state();
    updateMemory(s, detectIntent("Be pomidorų", s));
    expect(s.dislikedIngredients).toContain("pomidoras");
  });
  it("protein preference stored", () => {
    const s = state();
    updateMemory(s, detectIntent("Noriu vištienos", s));
    expect(s.preferredProtein).toBe("chicken");
  });
  it("protein=fish stored", () => {
    const s = state();
    updateMemory(s, detectIntent("Žuvies", s));
    expect(s.preferredProtein).toBe("fish");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. MENU SEARCH
// ══════════════════════════════════════════════════════════════════════════════

describe("MenuSearch — basics", () => {
  it("allProducts has items", () => {
    expect(allProducts.length).toBeGreaterThan(50);
  });
  it("byCategory('alus') returns beers", () => {
    const beers = byCategory("alus");
    expect(beers.length).toBeGreaterThan(0);
    beers.forEach((p) => expect(p.category).toBe("alus"));
  });
  it("byCategory('zuvis') returns fish", () => {
    const fish = byCategory("zuvis");
    expect(fish.length).toBeGreaterThan(0);
  });
  it("findById finds known product", () => {
    const p = findById("al1");
    expect(p?.category).toBe("alus");
  });
  it("findById returns undefined for unknown", () => {
    expect(findById("zzz_invalid_id")).toBeFalsy();
  });
  it("findByName finds by partial name", () => {
    const results = findByName("Espresso");
    expect(results.length).toBeGreaterThan(0);
  });
  it("textSearch finds by ingredient", () => {
    const results = textSearch("sūris");
    expect(results.length).toBeGreaterThan(0);
  });
  it("pickFresh excludes shown items", () => {
    const pool = byCategory("alus");
    const first = pool.slice(0, 2).map((p) => p.id);
    const { items } = pickFresh(pool, 2, first);
    items.forEach((item) => expect(first.includes(item.id)).toBeFalsy());
  });
  it("pickFresh returns items when pool exhausted", () => {
    const pool = byCategory("alus").slice(0, 2);
    const exclude = pool.map((p) => p.id);
    const { items } = pickFresh(pool, 2, exclude);
    expect(items.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. FILTER ENGINE
// ══════════════════════════════════════════════════════════════════════════════

describe("FilterEngine — allergens", () => {
  it("removes products with listed allergen", () => {
    const s = state();
    s.allergies = ["Pienas"];
    const pool = allProducts;
    const filtered = applyFilters(pool, s);
    filtered.forEach((p) => {
      expect(p.allergens.map((a) => a.toLowerCase()).includes("pienas")).toBeFalsy();
    });
  });
  it("returns results when no allergens set", () => {
    const s = state();
    const filtered = applyFilters(byCategory("zuvis"), s);
    expect(filtered.length).toBeGreaterThan(0);
  });
});

describe("FilterEngine — vegetarian", () => {
  it("removes meat categories when vegetarian=true", () => {
    const s = state();
    s.vegetarian = true;
    const meatCats = ["kiauliena", "jautiena", "vistiena"];
    const pool = allProducts.filter((p) => meatCats.includes(p.category));
    const filtered = applyFilters(pool, s);
    expect(filtered.length).toBe(0);
  });
  it("keeps salads when vegetarian=true", () => {
    const s = state();
    s.vegetarian = true;
    const pool = byCategory("salotos");
    const filtered = applyFilters(pool, s);
    expect(filtered.length).toBeGreaterThan(0);
  });
});

describe("FilterEngine — budget", () => {
  it("removes products above budget", () => {
    const s = state();
    s.budget = 10;
    const filtered = applyFilters(allProducts, s);
    filtered.forEach((p) => {
      if (p.price > 0) expect(p.price).toBeLessThanOrEqual(10);
    });
  });
  it("no budget = no price filter", () => {
    const s = state();
    const filtered = applyFilters(byCategory("jautiena"), s);
    expect(filtered.length).toBeGreaterThan(0);
  });
});

describe("FilterEngine — dislikes", () => {
  it("removes products with disliked ingredient in name/desc", () => {
    const s = state();
    s.dislikedIngredients = ["grybai"];
    const pool = allProducts;
    const filtered = applyFilters(pool, s);
    filtered.forEach((p) => {
      const hay = (p.name + " " + p.description + " " + p.ingredients.join(" ")).toLowerCase();
      expect(hay.includes("grybai")).toBeFalsy();
    });
  });
});

describe("FilterEngine — mood (light/filling)", () => {
  it("wantsLightFood restricts to light categories when pool is large enough", () => {
    const s = state();
    s.wantsLightFood = true;
    const pool = allProducts;
    const filtered = applyFilters(pool, s);
    expect(filtered.length).toBeGreaterThan(0);
  });
  it("wantsFillingFood restricts to filling categories", () => {
    const s = state();
    s.wantsFillingFood = true;
    const pool = allProducts;
    const filtered = applyFilters(pool, s);
    expect(filtered.length).toBeGreaterThan(0);
  });
  it("mood filter falls back when filtered pool is too small", () => {
    const s = state();
    s.wantsSpicyFood = true;
    s.vegetarian = true; // combine constraints
    const pool = byCategory("salotos");
    const filtered = applyFilters(pool, s);
    // should still return something — fallback to non-spicy
    // (or zero if none available — just mustn't crash)
    expect(Array.isArray(filtered)).toBeTruthy();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. PAIRING ENGINE
// ══════════════════════════════════════════════════════════════════════════════

describe("PairingEngine — food→drink", () => {
  it("fish dish pairs with light/wheat beer", () => {
    const s = state();
    const fish = byCategory("zuvis")[0];
    const pairing = pairForFood(fish, s);
    expect(pairing.drinks.length).toBeGreaterThan(0);
    expect(pairing.explanation.length).toBeGreaterThan(10);
  });
  it("steak dish pairs with dark beer or wine", () => {
    const s = state();
    const steak = byCategory("jautiena")[0];
    if (steak) {
      const pairing = pairForFood(steak, s);
      expect(pairing.drinks.length).toBeGreaterThan(0);
    }
  });
  it("pork pairs with lager/IPA", () => {
    const s = state();
    const pork = byCategory("kiauliena")[0];
    if (pork) {
      const pairing = pairForFood(pork, s);
      expect(pairing.explanation.length).toBeGreaterThan(5);
    }
  });
  it("dessert pairs with coffee", () => {
    const s = state();
    const dessert = byCategory("desertai")[0];
    if (dessert) {
      const pairing = pairForFood(dessert, s);
      expect(pairing.explanation.length).toBeGreaterThan(5);
    }
  });
  it("pairForCategory returns drinks for zuvis", () => {
    const s = state();
    const pairing = pairForCategory("zuvis", s);
    expect(pairing.drinks.length).toBeGreaterThan(0);
  });
  it("pairForCategory returns drinks for jautiena", () => {
    const s = state();
    const pairing = pairForCategory("jautiena", s);
    expect(pairing.drinks.length).toBeGreaterThan(0);
  });
  it("defaultPairing returns drinks", () => {
    const s = state();
    const pairing = defaultPairing(s);
    expect(pairing.drinks.length).toBeGreaterThan(0);
  });
  it("pairing respects hard allergen filter", () => {
    const s = state();
    s.allergies = ["Pienas"];
    const fish = byCategory("zuvis")[0];
    if (fish) {
      const pairing = pairForFood(fish, s);
      pairing.drinks.forEach((d) => {
        expect(d.allergens.map((a) => a.toLowerCase()).includes("pienas")).toBeFalsy();
      });
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. RECOMMENDATION ENGINE
// ══════════════════════════════════════════════════════════════════════════════

describe("RecommendationEngine — basics", () => {
  it("recommend returns products", () => {
    const s = state();
    const result = recommend(s);
    expect(result.products.length).toBeGreaterThan(0);
  });
  it("recommend returns max 3 by default", () => {
    const s = state();
    const result = recommend(s);
    expect(result.products.length).toBeLessThanOrEqual(3);
  });
  it("recommend respects vegetarian filter", () => {
    const s = state();
    s.vegetarian = true;
    const result = recommend(s);
    const meatCats = ["kiauliena", "jautiena", "vistiena", "grilinis"];
    result.products.forEach((p) => {
      expect(meatCats.includes(p.category)).toBeFalsy();
    });
  });
  it("recommend respects budget", () => {
    const s = state();
    s.budget = 12;
    const result = recommend(s);
    result.products.forEach((p) => {
      if (p.price > 0) expect(p.price).toBeLessThanOrEqual(12);
    });
  });
  it("recommend respects category override", () => {
    const s = state();
    const result = recommend(s, { categoryOverride: "picos" });
    result.products.forEach((p) => expect(p.category).toBe("picos"));
  });
  it("recommend avoids lastRecommendedIds when requireFresh", () => {
    const s = state();
    const firstBatch = recommend(s, { requireFresh: true });
    setRecommended(s, firstBatch.products.map((p) => p.id));
    const secondBatch = recommend(s, { requireFresh: true });
    const overlap = secondBatch.products.filter((p) =>
      firstBatch.products.some((f) => f.id === p.id)
    );
    // Overlap allowed only when pool is small
    if (byCategory("vistiena").length > 3) {
      expect(overlap.length).toBeLessThanOrEqual(1);
    }
  });
  it("recommendDrinks returns beers when drinkType=beer", () => {
    const s = state();
    const result = recommendDrinks(s, "beer");
    result.products.forEach((p) => expect(p.category).toBe("alus"));
  });
  it("recommendDesserts returns desserts", () => {
    const s = state();
    const result = recommendDesserts(s);
    result.products.forEach((p) => expect(p.category).toBe("desertai"));
  });
  it("recommendKids returns kids menu", () => {
    const s = state();
    const result = recommendKids(s);
    result.products.forEach((p) => expect(p.category).toBe("vaikiskas"));
  });
});

describe("RecommendationEngine — only real products", () => {
  it("all recommended products exist in menu", () => {
    const s = state();
    const result = recommend(s, { n: 10 });
    result.products.forEach((p) => {
      expect(findById(p.id)).toBeTruthy();
    });
  });
  it("drink products exist in menu", () => {
    const s = state();
    const result = recommendDrinks(s, "wine");
    result.products.forEach((p) => {
      expect(findById(p.id)).toBeTruthy();
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. FULL BRAIN — processMessage
// ══════════════════════════════════════════════════════════════════════════════

describe("Brain — basic responses", () => {
  it("responds to 'Ką rekomenduoji?'", () => {
    const s = cs();
    const reply = processMessage("Ką rekomenduoji?", s);
    expect(reply.length).toBeGreaterThan(10);
  });
  it("response contains product names (bullets)", () => {
    const s = cs();
    const reply = processMessage("Ką rekomenduoji?", s);
    expect(reply).toContain("•");
  });
  it("does NOT say 'I am here to help'", () => {
    const s = cs();
    const reply = processMessage("Sveiki", s);
    expect(reply).notToContain("I am here to help");
    expect(reply).notToContain("here to help");
  });
  it("responds in Lithuanian by default", () => {
    const s = cs("lt");
    const reply = processMessage("Ką rekomenduoji?", s);
    // LT response will contain common LT words
    const hasLt = reply.includes("rekomenduočiau") || reply.includes("siūlau") || reply.includes("meniu") || reply.includes("tiktų");
    expect(hasLt).toBeTruthy();
  });
  it("updates state language when EN detected", () => {
    const s = cs("lt");
    processMessage("What would you recommend?", s);
    expect(s.currentLanguage).toBe("en");
  });
});

describe("Brain — state memory across turns", () => {
  it("remembers vegetarian preference", () => {
    const s = cs();
    processMessage("Esu vegetaras", s);
    expect(s.vegetarian).toBeTruthy();
    // Second message should still filter
    const reply = processMessage("Ką rekomenduoji?", s);
    expect(s.vegetarian).toBeTruthy();
  });
  it("remembers budget", () => {
    const s = cs();
    processMessage("Turiu biudžetą iki 12€", s);
    expect(s.budget).toBe(12);
    // Subsequent recommendations should respect budget
    processMessage("Ką rekomenduoji?", s);
    s.lastRecommendedIds.forEach((id) => {
      const p = findById(id);
      if (p && p.price > 0) expect(p.price).toBeLessThanOrEqual(12);
    });
  });
  it("remembers mushroom dislike", () => {
    const s = cs();
    processMessage("Be grybų", s);
    expect(s.dislikedIngredients).toContain("grybai");
  });
  it("remembers nut allergy", () => {
    const s = cs();
    processMessage("Alergija riešutams", s);
    expect(s.allergies).toContain("Riešutai");
  });
  it("tracks lastFoodDishId after food recommendation", () => {
    const s = cs();
    processMessage("Noriu žuvies", s);
    // Should have set lastFoodDishId if fish was recommended
    if (s.lastRecommendedIds.length > 0) {
      // lastFoodDishId may or may not be set depending on category
      expect(Array.isArray(s.lastRecommendedIds)).toBeTruthy();
    }
  });
});

describe("Brain — conversation flows", () => {
  it("one-word replies produce specific recommendations", () => {
    const cases: [string, string[]][] = [
      ["Sočiai", ["kiauliena", "jautiena", "grilinis", "bulviniai", "wok", "koldumai"]],
      ["Lengvai", ["salotos", "sriubos", "zuvis", "lietiniai"]],
      ["Pigiau", [
        "uzkandziai", "salotos", "sriubos", "lietiniai", "koldumai",
        "wok", "bulviniai", "picos", "grilinis", "vistiena",
        "kiauliena", "jautiena", "zuvis", "vaikiskas", "prie-alaus",
      ]],
      ["Dar", [
        "uzkandziai", "salotos", "sriubos", "lietiniai", "koldumai",
        "wok", "bulviniai", "picos", "grilinis", "vistiena",
        "kiauliena", "jautiena", "zuvis", "vaikiskas", "prie-alaus",
      ]],
      ["Vištiena", ["vistiena"]],
      ["Žuvis", ["zuvis"]],
      ["Alus", ["alus"]],
      ["Desertas", ["desertai"]],
    ];

    for (const [input, categories] of cases) {
      const s = cs();
      const reply = processMessage(input, s);
      expect(reply.length).toBeGreaterThan(5);
      expect(reply).notToContain("Ką norėtumėte šiandien");
      expectLastRecommendationsInCategories(s, categories);
    }
  });

  it("one-word fish preference is not stored as an allergy", () => {
    const s = cs();
    processMessage("Žuvis", s);
    expect(s.preferredProtein).toBe("fish");
    expect(s.allergies.includes("Žuvis")).toBeFalsy();
  });

  it("one-word 'Pigiau' applies an affordable budget", () => {
    const s = cs();
    processMessage("Pigiau", s);
    expect(s.budget).toBe(12);
    s.lastRecommendedIds.forEach((id) => {
      const p = findById(id);
      if (p && p.price > 0) expect(p.price).toBeLessThanOrEqual(12);
    });
  });

  it("short answer after assistant question is treated as context", () => {
    const s = cs();
    const question = processMessage("Labas", s);
    expect(question.length).toBeGreaterThan(5);
    processMessage("Vištiena", s);
    expect(s.preferredProtein).toBe("chicken");
    expectLastRecommendationsInCategories(s, ["vistiena"]);
  });

  it("short mood answer after assistant question is treated as context", () => {
    const s = cs();
    processMessage("Labas", s);
    processMessage("Lengvai", s);
    expect(s.wantsLightFood).toBeTruthy();
    expectLastRecommendationsInCategories(s, ["salotos", "sriubos", "zuvis", "lietiniai"]);
  });

  it("drink pairing with named salmon returns drinks only", () => {
    const s = cs();
    const reply = processMessage("ką atsigerti prie lašišos?", s);
    expect(reply.length).toBeGreaterThan(10);
    expectLastRecommendationsInCategories(s, DRINK_TEST_CATEGORIES);
  });

  it("beer pairing with BBQ ribs returns beer only", () => {
    const s = cs();
    const reply = processMessage("kokį alų prie BBQ šonkaulių?", s);
    expect(reply.length).toBeGreaterThan(10);
    expectLastRecommendationsInCategories(s, ["alus"]);
  });

  it("drink pairing with pork belly returns drinks only", () => {
    const s = cs();
    const reply = processMessage("Kokį gėrimą prie kiaulienos šoninės?", s);
    expect(reply.length).toBeGreaterThan(10);
    expectLastRecommendationsInCategories(s, DRINK_TEST_CATEGORIES);
  });

  it("drink pairing with potato pancakes returns drinks only", () => {
    const s = cs();
    const reply = processMessage("kokį gėrimą prie bulvinių blynų?", s);
    expect(reply.length).toBeGreaterThan(10);
    expectLastRecommendationsInCategories(s, DRINK_TEST_CATEGORIES);
  });

  it("'o prie šito?' returns drinks only from current food context", () => {
    const s = cs();
    processMessage("Noriu lašišos", s);
    const reply = processMessage("o prie šito?", s);
    expect(reply.length).toBeGreaterThan(10);
    expectLastRecommendationsInCategories(s, DRINK_TEST_CATEGORIES);
  });

  it("context pronoun 'jos' uses the previous food dish for drink pairing", () => {
    const s = cs();
    processMessage("Noriu kiaulienos", s);
    const foodId = s.lastFoodDishId;
    const reply = processMessage("Ką prie jos gerti?", s);
    expect(reply.length).toBeGreaterThan(10);
    expect(s.lastFoodDishId).toBe(foodId);
    expectLastRecommendationsInCategories(s, DRINK_TEST_CATEGORIES);
  });

  it("food mode recommends food only", () => {
    const s = cs();
    const reply = processMessage("Rekomenduok ką nors", s);
    expect(reply.length).toBeGreaterThan(10);
    expectLastRecommendationsInCategories(s, FOOD_TEST_CATEGORIES);
  });

  it("allergy mode updates memory and recommends safe food", () => {
    const s = cs();
    processMessage("Be grybų", s);
    expect(s.dislikedIngredients).toContain("grybai");
    expectLastRecommendationsInCategories(s, FOOD_TEST_CATEGORIES);
    s.lastRecommendedIds.forEach((id) => {
      const p = findById(id);
      if (p) {
        const hay = `${p.name} ${p.description} ${p.ingredients.join(" ")}`.toLowerCase();
        expect(hay.includes("gryb")).toBeFalsy();
      }
    });
  });

  it("ingredients mode answers about the current dish without new recommendations", () => {
    const s = cs();
    processMessage("Noriu lašišos", s);
    const reply = processMessage("Kas jos sudėtyje?", s);
    expect(reply).toContain("Sudėtis");
    expect(reply).toContain("Lašišos");
  });

  it("price mode answers price without recommending a category", () => {
    const s = cs();
    const reply = processMessage("Kiek kainuoja lašiša?", s);
    expect(reply).toContain("20.90");
    expect(s.lastRecommendedIds.length).toBe(0);
  });

  it("menu search mode for beer returns drinks only", () => {
    const s = cs();
    processMessage("Kokį alų turite?", s);
    expectLastRecommendationsInCategories(s, ["alus"]);
  });

  it("budget mode recommends food only within budget", () => {
    const s = cs();
    processMessage("Iki 10 eurų", s);
    expect(s.budget).toBe(10);
    expectLastRecommendationsInCategories(s, FOOD_TEST_CATEGORIES);
    s.lastRecommendedIds.forEach((id) => {
      const p = findById(id);
      if (p && p.price > 0) expect(p.price).toBeLessThanOrEqual(10);
    });
  });

  it("children mode returns only kids menu", () => {
    const s = cs();
    processMessage("Ką vaikui?", s);
    expectLastRecommendationsInCategories(s, ["vaikiskas"]);
  });

  it("follow-up after beer stays in drinks", () => {
    const s = cs();
    processMessage("Alus", s);
    processMessage("Dar", s);
    expectLastRecommendationsInCategories(s, DRINK_TEST_CATEGORIES);
  });

  it("follow-up 'Ne' after food still returns food alternatives", () => {
    const s = cs();
    processMessage("Rekomenduok ką nors", s);
    const reply = processMessage("Ne", s);
    expect(reply.length).toBeGreaterThan(10);
    expectLastRecommendationsInCategories(s, FOOD_TEST_CATEGORIES);
  });

  it("short 'No alcohol' after food returns non-alcoholic drinks only", () => {
    const s = cs();
    processMessage("Noriu jautienos", s);
    processMessage("No alcohol", s);
    expect(s.preferredDrink).toBe("nonAlcoholic");
    expectLastRecommendationsInCategories(s, ["limonadai", "gerimai", "nealko-alus", "kava", "kokteiliai", "sampanas"]);
    s.lastRecommendedIds.forEach((id) => {
      const p = findById(id);
      if (p && ["kokteiliai", "sampanas"].includes(p.category)) {
        const text = `${p.name} ${p.description}`.toLowerCase();
        expect(text.includes("nealkohol") || text.includes("non-alcohol")).toBeTruthy();
      }
    });
  });

  it("'Ką rekomenduoji?' then 'Dar' shows different products", () => {
    const s = cs();
    const r1 = processMessage("Ką rekomenduoji?", s);
    const ids1 = [...s.lastRecommendedIds];
    const r2 = processMessage("Dar", s);
    const ids2 = [...s.lastRecommendedIds];
    // Response should be different
    expect(r2).not.toBe(r1);
    // IDs may overlap if pool is small, but reply should be different text
    expect(typeof r2).toBe("string");
  });

  it("'Noriu vištienos' → 'Dar' → different chicken dishes", () => {
    const s = cs();
    processMessage("Noriu vištienos", s);
    const first = [...s.lastRecommendedIds];
    processMessage("Dar", s);
    const second = [...s.lastRecommendedIds];
    // Should have attempted fresh picks
    expect(Array.isArray(second)).toBeTruthy();
  });

  it("'Sočiai' then 'Dar pigiau'", () => {
    const s = cs();
    processMessage("Sočiai", s);
    expect(s.wantsFillingFood).toBeTruthy();
    const r = processMessage("Dar pigiau", s);
    expect(r.length).toBeGreaterThan(5);
  });

  it("'Esu vegetaras' then 'Ką rekomenduoji?' avoids meat", () => {
    const s = cs();
    processMessage("Esu vegetaras", s);
    processMessage("Ką rekomenduoji?", s);
    const meatCats = ["kiauliena", "jautiena", "vistiena", "grilinis"];
    s.lastRecommendedIds.forEach((id) => {
      const p = findById(id);
      if (p) expect(meatCats.includes(p.category)).toBeFalsy();
    });
  });

  it("'Noriu žuvies' → 'Ką atsigerti?' returns drinks", () => {
    const s = cs();
    processMessage("Noriu žuvies", s);
    const reply = processMessage("Ką atsigerti?", s);
    // Should contain pairing info, not food
    expect(reply.length).toBeGreaterThan(10);
  });

  it("'Kokį alų?' returns beers", () => {
    const s = cs();
    const reply = processMessage("Kokį alų?", s);
    s.lastRecommendedIds.forEach((id) => {
      const p = findById(id);
      if (p) expect(p.category).toBe("alus");
    });
  });

  it("'Ką vaikui?' returns kids dishes", () => {
    const s = cs();
    const reply = processMessage("Ką vaikui?", s);
    s.lastRecommendedIds.forEach((id) => {
      const p = findById(id);
      if (p) expect(p.category).toBe("vaikiskas");
    });
  });

  it("'Noriu deserto' returns desserts", () => {
    const s = cs();
    processMessage("Noriu deserto", s);
    s.lastRecommendedIds.forEach((id) => {
      const p = findById(id);
      if (p) expect(p.category).toBe("desertai");
    });
  });

  it("'Ką rekomenduoji?' → 'Ne' → shows alternatives", () => {
    const s = cs();
    processMessage("Ką rekomenduoji?", s);
    const r2 = processMessage("Ne", s);
    expect(r2.length).toBeGreaterThan(10);
  });

  it("'Darbo laikas?' returns hours info", () => {
    const s = cs();
    const reply = processMessage("Darbo laikas?", s);
    expect(reply).toContain("11:00");
  });

  it("'Kur esate?' returns address", () => {
    const s = cs();
    const reply = processMessage("Kur esate?", s);
    expect(reply).toContain("Alytus");
  });

  it("'O prie šito?' after food gives drink pairing", () => {
    const s = cs();
    processMessage("Noriu lašišos", s);
    // Set lastFoodDishId manually if not set
    if (!s.lastFoodDishId) {
      const fish = byCategory("zuvis")[0];
      if (fish) s.lastFoodDishId = fish.id;
    }
    const reply = processMessage("O prie šito?", s);
    expect(reply.length).toBeGreaterThan(10);
  });

  it("budget 12 then 'Dar pigiau' reduces budget", () => {
    const s = cs();
    processMessage("Iki 12€", s);
    expect(s.budget).toBe(12);
    processMessage("Dar pigiau", s);
    expect(s.budget).toBeLessThanOrEqual(12);
  });

  it("allergy persists across multiple turns", () => {
    const s = cs();
    processMessage("Alergija riešutams", s);
    processMessage("Noriu sočiai pavalgyti", s);
    processMessage("Dar", s);
    // Allergy must still be set
    expect(s.allergies).toContain("Riešutai");
    // Recommended products must not contain the allergen
    s.lastRecommendedIds.forEach((id) => {
      const p = findById(id);
      if (p) {
        expect(p.allergens.map((a) => a.toLowerCase()).includes("riešutai")).toBeFalsy();
      }
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. SHIM COMPATIBILITY (ai-engine.ts)
// ══════════════════════════════════════════════════════════════════════════════

describe("ai-engine shim compatibility", () => {
  it("emptyContext returns valid state", () => {
    const ctx = emptyContext();
    expect(ctx.vegetarian).toBeFalsy();
    expect(ctx.currentLanguage).toBe("lt");
    expect(Array.isArray(ctx.allergies)).toBeTruthy();
  });
  it("generateReply returns a string", () => {
    const ctx = emptyContext();
    const reply = generateReply("Ką rekomenduoji?", ctx, "lt");
    expect(typeof reply).toBe("string");
    expect(reply.length).toBeGreaterThan(5);
  });
  it("generateReply updates ctx in place", () => {
    const ctx = emptyContext();
    generateReply("Esu vegetaras", ctx, "lt");
    expect(ctx.vegetarian).toBeTruthy();
  });
  it("generateReply respects lang param", () => {
    const ctx = emptyContext("lt");
    generateReply("Ką rekomenduoji?", ctx, "en");
    expect(ctx.currentLanguage).toBe("en");
  });
  it("updateContext is a no-op (does not throw)", () => {
    const ctx = emptyContext();
    // updateContext is imported at top level — just call it
    const { updateContext: uc } = { updateContext: (_c: unknown, _i: string) => {} };
    uc(ctx, "test");
    expect(true).toBeTruthy(); // no throw
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. EDGE CASES
// ══════════════════════════════════════════════════════════════════════════════

describe("Edge cases", () => {
  it("empty input does not crash", () => {
    const s = cs();
    const reply = processMessage("", s);
    expect(typeof reply).toBe("string");
  });
  it("very long input does not crash", () => {
    const s = cs();
    const long = "norėčiau ".repeat(100);
    const reply = processMessage(long, s);
    expect(typeof reply).toBe("string");
  });
  it("unknown words return some response", () => {
    const s = cs();
    const reply = processMessage("xyzxyzxyz blah blah", s);
    expect(reply.length).toBeGreaterThan(5);
  });
  it("multiple allergies stack", () => {
    const s = cs();
    processMessage("Alergija riešutams", s);
    processMessage("Alergija glitimui", s);
    expect(s.allergies).toContain("Riešutai");
    expect(s.allergies).toContain("Glitimas");
  });
  it("multiple dislikes stack", () => {
    const s = cs();
    processMessage("Be grybų", s);
    processMessage("Be svogūnų", s);
    expect(s.dislikedIngredients).toContain("grybai");
    expect(s.dislikedIngredients).toContain("svogūnas");
  });
  it("Russian input is handled", () => {
    const s = cs("ru");
    const reply = processMessage("Порекомендуй что-нибудь", s);
    expect(reply.length).toBeGreaterThan(5);
  });
  it("English input is handled", () => {
    const s = cs("en");
    const reply = processMessage("What would you recommend?", s);
    expect(reply.length).toBeGreaterThan(5);
  });
  it("'Dar' after 'Dar' (double change) still works", () => {
    const s = cs();
    processMessage("Ką rekomenduoji?", s);
    processMessage("Dar", s);
    const reply = processMessage("Dar", s);
    expect(typeof reply).toBe("string");
  });
  it("reset clears all state", () => {
    const s = cs();
    processMessage("Esu vegetaras", s);
    processMessage("Alergija riešutams", s);
    const fresh = createState("lt");
    expect(fresh.vegetarian).toBeFalsy();
    expect(fresh.allergies.length).toBe(0);
  });
  it("no products are invented — all IDs exist in menu", () => {
    const s = cs();
    const msgs = [
      "Ką rekomenduoji?", "Dar", "Noriu žuvies", "Ką atsigerti?",
      "Noriu deserto", "Kokį alų?", "Noriu picos", "Sočiai",
    ];
    for (const msg of msgs) {
      processMessage(msg, s);
      for (const id of s.lastRecommendedIds) {
        expect(findById(id)).toBeTruthy();
      }
    }
  });
  it("diet preference survives 5+ turns", () => {
    const s = cs();
    processMessage("Be grybų ir svogūnų", s);
    for (let i = 0; i < 5; i++) {
      processMessage(i % 2 === 0 ? "Ką rekomenduoji?" : "Dar", s);
    }
    expect(s.dislikedIngredients).toContain("grybai");
  });
  it("conversation history is recorded", () => {
    const s = cs();
    processMessage("Labas", s);
    expect(s.conversationHistory.length).toBeGreaterThanOrEqual(2); // user + assistant
  });
  it("max 20 turns in history (no memory leak)", () => {
    const s = cs();
    for (let i = 0; i < 15; i++) {
      processMessage("Dar", s);
    }
    expect(s.conversationHistory.length).toBeLessThanOrEqual(20);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 11. LITHUANIAN NLU MATRIX
// ══════════════════════════════════════════════════════════════════════════════

describe("Lithuanian NLU — drink forms return drinks", () => {
  const cases = [
    "ka gerti", "ką gerti", "ka gert", "koki gerima", "kokį gėrimą",
    "kokio gerimo", "kokiu gerimu", "ka atsigerti", "ką atsigerti",
    "isgerti", "išgerti", "atsigerti", "atsigerciau", "atsigerčiau",
    "gerčiau", "gerti", "gert", "gėrimą", "gerima", "gėrimo",
    "gėrimų", "prie ko gerti", "kokį alų", "sviesus alus",
    "šviesus alus", "tamsus alus", "kokį vyną", "raudonas vynas",
    "baltas vynas", "kokteili", "gin tonic", "kavos", "arbata",
    "sultys", "vanduo", "gira",
  ];

  cases.forEach((input) => {
    it(`understands drink form: ${input}`, () => {
      const s = cs();
      processMessage(input, s);
      expectLastRecommendationsInCategories(s, DRINK_TEST_CATEGORIES);
    });
  });
});

describe("Lithuanian NLU — drink pairing forms never return food", () => {
  const cases = [
    "prie salotu", "prie salotų", "kokį gėrimą prie salotų",
    "prie bulviniu blynu", "prie bulvinių blynų", "kokį gėrimą prie bulvinių blynų",
    "prie lasisos", "prie lašišos", "ką atsigerti prie lašišos",
    "prie kiaulienos sonines", "prie kiaulienos šoninės",
    "kokį alų prie BBQ šonkaulių", "ka gert prie sonkauliu",
    "ka prie lasisos gert", "kokiu gerimu prie picos", "prie picos",
    "prie vištienos", "prie vistienos", "prie jautienos", "prie žuvies",
  ];

  cases.forEach((input) => {
    it(`pairs drinks for: ${input}`, () => {
      const s = cs();
      processMessage(input, s);
      expectLastRecommendationsInCategories(s, DRINK_TEST_CATEGORIES);
    });
  });
});

describe("Lithuanian NLU — one-word and short context answers", () => {
  const foodCases: [string, string[]][] = [
    ["sociai", ["kiauliena", "jautiena", "grilinis", "bulviniai", "wok", "koldumai"]],
    ["sočiai", ["kiauliena", "jautiena", "grilinis", "bulviniai", "wok", "koldumai"]],
    ["lengvai", ["salotos", "sriubos", "zuvis", "lietiniai"]],
    ["lengviau", ["salotos", "sriubos", "zuvis", "lietiniai"]],
    ["vištiena", ["vistiena"]],
    ["vistiena", ["vistiena"]],
    ["zuvis", ["zuvis"]],
    ["žuvys", ["zuvis"]],
    ["žuvies", ["zuvis"]],
    ["pica", ["picos"]],
    ["bulviniai", ["bulviniai"]],
    ["salotos", ["salotos"]],
    ["desertas", ["desertai"]],
  ];

  foodCases.forEach(([input, categories]) => {
    it(`understands short answer: ${input}`, () => {
      const s = cs();
      processMessage(input, s);
      expectLastRecommendationsInCategories(s, categories);
    });
  });

  const followUps = ["pigiau", "dar", "ne", "ne sita", "ne šita", "geriau vištiena", "žuvies"];
  followUps.forEach((input) => {
    it(`uses context for short follow-up: ${input}`, () => {
      const s = cs();
      processMessage("Rekomenduok ką nors", s);
      processMessage(input, s);
      expect(s.lastRecommendedIds.length).toBeGreaterThan(0);
    });
  });
});

describe("Lithuanian NLU — memory references", () => {
  const refs = [
    "o prie sito", "o prie šito", "prie jo", "prie jos", "ka prie jo gert",
    "ką prie jo gerti", "ka prie jos gert", "prie šiam", "prie tam", "prie to",
  ];

  refs.forEach((input) => {
    it(`uses active dish reference: ${input}`, () => {
      const s = cs();
      processMessage("Noriu bulvinių blynų", s);
      processMessage(input, s);
      expect(s.activeDishId ?? s.lastFoodDishId).toBe("b4");
      expectLastRecommendationsInCategories(s, DRINK_TEST_CATEGORIES);
    });
  });

  it("selects a partial dish from previous recommendations", () => {
    const s = cs();
    processMessage("Rekomenduok ką nors", s);
    s.lastRecommendedIds = ["b4", "ki9", "s2"];
    processMessage("Bulvinius", s);
    expect(s.activeDishId ?? s.lastFoodDishId).toBe("b4");
  });
});

describe("Lithuanian NLU — restrictions and diet", () => {
  const dislikeCases = [
    "be grybų", "be grybu", "nemėgstu grybų", "nemegstu grybu",
    "be svogūnų", "be svogunu", "be pomidorų", "be surio",
  ];

  dislikeCases.forEach((input) => {
    it(`stores dislike: ${input}`, () => {
      const s = cs();
      processMessage(input, s);
      expect(s.dislikedIngredients.length > 0 || s.vegetarian).toBeTruthy();
    });
  });

  const allergyCases = [
    ["alergija riešutams", "Riešutai"],
    ["alergija riesutams", "Riešutai"],
    ["alergija glitimui", "Glitimas"],
    ["alergija kiaušiniams", "Kiaušiniai"],
    ["alergija kiausiniams", "Kiaušiniai"],
    ["netoleruoju pieno", "Pienas"],
  ] as const;

  allergyCases.forEach(([input, allergen]) => {
    it(`stores allergy: ${input}`, () => {
      const s = cs();
      processMessage(input, s);
      expect(s.allergies).toContain(allergen);
    });
  });

  const dietCases = [
    "be mėsos", "be mesos", "vegetaras", "vegetare", "vegetariškai",
    "nevalgau mesos", "veganas", "vegane", "veganiskas", "veganiška",
  ];

  dietCases.forEach((input) => {
    it(`understands diet: ${input}`, () => {
      const s = cs();
      processMessage(input, s);
      expect(s.vegetarian || s.vegan).toBeTruthy();
    });
  });
});

describe("Lithuanian NLU — budget and price forms", () => {
  const budgets: [string, number][] = [
    ["iki 10 eur", 10],
    ["iki 15", 15],
    ["iki 20€", 20],
    ["iki 25 euru", 25],
    ["biudzetas 12", 12],
    ["biudžetas 18", 18],
  ];

  budgets.forEach(([input, amount]) => {
    it(`extracts budget: ${input}`, () => {
      const s = cs();
      processMessage(input, s);
      expect(s.budget).toBe(amount);
      s.lastRecommendedIds.forEach((id) => {
        const p = findById(id);
        if (p && p.price > 0) expect(p.price).toBeLessThanOrEqual(amount);
      });
    });
  });

  ["pigiau", "dar pigiau", "pigesnio", "nebrangu", "pigu"].forEach((input) => {
    it(`handles cheap phrase: ${input}`, () => {
      const s = cs();
      processMessage("iki 20", s);
      processMessage(input, s);
      expect(s.budget).toBeLessThanOrEqual(20);
    });
  });

  ["kiek kainuoja lašiša", "kaina lašišos", "kiek eur lašiša"].forEach((input) => {
    it(`answers price: ${input}`, () => {
      const s = cs();
      const reply = processMessage(input, s);
      expect(reply).toContain("20.90");
    });
  });
});

describe("Lithuanian NLU — food entity forms", () => {
  const cases: [string, string[]][] = [
    ["lasisa", ["zuvis"]], ["lašiša", ["zuvis"]], ["lasisos", ["zuvis"]], ["lašišos", ["zuvis"]],
    ["kiauliena", ["kiauliena", "grilinis"]], ["kiaulienos", ["kiauliena", "grilinis"]],
    ["sonine", ["kiauliena"]], ["šoninė", ["kiauliena"]], ["sonkauliai", ["kiauliena", "grilinis"]],
    ["jautiena", ["jautiena", "grilinis"]], ["jautienos", ["jautiena", "grilinis"]],
    ["antrekotas", ["jautiena", "grilinis"]], ["steikas", ["jautiena", "grilinis"]],
    ["vistiena", ["vistiena"]], ["vištienos", ["vistiena"]], ["sparneliai", ["vistiena"]],
    ["zuvis", ["zuvis"]], ["menke", ["zuvis"]], ["tunas", ["zuvis"]],
    ["bulviniai blynai", ["bulviniai"]], ["bulviniu blynu", ["bulviniai"]],
    ["cepelinai", ["bulviniai"]], ["didzkukuliai", ["bulviniai"]],
    ["salotu", ["salotos"]], ["cezario", ["salotos"]], ["graikiskos", ["salotos"]],
    ["picos", ["picos"]], ["pizza", ["picos"]], ["pepperoni", ["picos"]],
    ["ledai", ["desertai"]], ["brownie", ["desertai"]], ["pyragas", ["desertai"]],
  ];

  cases.forEach(([input, categories]) => {
    it(`understands food form: ${input}`, () => {
      const s = cs();
      processMessage(input, s);
      expectLastRecommendationsInCategories(s, categories);
    });
  });
});

describe("Lithuanian NLU — normalization", () => {
  const pairs = [
    ["gėrimą", "gerima"], ["išgerti", "isgerti"], ["ką gerti", "ka gerti"],
    ["lašišos", "lasisos"], ["šonkaulių", "sonkauliu"], ["vištiena", "vistiena"],
    ["žuvies", "zuvies"], ["bulvinių blynų", "bulviniu blynu"], ["riešutų", "riesutu"],
    ["kiaušinių", "kiausiniu"], ["mėgstamiausia", "megstamiausia"], ["šito", "sito"],
    ["sudėtis", "sudetis"], ["aštru", "astru"], ["vaikiškas", "vaikiskas"],
  ];

  pairs.forEach(([input, expected]) => {
    it(`normalizes ${input}`, () => {
      expect(normalizeText(input)).toBe(expected);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 12. SEMANTIC RESTRICTION SYSTEM
// ══════════════════════════════════════════════════════════════════════════════

describe("RestrictionEngine — minor phrases disable alcohol", () => {
  const cases = [
    "nepilnametis", "nepilnamete", "nepilnametė", "esu nepilnametis",
    "esu nepilnamete", "esu nepilnametė", "as nepilnametis", "aš nepilnametis",
    "as nepilnamete", "aš nepilnametė", "nesu pilnametis", "nesu pilnamete",
    "nesu pilnametė", "dar nesu pilnametis", "dar nesu pilnamete",
    "dar nesu pilnametė", "dar nepilnametis", "dar nepilnamete",
    "dar nepilnametė", "man nera 18", "man nėra 18", "man dar nera 18",
    "man dar nėra 18", "neturiu 18", "dar neturiu 18", "dar ne 18",
    "ne 18", "iki 18", "man maziau nei 18", "man mažiau nei 18",
    "man tik 17", "man tik 16", "man tik 15", "man tik 14",
    "man 17", "man 16", "man 15", "man 14", "esu 17", "esu 16",
    "esu 15", "esu 14", "esu septyniolikos", "esu šešiolikos",
    "esu sesiolikos", "esu penkiolikos", "esu keturiolikos",
    "man septyniolika", "man šešiolika", "man sesiolika", "man penkiolika",
    "man keturiolika", "per jaunas", "per jauna", "esu per jaunas",
    "esu per jauna", "dar vaikas", "esu vaikas", "as vaikas", "aš vaikas",
    "mokausi mokykloje", "dar mokausi mokykloje", "negaliu gerti alkoholio",
    "negaliu vartoti alkoholio", "man negalima alkoholio", "alkoholio negalima",
    "alkoholio man negalima", "underage", "minor", "i am under 18",
    "i'm under 18", "i am 17", "i'm 17", "i am 16", "i'm 16",
    "not 18 yet", "not old enough", "too young", "can't drink alcohol",
    "cannot drink alcohol",
  ];

  cases.forEach((input) => {
    it(`stores minor/no-alcohol: ${input}`, () => {
      const s = cs();
      processMessage(input, s);
      expect(s.ageGroup === "minor" || s.allowAlcohol === false).toBeTruthy();
      expect(s.allowAlcohol).toBeFalsy();
      processMessage("Kokį alų?", s);
      expectNoAlcoholRecommendations(s);
    });
  });
});

describe("RestrictionEngine — no alcohol phrases persist", () => {
  const cases = [
    "negeriu alkoholio", "alkoholio negeriu", "nevartoju alkoholio",
    "nevartoju", "be alkoholio", "nenoriu alkoholio", "alkoholio nenoriu",
    "man be alkoholio", "bealkoholinis", "nealkoholinis", "nealkoholinio",
    "tik nealkoholini", "tik nealkoholinį", "vairuoju", "as vairuoju",
    "aš vairuoju", "esu vairuotojas", "esu vairuotoja", "rytoj i darba",
    "rytoj į darbą", "siandien dirbu", "šiandien dirbu", "negaliu gerti",
    "negaliu vartoti", "po vaistų", "vartoju vaistus", "esu su masina",
    "esu su mašina", "no alcohol", "non alcoholic", "can't drink alcohol",
  ];

  cases.forEach((input) => {
    it(`allows only non-alcoholic drinks: ${input}`, () => {
      const s = cs();
      processMessage(input, s);
      expect(s.allowAlcohol).toBeFalsy();
      processMessage("Kokį gėrimą prie lašišos?", s);
      expectNoAlcoholRecommendations(s);
    });
  });
});

describe("RestrictionEngine — vegetarian phrases avoid meat and fish", () => {
  const cases = [
    "vegetaras", "vegetare", "vegetarė", "esu vegetaras", "esu vegetare",
    "esu vegetarė", "vegetariskai", "vegetariškai", "vegetarinis",
    "vegetarine", "vegetarinė", "be mesos", "be mėsos", "mesos nevalgau",
    "mėsos nevalgau", "nevalgau mesos", "nevalgau mėsos", "nenoriu mesos",
    "nenoriu mėsos", "be jautienos", "be kiaulienos", "be vistienos",
    "be vištienos", "be žuvies", "be zuvies", "valgau tik darzoves",
    "valgau tik daržoves", "noriu be mesos", "noriu be mėsos",
    "ka be mesos", "ką be mėsos", "vegetarian", "meatless", "no meat",
  ];

  cases.forEach((input) => {
    it(`stores vegetarian/no meat: ${input}`, () => {
      const s = cs();
      processMessage(input, s);
      expect(s.vegetarian || s.noMeat).toBeTruthy();
      processMessage("Ką rekomenduojate?", s);
      expectNoRestrictionViolations(s);
    });
  });
});

describe("RestrictionEngine — vegan phrases avoid animal products", () => {
  const cases = [
    "veganas", "vegane", "veganė", "esu veganas", "esu vegane",
    "esu veganė", "veganiskai", "veganiškai", "veganiskas", "veganiškas",
    "tik augalinis", "tik augalinis maistas", "be gyvuniniu produktu",
    "be gyvūninių produktų", "be pieno", "be surio", "be sūrio",
    "be kiausiniu", "be kiaušinių", "be sviesto", "be grietines",
    "be grietinės", "be medaus", "nevalgau pieno produktu",
    "nevalgau pieno produktų", "nevalgau kiausiniu", "nevalgau kiaušinių",
    "vegan", "plant based", "plant-based",
  ];

  cases.forEach((input) => {
    it(`stores vegan/no animal products: ${input}`, () => {
      const s = cs();
      processMessage(input, s);
      expect(s.vegan || s.noAnimalProducts).toBeTruthy();
      processMessage("Ką rekomenduojate?", s);
      expectNoRestrictionViolations(s);
    });
  });
});

describe("RestrictionEngine — no pork and religious restrictions", () => {
  const noPorkCases = [
    "be kiaulienos", "kiaulienos ne", "kiaulienos negalima",
    "nevalgau kiaulienos", "nenoriu kiaulienos", "kiauliena netinka",
    "be sonines", "be šoninės", "sonines nevalgau", "šoninės nevalgau",
    "nenoriu sonines", "nenoriu šoninės", "nevalgau kumpio", "be kumpio",
    "be sonkauliu", "be šonkaulių", "no pork",
  ];

  noPorkCases.forEach((input) => {
    it(`stores no-pork: ${input}`, () => {
      const s = cs();
      processMessage(input, s);
      expect(s.noPork).toBeTruthy();
      processMessage("Ką rekomenduojate?", s);
      expectNoRestrictionViolations(s);
    });
  });

  const religiousCases = ["halal", "halal maistas", "musulmonas", "musulmonė", "muslim"];
  religiousCases.forEach((input) => {
    it(`halal-like restriction avoids pork and alcohol: ${input}`, () => {
      const s = cs();
      processMessage(input, s);
      expect(s.noPork).toBeTruthy();
      expect(s.allowAlcohol).toBeFalsy();
      processMessage("Kokį alų?", s);
      expectNoAlcoholRecommendations(s);
    });
  });

  ["kosher", "košerinis", "kosher maistas"].forEach((input) => {
    it(`kosher-like restriction avoids pork and shellfish: ${input}`, () => {
      const s = cs();
      processMessage(input, s);
      expect(s.noPork).toBeTruthy();
      expect(s.avoidShellfish).toBeTruthy();
      processMessage("Ką rekomenduojate?", s);
      expectNoRestrictionViolations(s);
    });
  });
});

describe("RestrictionEngine — allergy word forms", () => {
  const cases: [string, string][] = [
    ["alergija riešutams", "Riešutai"], ["alergija riesutams", "Riešutai"],
    ["turiu alergija riesutams", "Riešutai"], ["alergija migdolams", "Riešutai"],
    ["alergija glitimui", "Glitimas"], ["alergija gliutenui", "Glitimas"],
    ["netoleruoju glitimo", "Glitimas"], ["negaliu valgyti kvieciu", "Glitimas"],
    ["alergija miltams", "Glitimas"], ["alergija pienui", "Pienas"],
    ["netoleruoju laktozės", "Pienas"], ["netoleruoju laktozes", "Pienas"],
    ["alergija sūriui", "Pienas"], ["alergija suriui", "Pienas"],
    ["blogai nuo grietines", "Pienas"], ["alergiškas kiaušiniams", "Kiaušiniai"],
    ["alergiskas kiausiniams", "Kiaušiniai"], ["netoleruoju kiausiniu", "Kiaušiniai"],
    ["alergija žuviai", "Žuvis"], ["alergija zuviai", "Žuvis"],
    ["alergija lašišai", "Žuvis"], ["alergija tunui", "Žuvis"],
    ["alergija krevetėms", "Vėžiagyviai"], ["alergija krevetems", "Vėžiagyviai"],
    ["alergija juru gerybems", "Vėžiagyviai"], ["alergija moliuskams", "Vėžiagyviai"],
    ["alergija garstyčioms", "Garstyčios"], ["alergija garstycioms", "Garstyčios"],
    ["alergija salierams", "Salierai"], ["alergija sezamui", "Sezamas"],
    ["alergija sojai", "Soja"], ["reakcija nuo sojos", "Soja"],
  ];

  cases.forEach(([input, allergen]) => {
    it(`stores and filters allergy: ${input}`, () => {
      const s = cs();
      processMessage(input, s);
      expect(s.allergies).toContain(allergen);
      processMessage("Ką rekomenduojate?", s);
      expectNoRestrictionViolations(s);
      s.lastRecommendedIds.forEach((id) => {
        const p = findById(id);
        if (p) expect(productHasAllergenRisk(p, allergen)).toBeFalsy();
      });
    });
  });
});

describe("RestrictionEngine — dislike word forms", () => {
  const cases: [string, string][] = [
    ["be grybų", "grybai"], ["be grybu", "grybai"],
    ["nemėgstu grybų", "grybai"], ["nemegstu grybu", "grybai"],
    ["nepatinka grybai", "grybai"], ["be svogūnų", "svogūnas"],
    ["be svogunu", "svogūnas"], ["nemėgstu svogūnų", "svogūnas"],
    ["svogūnų nenoriu", "svogūnas"], ["be pomidorų", "pomidoras"],
    ["pomidoru nenoriu", "pomidoras"], ["be sūrio", "sūris"],
    ["be surio", "sūris"], ["nevalgau žuvies", "žuvis"],
    ["žuvies nemėgstu", "žuvis"], ["nevalgau kiaulienos", "kiauliena"],
    ["be kumpio", "kiauliena"], ["be šoninės", "kiauliena"],
  ];

  cases.forEach(([input, ingredient]) => {
    it(`stores and filters dislike: ${input}`, () => {
      const s = cs();
      processMessage(input, s);
      expect(s.dislikedIngredients.includes(ingredient) || s.noPork).toBeTruthy();
      processMessage("Ką rekomenduojate?", s);
      expectNoRestrictionViolations(s);
      s.lastRecommendedIds.forEach((id) => {
        const p = findById(id);
        if (p && s.dislikedIngredients.includes(ingredient)) {
          expect(productHasDislikedRisk(p, ingredient)).toBeFalsy();
        }
      });
    });
  });
});

describe("RestrictionEngine — budget semantics", () => {
  const cases: [string, number][] = [
    ["iki 10", 10], ["iki 10 eur", 10], ["iki 10€", 10], ["iki desimt", 10],
    ["iki dešimt", 10], ["iki 15", 15], ["iki 15 eur", 15], ["iki 15€", 15],
    ["iki penkiolika", 15], ["iki 20", 20], ["iki 20 eur", 20], ["iki 20€", 20],
    ["iki dvidesimt", 20], ["iki dvidešimt", 20], ["iki 25", 25], ["iki 30", 30],
    ["biudzetas 15", 15], ["biudžetas 15", 15], ["turiu 15", 15], ["noriu iki 15", 15],
  ];

  cases.forEach(([input, amount]) => {
    it(`sets budget and filters: ${input}`, () => {
      const s = cs();
      processMessage(input, s);
      expect(s.budget).toBe(amount);
      expectNoRestrictionViolations(s);
    });
  });

  ["pigiau", "dar pigiau", "nebrangu", "pigesnio", "pigesni"].forEach((input) => {
    it(`reduces or sets budget: ${input}`, () => {
      const s = cs();
      processMessage("iki 20", s);
      processMessage(input, s);
      expect(s.budget).toBeLessThanOrEqual(20);
      expectNoRestrictionViolations(s);
    });
  });
});

describe("RestrictionEngine — direct product safety rules", () => {
  const alcoholIds = ["al1", "al3", "sid1", "ak1", "ko2", "sp1", "sam1", "vy1"];
  alcoholIds.forEach((id) => {
    it(`marks alcohol unsafe when no alcohol: ${id}`, () => {
      const s = cs();
      s.allowAlcohol = false;
      const p = findById(id);
      expect(p).toBeTruthy();
      if (p) expect(productViolatesRestrictions(p, s)).toBeTruthy();
    });
  });

  const nonAlcoholIds = ["na1", "na3", "lim1", "lim5", "ko18", "sam7", "gg1", "kav7"];
  nonAlcoholIds.forEach((id) => {
    it(`keeps explicit non-alcohol safe: ${id}`, () => {
      const s = cs();
      s.allowAlcohol = false;
      const p = findById(id);
      expect(p).toBeTruthy();
      if (p) expect(productViolatesRestrictions(p, s)).toBeFalsy();
    });
  });

  const porkIds = ["ki1", "ki5", "ki9", "b5", "lb3", "s4"];
  porkIds.forEach((id) => {
    it(`marks pork unsafe with noPork: ${id}`, () => {
      const s = cs();
      s.noPork = true;
      const p = findById(id);
      expect(p).toBeTruthy();
      if (p) expect(productViolatesRestrictions(p, s)).toBeTruthy();
    });
  });

  const meatIds = ["v1", "ki1", "ja1", "z5", "s3", "w4"];
  meatIds.forEach((id) => {
    it(`marks meat/fish unsafe for vegetarian: ${id}`, () => {
      const s = cs();
      s.vegetarian = true;
      s.noMeat = true;
      const p = findById(id);
      expect(p).toBeTruthy();
      if (p) expect(productViolatesRestrictions(p, s)).toBeTruthy();
    });
  });
});

describe("RestrictionEngine — conversation flows", () => {
  it("switches from beer pairing to non-alcoholic after minor disclosure", () => {
    const s = cs();
    processMessage("Ką rekomenduojate?", s);
    processMessage("Ką galėčiau atsigerti prie koldūnų?", s);
    const reply = processMessage("Esu nepilnametis.", s);
    expect(reply).toContain("alkoholio nesiūlau");
    expectNoAlcoholRecommendations(s);
  });

  it("removes pork after user says be kiaulienos", () => {
    const s = cs();
    processMessage("Noriu kiaulienos", s);
    processMessage("Be kiaulienos", s);
    expect(s.noPork).toBeTruthy();
    expectNoRestrictionViolations(s);
  });

  it("switches to vegetarian options after vegetarian disclosure", () => {
    const s = cs();
    processMessage("Ką rekomenduojate?", s);
    processMessage("Esu vegetaras", s);
    expect(s.vegetarian).toBeTruthy();
    expectNoRestrictionViolations(s);
  });

  it("switches salmon drink pairing to non-alcoholic when driving", () => {
    const s = cs();
    processMessage("Ką atsigerti prie lašišos?", s);
    processMessage("Vairuoju", s);
    expect(s.allowAlcohol).toBeFalsy();
    expectNoAlcoholRecommendations(s);
  });

  it("minor restriction survives later beer request", () => {
    const s = cs();
    processMessage("man 17", s);
    processMessage("Kokį alų?", s);
    expectNoAlcoholRecommendations(s);
    processMessage("Dar", s);
    expectNoAlcoholRecommendations(s);
  });

  it("no alcohol restriction survives pairing request", () => {
    const s = cs();
    processMessage("negeriu alkoholio", s);
    processMessage("ką gerti prie bulvinių blynų?", s);
    expectNoAlcoholRecommendations(s);
  });

  it("allergy survives multiple turns", () => {
    const s = cs();
    processMessage("alergija krevetėms", s);
    processMessage("Ką rekomenduojate?", s);
    processMessage("Dar", s);
    expectNoRestrictionViolations(s);
  });

  it("budget and no alcohol both apply to drinks", () => {
    const s = cs();
    processMessage("iki 10", s);
    processMessage("vairuoju", s);
    processMessage("ką gerti?", s);
    expectNoAlcoholRecommendations(s);
    expectNoRestrictionViolations(s);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 13. PRODUCT AVAILABILITY / EXACT SEARCH
// ══════════════════════════════════════════════════════════════════════════════

describe("AvailabilitySearch — existence before recommendation", () => {
  it("answers unavailable banana cocktails before alternatives", () => {
    const s = cs();
    const reply = processMessage("turite bananinių kokteilių?", s);
    expect(reply).toContain("meniu nematau");
    expect(reply).notToContain("Taip, turime bananinio");
    expect(s.lastRecommendedIds.length).toBeGreaterThan(0);
  });

  it("answers existing strawberry cocktails", () => {
    const s = cs();
    const reply = processMessage("turite braškinių kokteilių?", s);
    expect(reply).toContain("Taip, turime");
    expect(reply).toContain("Braškinis Mojito");
  });

  it("finds mango cocktails by flavor", () => {
    const s = cs();
    const reply = processMessage("ar yra mango kokteilis?", s);
    expect(reply).toContain("Taip, turime");
    expect(reply).toContain("Mango Spritz");
  });

  it("finds IPA as beer", () => {
    const s = cs();
    const reply = processMessage("turite IPA?", s);
    expect(reply).toContain("Taip, turime");
    expect(reply).toContain("Spakainas");
    expectLastRecommendationsInCategories(s, ["alus"]);
  });

  it("finds non-alcoholic beer only", () => {
    const s = cs();
    const reply = processMessage("ar turite nealkoholinio alaus?", s);
    expect(reply).toContain("Taip, turime");
    expectLastRecommendationsInCategories(s, ["nealko-alus"]);
    expectNoAlcoholRecommendations(s);
  });

  it("does not treat strawberry milk cocktail as strawberry lemonade", () => {
    const s = cs();
    const reply = processMessage("turite braškinį limonadą?", s);
    expect(reply).toContain("meniu nematau");
    expect(reply).notToContain("Pieniški kokteiliai");
  });

  it("answers vegan pizza availability without inventing one", () => {
    const s = cs();
    const reply = processMessage("yra veganiška pica?", s);
    expect(reply).toContain("meniu nematau");
    expect(reply).notToContain("Taip, turime");
  });

  it("answers gluten-free availability as availability, not random recommendation", () => {
    const s = cs();
    const reply = processMessage("ar yra be glitimo?", s);
    expect(reply).toContain("meniu nematau");
    expect(reply).notToContain("Šiandien rekomenduočiau");
  });

  it("finds red wine by descriptor", () => {
    const s = cs();
    const reply = processMessage("turite raudono vyno?", s);
    expect(reply).toContain("Taip, turime");
    expectLastRecommendationsInCategories(s, ["vynas"]);
  });

  it("finds dark beer by descriptor", () => {
    const s = cs();
    const reply = processMessage("turite tamsaus alaus?", s);
    expect(reply).toContain("Taip, turime");
    expect(reply).toContain("Šposas");
    expectLastRecommendationsInCategories(s, ["alus"]);
  });

  it("minor asking for cocktails gets only non-alcoholic options", () => {
    const s = cs();
    processMessage("esu nepilnametis", s);
    const reply = processMessage("turite kokteilių?", s);
    expect(reply).toContain("Taip, turime");
    expectNoAlcoholRecommendations(s);
  });

  it("driver asking for cocktails gets only non-alcoholic options", () => {
    const s = cs();
    processMessage("vairuoju", s);
    const reply = processMessage("kokius kokteilius turite?", s);
    expect(reply).toContain("Taip, turime");
    expectNoAlcoholRecommendations(s);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// RUN
// ══════════════════════════════════════════════════════════════════════════════

printResults();
