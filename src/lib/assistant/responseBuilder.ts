/**
 * Response builder — converts recommendation results and intent context
 * into natural-sounding waiter responses.
 *
 * Rules:
 * - Never say "I'm here to help" or "Great question"
 * - Short, confident, friendly
 * - Variety: multiple template options per intent, randomly selected
 * - Supports LT / EN / RU
 */

import type { Product } from "../data.ts";
import type { Intent, ConversationState, PairingResult, RecommendationResult } from "./types.ts";
import { findById } from "./menuSearch.ts";

// ── Formatting ────────────────────────────────────────────────────────────────

export function fmtProduct(p: Product): string {
  const price = p.price > 0 ? ` — **${p.price.toFixed(2)} €**` : "";
  return `• **${p.name}**${price}`;
}

export function fmtList(products: Product[]): string {
  return products.map(fmtProduct).join("\n");
}

function one<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function t(lang: string, texts: Record<string, string>): string {
  return texts[lang] ?? texts.lt;
}

// ── Response templates ─────────────────────────────────────────────────────────

/** Food recommendations */
function foodRecommendationResponse(
  result: RecommendationResult,
  state: ConversationState
): string {
  const { products, poolExhausted } = result;
  const lang = state.currentLanguage;

  if (!products.length) {
    return t(lang, {
      lt: "Pagal jūsų pageidavimus šiuo metu neturiu tinkamų patiekalų. Gal pakeistumėte filtrą?",
      en: "I couldn't find dishes matching your preferences. Could you adjust the filters?",
      ru: "По вашим предпочтениям не нашлось подходящих блюд. Может, изменим фильтры?",
    });
  }

  const intros = {
    lt: [
      "Šiandien rekomenduočiau:",
      "Iš mūsų meniu siūlau:",
      "Puikiausiai tiktų:",
      "Pagal jūsų pageidavimus siūlau:",
    ],
    en: [
      "Today I'd recommend:",
      "From our menu, I suggest:",
      "These would be perfect:",
      "Based on your preferences:",
    ],
    ru: [
      "Сегодня порекомендую:",
      "Из нашего меню предлагаю:",
      "Отлично подойдёт:",
      "По вашим предпочтениям:",
    ],
  };

  const intro = one(intros[lang as keyof typeof intros] ?? intros.lt);
  const list = fmtList(products);
  const suffix = poolExhausted
    ? t(lang, {
        lt: "\n\nПерегледіл усе — починаємо спочатку 😊",
        en: "\n\nThat's all from this selection — cycling back!",
        ru: "\n\nПоказал все варианты — начинаем сначала!",
      })
    : "";

  const followUp = buildFollowUp(state, lang);

  return `${intro}\n${list}${suffix}${followUp}`;
}

/** Called when user asks for different/more */
function changeResponse(
  result: RecommendationResult,
  state: ConversationState
): string {
  const { products, poolExhausted } = result;
  const lang = state.currentLanguage;

  if (!products.length) {
    return t(lang, {
      lt: "Daugiau tinkamų variantų šiuo metu neturiu. Gal išbandykite kitą kategoriją?",
      en: "No more matching options right now. Try a different category?",
      ru: "Больше подходящих вариантов нет. Попробуем другую категорию?",
    });
  }

  if (poolExhausted) {
    return t(lang, {
      lt: "Parodžiau viską — pradedu iš naujo:\n",
      en: "I've shown you everything — restarting:\n",
      ru: "Показал всё — начинаю сначала:\n",
    }) + fmtList(products);
  }

  const intros = {
    lt: ["Taip pat siūlau:", "Gal patiktų:", "Kitas variantas —", "Štai dar:"],
    en: ["How about:", "Also available:", "Another option —", "Here's more:"],
    ru: ["Как насчёт:", "Ещё варианты:", "Другой вариант —", "Вот ещё:"],
  };

  const intro = one(intros[lang as keyof typeof intros] ?? intros.lt);
  return `${intro}\n${fmtList(products)}`;
}

/** Drink / beer / wine / cocktail response */
function drinkResponse(
  result: RecommendationResult,
  state: ConversationState,
  pairing?: PairingResult
): string {
  const { products } = result;
  const lang = state.currentLanguage;

  if (pairing?.explanation) {
    const drinkList = pairing.drinks.length > 0 ? `\n${fmtList(pairing.drinks)}` : "";
    return `${pairing.explanation}${drinkList}`;
  }

  if (!products.length) {
    return t(lang, {
      lt: "Šiuo metu šios rūšies gėrimų neturime. Pabandykite ką nors kita?",
      en: "We don't have that type of drink right now. Try something else?",
      ru: "Этого напитка сейчас нет. Попробуем другое?",
    });
  }

  const intros = {
    lt: ["Mūsų gėrimų pasirinkimas:", "Siūlau:", "Gerti galėtumėte:"],
    en: ["Our drinks:", "I suggest:", "To drink, we have:"],
    ru: ["Наши напитки:", "Предлагаю:", "Из напитков:"],
  };

  return `${one(intros[lang as keyof typeof intros] ?? intros.lt)}\n${fmtList(products)}`;
}

/** Beer recommendation — show all beers with tasting note */
function beerResponse(
  result: RecommendationResult,
  state: ConversationState
): string {
  const { products } = result;
  const lang = state.currentLanguage;

  const intro = t(lang, {
    lt: "Turime 6 savo daryklos alų. Populiariausi:",
    en: "We brew 6 craft beers in-house. Most popular:",
    ru: "Варим 6 сортов крафта. Самые популярные:",
  });

  const tail = t(lang, {
    lt: "\n\nNori paragauti visų? **Alaus degustacija** (14,00 €) — 6 taurelės vienu šūviu.",
    en: "\n\nWant to try them all? **Beer tasting** (€14.00) — 6 glasses in one go.",
    ru: "\n\nХотите попробовать все? **Дегустация пива** (14,00 €) — 6 бокалов сразу.",
  });

  return `${intro}\n${fmtList(products)}${tail}`;
}

/** Dessert response */
function dessertResponse(
  result: RecommendationResult,
  state: ConversationState
): string {
  const { products } = result;
  const lang = state.currentLanguage;

  const intro = t(lang, {
    lt: "Desertams siūlau:",
    en: "For dessert:",
    ru: "На десерт:",
  });

  const tail = t(lang, {
    lt: "\n\nPrie deserto rekomenduočiau espresso arba šiltą arbatą.",
    en: "\n\nWith dessert, I'd suggest an espresso or warm tea.",
    ru: "\n\nК десерту — эспрессо или тёплый чай.",
  });

  return `${intro}\n${fmtList(products)}${tail}`;
}

/** Pairing response (user asked "o prie šito?") */
function pairingResponse(pairing: PairingResult, state: ConversationState): string {
  const lang = state.currentLanguage;
  const drinkList = pairing.drinks.length > 0 ? `\n${fmtList(pairing.drinks)}` : "";
  return `${pairing.explanation}${drinkList}`;
}

/** Vegetarian / vegan response */
function dietResponse(
  result: RecommendationResult,
  state: ConversationState
): string {
  const lang = state.currentLanguage;
  const { products } = result;

  const intro = state.vegan
    ? t(lang, {
        lt: "Veganų patiekalai:",
        en: "Vegan options:",
        ru: "Веганские блюда:",
      })
    : t(lang, {
        lt: "Vegetariški patiekalai:",
        en: "Vegetarian options:",
        ru: "Вегетарианские блюда:",
      });

  if (!products.length) {
    return t(lang, {
      lt: "Pagal jūsų dietą šiuo metu neturiu specifinių patiekalų. Pabandykite salotas ar sriubas.",
      en: "I don't have specific dishes for your diet right now. Try salads or soups.",
      ru: "По вашей диете сейчас нет подходящего. Попробуйте салаты или супы.",
    });
  }

  return `${intro}\n${fmtList(products)}`;
}

/** Cheap food response */
function cheapResponse(
  result: RecommendationResult,
  state: ConversationState
): string {
  const lang = state.currentLanguage;
  const budget = state.budget;
  const { products } = result;

  if (!products.length) {
    return t(lang, {
      lt: `Iki ${budget ? budget + " €" : "tokios sumos"} meniu šiuo metu yra ribotai. Gal keisti filtrą?`,
      en: `Not much available under ${budget ? "€" + budget : "that amount"} right now. Adjust the filter?`,
      ru: `До ${budget ? budget + " €" : "такой суммы"} сейчас мало вариантов. Изменим фильтр?`,
    });
  }

  const intro = budget
    ? t(lang, { lt: `Iki **${budget} €**:`, en: `Under **€${budget}**:`, ru: `До **${budget} €**:` })
    : t(lang, { lt: "Ekonomiškai:", en: "Budget options:", ru: "Бюджетные варианты:" });

  return `${intro}\n${fmtList(products)}`;
}

/** Kids menu response */
function kidsResponse(
  result: RecommendationResult,
  state: ConversationState
): string {
  const lang = state.currentLanguage;
  const { products } = result;

  if (!products.length) {
    return t(lang, {
      lt: "Vaikų meniu šiuo metu peržiūrime — paklauskite padavėjo.",
      en: "Our kids menu is being updated — please ask the waiter.",
      ru: "Детское меню обновляется — спросите у официанта.",
    });
  }

  const intro = t(lang, {
    lt: "Vaikų meniu:",
    en: "Kids menu:",
    ru: "Детское меню:",
  });

  return `${intro}\n${fmtList(products)}`;
}

/** Ingredient / allergen info for a specific product */
function ingredientResponse(product: Product, state: ConversationState): string {
  const lang = state.currentLanguage;
  const alg = product.allergens.length
    ? product.allergens.join(", ")
    : t(lang, { lt: "nėra žinomų alergenų", en: "no known allergens", ru: "нет известных аллергенов" });

  const ingLabel = t(lang, { lt: "Sudėtis", en: "Ingredients", ru: "Состав" });
  const algLabel = t(lang, { lt: "Alergenai", en: "Allergens", ru: "Аллергены" });

  return `**${product.name}**\n${ingLabel}: ${product.ingredients.join(", ")}\n${algLabel}: ${alg}`;
}

/** Ask which dish when ingredient question but no dish context */
function askForDishResponse(state: ConversationState): string {
  const lang = state.currentLanguage;
  return t(lang, {
    lt: "Kurį patiekalą norėtumėte patikrinti? Pasakykite pavadinimą.",
    en: "Which dish would you like to check? Tell me the name.",
    ru: "Какое блюдо хотите проверить? Назовите название.",
  });
}

/** Restaurant info */
function restaurantInfoResponse(state: ConversationState, infoText: string): string {
  return infoText;
}

/** Positive confirmation — user agreed to a suggestion */
function confirmationResponse(state: ConversationState): string {
  const lang = state.currentLanguage;
  const dish = state.lastRecommendedIds[0]
    ? findById(state.lastRecommendedIds[0])?.name
    : null;

  const responses = {
    lt: dish
      ? [`Puikus pasirinkimas — **${dish}**! Ar norėtumėte ko nors gerti prie to?`, `Pridedu **${dish}** į krepšelį. Ar reikia dar ko nors?`]
      : ["Puiku! Ar reikia ko nors dar?"],
    en: dish
      ? [`Great choice — **${dish}**! Would you like something to drink with that?`, `Added **${dish}**. Anything else?`]
      : ["Perfect! Anything else?"],
    ru: dish
      ? [`Отличный выбор — **${dish}**! Что-нибудь выпьете?`, `Добавил **${dish}**. Что-нибудь ещё?`]
      : ["Отлично! Что-нибудь ещё?"],
  };

  return one(responses[lang as keyof typeof responses] ?? responses.lt);
}

/** Negative answer — offer alternatives */
function negativeResponse(state: ConversationState): string {
  const lang = state.currentLanguage;
  return t(lang, {
    lt: "Supratau! Parodysiu kitus variantus.",
    en: "Got it! Let me show you other options.",
    ru: "Понял! Покажу другие варианты.",
  });
}

/** Unknown intent — ask a single clarifying question */
function unknownResponse(state: ConversationState): string {
  const lang = state.currentLanguage;
  const questions = {
    lt: [
      "Ką norėtumėte šiandien — mėsos patiekalą, žuvį, picą ar gal ką nors gerti?",
      "Papasakokite — sočiai pavalgyti ar lengviau?",
      "Ar ieškote pagrindinio patiekalo, užkandžio ar gėrimo?",
    ],
    en: [
      "What are you in the mood for — meat, fish, pizza, or something to drink?",
      "Hungry for something hearty, or prefer something lighter?",
      "Looking for a main course, a starter, or a drink?",
    ],
    ru: [
      "Что хотите сегодня — мясное, рыбу, пиццу или что-нибудь выпить?",
      "Хочется сытного или полегче?",
      "Ищете основное блюдо, закуску или напиток?",
    ],
  };
  return one(questions[lang as keyof typeof questions] ?? questions.lt);
}

/** Build optional follow-up prompt at end of food response */
function buildFollowUp(state: ConversationState, lang: string): string {
  // Only add follow-up if not already in drink context
  if (state.preferredDrink || state.lastFoodDishId) return "";

  const followUps = {
    lt: ["\n\nAr norėtumėte ko nors gerti prie to?", ""],
    en: ["\n\nWould you like something to drink with that?", ""],
    ru: ["\n\nЧто-нибудь выпьете?", ""],
  };

  // ~40% chance to add follow-up
  if (Math.random() < 0.4) {
    const arr = followUps[lang as keyof typeof followUps] ?? followUps.lt;
    return arr[0];
  }
  return "";
}

// ── Main entry point ──────────────────────────────────────────────────────────

export interface BuildContext {
  intent: Intent;
  result?: RecommendationResult;
  pairing?: PairingResult;
  infoText?: string;
  specificProduct?: Product;
}

export function buildResponse(
  ctx: BuildContext,
  state: ConversationState
): string {
  const { intent, result, pairing, infoText, specificProduct } = ctx;

  switch (intent) {
    case "food_recommendation":
    case "menu_category":
    case "popular_dishes":
      return foodRecommendationResponse(result!, state);

    case "change_recommendation":
      return changeResponse(result!, state);

    case "drink_recommendation":
      return drinkResponse(result!, state, pairing);

    case "beer_recommendation":
      return beerResponse(result!, state);

    case "wine_recommendation":
    case "cocktail_recommendation":
      return drinkResponse(result!, state, pairing);

    case "dessert_recommendation":
      return dessertResponse(result!, state);

    case "pairing_request":
      return pairing ? pairingResponse(pairing, state) : drinkResponse(result!, state);

    case "vegetarian":
    case "vegan":
      return dietResponse(result!, state);

    case "cheap_food":
    case "expensive_food":
      return cheapResponse(result!, state);

    case "kids_menu":
      return kidsResponse(result!, state);

    case "ingredient_question":
    case "allergy_question":
      return specificProduct
        ? ingredientResponse(specificProduct, state)
        : askForDishResponse(state);

    case "restaurant_info":
    case "opening_hours":
      return restaurantInfoResponse(state, infoText ?? "");

    case "confirmation":
    case "positive_answer":
      return confirmationResponse(state);

    case "negative_answer":
      return negativeResponse(state);

    case "unknown":
    default:
      return unknownResponse(state);
  }
}
