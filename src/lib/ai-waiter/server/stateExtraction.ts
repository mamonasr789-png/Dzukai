import "server-only";

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
    category: "grilinis",
    pattern: /\b(gril\w*|grill(?:ed)?)\b|грил/u,
  },
  {
    category: "vaikiskas",
    pattern: /\b(vaik\w*|kids?(?: menu)?|children(?:s menu)?)\b|детск/u,
  },
  {
    category: "gerimai",
    pattern:
      /\b(?:a\s+)?(?:drinks?|beverages?)\b|\bgerim(?:as|o|u|a|ai|us|ams|ais)?\b|напит(?:ок|ка|ки|ков|ку|ками)?/u,
  },
];

/** Maps explicit customer category wording to an official menu category. */
export function menuCategoryForMessage(message: string): string | null {
  const normalized = normalize(message);
  return (
    menuCategoryPatterns.find(({ pattern }) => pattern.test(normalized))
      ?.category ?? null
  );
}

/** True only for wording that asks to continue the current recommendation set. */
export function messageRequestsAnotherRecommendation(message: string): boolean {
  const normalized = normalize(message);
  return /\b(another(?: one)?|something else|different one|more options?)\b|\b(dar(?: viena)?|kit(?:a|ka|as|ok\w*))\b|друг(?:ои|ую|ое|ие)|ещ[её]/u.test(
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
    /\b(kalbek lietuviskai|noriu|prasau|pridek|parodyk|rekomend\w*|gerim\w*|dar|kita|geriau|esu|iki|sotus|sotaus)\b/u.test(
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
  { value: "fish", pattern: /\b(zuv\w*|fish|lasis\w*|salmon)\b/u },
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
    /recommendation[^\d]{0,12}[1-9]|[1-9][^\d]{0,12}recommendation/u.test(
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
    /\b(nemegstu|nepatinka|dislike|dont like|do not like)\b/u.test(normalized);
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
    /\b(noriu|want|recommend|rekomend\w*|pasiulyk|parodyk|something|kazko)\b|хочу|рекоменд|посовет|покаж/u.test(
      normalized
    )
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
