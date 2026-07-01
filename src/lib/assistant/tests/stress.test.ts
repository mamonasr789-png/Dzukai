import { describe, it } from "./runner.ts";
import { detectIntent } from "../intentEngine.ts";
import { determineConversationMode } from "../conversationMode.ts";
import { createState, processMessage } from "../brain.ts";
import { findById, FOOD_CATEGORIES, DRINK_CATEGORIES } from "../menuSearch.ts";
import { isAlcoholicProduct, productViolatesRestrictions } from "../restrictionEngine.ts";
import type { ConversationState, Intent, ConversationMode } from "../types.ts";
import type { Category, Product } from "../../data.ts";

type TestContext = {
  input: string;
  expected: string;
  actual: string;
  suspectedModule: string;
};

function failCase(ctx: TestContext): never {
  throw new Error(
    `input: ${ctx.input}\nexpected: ${ctx.expected}\nactual: ${ctx.actual}\nsuspected module: ${ctx.suspectedModule}`
  );
}

function assertCase(condition: boolean, ctx: TestContext): void {
  if (!condition) failCase(ctx);
}

function state(): ConversationState {
  return createState("lt");
}

function recommendedProducts(s: ConversationState): Product[] {
  return s.lastRecommendedIds
    .map((id) => findById(id))
    .filter((product): product is Product => Boolean(product));
}

function productSummary(products: Product[]): string {
  return products.map((product) => `${product.id}:${product.category}:${product.name}`).join(" | ") || "(none)";
}

function assertAllRecommendedInCategories(
  s: ConversationState,
  allowed: Category[],
  input: string,
  expected: string,
  suspectedModule: string
): void {
  const products = recommendedProducts(s);
  assertCase(products.length > 0, {
    input,
    expected,
    actual: "No recommendations were stored in state.lastRecommendedIds",
    suspectedModule,
  });
  const disallowed = products.filter((product) => !allowed.includes(product.category));
  assertCase(disallowed.length === 0, {
    input,
    expected,
    actual: `Unexpected categories: ${productSummary(disallowed)}; all recommendations: ${productSummary(products)}`,
    suspectedModule,
  });
}

function assertNoAlcoholRecommendations(
  s: ConversationState,
  input: string,
  expected: string,
  suspectedModule: string
): void {
  const products = recommendedProducts(s);
  assertCase(products.length > 0, {
    input,
    expected,
    actual: "No drink recommendations were stored in state.lastRecommendedIds",
    suspectedModule,
  });
  const alcoholic = products.filter((product) => isAlcoholicProduct(product));
  assertCase(alcoholic.length === 0, {
    input,
    expected,
    actual: `Alcoholic recommendations: ${productSummary(alcoholic)}`,
    suspectedModule,
  });
}

function assertNoRestrictionViolations(
  s: ConversationState,
  input: string,
  expected: string,
  suspectedModule: string
): void {
  const products = recommendedProducts(s);
  const invalid = products.filter((product) => productViolatesRestrictions(product, s));
  assertCase(invalid.length === 0, {
    input,
    expected,
    actual: `Restriction-violating products: ${productSummary(invalid)}`,
    suspectedModule,
  });
}

function runConversation(messages: string[]): { state: ConversationState; replies: string[] } {
  const s = state();
  const replies = messages.map((message) => processMessage(message, s));
  return { state: s, replies };
}

// 1. Intent detection — Lithuanian and direct waiter phrases (25)
const intentCases: Array<{ input: string; expected: Intent }> = [
  { input: "Sočiai", expected: "food_recommendation" },
  { input: "Lengvai", expected: "food_recommendation" },
  { input: "Pigiau", expected: "cheap_food" },
  { input: "Brangiau", expected: "expensive_food" },
  { input: "Dar", expected: "change_recommendation" },
  { input: "Ne", expected: "negative_answer" },
  { input: "Taip", expected: "positive_answer" },
  { input: "Vištiena", expected: "food_recommendation" },
  { input: "Žuvis", expected: "food_recommendation" },
  { input: "Pica", expected: "food_recommendation" },
  { input: "Salotos", expected: "food_recommendation" },
  { input: "Desertas", expected: "dessert_recommendation" },
  { input: "Alus", expected: "beer_recommendation" },
  { input: "Vynas", expected: "wine_recommendation" },
  { input: "Kokteilis", expected: "cocktail_recommendation" },
  { input: "Kava", expected: "drink_recommendation" },
  { input: "Vaikams", expected: "kids_menu" },
  { input: "Vegetariškai", expected: "vegetarian" },
  { input: "Veganiška", expected: "vegan" },
  { input: "Be glitimo", expected: "allergy_question" },
  { input: "Be laktozės", expected: "allergy_question" },
  { input: "Ką atsigerti prie lašišos?", expected: "drink_recommendation" },
  { input: "O prie šito?", expected: "pairing_request" },
  { input: "Kiek kainuoja lašiša?", expected: "food_recommendation" },
  { input: "Kas sudėtyje?", expected: "ingredient_question" },
  { input: "Populiariausi", expected: "popular_dishes" },
  { input: "Vegetaras", expected: "vegetarian" },
  { input: "Veganas", expected: "vegan" },
  { input: "Kada dirbate?", expected: "opening_hours" },
  { input: "Adresas", expected: "restaurant_info" },
];

describe("Stress — intent detection", () => {
  intentCases.forEach(({ input, expected }) => {
    it(`detects intent for "${input}"`, () => {
      const actual = detectIntent(input, state()).intent;
      assertCase(actual === expected, {
        input,
        expected: `intent ${expected}`,
        actual: `intent ${actual}`,
        suspectedModule: "intentEngine",
      });
    });
  });
});

// 2. Intent detection — misspellings and accentless variants (25)
const misspellingCases: Array<{ input: string; expected: Intent }> = [
  { input: "Sociai", expected: "food_recommendation" },
  { input: "Lengviau", expected: "food_recommendation" },
  { input: "Pigiauu", expected: "cheap_food" },
  { input: "Brangesnio", expected: "expensive_food" },
  { input: "Kitka", expected: "change_recommendation" },
  { input: "Ne sita", expected: "change_recommendation" },
  { input: "Vistiena", expected: "food_recommendation" },
  { input: "Zuvis", expected: "food_recommendation" },
  { input: "Lasisa", expected: "food_recommendation" },
  { input: "Deserto", expected: "dessert_recommendation" },
  { input: "Alaus", expected: "beer_recommendation" },
  { input: "Vyno", expected: "wine_recommendation" },
  { input: "Kokteiliu", expected: "cocktail_recommendation" },
  { input: "Vaikui", expected: "kids_menu" },
  { input: "Vegetariskas", expected: "vegetarian" },
  { input: "Veganiskas", expected: "vegan" },
  { input: "Be glitimo", expected: "allergy_question" },
  { input: "Be laktozes", expected: "allergy_question" },
  { input: "Ka atsigerti prie lasisos?", expected: "drink_recommendation" },
  { input: "O prie sito?", expected: "pairing_request" },
  { input: "Kas sudetyje?", expected: "ingredient_question" },
  { input: "Populiariausi", expected: "popular_dishes" },
  { input: "Kada dirbate?", expected: "opening_hours" },
  { input: "Adresas", expected: "restaurant_info" },
  { input: "Ar turite IPA?", expected: "beer_recommendation" },
];

describe("Stress — misspelling handling", () => {
  misspellingCases.forEach(({ input, expected }) => {
    it(`normalizes "${input}" into ${expected}`, () => {
      const actual = detectIntent(input, state()).intent;
      assertCase(actual === expected, {
        input,
        expected: `intent ${expected}`,
        actual: `intent ${actual}`,
        suspectedModule: "synonyms / intentEngine",
      });
    });
  });
});

// 3. Conversation mode routing (25)
const modeCases: Array<{ input: string; expected: ConversationMode; setup?: (s: ConversationState) => void }> = [
  { input: "Rekomenduok ką nors", expected: "FOOD_RECOMMENDATION" },
  { input: "Sočiai", expected: "FOOD_RECOMMENDATION" },
  { input: "Lengvai", expected: "FOOD_RECOMMENDATION" },
  { input: "Ką atsigerti prie lašišos?", expected: "DRINK_PAIRING" },
  { input: "Kokį gėrimą prie bulvinių blynų?", expected: "DRINK_PAIRING" },
  { input: "O prie šito?", expected: "DRINK_PAIRING", setup: (s) => { s.lastFoodDishId = "z5"; } },
  { input: "Desertas", expected: "DESSERT" },
  { input: "Be grybų", expected: "ALLERGY" },
  { input: "Be kiaulienos", expected: "ALLERGY" },
  { input: "Kas sudėtyje?", expected: "INGREDIENTS" },
  { input: "Kiek kainuoja lašiša?", expected: "PRICE" },
  { input: "Turite IPA?", expected: "MENU_SEARCH" },
  { input: "Turite kokteilių?", expected: "MENU_SEARCH" },
  { input: "Turite raudono vyno?", expected: "MENU_SEARCH" },
  { input: "Pigiau", expected: "BUDGET" },
  { input: "Brangiau", expected: "BUDGET" },
  { input: "Ką vaikui?", expected: "CHILDREN" },
  { input: "Dar", expected: "FOLLOW_UP", setup: (s) => { s.lastRecommendedIds = ["v1"]; } },
  { input: "Kitką", expected: "FOLLOW_UP", setup: (s) => { s.lastRecommendedIds = ["v1"]; } },
  { input: "Ne", expected: "FOLLOW_UP", setup: (s) => { s.currentIntent = "food_recommendation"; } },
  { input: "Taip", expected: "FOLLOW_UP" },
  { input: "Kava", expected: "MENU_SEARCH" },
  { input: "Vynas", expected: "MENU_SEARCH" },
  { input: "Alus", expected: "MENU_SEARCH" },
  { input: "Be alkoholio", expected: "MENU_SEARCH" },
];

describe("Stress — conversation mode", () => {
  modeCases.forEach(({ input, expected, setup }) => {
    it(`routes "${input}" to ${expected}`, () => {
      const s = state();
      setup?.(s);
      const nlu = detectIntent(input, s);
      const actual = determineConversationMode(nlu, s);
      assertCase(actual === expected, {
        input,
        expected: `mode ${expected}`,
        actual: `mode ${actual}`,
        suspectedModule: "conversationMode",
      });
    });
  });
});

// 4. Availability: positive matches and exact search behavior (25)
const availabilityFoundCases = [
  "turite IPA?",
  "ar turite nealkoholinio alaus?",
  "turite raudono vyno?",
  "turite tamsaus alaus?",
  "ar yra mango kokteilis?",
  "turite kokteilių?",
  "turite alaus?",
  "turite vyno?",
  "turite limonadų?",
  "turite kavos?",
  "turite arbatos?",
  "turite picos?",
  "turite salotų?",
  "turite sriubų?",
  "turite desertų?",
  "turite ledų?",
  "turite žuvies?",
  "turite vištienos?",
  "turite jautienos?",
  "turite vaikišką meniu?",
  "ar meniu yra pica?",
  "gal turite alaus?",
  "pas jus yra vyno?",
  "ar galima gauti limonadą?",
  "ar yra burgerių?",
] as const;

describe("Stress — availability found cases", () => {
  availabilityFoundCases.forEach((input) => {
    it(`answers availability for "${input}" without inventing products`, () => {
      const s = state();
      const reply = processMessage(input, s);
      assertCase(reply.includes("Taip, turime"), {
        input,
        expected: `reply starting with availability confirmation`,
        actual: reply,
        suspectedModule: "availabilitySearch",
      });
      const products = recommendedProducts(s);
      assertCase(products.length > 0, {
        input,
        expected: "at least one matching local product",
        actual: "No products were attached to the reply",
        suspectedModule: "availabilitySearch",
      });
    });
  });
});

// 5. Availability: missing exact matches with alternatives only (25)
const availabilityMissingCases = [
  "turite bananinį kokteilį?",
  "turite bananinių kokteilių?",
  "turite braškinį limonadą?",
  "turite vanilinį limonadą?",
  "turite karamelinį limonadą?",
  "turite bananinę picą?",
  "turite veganišką picą?",
  "turite braškinės kavos?",
  "turite vyšnių arbatą?",
  "turite kokosų alaus?",
  "turite bananinio sidro?",
  "turite karamelinio sidro?",
  "turite ananasų sriubą?",
  "turite obuolių burgerį?",
  "turite braškinį kepsnį?",
  "turite vanilinės žuvies?",
  "turite bananinę vištieną?",
  "turite mėlynių jautieną?",
  "turite kokosų salotas?",
  "turite karamelinę sriubą?",
  "turite šokoladinį alų?",
  "turite bananinį vyną?",
  "turite braškinį burgerį?",
] as const;

describe("Stress — availability missing exact matches", () => {
  availabilityMissingCases.forEach((input) => {
    it(`says not found for "${input}" and keeps alternatives local`, () => {
      const s = state();
      const reply = processMessage(input, s);
      assertCase(reply.includes("nematau"), {
        input,
        expected: `clear not-found answer`,
        actual: reply,
        suspectedModule: "availabilitySearch",
      });
      const products = recommendedProducts(s);
      assertCase(products.every((product) => Boolean(findById(product.id))), {
        input,
        expected: "alternatives must still come from local menu",
        actual: productSummary(products),
        suspectedModule: "availabilitySearch",
      });
    });
  });
});

// 6. Memory and semantic restriction extraction (25)
const restrictionMemoryChecks: Array<{
  input: string;
  expected: string;
  check: (s: ConversationState) => boolean;
  actual: (s: ConversationState) => string;
}> = [
  { input: "esu nepilnametis", expected: "ageGroup=minor and alcohol disabled", check: (s) => s.ageGroup === "minor" && s.allowAlcohol === false, actual: (s) => JSON.stringify({ ageGroup: s.ageGroup, allowAlcohol: s.allowAlcohol }) },
  { input: "vairuoju", expected: "preferredDrink=nonAlcoholic", check: (s) => s.preferredDrink === "nonAlcoholic" && s.allowAlcohol === false, actual: (s) => JSON.stringify({ preferredDrink: s.preferredDrink, allowAlcohol: s.allowAlcohol }) },
  { input: "be alkoholio", expected: "preferredDrink=nonAlcoholic", check: (s) => s.preferredDrink === "nonAlcoholic" && s.allowAlcohol === false, actual: (s) => JSON.stringify({ preferredDrink: s.preferredDrink, allowAlcohol: s.allowAlcohol }) },
  { input: "vegetariškai", expected: "vegetarian=true", check: (s) => s.vegetarian === true, actual: (s) => JSON.stringify({ vegetarian: s.vegetarian, vegan: s.vegan }) },
  { input: "veganiška", expected: "vegan=true and noAnimalProducts=true", check: (s) => s.vegan === true && s.noAnimalProducts === true, actual: (s) => JSON.stringify({ vegan: s.vegan, noAnimalProducts: s.noAnimalProducts }) },
  { input: "be glitimo", expected: "glutenFree=true", check: (s) => s.glutenFree === true, actual: (s) => JSON.stringify({ glutenFree: s.glutenFree }) },
  { input: "be laktozės", expected: "lactoseFree=true", check: (s) => s.lactoseFree === true, actual: (s) => JSON.stringify({ lactoseFree: s.lactoseFree }) },
  { input: "be grybų", expected: "grybai added to dislikedIngredients", check: (s) => s.dislikedIngredients.includes("grybai"), actual: (s) => JSON.stringify(s.dislikedIngredients) },
  { input: "be svogūnų", expected: "svogūnas added to dislikedIngredients", check: (s) => s.dislikedIngredients.includes("svogūnas"), actual: (s) => JSON.stringify(s.dislikedIngredients) },
  { input: "be pomidorų", expected: "pomidoras added to dislikedIngredients", check: (s) => s.dislikedIngredients.includes("pomidoras"), actual: (s) => JSON.stringify(s.dislikedIngredients) },
  { input: "be sūrio", expected: "sūris added to dislikedIngredients", check: (s) => s.dislikedIngredients.includes("sūris"), actual: (s) => JSON.stringify(s.dislikedIngredients) },
  { input: "be žuvies", expected: "žuvis added to dislikedIngredients", check: (s) => s.dislikedIngredients.includes("žuvis"), actual: (s) => JSON.stringify(s.dislikedIngredients) },
  { input: "be kiaulienos", expected: "noPork=true without forcing vegetarian", check: (s) => s.noPork === true && s.vegetarian === false, actual: (s) => JSON.stringify({ noPork: s.noPork, vegetarian: s.vegetarian }) },
  { input: "netoleruoju pieno", expected: "Pienas allergy stored", check: (s) => s.allergies.includes("Pienas"), actual: (s) => JSON.stringify(s.allergies) },
  { input: "alergija riešutams", expected: "Riešutai allergy stored", check: (s) => s.allergies.includes("Riešutai"), actual: (s) => JSON.stringify(s.allergies) },
  { input: "no alcohol", expected: "preferredDrink=nonAlcoholic", check: (s) => s.preferredDrink === "nonAlcoholic" && s.allowAlcohol === false, actual: (s) => JSON.stringify({ preferredDrink: s.preferredDrink, allowAlcohol: s.allowAlcohol }) },
  { input: "no mushrooms", expected: "grybai added to dislikedIngredients", check: (s) => s.dislikedIngredients.includes("grybai"), actual: (s) => JSON.stringify(s.dislikedIngredients) },
  { input: "vegetarian", expected: "vegetarian=true", check: (s) => s.vegetarian === true, actual: (s) => JSON.stringify({ vegetarian: s.vegetarian }) },
  { input: "vegan", expected: "vegan=true", check: (s) => s.vegan === true, actual: (s) => JSON.stringify({ vegan: s.vegan }) },
  { input: "no pork", expected: "noPork=true", check: (s) => s.noPork === true, actual: (s) => JSON.stringify({ noPork: s.noPork }) },
  { input: "halal", expected: "noPork=true and no alcohol", check: (s) => s.noPork === true && s.allowAlcohol === false, actual: (s) => JSON.stringify({ noPork: s.noPork, allowAlcohol: s.allowAlcohol }) },
  { input: "kosher", expected: "avoidShellfish=true", check: (s) => s.avoidShellfish === true, actual: (s) => JSON.stringify({ avoidShellfish: s.avoidShellfish }) },
  { input: "biudžetas 15", expected: "budget=15", check: (s) => s.budget === 15, actual: (s) => JSON.stringify({ budget: s.budget }) },
  { input: "iki dešimt", expected: "budget=10", check: (s) => s.budget === 10, actual: (s) => JSON.stringify({ budget: s.budget }) },
  { input: "ką nors aštraus", expected: "wantsSpicyFood=true", check: (s) => s.wantsSpicyFood === true, actual: (s) => JSON.stringify({ wantsSpicyFood: s.wantsSpicyFood }) },
  { input: "biudzetas 18", expected: "budget=18", check: (s) => s.budget === 18, actual: (s) => JSON.stringify({ budget: s.budget }) },
  { input: "turiu iki 12", expected: "budget=12", check: (s) => s.budget === 12, actual: (s) => JSON.stringify({ budget: s.budget }) },
  { input: "meatless", expected: "vegetarian=true", check: (s) => s.vegetarian === true, actual: (s) => JSON.stringify({ vegetarian: s.vegetarian }) },
  { input: "plant based", expected: "vegan=true", check: (s) => s.vegan === true, actual: (s) => JSON.stringify({ vegan: s.vegan }) },
  { input: "underage", expected: "ageGroup=minor", check: (s) => s.ageGroup === "minor", actual: (s) => JSON.stringify({ ageGroup: s.ageGroup }) },
];

describe("Stress — memory extraction", () => {
  restrictionMemoryChecks.forEach(({ input, expected, check, actual }) => {
    it(`stores semantic memory for "${input}"`, () => {
      const s = state();
      processMessage(input, s);
      assertCase(check(s), {
        input,
        expected,
        actual: actual(s),
        suspectedModule: "memory / restrictionEngine",
      });
    });
  });
});

// 7. Food requests and one-word follow-ups (25)
const foodFlowCases: Array<{ messages: string[]; expectedCategory?: Category; expectedProtein?: string }> = [
  { messages: ["Sočiai"] },
  { messages: ["Lengvai"] },
  { messages: ["Noriu vištienos"], expectedCategory: "vistiena", expectedProtein: "chicken" },
  { messages: ["Noriu žuvies"], expectedCategory: "zuvis", expectedProtein: "fish" },
  { messages: ["Noriu jautienos"], expectedProtein: "beef" },
  { messages: ["Noriu picos"], expectedCategory: "picos" },
  { messages: ["Noriu salotų"], expectedCategory: "salotos" },
  { messages: ["Noriu sriubos"], expectedCategory: "sriubos" },
  { messages: ["Rekomenduok ką nors", "Vištiena"], expectedCategory: "vistiena", expectedProtein: "chicken" },
  { messages: ["Rekomenduok ką nors", "Žuvis"], expectedCategory: "zuvis", expectedProtein: "fish" },
  { messages: ["Rekomenduok ką nors", "Geriau vištiena"], expectedCategory: "vistiena", expectedProtein: "chicken" },
  { messages: ["Rekomenduok ką nors", "Lengvai"] },
  { messages: ["Rekomenduok ką nors", "Sočiai"] },
  { messages: ["Rekomenduok ką nors", "Pigiau"] },
  { messages: ["Rekomenduok ką nors", "Dar"] },
  { messages: ["Rekomenduok ką nors", "Kitką"] },
  { messages: ["Aštraus kažko"] },
  { messages: ["Ką nors lengvo"] },
  { messages: ["Ką nors sotaus"] },
  { messages: ["Ką nors aštraus"] },
  { messages: ["Populiariausi patiekalai"] },
  { messages: ["Ką vaikui?"] },
  { messages: ["Desertas"] },
  { messages: ["Rekomenduok ką nors", "Desertas"] },
  { messages: ["Rekomenduok ką nors", "Alus"] },
];

describe("Stress — food and short follow-up flows", () => {
  foodFlowCases.forEach(({ messages, expectedCategory, expectedProtein }) => {
    it(`handles flow: ${messages.join(" -> ")}`, () => {
      const { state: s, replies } = runConversation(messages);
      const input = messages.join(" -> ");
      const lastReply = replies.at(-1) ?? "";

      if (messages.at(-1) === "Desertas") {
        assertAllRecommendedInCategories(s, ["desertai"], input, "dessert recommendations only", "brain / recommendationEngine");
        return;
      }

      if (messages.at(-1) === "Alus") {
        assertAllRecommendedInCategories(s, DRINK_CATEGORIES, input, "drink recommendations only", "brain / recommendationEngine");
        return;
      }

      assertCase(lastReply.length > 0, {
        input,
        expected: "a non-empty waiter reply",
        actual: "(empty reply)",
        suspectedModule: "responseBuilder",
      });

      if (messages[0] === "Ką vaikui?") {
        assertAllRecommendedInCategories(s, ["vaikiskas"], input, "kids menu only", "brain / recommendationEngine");
        return;
      }

      assertAllRecommendedInCategories(s, FOOD_CATEGORIES, input, "food recommendations only", "brain / recommendationEngine");
      assertNoRestrictionViolations(s, input, "recommendations that respect active restrictions", "filterEngine / restrictionEngine");

      if (expectedCategory) {
        const categories = new Set(recommendedProducts(s).map((product) => product.category));
        assertCase(categories.size === 1 && categories.has(expectedCategory), {
          input,
          expected: `only ${expectedCategory} recommendations`,
          actual: [...categories].join(", "),
          suspectedModule: "memory / recommendationEngine",
        });
      }

      if (expectedProtein) {
        assertCase(s.preferredProtein === expectedProtein, {
          input,
          expected: `preferredProtein=${expectedProtein}`,
          actual: `preferredProtein=${s.preferredProtein}`,
          suspectedModule: "memory",
        });
      }
    });
  });
});

// 8. Drink pairing with concrete food context (25)
const pairingCases: Array<{ messages: string[]; nonAlcoholic?: boolean }> = [
  { messages: ["Ką atsigerti prie lašišos?"] },
  { messages: ["Kokį gėrimą prie bulvinių blynų?"] },
  { messages: ["Ką gerti prie kiaulienos šoninės?"] },
  { messages: ["Kokį alų prie BBQ šonkaulių?"] },
  { messages: ["Kokį gėrimą prie vištienos?"] },
  { messages: ["Kokį gėrimą prie picos?"] },
  { messages: ["Ką gerti prie salotų?"] },
  { messages: ["Ką gerti prie sriubos?"] },
  { messages: ["Ką gerti prie wok?"] },
  { messages: ["Rekomenduok ką nors", "O prie šito?"] },
  { messages: ["Rekomenduok ką nors", "Ką prie šito gerti?"] },
  { messages: ["Rekomenduok ką nors", "Ką prie jo gerti?"] },
  { messages: ["Rekomenduok ką nors", "Ką prie jos gerti?"] },
  { messages: ["Rekomenduok ką nors", "Ką atsigerti prie šito?"] },
  { messages: ["Rekomenduok ką nors", "O prie šito?", "Dar"] },
  { messages: ["Noriu žuvies", "O prie šito?"] },
  { messages: ["Noriu vištienos", "O prie šito?"] },
  { messages: ["Noriu picos", "O prie šito?"] },
  { messages: ["Noriu salotų", "O prie šito?"] },
  { messages: ["esu nepilnametis", "Ką atsigerti prie lašišos?"], nonAlcoholic: true },
  { messages: ["vairuoju", "Ką atsigerti prie lašišos?"], nonAlcoholic: true },
  { messages: ["be alkoholio", "Ką atsigerti prie lašišos?"], nonAlcoholic: true },
  { messages: ["halal", "Ką atsigerti prie vištienos?"], nonAlcoholic: true },
  { messages: ["esu nepilnametis", "Kokį gėrimą prie bulvinių blynų?"], nonAlcoholic: true },
  { messages: ["vairuoju", "Kokį gėrimą prie picos?"], nonAlcoholic: true },
];

describe("Stress — drink pairing flows", () => {
  pairingCases.forEach(({ messages, nonAlcoholic }) => {
    it(`pairs correctly for ${messages.join(" -> ")}`, () => {
      const { state: s, replies } = runConversation(messages);
      const input = messages.join(" -> ");
      const reply = replies.at(-1) ?? "";

      assertAllRecommendedInCategories(s, DRINK_CATEGORIES, input, "drink recommendations only", "brain / pairingEngine");
      assertNoRestrictionViolations(s, input, "pairings that respect restrictions", "pairingEngine / restrictionEngine");

      if (nonAlcoholic) {
        assertNoAlcoholRecommendations(s, input, "non-alcoholic drinks only", "pairingEngine / restrictionEngine");
        assertCase(!/\b(vynas|alus|ipa|lageris|porteris)\b/i.test(reply), {
          input,
          expected: "non-alcoholic pairing explanation without alcoholic suggestions",
          actual: reply,
          suspectedModule: "pairingEngine / responseBuilder",
        });
      }
    });
  });
});

// 9. Availability under restrictions and follow-up context (25)
const contextCases: Array<{ messages: string[]; expectNonAlcoholic?: boolean; expectFood?: boolean; expectDrink?: boolean }> = [
  { messages: ["esu nepilnametis", "turite kokteilių?"], expectNonAlcoholic: true, expectDrink: true },
  { messages: ["vairuoju", "kokius kokteilius turite?"], expectNonAlcoholic: true, expectDrink: true },
  { messages: ["be alkoholio", "turite kokteilių?"], expectNonAlcoholic: true, expectDrink: true },
  { messages: ["vegetariškai", "rekomenduok ką nors"], expectFood: true },
  { messages: ["veganiška", "rekomenduok ką nors"], expectFood: true },
  { messages: ["be kiaulienos", "rekomenduok ką nors"], expectFood: true },
  { messages: ["be glitimo", "rekomenduok ką nors"], expectFood: true },
  { messages: ["be laktozės", "rekomenduok ką nors"], expectFood: true },
  { messages: ["be grybų", "rekomenduok ką nors"], expectFood: true },
  { messages: ["be svogūnų", "rekomenduok ką nors"], expectFood: true },
  { messages: ["be pomidorų", "rekomenduok ką nors"], expectFood: true },
  { messages: ["be sūrio", "rekomenduok ką nors"], expectFood: true },
  { messages: ["vegetariškai", "desertas"], expectFood: false },
  { messages: ["veganiška", "desertas"], expectFood: false },
  { messages: ["be glitimo", "desertas"], expectFood: false },
  { messages: ["be laktozės", "desertas"], expectFood: false },
  { messages: ["rekomenduok ką nors", "dar", "pigiau"], expectFood: true },
  { messages: ["rekomenduok ką nors", "žuvis"], expectFood: true },
  { messages: ["rekomenduok ką nors", "vištiena"], expectFood: true },
  { messages: ["rekomenduok ką nors", "o prie šito?"], expectDrink: true },
  { messages: ["rekomenduok ką nors", "ką prie jo gerti?"], expectDrink: true },
  { messages: ["rekomenduok ką nors", "ką prie jos gerti?"], expectDrink: true },
  { messages: ["rekomenduok ką nors", "desertas"], expectFood: false },
];

describe("Stress — context memory and follow-ups", () => {
  contextCases.forEach(({ messages, expectNonAlcoholic, expectFood, expectDrink }) => {
    it(`keeps context through ${messages.join(" -> ")}`, () => {
      const { state: s } = runConversation(messages);
      const input = messages.join(" -> ");

      if (expectDrink) {
        assertAllRecommendedInCategories(s, DRINK_CATEGORIES, input, "drink recommendations only", "brain / pairingEngine");
      } else if (expectFood === false && messages.at(-1) === "desertas") {
        assertAllRecommendedInCategories(s, ["desertai"], input, "dessert recommendations only", "brain / recommendationEngine");
      } else if (expectFood) {
        assertAllRecommendedInCategories(s, FOOD_CATEGORIES, input, "food recommendations only", "brain / recommendationEngine");
      }

      assertNoRestrictionViolations(s, input, "context-aware recommendations with active restrictions", "memory / filterEngine / recommendationEngine");

      if (expectNonAlcoholic) {
        assertNoAlcoholRecommendations(s, input, "non-alcoholic recommendations only", "memory / recommendationEngine");
      }
    });
  });
});

// 10. Diet and restriction safety (25)
const restrictionFlowCases: Array<{ messages: string[]; expectedCategory?: Category[]; nonAlcoholic?: boolean }> = [
  { messages: ["vegetariškai"], expectedCategory: FOOD_CATEGORIES },
  { messages: ["veganiška"], expectedCategory: FOOD_CATEGORIES },
  { messages: ["be kiaulienos"], expectedCategory: FOOD_CATEGORIES },
  { messages: ["be grybų"], expectedCategory: FOOD_CATEGORIES },
  { messages: ["be svogūnų"], expectedCategory: FOOD_CATEGORIES },
  { messages: ["be pomidorų"], expectedCategory: FOOD_CATEGORIES },
  { messages: ["be sūrio"], expectedCategory: FOOD_CATEGORIES },
  { messages: ["be žuvies"], expectedCategory: FOOD_CATEGORIES },
  { messages: ["be glitimo"], expectedCategory: FOOD_CATEGORIES },
  { messages: ["be laktozės"], expectedCategory: FOOD_CATEGORIES },
  { messages: ["alergija riešutams", "rekomenduok ką nors"], expectedCategory: FOOD_CATEGORIES },
  { messages: ["netoleruoju pieno", "rekomenduok ką nors"], expectedCategory: FOOD_CATEGORIES },
  { messages: ["halal", "rekomenduok ką nors"], expectedCategory: FOOD_CATEGORIES, nonAlcoholic: true },
  { messages: ["kosher", "rekomenduok ką nors"], expectedCategory: FOOD_CATEGORIES },
  { messages: ["esu nepilnametis", "turite vyno?"], nonAlcoholic: true },
  { messages: ["vairuoju", "turite alaus?"], nonAlcoholic: true },
  { messages: ["be alkoholio", "turite kokteilių?"], expectedCategory: DRINK_CATEGORIES, nonAlcoholic: true },
  { messages: ["vegetariškai", "dar"], expectedCategory: FOOD_CATEGORIES },
  { messages: ["veganiška", "dar"], expectedCategory: FOOD_CATEGORIES },
  { messages: ["be kiaulienos", "dar"], expectedCategory: FOOD_CATEGORIES },
  { messages: ["be glitimo", "dar"], expectedCategory: FOOD_CATEGORIES },
  { messages: ["be laktozės", "dar"], expectedCategory: FOOD_CATEGORIES },
  { messages: ["halal", "ką atsigerti prie vištienos?"], expectedCategory: DRINK_CATEGORIES, nonAlcoholic: true },
  { messages: ["esu nepilnametis", "ką atsigerti prie lašišos?"], expectedCategory: DRINK_CATEGORIES, nonAlcoholic: true },
  { messages: ["vairuoju", "o prie šito?", "rekomenduok ką nors"], expectedCategory: FOOD_CATEGORIES, nonAlcoholic: true },
];

describe("Stress — restriction safety", () => {
  restrictionFlowCases.forEach(({ messages, expectedCategory, nonAlcoholic }) => {
    it(`respects restrictions in flow ${messages.join(" -> ")}`, () => {
      const { state: s } = runConversation(messages);
      const input = messages.join(" -> ");

      if (expectedCategory) {
        assertAllRecommendedInCategories(s, expectedCategory, input, `categories inside ${expectedCategory.join(", ")}`, "filterEngine / recommendationEngine");
      }
      assertNoRestrictionViolations(s, input, "no products violating active restrictions", "restrictionEngine / filterEngine");
      if (nonAlcoholic) {
        assertNoAlcoholRecommendations(s, input, "non-alcoholic options only", "restrictionEngine / pairingEngine / recommendationEngine");
      }
    });
  });
});

// 11. Budget and mood handling (25)
const budgetMoodCases: Array<{ messages: string[]; maxPrice?: number; expectedFlag?: keyof ConversationState; expectedCategory?: Category[] }> = [
  { messages: ["Pigiau"], maxPrice: 12 },
  { messages: ["Rekomenduok ką nors", "Pigiau"], maxPrice: 12 },
  { messages: ["Biudžetas 15"], maxPrice: 15 },
  { messages: ["Iki 10 eurų"], maxPrice: 10 },
  { messages: ["Iki 20€"], maxPrice: 20 },
  { messages: ["Sočiai"], expectedFlag: "wantsFillingFood", expectedCategory: FOOD_CATEGORIES },
  { messages: ["Lengvai"], expectedFlag: "wantsLightFood", expectedCategory: FOOD_CATEGORIES },
  { messages: ["Ką nors aštraus"], expectedFlag: "wantsSpicyFood", expectedCategory: FOOD_CATEGORIES },
  { messages: ["Aštraus kažko"], expectedFlag: "wantsSpicyFood", expectedCategory: FOOD_CATEGORIES },
  { messages: ["Rekomenduok ką nors", "Sočiai"], expectedFlag: "wantsFillingFood", expectedCategory: FOOD_CATEGORIES },
  { messages: ["Rekomenduok ką nors", "Lengvai"], expectedFlag: "wantsLightFood", expectedCategory: FOOD_CATEGORIES },
  { messages: ["Rekomenduok ką nors", "Aštriai"], expectedFlag: "wantsSpicyFood", expectedCategory: FOOD_CATEGORIES },
  { messages: ["Rekomenduok ką nors", "Pigiau"], maxPrice: 12 },
  { messages: ["Turiu iki 18"], maxPrice: 18 },
  { messages: ["Biudžetas 14", "Dar"], maxPrice: 14 },
  { messages: ["Biudžetas 14", "Žuvis"], maxPrice: 14 },
  { messages: ["Biudžetas 14", "Vištiena"], maxPrice: 14 },
  { messages: ["Biudžetas 14", "Desertas"], maxPrice: 14 },
  { messages: ["Biudžetas 14", "Alus"], maxPrice: 14 },
  { messages: ["Brangiau"], expectedCategory: FOOD_CATEGORIES },
  { messages: ["Premium"], expectedCategory: FOOD_CATEGORIES },
  { messages: ["Ką nors lengvo"], expectedFlag: "wantsLightFood", expectedCategory: FOOD_CATEGORIES },
  { messages: ["Ką nors sotaus"], expectedFlag: "wantsFillingFood", expectedCategory: FOOD_CATEGORIES },
  { messages: ["Ką nors aštraus", "Dar"], expectedFlag: "wantsSpicyFood", expectedCategory: FOOD_CATEGORIES },
  { messages: ["Pigiau", "Dar"], maxPrice: 12 },
];

describe("Stress — budget and mood", () => {
  budgetMoodCases.forEach(({ messages, maxPrice, expectedFlag, expectedCategory }) => {
    it(`handles budget/mood flow ${messages.join(" -> ")}`, () => {
      const { state: s } = runConversation(messages);
      const input = messages.join(" -> ");

      if (expectedCategory) {
        const lastMessage = messages.at(-1);
        if (lastMessage === "Desertas") {
          assertAllRecommendedInCategories(s, ["desertai"], input, "dessert recommendations only", "recommendationEngine");
        } else if (lastMessage === "Alus") {
          assertAllRecommendedInCategories(s, DRINK_CATEGORIES, input, "drink recommendations only", "recommendationEngine");
        } else {
          assertAllRecommendedInCategories(s, expectedCategory, input, "food recommendations only", "recommendationEngine");
        }
      }

      if (maxPrice != null) {
        const tooExpensive = recommendedProducts(s).filter((product) => product.price > 0 && product.price > maxPrice);
        assertCase(tooExpensive.length === 0, {
          input,
          expected: `all recommended products at or under ${maxPrice} €`,
          actual: productSummary(tooExpensive),
          suspectedModule: "memory / filterEngine / recommendationEngine",
        });
      }

      if (expectedFlag) {
        assertCase(Boolean(s[expectedFlag]), {
          input,
          expected: `${expectedFlag}=true`,
          actual: JSON.stringify({
            wantsFillingFood: s.wantsFillingFood,
            wantsLightFood: s.wantsLightFood,
            wantsSpicyFood: s.wantsSpicyFood,
          }),
          suspectedModule: "memory",
        });
      }
    });
  });
});

// 12. No-alcohol stress matrix (25)
const noAlcoholCases: Array<{ messages: string[]; expectSilenceAboutAlcohol?: boolean }> = [
  { messages: ["esu nepilnametis", "turite kokteilių?"], expectSilenceAboutAlcohol: false },
  { messages: ["esu nepilnametis", "turite alaus?"], expectSilenceAboutAlcohol: false },
  { messages: ["esu nepilnametis", "turite vyno?"], expectSilenceAboutAlcohol: false },
  { messages: ["esu nepilnametis", "turite IPA?"], expectSilenceAboutAlcohol: false },
  { messages: ["esu nepilnametis", "ką atsigerti prie lašišos?"], expectSilenceAboutAlcohol: true },
  { messages: ["esu nepilnametis", "kokį gėrimą prie bulvinių blynų?"], expectSilenceAboutAlcohol: true },
  { messages: ["vairuoju", "turite kokteilių?"], expectSilenceAboutAlcohol: false },
  { messages: ["vairuoju", "turite alaus?"], expectSilenceAboutAlcohol: false },
  { messages: ["vairuoju", "turite vyno?"], expectSilenceAboutAlcohol: false },
  { messages: ["vairuoju", "turite IPA?"], expectSilenceAboutAlcohol: false },
  { messages: ["vairuoju", "ką atsigerti prie lašišos?"], expectSilenceAboutAlcohol: true },
  { messages: ["vairuoju", "kokį gėrimą prie bulvinių blynų?"], expectSilenceAboutAlcohol: true },
  { messages: ["be alkoholio", "turite kokteilių?"], expectSilenceAboutAlcohol: false },
  { messages: ["be alkoholio", "turite alaus?"], expectSilenceAboutAlcohol: false },
  { messages: ["be alkoholio", "turite vyno?"], expectSilenceAboutAlcohol: false },
  { messages: ["be alkoholio", "turite IPA?"], expectSilenceAboutAlcohol: false },
  { messages: ["be alkoholio", "ką atsigerti prie lašišos?"], expectSilenceAboutAlcohol: true },
  { messages: ["be alkoholio", "kokį gėrimą prie bulvinių blynų?"], expectSilenceAboutAlcohol: true },
  { messages: ["halal", "turite kokteilių?"], expectSilenceAboutAlcohol: false },
  { messages: ["halal", "turite alaus?"], expectSilenceAboutAlcohol: false },
  { messages: ["halal", "turite vyno?"], expectSilenceAboutAlcohol: false },
  { messages: ["halal", "turite IPA?"], expectSilenceAboutAlcohol: false },
  { messages: ["halal", "ką atsigerti prie vištienos?"], expectSilenceAboutAlcohol: true },
  { messages: ["halal", "kokį gėrimą prie picos?"], expectSilenceAboutAlcohol: true },
  { messages: ["esu nepilnametis", "o prie šito?", "rekomenduok ką nors"], expectSilenceAboutAlcohol: false },
];

describe("Stress — no-alcohol matrix", () => {
  noAlcoholCases.forEach(({ messages, expectSilenceAboutAlcohol }) => {
    it(`never leaks alcohol in ${messages.join(" -> ")}`, () => {
      const { state: s, replies } = runConversation(messages);
      const input = messages.join(" -> ");
      const reply = replies.at(-1) ?? "";

      if (recommendedProducts(s).length > 0) {
        assertNoAlcoholRecommendations(s, input, "non-alcoholic options only", "restrictionEngine / recommendationEngine / pairingEngine");
      }

      if (expectSilenceAboutAlcohol) {
        assertCase(!/\b(vynas|alus|ipa|lageris|porteris)\b/i.test(reply), {
          input,
          expected: "reply text without alcoholic suggestions",
          actual: reply,
          suspectedModule: "pairingEngine / responseBuilder",
        });
      }
    });
  });
});
