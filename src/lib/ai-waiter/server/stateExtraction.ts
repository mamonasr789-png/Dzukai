import "server-only";

import { products } from "../../data.ts";
import { foodGroupForCategory } from "../../foodGroups.ts";
import type {
  ConversationState,
  SupportedLanguage,
} from "../schemas.ts";
import {
  ConversationStateDeltaSchema,
  type ConversationStateDelta,
} from "./conversationStateReducer.ts";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/gu, "");
}

const menuCategoryPatterns: ReadonlyArray<{
  category: string;
  pattern: RegExp;
}> = [
  // Must precede "alus": "prie alaus" asks for beer snacks, not for a beer.
  // Cyrillic alternatives carry no \b — JS \w is ASCII-only.
  { category: "uzkandziai", pattern: /\b(uzkand\w*|appetiz\w*|starters?)\b|закуск/u },
  { category: "koldumai", pattern: /\b(koldun\w*|dumplings?)\b|пельмен|вареник/u },
  {
    category: "lietiniai",
    pattern: /\b(lietin\w*|blyn\w*|pancakes?|crepes?)\b|блин/u,
  },
  { category: "vistiena", pattern: /\b(vistien\w*|chicken)\b|курин|куриц/u },
  { category: "kiauliena", pattern: /\b(kiaulien\w*|pork)\b|свинин/u },
  { category: "jautiena", pattern: /\b(jautien\w*|beef)\b|говядин/u },
  { category: "zuvis", pattern: /\b(zuv\w*|fish|lasis\w*|salmon)\b|рыб/u },
  {
    category: "grilinis",
    pattern: /\b(kepsn\w*|steaks?|grill\w*|gril\w*)\b|стейк|гриль/u,
  },
  {
    category: "prie-alaus",
    pattern:
      /\bprie\s+alaus\b|\b(?:beer|pub)\s+snacks?\b|\bwith\s+(?:a\s+|the\s+)?beer\b|к\s+пиву|под\s+пиво/u,
  },
  { category: "alus", pattern: /\b(alus|alaus|alu|beers?)\b|пив/u },
  { category: "vynas", pattern: /\b(vyn\w*|wines?)\b|вин(?:о|а|у|ом)?/u },
  {
    category: "kokteiliai",
    pattern: /\b(kokteil\w*|cocktails?)\b|коктейл/u,
  },
  { category: "sidras", pattern: /\b(sidr\w*|ciders?)\b|сидр/u },
  {
    category: "limonadai",
    pattern: /\b(limonad\w*|lemonades?)\b|лимонад/u,
  },
  { category: "kava", pattern: /\b(kav\w*|coffee|tea)\b|кофе|ча[йя]/u },
  { category: "picos", pattern: /\b(pic\w*|pizzas?)\b|пицц/u },
  { category: "salotos", pattern: /\b(salot\w*|salads?)\b|салат/u },
  { category: "sriubos", pattern: /\b(sriub\w*|soups?)\b|суп/u },
  { category: "desertai", pattern: /\b(desert\w*|desserts?)\b|десерт/u },
  { category: "wok", pattern: /\bwok\b|вок/u },
  {
    category: "bulviniai",
    pattern: /\b(bulvin\w*|potato(?: dishes?)?)\b|картоф/u,
  },
  {
    category: "vaikiskas",
    pattern: /\b(vaik\w*|kids?(?: menu)?|children(?:s menu)?)\b|детск/u,
  },
  {
    category: "gerimai",
    pattern:
      /\b(?:a\s+)?(?:drinks?|beverages?)\b|\bgerim(?:as|o|u|a|ai|us|ams|ais)?\b|\b(?:atsigert\w*|isgert\w*|gert\w*)\b|напит(?:ок|ка|ки|ков|ку|ками)?|выпит/u,
  },
];

const CATEGORY_REFUSAL =
  /\b(nenoriu|nemegstu|nepatinka|jokio|jokios|dont want|do not want|dont like|do not like|no more|without)\b|не\s+хочу|не\s+люблю|никакой/u;

const DRINK_CATEGORY_IDS = new Set([
  "alus",
  "vynas",
  "kokteiliai",
  "sidras",
  "limonadai",
  "kava",
  "gerimai",
]);

const BEER_SNACK_PATTERN =
  /\bprie\s+alaus\b|\b(?:beer|pub)\s+snacks?\b|\bwith\s+(?:a\s+|the\s+)?beer\b|к\s+пиву|под\s+пиво/u;

const FOOD_EAT_PATTERN =
  /\b(valgyti|valgyt|uzkand\w*|uzkas\w*|eat|food|snacks?|dish)\b|ед|закуск|блюд/u;

/** Informal recommend verbs: pasiulyk, pasiulysi, recommend, посоветуй. */
export const RECOMMEND_REQUEST_PATTERN =
  /\b(noriu|want|recommend|rekomend\w*|pasiul\w*|parodyk|something|kazko|vegetar\w*|beef|jautien\w*|nenoriu|nemegstu|nepatinka|dont like|do not like)\b|хочу|рекоменд|посовет|покаж|вегетари|говядин|не\s+люблю|не\s+хочу/u;

/** Drink verbs and pairing: atsigerti, ka gerti, what to drink with, к чему выпить. */
export const DRINK_REQUEST_PATTERN =
  /\b(atsigert\w*|isgert\w*|gert\w*|gerim\w*|drinks?|beverages?)\b|what to drink|drink with|выпит|напит|к\s+чему\s+выпить|что\s+(?:выпить|пить)\s+к/u;

const PAIRING_PATTERN =
  /\bprie\s+[a-z]{3,}|what to drink with|drink with\b|(?:выпить|пить)\s+к|к\s+чему/u;

const MENU_HELP_PATTERN =
  /\b(valgyti|valgyt|patiekal|maist|meniu|menu|eat|food|dish|meal|sriub\w*|soups?|gert\w*|atsigert\w*|gerim\w*|drinks?|beverages?|pasiul\w*|rekomend\w*|recommend|noriu|want|kazko|something)\b|ед|блюд|меню|суп|напит|выпит|рекоменд|хочу/u;

function messageMentionsFoodDish(normalizedMessage: string): boolean {
  const words = normalizedMessage
    .split(/[^a-z0-9]+/u)
    .filter((word) => word.length >= 5);
  if (words.length === 0) return false;
  for (const product of products) {
    if (foodGroupForCategory(product.category) === "drinks") continue;
    const tokens = normalize(product.name)
      .split(/[^a-z0-9]+/u)
      .filter((token) => token.length >= 5);
    for (const token of tokens) {
      const stem = token.slice(0, Math.min(6, token.length));
      if (
        words.some(
          (word) =>
            word.startsWith(stem) || stem.startsWith(word.slice(0, stem.length))
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

export function messageRequestsDrinks(message: string): boolean {
  const normalized = normalize(message);
  if (DRINK_REQUEST_PATTERN.test(normalized)) return true;
  return (
    PAIRING_PATTERN.test(normalized) &&
    messageMentionsFoodDish(normalized) &&
    !FOOD_EAT_PATTERN.test(normalized)
  );
}

export function messageRequestsRecommendation(message: string): boolean {
  return RECOMMEND_REQUEST_PATTERN.test(normalize(message));
}

export function messageLooksLikeMenuHelp(message: string): boolean {
  const normalized = normalize(message);
  return (
    MENU_HELP_PATTERN.test(normalized) ||
    messageRequestsDrinks(message) ||
    messageMentionsFoodDish(normalized)
  );
}

function isBeerSnackRequest(normalized: string): boolean {
  if (!BEER_SNACK_PATTERN.test(normalized)) return false;
  // "ką gerti prie alaus" is drinks; "ką valgyti prie alaus" stays snacks.
  if (DRINK_REQUEST_PATTERN.test(normalized) && !FOOD_EAT_PATTERN.test(normalized)) {
    return false;
  }
  return true;
}

/** Maps explicit customer category wording to an official menu category. */
export function menuCategoryForMessage(message: string): string | null {
  const normalized = normalize(message);
  // "I don't want fish" names a category it is refusing; picking it would
  // recommend the exact thing the guest just turned down.
  if (CATEGORY_REFUSAL.test(normalized)) return null;
  if (isBeerSnackRequest(normalized)) return "prie-alaus";
  if (messageRequestsDrinks(message)) {
    const specific = menuCategoryPatterns.find(
      ({ category, pattern }) =>
        DRINK_CATEGORY_IDS.has(category) &&
        category !== "gerimai" &&
        pattern.test(normalized)
    )?.category;
    return specific ?? "gerimai";
  }
  return (
    menuCategoryPatterns.find(({ pattern }) => pattern.test(normalized))
      ?.category ?? null
  );
}

/** True only for wording that asks to continue the current recommendation set. */
export function messageRequestsAnotherRecommendation(message: string): boolean {
  const normalized = normalize(message);
  return /\b(another(?: one)?|something else|different one|more options?|anything else|what else|more)\b|\b(dar(?: viena)?|daugiau|kit(?:a|ka|as|ok\w*))\b|друг(?:ои|ую|ое|ие)|ещ[её]|что\s+ещ/u.test(
    normalized
  );
}

export function detectLanguage(
  message: string,
  current: SupportedLanguage
): SupportedLanguage {
  if (/[а-яё]/iu.test(message)) return "ru";
  const normalized = normalize(message);
  if (
    /\b(speak english|in english|the|please|want|would|recommend|allergic|vegetarian|under|something|food|drinks?|beverages?|another|else|add|remove|hello|hi|hey)\b/u.test(
      normalized
    )
  ) {
    return "en";
  }
  if (
    /[ąčęėįšųūž]/iu.test(message) ||
    /\b(kalbek lietuviskai|noriu|prasau|pridek|parodyk|rekomend\w*|pasiul\w*|gerim\w*|atsigert\w*|dar|kita|geriau|esu|iki|sotus|sotaus)\b/u.test(
      normalized
    )
  ) {
    return "lt";
  }
  return current;
}

function partySize(message: string): number | null {
  const normalized = normalize(message);
  const numeric = normalized.match(
    /\b(\d{1,2})\s*(?:zmon(?:ems|iu|es)|people|persons?)\b|(\d{1,2})\s*(?:человек|персон)/u
  );
  if (numeric) return Number(numeric[1] ?? numeric[2]);
  const words: Array<[RegExp, number]> = [
    [/\b(dviem|dviese|two people)\b/u, 2],
    [/\b(trims|trise|three people)\b/u, 3],
    [/\b(keturiems|keturiese|four people)\b/u, 4],
  ];
  return words.find(([pattern]) => pattern.test(normalized))?.[1] ?? null;
}

function extractBudget(
  message: string
): { amount: number; partySize: number | null } | null {
  const normalized = normalize(message).replace(",", ".");
  const match =
    normalized.match(
      /(?:iki|under|up to|budget(?:as)?|biudzetas|до|бюджет)\s*(?:€|eur)?\s*(\d{1,4}(?:\.\d{1,2})?)/u
    ) ??
    normalized.match(
      /(\d{1,4}(?:\.\d{1,2})?)\s*(?:€|eur)\b/u
    );
  if (!match) return null;
  const amount = Number(match[1]);
  if (!(amount > 0 && amount <= 1_000)) return null;
  return { amount, partySize: partySize(message) };
}

const allergens = [
  { allergen: "nuts" as const, pattern: /\b(riesut\w*|nuts?|peanut\w*)\b|орех|арахис/u },
  { allergen: "milk" as const, pattern: /\b(pien\w*|milk|dairy)\b|молок|молоч/u },
  { allergen: "gluten" as const, pattern: /\b(glitim\w*|gluten)\b|глютен/u },
  { allergen: "eggs" as const, pattern: /\b(kiausin\w*|eggs?)\b|яйц/u },
  { allergen: "fish" as const, pattern: /\b(zuv\w*|fish)\b|рыб/u },
];

const proteins = [
  { value: "beef", pattern: /\b(jautien\w*|beef)\b/u },
  { value: "chicken", pattern: /\b(vistien\w*|chicken)\b/u },
  { value: "pork", pattern: /\b(kiaulien\w*|pork)\b/u },
  { value: "fish", pattern: /\b(zuv\w*|fish|lasis\w*|salmon|silk\w*|herring)\b|сельд|селедк/u },
];

const ingredientTerms = [
  { value: "onions", pattern: /\b(svogun\w*|onions?)\b/u },
  { value: "garlic", pattern: /\b(cesnak\w*|garlic)\b/u },
];

export function messageUsesPriorReference(message: string): boolean {
  const normalized = normalize(message);
  return (
    messageRequestsAnotherRecommendation(message) ||
    /\b(sita|sitas|this one|that one|antr\w*|second|pirm\w*|first|toki pat|same)\b|эт[оа]|перв|втор|трет|тако[йе]\s+же|предлож/u.test(
      normalized
    ) ||
    /(?:recommendation|pasiul\w*|предлож)[^\d]{0,12}[1-9]|[1-9][^\d]{0,12}(?:recommendation|pasiul\w*|предлож)/u.test(
      normalized
    )
  );
}

export interface ExtractedTurnState {
  intent: string;
  delta: ConversationStateDelta;
  unresolvedAllergy: boolean;
}

export function extractTurnState(
  message: string,
  state: ConversationState,
  requestedLanguage?: SupportedLanguage
): ExtractedTurnState {
  const normalized = normalize(message);
  const operations: ConversationStateDelta["operations"] = [];
  const menuCategory = menuCategoryForMessage(message);
  const contextualFollowUp = messageRequestsAnotherRecommendation(message);
  const language =
    requestedLanguage ?? detectLanguage(message, state.language);
  if (language !== state.language) {
    operations.push({ kind: "set_language", language });
  }

  if (menuCategory) {
    operations.push({
      kind: "clear_temporary_preference",
      field: "preferredCategories",
    });
    // A category with no protein of its own ("kepsnio", "deserto") would
    // otherwise stay filtered by a protein carried over from an earlier turn.
    if (!proteins.some((protein) => protein.pattern.test(normalized))) {
      operations.push({
        kind: "clear_temporary_preference",
        field: "preferredProteins",
      });
    }
    operations.push({
      kind: "set_temporary_preference",
      field: "preferredCategories",
      value: menuCategory,
    });
  }

  const budget = extractBudget(message);
  if (budget) {
    operations.push({
      kind: "set_budget",
      amount: budget.amount,
      scope: {
        kind: "total",
        partySize: budget.partySize,
      },
    });
  } else if (/\b(pamirsk biudzeta|clear (?:my )?budget|be biudzeto)\b|забудь\s+бюджет|без\s+бюджета/u.test(normalized)) {
    operations.push({ kind: "clear_budget" });
  }

  const temporary =
    /\b(siandien|sikart|dabar|today|this time|for now)\b/u.test(normalized);
  const persistentPreference =
    /\b(geriau|megstu|mėgstu|prefer|favorite|favourite)\b/u.test(normalized);
  const dislike =
    /\b(nemegstu|nepatinka|nenoriu|dislike|dont like|do not like|no more)\b|не\s+люблю|не\s+хочу|надоел/u.test(
      normalized
    );
  const temporaryAcceptance =
    /\b(bet siandien galiu|but today i can|this time is fine)\b/u.test(
      normalized
    );
  for (const protein of proteins) {
    if (!protein.pattern.test(normalized)) continue;
    if (dislike && !temporaryAcceptance) {
      operations.push({ kind: "add_dislike", value: protein.value });
    } else if (temporary || temporaryAcceptance) {
      operations.push({
        kind: "set_temporary_preference",
        field: "preferredProteins",
        value: protein.value,
      });
    } else if (persistentPreference) {
      operations.push({
        kind: "add_preference",
        field: "preferredProteins",
        value: protein.value,
      });
    }
  }

  // "Something meaty" spans several categories, so it becomes a protein
  // preference rather than a category pick.
  if (
    /\b(mes\w*|meat|meaty)\b|мясн|мяса|мясо/u.test(normalized) &&
    !dislike
  ) {
    for (const protein of ["beef", "pork", "chicken"]) {
      operations.push({
        kind: "set_temporary_preference",
        field: "preferredProteins",
        value: protein,
      });
    }
  }

  for (const ingredient of ingredientTerms) {
    if (!ingredient.pattern.test(normalized)) continue;
    if (
      /\b(pamirsk|nebe|remove|forget)\b/u.test(normalized) &&
      /\b(sakiau|said|mine|mano)\b/u.test(normalized)
    ) {
      operations.push({ kind: "remove_dislike", value: ingredient.value });
    } else if (dislike) {
      operations.push({ kind: "add_dislike", value: ingredient.value });
    }
  }

  const negativeVegetarian =
    /\b(ne(?:su )?vegetar\w*|not (?:a )?vegetarian)\b|я\s+не\s+вегетари/u.test(normalized);
  const positiveVegetarian =
    /\b(esu vegetar\w*|noriu vegetar\w*|i am (?:a )?vegetarian|(?:want|need) vegetar\w*|vegetarian (?:food|dish|meal))\b|я\s+вегетари|хочу\s+вегетари/u.test(
      normalized
    );
  if (negativeVegetarian) {
    operations.push({
      kind: "remove_dietary_requirement",
      requirement: "vegetarian",
    });
  } else if (positiveVegetarian) {
    operations.push({
      kind: "add_dietary_requirement",
      requirement: "vegetarian",
    });
  }
  if (/\b(esu veganas|i am vegan|vegan (?:food|dish|meal))\b|я\s+веган/u.test(normalized)) {
    operations.push({ kind: "add_dietary_requirement", requirement: "vegan" });
  }
  if (/\b(be glitimo|gluten[- ]?free)\b|без\s+глютена/u.test(normalized)) {
    operations.push({
      kind: "add_dietary_requirement",
      requirement: "gluten_free",
    });
  }
  if (/\b(be laktozes|lactose[- ]?free)\b|без\s+лактозы/u.test(normalized)) {
    operations.push({
      kind: "add_dietary_requirement",
      requirement: "lactose_free",
    });
  }
  if (/\bhalal\b/u.test(normalized)) {
    operations.push({ kind: "add_dietary_requirement", requirement: "halal" });
  }
  if (/\b(kosher|koser)\b/u.test(normalized)) {
    operations.push({ kind: "add_dietary_requirement", requirement: "kosher" });
  }

  const allergyMentioned =
    /\b(alerg\w*|allerg\w*)\b|аллерг/u.test(normalized);
  const thirdPartyAllergy =
    /(?:\b(draug\w*|friend|jis|ji|he|she|vaikas|child)\b|друг|подруг|ребен|ребён)[^.!?]{0,80}(?:\b(alerg\w*|allerg\w*)\b|аллерг)/u.test(
      normalized
    );
  const negatedAllergy =
    /\b(nesu|neesu|ne) alerg\w*|not allerg\w*|dont have an allerg\w*|do not have an allerg\w*|у\s+меня\s+нет\s+аллерг|я\s+не\s+аллерг/u.test(
      normalized
    );
  const correctedAllergy =
    /\b(nebesu alerg\w*|i am no longer allerg\w*|remove my allerg\w*)\b|аллергии\s+больше\s+нет/u.test(
      normalized
    );
  const uncertainAllergy =
    allergyMentioned &&
    /\b(gal|galbut|itariu|nezinau ar|maybe|might|possibly|not sure)\b|возможно|может\s+быть|не\s+уверен/u.test(
      normalized
    );
  const explicitFirstPersonAllergy =
    /\b(esu alerg\w*|as alerg\w*|man alerg\w*|i am allerg\w*|im allerg\w*)\b|у\s+меня\s+аллерг|я\s+аллерг/u.test(
      normalized
    );
  let unresolvedAllergy = false;
  for (const candidate of allergens) {
    if (!allergyMentioned || !candidate.pattern.test(normalized)) continue;
    if (correctedAllergy) {
      operations.push({
        kind: "remove_allergy",
        allergy: { allergen: candidate.allergen },
      });
    } else if (thirdPartyAllergy || negatedAllergy) {
      // Explicitly not customer safety state.
    } else if (uncertainAllergy || !explicitFirstPersonAllergy) {
      unresolvedAllergy = true;
    } else {
      operations.push({
        kind: "add_allergy",
        allergy: { allergen: candidate.allergen },
      });
    }
  }
  if (unresolvedAllergy) {
    operations.push(
      { kind: "set_stage", stage: "clarifying" },
      {
        kind: "set_unresolved_question",
        question: {
          kind: "dietary_detail",
          promptKey: "uncertain_allergy",
          relatedProductIds: [],
        },
      }
    );
  }

  let hungerLevel = state.hungerLevel;
  if (
    /\b(nealkanas|not hungry|beveik nealkanas|hardly hungry)\b/u.test(normalized)
  ) {
    hungerLevel = "light";
  } else if (/\b(lengv\w*|light)\b/u.test(normalized)) {
    hungerLevel = "light";
  } else if (/\b(labai alkan|very hungry)\b/u.test(normalized)) {
    hungerLevel = "very_hungry";
  } else if (/\b(sot\w*|hungry|filling)\b/u.test(normalized)) {
    hungerLevel = "hungry";
  }
  if (hungerLevel !== state.hungerLevel) {
    operations.push({ kind: "set_hunger", hungerLevel });
  }

  let intent = "unknown";
  let stage: ConversationState["stage"] | null = null;
  if (/\b(labas|sveiki|hello|hi|hey)\b|привет|здравств/u.test(normalized)) {
    intent = "greeting";
    stage = "greeting";
  }
  if (
    RECOMMEND_REQUEST_PATTERN.test(normalized) ||
    messageRequestsDrinks(message)
  ) {
    intent = "recommendation";
    stage = "discovering_preferences";
  }
  if (
    menuCategory ||
    (contextualFollowUp &&
      (state.latestReferencedProductIds.length > 0 ||
        state.preferences.preferredCategories.length > 0 ||
        state.temporaryPreferences.preferredCategories.length > 0))
  ) {
    intent = "recommendation";
    stage = "discovering_preferences";
  }
  if (/\b(pridek|add|imsiu|take)\b|добав|полож/u.test(normalized)) {
    intent = "add_to_cart";
  }
  if (/\b(pasalink|remove)\b|удал|убер/u.test(normalized)) {
    intent = "remove_from_cart";
  }
  if (/\b(saskait\w*|bill)\b|сч[её]т/u.test(normalized)) {
    intent = "request_bill";
  }
  if (/\b(padavej\w*|waiter)\b|официант/u.test(normalized)) {
    intent = "request_waiter";
  }
  if (allergyMentioned && !thirdPartyAllergy && !negatedAllergy) {
    intent = "allergy";
    stage = "clarifying";
  }
  if (stage && !unresolvedAllergy) {
    operations.push({ kind: "set_stage", stage });
  }

  if (
    state.latestReferencedProductIds.length > 0 &&
    !messageUsesPriorReference(message) &&
    !/\b(pridek|add|imsiu|take)\b|добав|полож/u.test(normalized)
  ) {
    operations.push({ kind: "update_references", productIds: [] });
    operations.push({ kind: "set_ambiguity", ambiguity: null });
  }

  return {
    intent,
    delta: ConversationStateDeltaSchema.parse({ operations }),
    unresolvedAllergy,
  };
}
