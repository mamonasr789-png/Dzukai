import "server-only";

import type { SupportedLanguage } from "../schemas.ts";

export interface VoiceContext {
  language: SupportedLanguage;
  sessionId: string;
  turn: number;
  casual: boolean;
  informal: boolean;
  hour: number;
}

type Pool = readonly string[];
type LangPools = Record<SupportedLanguage, Pool>;

function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * FNV low bits stay linear in the input, so two hashes over related strings
 * cancel each other under a small modulus. Avalanche before taking one.
 */
function mix(value: number): number {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Derives a per-turn seed so phrasing rotates without a stored turn counter. */
export function turnSeed(message: string, marker: string | null): number {
  return hash(`${message}|${marker ?? ""}`);
}

/** Rotating by turn so the same slot never repeats on consecutive replies. */
function pick(pools: LangPools, ctx: VoiceContext, slot: string): string {
  const pool = pools[ctx.language];
  const index = mix(hash(`${ctx.sessionId}:${slot}:${ctx.turn}`));
  return pool[index % pool.length];
}

function chance(ctx: VoiceContext, slot: string, percent: number): boolean {
  return mix(hash(`${ctx.sessionId}:${slot}:${ctx.turn}:c`)) % 100 < percent;
}

const LT_DIACRITICS = /[ąčęėįšųūž]/i;
const LT_WORDS_NEEDING_DIACRITICS =
  /\b(aciu|prasau|noreciau|noriu|kiek|kainuoja|patiekal|gerimu|salot|desert|uzsakym|krepsel|padavej|saskait)/i;

export function detectCasual(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  const missingDiacritics =
    LT_WORDS_NEEDING_DIACRITICS.test(trimmed) && !LT_DIACRITICS.test(trimmed);
  const noSentenceCase = trimmed === trimmed.toLowerCase() && trimmed.length > 8;
  return missingDiacritics || noSentenceCase;
}

export function detectInformal(message: string, language: SupportedLanguage): boolean {
  if (language === "en") return false;
  if (language === "ru") {
    return /(?:^|[^\p{L}])(ты|тебе|тебя|твой|твоя|можешь|посоветуй|дай|принеси)(?![\p{L}])/iu.test(
      message
    );
  }
  return /\b(tu|tau|tave|tavo|gali|galetum|rekomenduoji|rekomenduotum|duok|atnesk|turi|zinai|žinai|galėtum|rekomenduotum)\b/iu.test(
    message
  );
}

export function buildVoiceContext(command: {
  language: SupportedLanguage;
  sessionId: string;
  turn: number;
  message: string;
  now?: Date;
}): VoiceContext {
  const now = command.now ?? new Date();
  return {
    language: command.language,
    sessionId: command.sessionId,
    turn: command.turn,
    casual: detectCasual(command.message),
    informal: detectInformal(command.message, command.language),
    hour: now.getHours(),
  };
}

// ── Address forms ─────────────────────────────────────────────────────────────

/** Second-person verb forms differ by address; every template picks through this. */
function you(
  ctx: VoiceContext,
  forms: { formal: string; informal: string }
): string {
  return ctx.informal ? forms.informal : forms.formal;
}

export function wantVerb(ctx: VoiceContext): string {
  if (ctx.language === "lt") return you(ctx, { formal: "norite", informal: "nori" });
  if (ctx.language === "ru") return you(ctx, { formal: "хотите", informal: "хочешь" });
  return "you want";
}

export function meanVerb(ctx: VoiceContext): string {
  if (ctx.language === "lt") return you(ctx, { formal: "turite", informal: "turi" });
  if (ctx.language === "ru") return you(ctx, { formal: "имеете", informal: "имеешь" });
  return "you mean";
}

// ── Greetings ─────────────────────────────────────────────────────────────────

function timeGreeting(ctx: VoiceContext): string {
  const morning = ctx.hour < 11;
  const evening = ctx.hour >= 17;
  if (ctx.language === "lt") {
    if (morning) return "Labas rytas";
    if (evening) return "Labas vakaras";
    return "Laba diena";
  }
  if (ctx.language === "ru") {
    if (morning) return "Доброе утро";
    if (evening) return "Добрый вечер";
    return "Добрый день";
  }
  if (morning) return "Good morning";
  if (evening) return "Good evening";
  return "Good afternoon";
}

const greetingTails: LangPools = {
  lt: [
    "Ko šiandien norėtųsi?",
    "Kuo galiu padėti?",
    "Ką šiandien renkamės?",
    "Nuo ko pradedam?",
  ],
  en: [
    "What are you in the mood for?",
    "What can I get you?",
    "Where shall we start?",
    "Anything catching your eye?",
  ],
  ru: [
    "Что бы хотелось сегодня?",
    "Чем могу помочь?",
    "С чего начнём?",
    "Что вам подсказать?",
  ],
};

export function greeting(ctx: VoiceContext): string {
  return `${timeGreeting(ctx)}! ${pick(greetingTails, ctx, "greeting")}`;
}

// ── Cart actions ──────────────────────────────────────────────────────────────

const addedPools: LangPools = {
  lt: [
    "Įdėjau „{name}“.",
    "Gerai — „{name}“ jau krepšelyje.",
    "„{name}“ pridėta.",
    "Puikus pasirinkimas. Įdėjau „{name}“.",
    "Padaryta, „{name}“ krepšelyje.",
  ],
  en: [
    "Added “{name}”.",
    "Done — “{name}” is in your cart.",
    "“{name}” it is.",
    "Good choice. “{name}” is in.",
    "That's “{name}” added.",
  ],
  ru: [
    "Добавил «{name}».",
    "Готово — «{name}» уже в корзине.",
    "«{name}» добавлено.",
    "Отличный выбор. «{name}» добавил.",
    "Сделано, «{name}» в корзине.",
  ],
};

const updatedPools: LangPools = {
  lt: ["Pakeičiau „{name}“ kiekį.", "Atnaujinau „{name}“.", "Gerai, „{name}“ pataisiau."],
  en: ["Updated “{name}”.", "Changed the quantity for “{name}”.", "Done — “{name}” adjusted."],
  ru: ["Обновил «{name}».", "Изменил количество «{name}».", "Готово — «{name}» поправил."],
};

const removedPools: LangPools = {
  lt: ["Išėmiau „{name}“.", "„{name}“ pašalinau.", "Gerai, „{name}“ nebeliko."],
  en: ["Removed “{name}”.", "Took “{name}” out.", "Done — “{name}” is off the list."],
  ru: ["Убрал «{name}».", "«{name}» удалил.", "Готово — «{name}» больше нет."],
};

const clearedPools: LangPools = {
  lt: ["Krepšelį ištuštinau.", "Viską išėmiau — pradedam iš naujo.", "Krepšelis tuščias."],
  en: ["Cleared the cart.", "All taken out — fresh start.", "Your cart is empty now."],
  ru: ["Корзину очистил.", "Всё убрал — начнём заново.", "Корзина пуста."],
};

const followUps: LangPools = {
  lt: ["Dar ko nors?", "Prie to ko nors gerti?", "Kažko dar?", "Ką dar pridedam?"],
  en: ["Anything else?", "Something to drink with that?", "Shall I add anything else?"],
  ru: ["Что-нибудь ещё?", "Напиток к этому?", "Добавим что-то ещё?"],
};

function withFollowUp(base: string, ctx: VoiceContext, slot: string): string {
  if (!chance(ctx, slot, 55)) return base;
  return `${base} ${pick(followUps, ctx, `${slot}-tail`)}`;
}

export function cartAdded(name: string, ctx: VoiceContext): string {
  return withFollowUp(
    pick(addedPools, ctx, "added").replace("{name}", name),
    ctx,
    "added"
  );
}

const addedGenericPools: LangPools = {
  lt: ["Įdėjau į krepšelį.", "Gerai, jau krepšelyje.", "Padaryta."],
  en: ["Added to your cart.", "Done, it's in the cart.", "That's in."],
  ru: ["Добавил в корзину.", "Готово, уже в корзине.", "Сделано."],
};

export function cartAddedGeneric(ctx: VoiceContext): string {
  return withFollowUp(pick(addedGenericPools, ctx, "added-generic"), ctx, "added-generic");
}

export function cartUpdated(name: string, ctx: VoiceContext): string {
  return pick(updatedPools, ctx, "updated").replace("{name}", name);
}

export function cartRemoved(name: string, ctx: VoiceContext): string {
  return pick(removedPools, ctx, "removed").replace("{name}", name);
}

export function cartCleared(ctx: VoiceContext): string {
  return pick(clearedPools, ctx, "cleared");
}

const cartShownPools: LangPools = {
  lt: ["Štai kas kol kas krepšelyje:", "Šiuo metu turite:", "Kol kas surinkta:"],
  en: ["Here's what's in your cart:", "So far you have:", "Currently in the cart:"],
  ru: ["Вот что сейчас в корзине:", "Пока у вас:", "На данный момент собрано:"],
};

export function cartShown(ctx: VoiceContext): string {
  return pick(cartShownPools, ctx, "cart-shown");
}

const cartEmptyPools: LangPools = {
  lt: ["Krepšelis kol kas tuščias. Nuo ko pradedam?", "Kol kas nieko nepasirinkta — gal ką pasiūlyti?"],
  en: ["Your cart is empty so far. Where shall we start?", "Nothing chosen yet — shall I suggest something?"],
  ru: ["Корзина пока пуста. С чего начнём?", "Пока ничего не выбрано — предложить что-нибудь?"],
};

export function cartEmpty(ctx: VoiceContext): string {
  return pick(cartEmptyPools, ctx, "cart-empty");
}

// ── Staff requests ────────────────────────────────────────────────────────────

const waiterCalledPools: LangPools = {
  lt: [
    "Jau kviečiu — tuoj kas nors prieis.",
    "Perdaviau, kolega netrukus bus prie jūsų staliuko.",
    "Padavėją pakviečiau, palaukite akimirką.",
  ],
  en: [
    "Calling someone over now — they'll be with you shortly.",
    "Passed it on, a colleague will come by in a moment.",
    "A waiter is on the way.",
  ],
  ru: [
    "Уже зову — подойдут через минутку.",
    "Передал, коллега скоро подойдёт к вашему столику.",
    "Официанта позвал, подождите немного.",
  ],
};

const billRequestedPools: LangPools = {
  lt: [
    "Sąskaitą paruošiu — tuoj atnešime.",
    "Perdaviau dėl sąskaitos, netrukus bus.",
    "Gerai, sąskaita jau ruošiama.",
  ],
  en: [
    "I'll get the bill sorted — it'll be right over.",
    "Passed on the bill request, it won't be long.",
    "Right, the bill is being prepared.",
  ],
  ru: [
    "Счёт подготовлю — сейчас принесём.",
    "Передал насчёт счёта, скоро будет.",
    "Хорошо, счёт уже готовится.",
  ],
};

export function waiterCalled(ctx: VoiceContext): string {
  return pick(waiterCalledPools, ctx, "waiter");
}

export function billRequested(ctx: VoiceContext): string {
  return pick(billRequestedPools, ctx, "bill");
}

const staffOfferPools: LangPools = {
  lt: ["Norite, kad pakviesčiau padavėją?", "Gal pakviesti kolegą, kad patikslintų?"],
  en: ["Shall I call a waiter over?", "Want me to get a colleague to check?"],
  ru: ["Позвать официанта?", "Хотите, позову коллегу уточнить?"],
};

export function staffOffer(ctx: VoiceContext): string {
  return pick(staffOfferPools, ctx, "staff-offer");
}

// ── Clarifications ────────────────────────────────────────────────────────────

const whichItemPools: LangPools = {
  lt: ["Kurį būtent turite omenyje?", "Kurio patiekalo — pasakykite pavadinimą?", "Atsiprašau, kurį iš jų?"],
  en: ["Which one exactly?", "Which dish do you mean?", "Sorry — which of them?"],
  ru: ["Какое именно?", "Какое блюдо вы имеете в виду?", "Извините, какое из них?"],
};

const whichVariantPools: LangPools = {
  lt: ["Kokio dydžio norėtumėte?", "Kurį variantą renkamės?"],
  en: ["Which size would you like?", "Which option shall we go with?"],
  ru: ["Какой размер желаете?", "Какой вариант выберем?"],
};

const noMatchPools: LangPools = {
  lt: [
    "Tokio dalyko meniu nerandu. Gal pasiūlyti kažką panašaus?",
    "Šito neturime. Papasakokite, ko norėtųsi — ką nors parinksiu.",
    "Pagal tai nieko tinkamo nerandu. Gal palengvinam kriterijus?",
  ],
  en: [
    "I can't find that on the menu. Shall I suggest something similar?",
    "We don't have that one. Tell me what you fancy and I'll find something.",
    "Nothing matches that. Want to loosen the criteria a bit?",
  ],
  ru: [
    "Такого в меню не нахожу. Предложить что-то похожее?",
    "Этого у нас нет. Скажите, чего хочется — подберу.",
    "Ничего подходящего не нашлось. Может, смягчим критерии?",
  ],
};

const modifierPools: LangPools = {
  lt: [
    "Dėl tokio pakeitimo turėčiau pasitikslinti virtuvėje. Kol kas galiu įdėti įprastą variantą — tinka?",
    "Šito pakeitimo pats patvirtinti negaliu. Pakviesti kolegą, ar dedam standartinį?",
  ],
  en: [
    "I'd need to check that change with the kitchen. I can add the standard one for now — alright?",
    "I can't confirm that change myself. Shall I ask a colleague, or add it as it comes?",
  ],
  ru: [
    "Насчёт такого изменения нужно уточнить на кухне. Пока могу добавить обычный вариант — подойдёт?",
    "Сам подтвердить это изменение не могу. Позвать коллегу или добавить стандартный?",
  ],
};

export function whichItem(ctx: VoiceContext): string {
  return pick(whichItemPools, ctx, "which-item");
}

export function whichVariant(ctx: VoiceContext): string {
  return pick(whichVariantPools, ctx, "which-variant");
}

const soldOutPools: LangPools = {
  lt: [
    "Šito šiuo metu neturime — išparduota.",
    "Deja, šis patiekalas šiuo metu išparduotas.",
  ],
  en: [
    "That one's sold out at the moment.",
    "Sorry — that dish isn't available right now.",
  ],
  ru: [
    "Этого сейчас нет — закончилось.",
    "К сожалению, это блюдо сейчас недоступно.",
  ],
};

export function itemSoldOut(ctx: VoiceContext): string {
  return pick(soldOutPools, ctx, "sold-out");
}

export function noMatch(ctx: VoiceContext): string {
  return pick(noMatchPools, ctx, "no-match");
}

export function modifierUnsure(ctx: VoiceContext): string {
  return pick(modifierPools, ctx, "modifier");
}

const notDonePools: LangPools = {
  lt: ["Tada nieko nekeičiu.", "Gerai, palieku kaip yra."],
  en: ["Leaving it as it is, then.", "Alright, no changes."],
  ru: ["Тогда ничего не меняю.", "Хорошо, оставляю как есть."],
};

const notDoneYetPools: LangPools = {
  lt: ["Kol kas nieko nedariau. Norite, kad padaryčiau dabar?", "Dar nepadariau — sakykite, kai reikės."],
  en: ["I haven't done it yet. Want me to do it now?", "Not done yet — just say when."],
  ru: ["Пока ничего не сделал. Сделать сейчас?", "Ещё не сделал — скажите, когда нужно."],
};

export function actionNotDone(ctx: VoiceContext): string {
  return pick(notDonePools, ctx, "not-done");
}

export function actionNotDoneYet(ctx: VoiceContext): string {
  return pick(notDoneYetPools, ctx, "not-done-yet");
}

// ── Allergens ─────────────────────────────────────────────────────────────────

const allergyPools: LangPools = {
  lt: [
    "Sudėtį pasakysiu tiksliai, bet dėl kryžminės taršos virtuvėje geriau pasitikslinti su kolega. Pakviesti?",
    "Alergiją pasižymėjau. Ką sudėtyje turime — pasakysiu, tačiau dėl bendros virtuvės saugumo garantuoti negaliu. Norite, kad pakviesčiau darbuotoją?",
  ],
  en: [
    "I can tell you the exact ingredients, but for cross-contamination it's better to check with a colleague. Shall I call one?",
    "I've noted the allergy. I can tell you what's in it, though I can't guarantee a shared kitchen. Want me to get a staff member?",
  ],
  ru: [
    "Состав скажу точно, но насчёт перекрёстного загрязнения лучше уточнить у коллеги. Позвать?",
    "Аллергию отметил. Что в составе — скажу, но за общую кухню поручиться не могу. Позвать сотрудника?",
  ],
};

const certificationPools: LangPools = {
  lt: ["Dėl halal ar košerinio sertifikavimo turėčiau pasitikslinti — pakviesti kolegą?"],
  en: ["I'd have to check on halal or kosher certification — shall I get a colleague?"],
  ru: ["Насчёт халяльной или кошерной сертификации нужно уточнить — позвать коллегу?"],
};

export function allergyCaution(ctx: VoiceContext): string {
  return pick(allergyPools, ctx, "allergy");
}

const allergenDeclaredPools: LangPools = {
  lt: [
    "Katalogas nurodo šiuos alergenus, bet įrašas nepilnas — saugumo negarantuoju. Pakviesti kolegą?",
    "Štai ką turime pažymėta. Sąrašas nepatikrintas, todėl geriau pasitikslinti su kolega. Pakviesti?",
  ],
  en: [
    "The catalog lists these allergens, but the record is incomplete — I can't guarantee it's safe. Shall I call a colleague?",
    "Here's what we have on file. It's unverified, so better to check with a colleague. Shall I call one?",
  ],
  ru: [
    "В каталоге указаны эти аллергены, но запись неполная — безопасность не гарантирую. Позвать коллегу?",
    "Вот что отмечено. Список не проверен, лучше уточнить у коллеги. Позвать?",
  ],
};

const allergenUnknownPools: LangPools = {
  lt: [
    "Kataloge šito patiekalo alergenų nėra — tiksliai nežinau. Pakviesti kolegą patikrinti?",
    "Įrašo apie alergenus nėra, todėl negaliu patvirtinti. Norite, kad pakviesčiau darbuotoją?",
  ],
  en: [
    "There's no allergen record for that dish — I don't know for sure. Shall I get a colleague to check?",
    "No allergen entry on file, so I can't confirm. Want me to call a staff member?",
  ],
  ru: [
    "В каталоге аллергенов к этому блюду нет — точно не знаю. Позвать коллегу проверить?",
    "Записи об аллергенах нет, подтвердить не могу. Позвать сотрудника?",
  ],
};

export function allergenDeclared(ctx: VoiceContext): string {
  return pick(allergenDeclaredPools, ctx, "allergen-declared");
}

export function allergenUnknown(ctx: VoiceContext): string {
  return pick(allergenUnknownPools, ctx, "allergen-unknown");
}

export function certificationCaution(ctx: VoiceContext): string {
  return pick(certificationPools, ctx, "certification");
}

// ── Recommendations ───────────────────────────────────────────────────────────

const recommendIntros: LangPools = {
  lt: [
    "Siūlyčiau štai ką:",
    "Šiandien gerai eina:",
    "Iš mūsų meniu rinkčiausi:",
    "Va čia tikrai neapsiriksite:",
    "Pažiūrėkite į šiuos:",
  ],
  en: [
    "Here's what I'd suggest:",
    "These are going well today:",
    "From our menu I'd pick:",
    "You won't go wrong with these:",
    "Have a look at these:",
  ],
  ru: [
    "Вот что я бы предложил:",
    "Сегодня хорошо идёт:",
    "Из нашего меню я бы выбрал:",
    "С этими точно не ошибётесь:",
    "Посмотрите на эти:",
  ],
};

export function recommendIntro(ctx: VoiceContext): string {
  return pick(recommendIntros, ctx, "recommend");
}

/** Deterministic per-turn offset so repeat visits do not open on the same dishes. */
export function rotationOffset(ctx: VoiceContext, span: number): number {
  if (span <= 1) return 0;
  return mix(hash(`${ctx.sessionId}:rotation:${ctx.turn}`)) % span;
}

// ── Small talk and unknown input ──────────────────────────────────────────────

export type SmallTalkKind =
  | "how_are_you"
  | "thanks"
  | "compliment"
  | "weather"
  | "who_are_you"
  | "joke"
  | "goodbye";

const smallTalkPools: Record<SmallTalkKind, LangPools> = {
  how_are_you: {
    lt: [
      "Ačiū, neblogai — darbo netrūksta, bet tokia jau diena. O jums kaip?",
      "Puikiai, ačiū, kad paklausėte. Ko šiandien norėtųsi?",
    ],
    en: [
      "Not bad, thanks — busy, but that's the job. How about you?",
      "Doing well, thanks for asking. What are you in the mood for?",
    ],
    ru: [
      "Спасибо, неплохо — работы хватает, но день такой. А у вас как?",
      "Отлично, спасибо, что спросили. Чего сегодня хочется?",
    ],
  },
  thanks: {
    lt: ["Nėra už ką.", "Prašom, malonu padėti.", "Visada prašom."],
    en: ["My pleasure.", "Anytime.", "Happy to help."],
    ru: ["Не за что.", "Пожалуйста, рад помочь.", "Всегда пожалуйста."],
  },
  compliment: {
    lt: ["Ačiū, perduosiu virtuvei — jiems bus malonu.", "Malonu girdėti, ačiū."],
    en: ["Thank you, I'll pass that to the kitchen.", "Good to hear, thanks."],
    ru: ["Спасибо, передам на кухню — им будет приятно.", "Приятно слышать, спасибо."],
  },
  weather: {
    lt: [
      "Oras toks, koks yra — pas mus viduj šilta. Ko atnešti?",
      "Lauke visaip, bet čia jauku. Gal ko nors šilto?",
    ],
    en: [
      "Weather's doing its thing — it's warm in here though. What can I bring you?",
      "Bit of everything outside, but it's cosy in here. Something warm, maybe?",
    ],
    ru: [
      "Погода как погода — у нас внутри тепло. Что принести?",
      "На улице по-разному, а здесь уютно. Может, что-то горячее?",
    ],
  },
  who_are_you: {
    lt: [
      "Esu Vytas, skaitmeninis Dzūkų Ainių padavėjas. Meniu žinau mintinai — klauskite.",
      "Vytas, jūsų padavėjas šiame pokalbyje. Programa, bet meniu išmanau neblogai.",
    ],
    en: [
      "I'm Vytas, the digital waiter here at Dzūkų Ainiai. I know the menu by heart — ask away.",
      "Vytas, your waiter for this chat. A program, but I know the menu well.",
    ],
    ru: [
      "Я Витас, цифровой официант «Dzūkų Ainiai». Меню знаю наизусть — спрашивайте.",
      "Витас, ваш официант в этом чате. Программа, но меню знаю хорошо.",
    ],
  },
  joke: {
    lt: ["Juokdarys iš manęs prastas — bet virėjas pas mus geras. Ko paragausite?"],
    en: ["I'm a poor comedian — but our chef is excellent. What will you try?"],
    ru: ["Комик из меня так себе — а вот повар у нас отличный. Что попробуете?"],
  },
  goodbye: {
    lt: ["Skanaus ir gero vakaro!", "Ačiū, kad užsukote. Iki!"],
    en: ["Enjoy your meal, and have a good evening!", "Thanks for stopping by. See you!"],
    ru: ["Приятного аппетита и хорошего вечера!", "Спасибо, что зашли. До встречи!"],
  },
};

const smallTalkPatterns: Record<SmallTalkKind, RegExp> = {
  how_are_you:
    /\b(kaip (?:tu |jus |jūs |gyveni|laikais|sekasi)|kaip einasi)\b|how are you|how'?s it going|как (?:дела|ты|вы|жизнь)/iu,
  thanks: /\b(aciu|ačiū|dekui|dėkui)\b|\bthank|thanks|спасибо|благодар/iu,
  compliment:
    /\b(skanu|labai skanu|puiku|nuostabu|patiko|geriausi)\b|delicious|lovely|amazing|вкусно|прекрасно|отлично|понравилось/iu,
  weather: /\b(oras|lyja|snieg|salta|šalta|karsta|karšta)\b|weather|raining|погод|дожд|снег|холодно|жарко/iu,
  who_are_you:
    /\b(kas tu|kas jus|kas jūs|ar tu robotas|ar tu zmogus|ar tu žmogus|tavo vardas|koks tavo vardas)\b|who are you|are you (?:a )?(?:robot|bot|human|real)|your name|кто (?:ты|вы)|ты (?:робот|бот|человек)|как тебя зовут/iu,
  joke: /\b(pajuokauk|anekdot|juokas|papasakok juoka)\b|tell me a joke|пошути|анекдот/iu,
  goodbye:
    /\b(viso gero|iki|sudie|ate)\b|\bbye\b|goodbye|see you|пока|до свидания|всего доброго/iu,
};

export function detectSmallTalk(message: string): SmallTalkKind | null {
  const order: SmallTalkKind[] = [
    "who_are_you",
    "how_are_you",
    "joke",
    "weather",
    "compliment",
    "goodbye",
    "thanks",
  ];
  for (const kind of order) {
    if (smallTalkPatterns[kind].test(message)) return kind;
  }
  return null;
}

export function smallTalk(kind: SmallTalkKind, ctx: VoiceContext): string {
  return pick(smallTalkPools[kind], ctx, `smalltalk-${kind}`);
}

/** Humble menu offer — never claim inability on restaurant topics. */
const unknownPools: LangPools = {
  lt: [
    "Galiu pasiūlyti iš meniu — ko norėtumėte, valgio ar gėrimo?",
    "Pasakykite, ko ieškote prie stalo — parinksiu iš meniu.",
    "Kuo galiu padėti: valgiu, gėrimu ar kuo nors prie stalo?",
    "Klauskite meniu, porcijų ar kas tinka prie patiekalo — parinksiu.",
  ],
  en: [
    "I can suggest something from the menu — food or a drink?",
    "Tell me what you need at the table and I'll pick from the menu.",
    "Food, a drink, or something else for the table — what can I help with?",
    "Ask about the menu, portions, or what goes with a dish — I'll find it.",
  ],
  ru: [
    "Могу предложить из меню — еду или напиток?",
    "Скажите, что нужно за столом — подберу из меню.",
    "Еда, напиток или что-то к столу — чем помочь?",
    "Спросите про меню, порции или что подойдёт к блюду — подберу.",
  ],
};

export function whichNamedItems(ctx: VoiceContext, names: string[]): string {
  const shown = names.map((name) => name.trim()).filter(Boolean).slice(0, 3);
  if (shown.length < 2) return whichItem(ctx);
  if (ctx.language === "lt") {
    if (shown.length === 2) return `${shown[0]} ar ${shown[1]}?`;
    return `Kurį: ${shown[0]}, ${shown[1]} ar ${shown[2]}?`;
  }
  if (ctx.language === "en") {
    if (shown.length === 2) return `The ${shown[0]} or the ${shown[1]}?`;
    return `Which one: ${shown[0]}, ${shown[1]}, or ${shown[2]}?`;
  }
  if (shown.length === 2) return `${shown[0]} или ${shown[1]}?`;
  return `Какое: ${shown[0]}, ${shown[1]} или ${shown[2]}?`;
}

const waitGroupLabel: Record<SupportedLanguage, Record<string, string>> = {
  lt: {
    starters: "užkandžiai ir sriubos",
    mains: "pagrindiniai",
    kids: "vaikiški",
    drinks: "gėrimai",
    desserts: "desertai",
  },
  en: {
    starters: "starters and soups",
    mains: "mains",
    kids: "kids' dishes",
    drinks: "drinks",
    desserts: "desserts",
  },
  ru: {
    starters: "закуски и супы",
    mains: "основные блюда",
    kids: "детские",
    drinks: "напитки",
    desserts: "десерты",
  },
};

export function waitTimeForGroup(
  ctx: VoiceContext,
  group: string,
  minutes: number
): string {
  const label = waitGroupLabel[ctx.language][group] ?? group;
  if (ctx.language === "lt") {
    return `${label[0].toUpperCase()}${label.slice(1)} paprastai apie ${minutes} min. — tai ne tikslus virtuvės laikas.`;
  }
  if (ctx.language === "en") {
    return `${label[0].toUpperCase()}${label.slice(1)} are usually around ${minutes} min — not an exact kitchen time.`;
  }
  return `${label[0].toUpperCase()}${label.slice(1)} обычно около ${minutes} мин. — это не точное время кухни.`;
}

export function waitTimeOverview(
  ctx: VoiceContext,
  groups: ReadonlyArray<{ group: string; minutes: number }>
): string {
  const parts = groups.map((item) => {
    const label = waitGroupLabel[ctx.language][item.group] ?? item.group;
    return `${label} ~${item.minutes} min`;
  });
  if (ctx.language === "lt") {
    return `Paprastai: ${parts.join(", ")}. Tai apytiksliai, ne tikslus virtuvės laikas.`;
  }
  if (ctx.language === "en") {
    return `Usually: ${parts.join(", ")}. Approximate — not an exact kitchen time.`;
  }
  return `Обычно: ${parts.join(", ")}. Примерно, не точное время кухни.`;
}

export function unknownRedirect(ctx: VoiceContext): string {
  return pick(unknownPools, ctx, "unknown");
}
