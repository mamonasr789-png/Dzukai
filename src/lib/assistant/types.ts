import type { Product, Category } from "../data.ts";

export type { Product, Category };

// ── Intents ───────────────────────────────────────────────────────────────────

export type Intent =
  | "food_recommendation"
  | "drink_recommendation"
  | "beer_recommendation"
  | "wine_recommendation"
  | "cocktail_recommendation"
  | "dessert_recommendation"
  | "ingredient_question"
  | "allergy_question"
  | "vegetarian"
  | "vegan"
  | "kids_menu"
  | "cheap_food"
  | "expensive_food"
  | "popular_dishes"
  | "restaurant_info"
  | "opening_hours"
  | "menu_category"
  | "pairing_request"
  | "change_recommendation"
  | "confirmation"
  | "negative_answer"
  | "positive_answer"
  | "unknown";

// ── NLU ──────────────────────────────────────────────────────────────────────

export interface NLUResult {
  intent: Intent;
  confidence: number;
  entities: {
    budget?: number;
    category?: Category;
    protein?: string;
    allergen?: string;
    dislike?: string;
    dish?: string;
    drinkType?: string;
    moodFilling?: boolean;
    moodLight?: boolean;
    moodSpicy?: boolean;
    vegetarian?: boolean;
    vegan?: boolean;
    glutenFree?: boolean;
    lactoseFree?: boolean;
  };
  rawInput: string;
  normalizedInput: string;
}

export type ConversationMode =
  | "FOOD_RECOMMENDATION"
  | "DRINK_PAIRING"
  | "DESSERT"
  | "ALLERGY"
  | "INGREDIENTS"
  | "PRICE"
  | "MENU_SEARCH"
  | "BUDGET"
  | "CHILDREN"
  | "FOLLOW_UP";

// ── Conversation ──────────────────────────────────────────────────────────────

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  intent?: Intent;
  recommendedIds?: string[];
  timestamp: number;
}

export interface ConversationState {
  currentIntent: Intent | null;
  conversationHistory: ConversationTurn[];

  // Last shown recommendations (for rotation)
  lastRecommendedIds: string[];
  shownProductIds: string[];         // all ever shown in session

  // Dish context
  selectedDishId: string | null;     // user confirmed this dish
  lastFoodDishId: string | null;     // last food dish mentioned/shown
  activeDishId: string | null;       // dish implied by pronouns/short follow-ups

  // User preferences (persist for the session)
  budget: number | null;
  preferredProtein: string | null;   // chicken, pork, beef, fish, lamb
  preferredCategory: Category | null;
  preferredDrink: string | null;
  preferredDessert: string | null;

  // Diet flags
  ageGroup: "minor" | "adult" | null;
  allowAlcohol: boolean;
  diet: "vegetarian" | "vegan" | null;
  vegetarian: boolean;
  vegan: boolean;
  noMeat: boolean;
  noAnimalProducts: boolean;
  noPork: boolean;
  avoidShellfish: boolean;
  religiousRestriction: "halal" | "kosher" | null;
  glutenFree: boolean;
  lactoseFree: boolean;

  // Allergies & dislikes
  allergies: string[];
  dislikedIngredients: string[];

  // Mood
  wantsLightFood: boolean;
  wantsFillingFood: boolean;
  wantsSpicyFood: boolean;

  // Language
  currentLanguage: string;
}

// ── Recommendations ───────────────────────────────────────────────────────────

export interface PairingResult {
  drinks: Product[];
  desserts: Product[];
  explanation: string;
}

export interface RecommendationResult {
  products: Product[];
  pairings?: PairingResult;
  poolExhausted: boolean;
}
