import type { ConversationMode, ConversationState, NLUResult } from "./types.ts";

const DRINK_PAIRING_PATTERNS = [
  /\b(prie|su)\b.*\b(gerti|gert|atsigerti|gerim|alu|alaus|vyna|vyno|sidr|kokteil|limonad|sult|vand|kava|arbata)/i,
  /\b(gerti|gert|atsigerti|gerim|alu|alaus|vyna|vyno|sidr|kokteil|limonad|sult|vand|kava|arbata)\b.*\bprie\b/i,
  /\bo\s+prie\b/i,
  /\bprie\s+(jos|jo|ju|sito|sio|to|tam|siam)\b/i,
  /\bprie\b.*\b(salot|bulvini|blynu|lasis|kiaulien|sonin|sonkaul|vistien|jautien|zuv|pic)/i,
  /\bwith\b.*\b(drink|beer|wine|cider|cocktail|lemonade|juice|water|coffee|tea)\b/i,
];

const PRICE_PATTERNS = [
  /\bkiek\s+kain/i,
  /\bkiek\b.*\b(kain|eur|€|lasis|sonin|sonkaul|pica|vistien|jautien|zuv|bulvin|cepelin|didzkukul)/i,
  /\bkaina\b/i,
  /\bprice\b/i,
  /\bсколько\s+стоит/i,
];

const MENU_SEARCH_PATTERNS = [
  /\bar\s+turite\b/i,
  /\bturite\b/i,
  /\bparodyk\b/i,
  /\bshow\b/i,
  /\bесть\s+ли\b/i,
];

export function determineConversationMode(
  nlu: NLUResult,
  state: ConversationState
): ConversationMode {
  const text = nlu.normalizedInput;

  // Beer snacks — "ką užkąsti prie alaus?" is a FOOD request, not drink pairing,
  // even though it matches the "prie ... alaus" pairing pattern below.
  if (/(uzkand|uzkas|kasti|valgy)/.test(text) && /\b(alaus|alui|alu)\b/.test(text)) {
    return "FOOD_RECOMMENDATION";
  }

  if (DRINK_PAIRING_PATTERNS.some((re) => re.test(text))) return "DRINK_PAIRING";

  if (/\b(no alcohol|be alkoholio|nealkohol|non.?alcohol|без алкоголя)\b/i.test(text)) {
    return state.lastFoodDishId ? "DRINK_PAIRING" : "MENU_SEARCH";
  }

  if (
    nlu.intent === "drink_recommendation" &&
    (state.lastFoodDishId || /\bprie\b/i.test(text))
  ) {
    return "DRINK_PAIRING";
  }
  if (nlu.intent === "drink_recommendation") return "MENU_SEARCH";

  if (PRICE_PATTERNS.some((re) => re.test(text))) return "PRICE";
  if (nlu.intent === "ingredient_question") return "INGREDIENTS";
  if (nlu.intent === "allergy_question" || nlu.entities.allergen || nlu.entities.dislike) return "ALLERGY";
  if (nlu.intent === "kids_menu" || nlu.entities.category === "vaikiskas") return "CHILDREN";
  if (nlu.intent === "dessert_recommendation" || nlu.entities.category === "desertai") return "DESSERT";
  if (nlu.intent === "cheap_food" || nlu.intent === "expensive_food" || nlu.entities.budget != null) return "BUDGET";

  if (
    nlu.intent === "beer_recommendation" ||
    nlu.intent === "wine_recommendation" ||
    nlu.intent === "cocktail_recommendation" ||
    nlu.entities.drinkType
  ) {
    return "MENU_SEARCH";
  }

  if (nlu.intent === "change_recommendation" || nlu.intent === "negative_answer" || nlu.intent === "positive_answer" || nlu.intent === "confirmation") {
    return "FOLLOW_UP";
  }

  if (MENU_SEARCH_PATTERNS.some((re) => re.test(text)) && (nlu.entities.category || nlu.entities.protein)) {
    return "MENU_SEARCH";
  }

  return "FOOD_RECOMMENDATION";
}
