/**
 * Conversation state factory and utilities.
 * The state is a plain object (no classes) to keep it serializable.
 */

import type { ConversationState, ConversationTurn, Intent } from "./types.ts";
import type { Category } from "../data.ts";

export function createState(lang = "lt"): ConversationState {
  return {
    currentIntent: null,
    conversationHistory: [],
    lastRecommendedIds: [],
    shownProductIds: [],
    selectedDishId: null,
    lastFoodDishId: null,
    activeDishId: null,
    budget: null,
    preferredProtein: null,
    preferredCategory: null,
    preferredDrink: null,
    preferredDessert: null,
    ageGroup: null,
    allowAlcohol: true,
    diet: null,
    vegetarian: false,
    vegan: false,
    noMeat: false,
    noAnimalProducts: false,
    noPork: false,
    avoidShellfish: false,
    religiousRestriction: null,
    glutenFree: false,
    lactoseFree: false,
    allergies: [],
    dislikedIngredients: [],
    wantsLightFood: false,
    wantsFillingFood: false,
    wantsSpicyFood: false,
    currentLanguage: lang,
    pendingActions: [],
    awaitingConfirmation: false,
    hasUnclaimedRecommendation: false,
  };
}

/** Record a turn in conversation history (keeps last 20 turns) */
export function recordTurn(
  state: ConversationState,
  role: "user" | "assistant",
  content: string,
  intent?: Intent,
  recommendedIds?: string[]
): void {
  const turn: ConversationTurn = {
    role,
    content,
    intent,
    recommendedIds,
    timestamp: Date.now(),
  };
  state.conversationHistory.push(turn);
  if (state.conversationHistory.length > 20) {
    state.conversationHistory.shift();
  }
}

/** Set the current batch of recommended product IDs */
export function setRecommended(state: ConversationState, ids: string[]): void {
  state.lastRecommendedIds = ids;
  for (const id of ids) {
    if (!state.shownProductIds.includes(id)) {
      state.shownProductIds.push(id);
    }
  }
  if (ids.length > 0) {
    state.lastMentionedProductId = ids[0];
    state.hasUnclaimedRecommendation = true;
  }
}

/** Reset the shown products pool (for rotation restart) */
export function resetShownProducts(state: ConversationState): void {
  state.shownProductIds = [];
  state.lastRecommendedIds = [];
}

/** Get last user message */
export function lastUserMessage(state: ConversationState): string | null {
  const turns = [...state.conversationHistory].reverse();
  return turns.find((t) => t.role === "user")?.content ?? null;
}

/** Get last assistant message */
export function lastAssistantMessage(state: ConversationState): string | null {
  const turns = [...state.conversationHistory].reverse();
  return turns.find((t) => t.role === "assistant")?.content ?? null;
}

/** How many consecutive times the user has asked for changes */
export function changeCount(state: ConversationState): number {
  let count = 0;
  for (const turn of [...state.conversationHistory].reverse()) {
    if (turn.role === "user" && turn.intent === "change_recommendation") count++;
    else if (turn.role === "user") break;
  }
  return count;
}
