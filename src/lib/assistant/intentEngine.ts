/**
 * Intent detection engine using weighted keyword scoring.
 * Returns the most likely intent with a confidence score.
 *
 * Design: each intent has primary keywords (high weight), secondary keywords (lower weight),
 * and context rules that boost confidence based on conversation state.
 */

import type { NLUResult, Intent, ConversationState } from "./types.ts";
import {
  normalizeText,
  matchesGroup,
  scoreGroup,
  extractBudget,
  synonyms,
  kwMatchesInText,
} from "./synonyms.ts";
import type { Category } from "../data.ts";

interface IntentRule {
  intent: Intent;
  primaryKeywords: string[];   // +10 pts each match
  secondaryKeywords: string[]; // +4 pts each match
  negativeKeywords?: string[]; // disqualify if matched
  minScore?: number;           // minimum score threshold (default 4)
  /** Boost if state has specific properties */
  contextBoost?: (state: ConversationState) => number;
}

const intentRules: IntentRule[] = [
  // ── Navigation intents (high priority) ─────────────────────────────────
  {
    intent: "change_recommendation",
    primaryKeywords: [
      "dar", "kitką", "kitą", "kitas", "skirtingą", "ne šitą", "ne šitą",
      "rodyk kitą", "parodyk kitą", "rodyk kita", "kitko", "kitok",
      "another", "different", "other", "else", "more options",
      "другое", "ещё", "иное",
    ],
    secondaryKeywords: ["daugiau", "more", "show", "больше"],
    contextBoost: (s) => (s.lastRecommendedIds.length > 0 ? 6 : 0),
  },

  {
    intent: "negative_answer",
    primaryKeywords: [
      "ne", "nope", "nereikia", "netinka", "nenoriu", "nieko",
      "no", "not that", "no thanks", "nein",
      "нет", "не надо",
    ],
    secondaryKeywords: ["nepatinka", "negerai", "neverta"],
    contextBoost: (s) => (s.currentIntent !== null ? 4 : 0),
    minScore: 5,
  },

  {
    intent: "positive_answer",
    primaryKeywords: [
      "taip", "gerai", "puiku", "prašau", "imsiu", "paimsu", "užsisakysiu",
      "yes", "ok", "okay", "sure", "great",
      "да", "хорошо", "возьму",
    ],
    secondaryKeywords: ["noriu", "norėčiau", "tiksliai", "tobulai"],
    contextBoost: (s) => (s.lastRecommendedIds.length > 0 ? 5 : 0),
    minScore: 5,
  },

  {
    intent: "add_to_cart",
    primaryKeywords: [
      "pridėk į krepšelį", "įdėk į krepšelį", "dėk į krepšelį",
      "pridėti į krepšelį", "noriu pridėti", "įdėk į krepšelį",
      "add to cart", "add to my cart", "put in cart",
      "добавь в корзину", "положи в корзину", "добавить в корзину",
    ],
    secondaryKeywords: ["krepšelis", "krepšelį", "cart", "корзина", "pridėti", "įdėti"],
    minScore: 8,
  },

  {
    intent: "remove_from_cart",
    primaryKeywords: [
      "pašalink", "išimk", "pašalinti", "išimti", "nebenorėčiau",
      "pašalink iš krepšelio", "išimk iš krepšelio",
      "remove", "delete from cart", "take out of cart",
      "убери", "удали", "убрать из корзины",
    ],
    secondaryKeywords: ["krepšelis", "krepšelį", "cart", "корзина"],
    minScore: 6,
  },

  {
    intent: "cart_summary",
    primaryKeywords: [
      "ką turiu krepšelyje", "krepšelio turinys", "mano krepšelis",
      "kas krepšelyje", "kiek krepšelyje", "krepšelio santrauka",
      "show cart", "what's in my cart", "cart summary", "my cart",
      "моя корзина", "что в корзине", "покажи корзину",
    ],
    secondaryKeywords: ["krepšelyje", "krepšelis", "cart"],
    minScore: 8,
  },

  {
    intent: "clear_cart",
    primaryKeywords: [
      "išvalyti krepšelį", "išvalykite krepšelį", "ištuštinti krepšelį",
      "viską ištrinti", "viską pašalinti", "pradėti iš naujo",
      "išvalyk krepšelį", "ištuštinkite krepšelį",
      "clear cart", "empty cart", "start over", "reset cart",
      "очистить корзину", "всё убрать", "начать заново",
    ],
    secondaryKeywords: ["krepšelis", "viską", "cart"],
    minScore: 8,
  },

  {
    intent: "confirmation",
    primaryKeywords: [
      "noriu to", "noriu šito", "tą", "šitą", "I'll take", "I'll have",
      "užsisakau",
    ],
    secondaryKeywords: ["imsiu", "paimsu", "noriu"],
    contextBoost: (s) => (s.lastRecommendedIds.length > 0 ? 5 : 0),
    minScore: 8,
  },

  // ── Cheap/expensive ─────────────────────────────────────────────────────
  {
    intent: "cheap_food",
    primaryKeywords: [
      "pigiau", "pigesnio", "pigesnį", "pigesnis", "pigus", "ekonomiškai",
      "cheaper", "budget", "affordable", "inexpensive",
      "дешевле", "бюджет", "недорого",
    ],
    secondaryKeywords: ["iki", "kainuoja", "kaina"],
    minScore: 4,
  },

  {
    intent: "expensive_food",
    primaryKeywords: [
      "brangesnio", "brangesnis", "brangų", "premium", "geresnio",
      "expensive", "premium", "luxury",
      "дороже", "премиум",
    ],
    secondaryKeywords: ["aukštos kokybės", "geriausias"],
    minScore: 4,
  },

  // ── Diet / allergens ────────────────────────────────────────────────────
  {
    intent: "vegan",
    primaryKeywords: [
      "veganas", "veganė", "veganiškas", "veganiškai",
      "vegan", "plant based",
      "веган",
    ],
    secondaryKeywords: ["augaliniai", "be gyvuliškų"],
    minScore: 4,
  },

  {
    intent: "vegetarian",
    primaryKeywords: [
      "vegetaras", "vegetarė", "vegetariškas", "vegetariškai",
      "be mėsos", "meatless", "vegetarian",
      "вегетарианец", "без мяса",
    ],
    secondaryKeywords: ["augalinė", "žalias"],
    negativeKeywords: ["vegan"],
    minScore: 4,
  },

  {
    intent: "allergy_question",
    primaryKeywords: [
      "alergiška", "alergija", "alergiškas", "alerginė",
      "allergi", "intolerance", "netoleruoju",
      "аллерги", "непереносимость",
      "be glitimo", "be laktozės", "be pieno", "be riešutų",
      "gluten free", "dairy free", "lactose free",
    ],
    secondaryKeywords: ["riešutai", "glitimas", "pienas", "kiaušiniai", "žuvis"],
    minScore: 5,
  },

  // ── Gluten/lactose ──────────────────────────────────────────────────────
  // (handled as allergy_question with entities)

  // ── Kids ────────────────────────────────────────────────────────────────
  {
    intent: "kids_menu",
    primaryKeywords: [
      "vaikams", "vaikui", "vaikas", "vaikiškas", "vaikų meniu",
      "kids", "children", "child menu",
      "детское", "для детей",
    ],
    secondaryKeywords: ["mažam", "mažiukui"],
    minScore: 4,
  },

  // ── Drink intents (before food_recommendation to prevent false positives) ──
  {
    intent: "beer_recommendation",
    primaryKeywords: [
      "alaus", "alų", "alui", "alus",
      "beer", "craft beer", "пиво",
      "lageris", "porteris", "ipa", "kvietinis alus", "kvietinis",
    ],
    secondaryKeywords: ["gerti", "gėrimas", "drink"],
    contextBoost: (s) => {
      const t = (s.conversationHistory.at(-1)?.content ?? "").toLowerCase();
      return t.includes("ger") ? 3 : 0;
    },
    minScore: 6,
  },

  {
    intent: "wine_recommendation",
    primaryKeywords: [
      "vyno", "vynų", "vyną", "vynas",
      "kokį vyną", "raudoną vyną", "baltą vyną",
      "wine", "red wine", "white wine",
      "вино",
    ],
    secondaryKeywords: ["gerti", "gėrimas"],
    minScore: 6,
  },

  {
    intent: "cocktail_recommendation",
    primaryKeywords: [
      "kokteilių", "kokteilį", "kokteilis",
      "cocktail", "mixed drink", "mojito",
      "коктейль",
    ],
    secondaryKeywords: ["gerti", "gėrimas"],
    minScore: 6,
  },

  {
    intent: "drink_recommendation",
    primaryKeywords: [
      "ką gerti", "ką išgerti", "ką atsigerti", "gėrimų", "gėrimą",
      "what to drink", "something to drink",
      "что выпить", "выпить",
      "gėrimas prie", "gerti prie",
    ],
    secondaryKeywords: ["gerti", "gėrimas", "drink", "напиток"],
    contextBoost: (s) => (s.lastFoodDishId ? 5 : 0),
    minScore: 5,
  },

  // ── Pairing ─────────────────────────────────────────────────────────────
  {
    intent: "pairing_request",
    primaryKeywords: [
      "prie šito", "prie to", "prie šio", "prie jo",
      "goes with", "pairs with", "what goes with",
      "к этому", "что подойдёт",
      "o prie", "kas tiktų prie",
    ],
    secondaryKeywords: ["derinti", "derėtų", "tinka"],
    contextBoost: (s) => (s.lastFoodDishId ? 6 : -4),
    minScore: 5,
  },

  // ── Dessert ──────────────────────────────────────────────────────────────
  {
    intent: "dessert_recommendation",
    primaryKeywords: [
      "desertas", "deserto", "desertą", "desertai", "desertų",
      "tortas", "tortą", "ledai", "ledų", "saldumynai", "saldaus",
      "dessert", "sweets", "cake", "ice cream",
      "десерт", "сладкое",
    ],
    secondaryKeywords: ["po patiekalo", "po maisto", "pabaigai"],
    minScore: 6,
  },

  // ── Ingredient question ──────────────────────────────────────────────────
  {
    intent: "ingredient_question",
    primaryKeywords: [
      "iš ko", "kas yra", "sudėtis", "sudėtyje", "ingredientai",
      "what's in", "ingredients", "made of",
      "состав", "из чего",
    ],
    secondaryKeywords: ["yra", "turi", "has", "contains"],
    minScore: 6,
  },

  // ── Restaurant info ──────────────────────────────────────────────────────
  {
    intent: "opening_hours",
    primaryKeywords: [
      "darbo laikas", "kada dirbate", "kada atidarytas", "kada uždaromas",
      "open", "close", "hours",
      "часы работы", "когда открыто",
    ],
    secondaryKeywords: ["laikas", "valanda"],
    minScore: 6,
  },

  {
    intent: "restaurant_info",
    primaryKeywords: [
      "adresas", "kur esate", "kur jūs", "kaip pas jus patekti",
      "address", "where are you", "location",
      "адрес", "где находитесь",
    ],
    secondaryKeywords: ["restoranas", "vieta", "kaip nuvažiuoti"],
    minScore: 6,
  },

  // ── Popular dishes ───────────────────────────────────────────────────────
  {
    intent: "popular_dishes",
    primaryKeywords: [
      "populiariausi", "populiariausias", "rekomenduojamiausi",
      "best seller", "top dishes", "most popular",
      "самые популярные", "хиты",
    ],
    secondaryKeywords: ["klientai renkasi", "dažniausiai", "often ordered"],
    minScore: 6,
  },

  // ── Food recommendation (broad, low priority — catches rest) ─────────────
  {
    intent: "food_recommendation",
    primaryKeywords: [
      "rekomenduok", "rekomenduoji", "rekomenduoja", "rekomenduoti", "rekomend",
      "siūlyk", "siūlau", "siūlai", "patark",
      "recommend", "suggest", "порекомендуй", "посоветуй",
      "ką valgyti", "ko norėčiau", "ko verta paragauti",
      "norėčiau", "ko šiandien",
    ],
    secondaryKeywords: [
      "alkanas", "alkana", "pavalgyti", "pavalgsiu", "noriu",
      "sočiai", "sotaus", "lengviau", "lengvo", "aštraus", "aštri",
      "vištiena", "vištienos", "žuvis", "žuvies", "jautiena", "jautienos",
      "kiauliena", "kiaulienos", "pica", "picos", "salotos", "desertas", "deserto",
      "hungry", "eat", "food", "meal", "кушать", "поесть",
    ],
    minScore: 3,
  },
];

// ── Detect Intent ─────────────────────────────────────────────────────────────

export function detectIntent(input: string, state: ConversationState): NLUResult {
  const normalized = normalizeText(input);

  const priorityIntent = detectPriorityIntent(normalized, state);
  if (priorityIntent) {
    const entities = extractEntities(normalized, priorityIntent, state);
    return {
      intent: priorityIntent,
      confidence: 1,
      entities,
      rawInput: input,
      normalizedInput: normalized,
    };
  }

  let bestIntent: Intent = "unknown";
  let bestScore = 0;

  for (const rule of intentRules) {
    let score = 0;

    for (const kw of rule.primaryKeywords) {
      if (kwMatchesInText(normalized, kw)) score += 10;
    }
    for (const kw of rule.secondaryKeywords) {
      if (kwMatchesInText(normalized, kw)) score += 4;
    }
    for (const kw of rule.negativeKeywords ?? []) {
      if (kwMatchesInText(normalized, kw)) score -= 20;
    }

    const contextBonus = rule.contextBoost ? rule.contextBoost(state) : 0;
    score += contextBonus;

    const threshold = rule.minScore ?? 4;
    if (score >= threshold && score > bestScore) {
      bestScore = score;
      bestIntent = rule.intent;
    }
  }

  // Single-word shortcuts — override if very high synonym group match
  const singleWordIntents = detectSingleWordIntent(normalized, state);
  if (singleWordIntents && singleWordIntents.score > bestScore) {
    bestIntent = singleWordIntents.intent;
    bestScore = singleWordIntents.score;
  }

  const entities = extractEntities(normalized, bestIntent, state);
  const confidence = Math.min(bestScore / 20, 1);

  return {
    intent: bestIntent,
    confidence,
    entities,
    rawInput: input,
    normalizedInput: normalized,
  };
}

function detectPriorityIntent(normalized: string, state: ConversationState): Intent | null {
  // Pure greeting — nothing else in the message. Answer like a waiter, don't dump
  // recommendations.
  if (/^((nu|na|o|ei|tai)\s+)?(labas|sveiki|sveikas|laba diena|labas vakaras|labas rytas|hello|hi|hey|privet|привет|здравствуйте|добрый день|добрый вечер)[\s!.?]*$/.test(normalized)) {
    return "greeting";
  }

  // Opening hours — "ar dirbate pirmadienį?", "iki kelių dirbate?"
  if (/\b(dirbat|darbo laik|kada atidar|kada uzdar|iki keliu|nuo keliu|kada dirba)/.test(normalized)) {
    return "opening_hours";
  }

  // 0. Cart management verbs — must run BEFORE food synonyms so "pašalink lašišą"
  //    isn't swallowed by the FISH synonym check.
  if (/\b(pasalink|isimk|pasalinti|isimti|nebenoreciau|nuimk|nuimti|atsauk|atsaukti|atsaukite|uberi|udali)\b/.test(normalized)) {
    return "remove_from_cart";
  }
  if (/\b(isvalyk|isvalykite|istustink|istustinkite)\b.*\b(krepseli|krepsel)\b/.test(normalized)) {
    return "clear_cart";
  }
  // Direct add commands can put the verb before or after the product name and
  // do not require prior recommendation context ("add one duck breast").
  if (
    /\b(add|put|place)\b/.test(normalized) ||
    /\b(pridek|prideti|idek|ideti|dek)\b/.test(normalized)
  ) {
    return "add_to_cart";
  }
  // Cart summary — "kas mano krepšelyje?", "parodyk krepšelį", "kiek moku?"
  if (
    /krepsel/.test(normalized) &&
    /(kas|kiek|parodyk|rodyk|mano|turiu|perziuret|santrauka|show|what|покажи|что)/.test(normalized) &&
    !/(pridek|idek|prideti|ideti|\bdek\b|add)/.test(normalized)
  ) {
    return "cart_summary";
  }
  if (/\b(kiek (moku|moketi|is viso)|kokia (suma|saskaita)|saskaita prasau)\b/.test(normalized)) {
    return "cart_summary";
  }

  // 0.5 Beer snacks — "ką užkąsti prie alaus?" must beat the BEER drink group.
  if (/(uzkand|uzkas|kasti|valgy)/.test(normalized) && /\b(alaus|alui|alu)\b/.test(normalized)) {
    return "food_recommendation";
  }

  // 0.6 Ingredient questions about a specific dish — "iš ko pagamintas tuno karpačio?"
  //     must beat the FISH/PORK/etc. food-group checks below.
  if (matchesGroup(normalized, "INGREDIENTS")) return "ingredient_question";

  // 1. Drinks always win over food keywords.
  if (matchesGroup(normalized, "DRINK")) return "drink_recommendation";
  if (matchesGroup(normalized, "BEER")) return "beer_recommendation";
  if (matchesGroup(normalized, "WINE")) return "wine_recommendation";
  if (matchesGroup(normalized, "COCKTAIL")) return "cocktail_recommendation";
  if (matchesGroup(normalized, "COFFEE") || matchesGroup(normalized, "TEA") || matchesGroup(normalized, "LEMONADE")) {
    return "drink_recommendation";
  }

  // 2. Restrictions and diet.
  if (matchesGroup(normalized, "VEGAN")) return "vegan";
  if (matchesGroup(normalized, "VEGETARIAN")) return "vegetarian";
  if (matchesGroup(normalized, "ALLERGY") || matchesGroup(normalized, "ALLERGENS") || matchesGroup(normalized, "DISLIKE") || matchesGroup(normalized, "GLUTEN_FREE") || matchesGroup(normalized, "LACTOSE_FREE")) {
    return "allergy_question";
  }

  // 3. Budget.
  if (matchesGroup(normalized, "CHEAPER") || extractBudget(normalized) != null) return "cheap_food";
  if (matchesGroup(normalized, "EXPENSIVE")) return "expensive_food";

  // 4. Specific food/category search.
  if (matchesGroup(normalized, "POPULAR")) return "popular_dishes";
  if (matchesGroup(normalized, "KIDS")) return "kids_menu";
  if (matchesGroup(normalized, "FILLING") || matchesGroup(normalized, "LIGHT") || matchesGroup(normalized, "SPICY")) {
    return "food_recommendation";
  }
  if (
    matchesGroup(normalized, "CHICKEN") ||
    matchesGroup(normalized, "PORK") ||
    matchesGroup(normalized, "BEEF") ||
    matchesGroup(normalized, "FISH") ||
    matchesGroup(normalized, "LAMB") ||
    matchesGroup(normalized, "PIZZA") ||
    matchesGroup(normalized, "SALAD") ||
    matchesGroup(normalized, "SOUP") ||
    matchesGroup(normalized, "WOK") ||
    matchesGroup(normalized, "POTATO") ||
    matchesGroup(normalized, "BBQ_GRILL")
  ) {
    return "food_recommendation";
  }

  // 5. Dessert.
  if (matchesGroup(normalized, "DESSERT")) return "dessert_recommendation";

  // 6. Info and utility intents.
  if (matchesGroup(normalized, "INGREDIENTS")) return "ingredient_question";
  if (matchesGroup(normalized, "PRICE")) return "unknown";
  if (matchesGroup(normalized, "RESTAURANT_INFO")) {
    return normalized.includes("laikas") || normalized.includes("hours") || normalized.includes("dirbate") || normalized.includes("atidarytas") || normalized.includes("uzdaromas")
      ? "opening_hours"
      : "restaurant_info";
  }
  if (matchesGroup(normalized, "MORE_DIFFERENT")) return "change_recommendation";
  if (matchesGroup(normalized, "NEGATIVE") && state.currentIntent) return "negative_answer";
  if (matchesGroup(normalized, "POSITIVE") && state.lastRecommendedIds.length > 0) return "positive_answer";

  return null;
}

/** Detect single-word or short-phrase intents via synonym group scoring */
function detectSingleWordIntent(
  normalized: string,
  state: ConversationState
): { intent: Intent; score: number } | null {
  const checks: [SynonymGroupKey, Intent, number][] = [
    ["MORE_DIFFERENT", "change_recommendation", 15],
    ["NEGATIVE",       "negative_answer",        15],
    ["POSITIVE",       "positive_answer",         15],
    ["CHEAPER",        "cheap_food",              12],
    ["EXPENSIVE",      "expensive_food",          12],
    ["FILLING",        "food_recommendation",      5],
    ["LIGHT",          "food_recommendation",      5],
    ["SPICY",          "food_recommendation",      5],
    ["BEER",           "beer_recommendation",     12],
    ["WINE",           "wine_recommendation",     12],
    ["COCKTAIL",       "cocktail_recommendation", 12],
    ["DESSERT",        "dessert_recommendation",  12],
    ["VEGETARIAN",     "vegetarian",              15],
    ["VEGAN",          "vegan",                   15],
    ["KIDS",           "kids_menu",               15],
  ];

  type SynonymGroupKey = keyof typeof synonyms;

  let best: { intent: Intent; score: number } | null = null;
  for (const [groupKey, intent, threshold] of checks) {
    const s = scoreGroup(normalized, groupKey as SynonymGroupKey) * 20;
    if (s >= threshold && (!best || s > best.score)) {
      best = { intent, score: s };
    }
  }
  return best;
}

/** Extract structured entities from input text */
function extractEntities(
  normalized: string,
  intent: Intent,
  state: ConversationState
): NLUResult["entities"] {
  const entities: NLUResult["entities"] = {};

  // Budget
  const budget = extractBudget(normalized);
  if (budget) entities.budget = budget;

  // Mood
  if (matchesGroup(normalized, "FILLING")) entities.moodFilling = true;
  if (matchesGroup(normalized, "LIGHT"))   entities.moodLight   = true;
  if (matchesGroup(normalized, "SPICY"))   entities.moodSpicy   = true;

  // Diet
  if (matchesGroup(normalized, "VEGETARIAN")) entities.vegetarian = true;
  if (matchesGroup(normalized, "VEGAN"))       entities.vegan      = true;
  if (matchesGroup(normalized, "GLUTEN_FREE")) entities.glutenFree = true;
  if (matchesGroup(normalized, "LACTOSE_FREE")) entities.lactoseFree = true;

  // Proteins
  if (matchesGroup(normalized, "CHICKEN")) entities.protein = "chicken";
  else if (matchesGroup(normalized, "PORK")) entities.protein = "pork";
  else if (matchesGroup(normalized, "BEEF")) entities.protein = "beef";
  else if (matchesGroup(normalized, "FISH")) entities.protein = "fish";
  else if (matchesGroup(normalized, "LAMB")) entities.protein = "lamb";

  // Beer snacks — "užkąsti prie alaus" is a FOOD request in the prie-alaus category,
  // not a beer request. Set the category and suppress the beer drinkType below.
  const isBeerSnackRequest =
    /(uzkand|uzkas|kasti|valgy)/.test(normalized) && /\b(alaus|alui|alu)\b/.test(normalized);
  if (isBeerSnackRequest) entities.category = "prie-alaus" as Category;

  // Category overrides
  if (matchesGroup(normalized, "PIZZA"))   entities.category = "picos" as Category;
  if (matchesGroup(normalized, "SALAD"))   entities.category = "salotos" as Category;
  if (matchesGroup(normalized, "SOUP"))    entities.category = "sriubos" as Category;
  if (matchesGroup(normalized, "DESSERT")) entities.category = "desertai" as Category;
  if (matchesGroup(normalized, "WOK"))     entities.category = "wok" as Category;
  if (matchesGroup(normalized, "POTATO"))  entities.category = "bulviniai" as Category;
  if (matchesGroup(normalized, "BBQ_GRILL")) entities.category = "grilinis" as Category;
  if (matchesGroup(normalized, "KIDS"))    entities.category = "vaikiskas" as Category;

  // Drink types
  if (isBeerSnackRequest) { /* food request — no drinkType */ }
  else if (matchesGroup(normalized, "BEER"))     entities.drinkType = "beer";
  else if (matchesGroup(normalized, "WINE")) entities.drinkType = "wine";
  else if (matchesGroup(normalized, "COCKTAIL")) entities.drinkType = "cocktail";
  else if (matchesGroup(normalized, "LEMONADE")) entities.drinkType = "lemonade";
  else if (matchesGroup(normalized, "COFFEE"))   entities.drinkType = "coffee";

  // Allergens — only persist as allergies when the intent is about restrictions.
  if (intent === "allergy_question") {
    if (matchesGroup(normalized, "ALLERGY_NUTS"))   entities.allergen = "Riešutai";
    if (matchesGroup(normalized, "ALLERGY_GLUTEN"))  entities.allergen = "Glitimas";
    if (matchesGroup(normalized, "ALLERGY_DAIRY"))   entities.allergen = "Pienas";
    if (matchesGroup(normalized, "ALLERGY_EGGS"))    entities.allergen = "Kiaušiniai";
    if (matchesGroup(normalized, "ALLERGY_FISH"))    entities.allergen = "Žuvis";
  }

  // Dislikes
  if (matchesGroup(normalized, "DISLIKE_MUSHROOMS")) entities.dislike = "grybai";
  else if (matchesGroup(normalized, "DISLIKE_ONION")) entities.dislike = "svogūnas";
  else if (matchesGroup(normalized, "DISLIKE_TOMATO")) entities.dislike = "pomidoras";
  else if (matchesGroup(normalized, "DISLIKE_CHEESE")) entities.dislike = "sūris";
  else if (matchesGroup(normalized, "DISLIKE_CHILI")) entities.dislike = "čili";

  return entities;
}

type SynonymGroupKey = keyof typeof synonyms;
