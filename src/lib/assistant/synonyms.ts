/**
 * Synonym groups for Natural Language Understanding.
 * Each group maps concepts to keyword arrays across LT/EN/RU.
 * Used by intentEngine and memory modules for fuzzy matching.
 */

export interface SynonymGroup {
  /** All keyword variants that belong to this concept */
  keywords: string[];
  /** Weight multiplier when this keyword is the only/main word in input */
  singleWordBoost?: number;
}

export const synonyms = {

  // ── MOOD ─────────────────────────────────────────────────────────────────

  FILLING: {
    keywords: [
      "sočiai", "sotaus", "sotų", "soties", "soti", "sodras", "labai alkanas",
      "labai alkana", "alkanas", "alkana", "normaliai pavalgyti", "didelė porcija",
      "rimto kažko", "kažko rimto", "rimtai", "sotaus kažko", "kažko sotaus",
      "sociai", "sotus", "sotu", "kazko rimto", "dideles porcijos", "didele porcija",
      "filling", "hungry", "starving", "something filling", "something big",
      "сытный", "сытно", "очень голоден", "хочу сытного",
      "didelį", "didelę", "daug", "gerai pavalgyti", "gerai pavalgyt",
    ],
    singleWordBoost: 2,
  },

  LIGHT: {
    keywords: [
      "lengvai", "lengvo", "lengvą", "lengvau", "lengvesnio", "lengvesnis", "lengviau",
      "nesočiai", "nesotaus", "dieta", "dietinis", "nesunkiai", "truputį",
      "truputis", "nesinoriai", "light", "diet", "something light", "not heavy",
      "kazko lengvo", "nenoriu sunkiai", "ne per sunkiai", "lengvas maistas",
      "лёгкое", "что-нибудь лёгкое", "диета",
      "salotų", "salotos", "su daržovėmis",
    ],
    singleWordBoost: 2,
  },

  SPICY: {
    keywords: [
      "aštraus", "aštri", "aštrus", "aštriu", "aštriai", "čili", "chili",
      "pikantiškas", "pikantišką", "pikantiškai", "karstą", "karstų",
      "astru", "astriau", "cili", "pipirai", "aitru",
      "spicy", "hot", "burning", "пикантный", "острое", "остро",
    ],
    singleWordBoost: 2,
  },

  // ── DIET ─────────────────────────────────────────────────────────────────

  VEGETARIAN: {
    keywords: [
      "vegetaras", "vegetarė", "vegetariškas", "vegetariškai", "vegetariška",
      "be mėsos", "be mėsų", "nemėgstu mėsos", "negaliu mėsos",
      "vegetare", "be mesos", "nevalgau mesos", "nevalgau mėsos",
      "meatless", "vegetarian", "veggie", "no meat",
      "вегетарианец", "без мяса",
      "augalinė mityba", "augaliniai",
    ],
    singleWordBoost: 3,
  },

  VEGAN: {
    keywords: [
      "veganas", "veganė", "veganiškas", "veganiškai", "veganišką",
      "vegane", "veganiska", "veganiška", "be kiausiniu", "be kiaušinių",
      "vegan", "plant based", "plant-based",
      "веган", "веганский",
    ],
    singleWordBoost: 3,
  },

  GLUTEN_FREE: {
    keywords: [
      "be glitimo", "be gliuteno", "glitimo netoleruoju", "celiakija",
      "gluten free", "gluten-free", "no gluten", "celiac",
      "без глютена",
    ],
    singleWordBoost: 3,
  },

  LACTOSE_FREE: {
    keywords: [
      "be laktozės", "laktozės netoleruoju", "be pieno", "pieno netoleruoju",
      "lactose free", "lactose-free", "dairy free", "no dairy",
      "без лактозы", "без молока",
    ],
    singleWordBoost: 3,
  },

  // ── PROTEINS ─────────────────────────────────────────────────────────────

  CHICKEN: {
    keywords: [
      "vištiena", "vištienos", "vištieną", "vištienai", "vištiena",
      "viščiukas", "viščiuko", "sparneliai", "vištos",
      "vistiena", "vistienos", "vistienai", "file", "filė",
      "chicken", "poultry", "курица", "куриное",
    ],
    singleWordBoost: 2,
  },

  PORK: {
    keywords: [
      "kiauliena", "kiaulienos", "kiaulieną", "kiaulienai",
      "šonkauliai", "šonkauliukai", "carbonada", "kumpio",
      "sonine", "šoninė", "sonines", "šoninės", "soninei", "šoninei",
      "sonkauliai", "šonkauliai", "sonkauliu", "šonkaulių",
      "pork", "ribs", "свинина",
    ],
    singleWordBoost: 2,
  },

  BEEF: {
    keywords: [
      "jautiena", "jautienos", "jautieną", "jautienai",
      "antrekotas", "antrekoto", "steak", "hamburger",
      "steikas",
      "beef", "steak", "говядина", "стейк",
    ],
    singleWordBoost: 2,
  },

  FISH: {
    keywords: [
      "žuvis", "žuvies", "žuvį", "žuviai", "žuvys",
      "lašiša", "lašišos", "tunas", "tuno",
      "skumbrė", "menkė", "ešerys",
      "zuvis", "zuvies", "zuvys", "lasisa", "lasisos", "lasisai", "lašišai",
      "lasisos kepsnys", "lašišos kepsnys", "menke", "menkes",
      "krevetės", "aštuonkojis",
      "fish", "seafood", "salmon", "tuna",
      "рыба", "рыбы", "морепродукты",
    ],
    singleWordBoost: 2,
  },

  LAMB: {
    keywords: [
      "aviena", "avienos", "avieną",
      "lamb", "агнец", "баранина",
    ],
    singleWordBoost: 2,
  },

  // ── DRINK TYPES ───────────────────────────────────────────────────────────

  BEER: {
    keywords: [
      "alus", "alaus", "alų", "alui",
      "craft", "daryklos alus", "naminiu alumi",
      "alu", "alumi", "alucio", "alučio", "sviesus alus", "šviesus alus", "tamsus alus",
      "beer", "craft beer", "пиво", "крафт",
      "lageris", "lagerio", "ipa", "porteris",
    ],
    singleWordBoost: 2,
  },

  WINE: {
    keywords: [
      "vynas", "vyno", "vynai", "vynų", "vyną",
      "raudonas vynas", "baltas vynas", "raudonąjį", "baltąjį",
      "vyna", "sausas vynas", "prosecco",
      "wine", "red wine", "white wine",
      "вино", "красное вино", "белое вино",
    ],
    singleWordBoost: 2,
  },

  COCKTAIL: {
    keywords: [
      "kokteiliai", "kokteilių", "kokteilį", "kokteilis",
      "mojito", "spritz", "mimosa",
      "kokteili", "kokteilio", "gin tonic",
      "cocktail", "mixed drink",
      "коктейль",
    ],
    singleWordBoost: 2,
  },

  LEMONADE: {
    keywords: [
      "limonadas", "limonado", "limonadų",
      "lemonade", "soft drink",
      "gira", "giros", "vanduo", "vandens", "sultys", "sulciu",
      "cola", "coca cola", "sprite", "fanta", "mineralinis",
      "gazuotas vanduo", "negazuotas vanduo",
      "лимонад",
      "gaivus gėrimas", "gaivaus",
    ],
    singleWordBoost: 2,
  },

  COFFEE: {
    keywords: [
      "kava", "kavos", "kavą",
      "espresso", "cappuccino", "latte", "americano",
      "coffee", "café",
      "кофе", "эспрессо",
    ],
    singleWordBoost: 2,
  },

  TEA: {
    keywords: [
      "arbata", "arbatos", "arbatą", "zalia arbata", "žalia arbata", "juoda arbata", "tea",
    ],
    singleWordBoost: 2,
  },

  DRINK: {
    keywords: [
      "gerti", "gert", "gerima", "gėrimą", "gėrimo", "gėrimų",
      "isgerti", "išgerti", "atsigerti", "atsigerciau", "atsigerčiau", "atsigersiu",
      "ka gerti", "ką gerti", "ka gert", "kokio gerimo", "koki gerima", "kokį gėrimą",
      "kokiu gerimu", "prie ko gerti", "ka atsigerti", "ką atsigerti", "gerčiau",
    ],
    singleWordBoost: 2,
  },

  // ── BUDGET ───────────────────────────────────────────────────────────────

  CHEAPER: {
    keywords: [
      "pigiau", "pigesnio", "pigesnį", "pigesnis", "pigus", "pigo",
      "biudžetinis", "ekonomiškai", "ekonomiškas",
      "budget", "biudžetas",
      "biudzetas", "pigu", "nebrangu", "eur", "euro", "euru", "€", "pigesni",
      "mažesnį kainą", "mažesnę kainą", "už mažiau",
      "cheaper", "affordable", "inexpensive", "less expensive",
      "дешевле", "недорого",
    ],
    singleWordBoost: 2,
  },

  EXPENSIVE: {
    keywords: [
      "brangesnio", "brangesnis", "brangų", "brangus", "premium",
      "geresnio", "aukštos kokybės",
      "brangiau", "geriausia", "sefui", "šefo", "prabangiau", "kazko gero", "kazko ypatingo",
      "expensive", "premium", "luxury",
      "дороже", "премиум",
    ],
    singleWordBoost: 2,
  },

  // ── NAVIGATION ───────────────────────────────────────────────────────────

  MORE_DIFFERENT: {
    keywords: [
      "dar", "dar ką", "dar kito", "kitką", "kitą", "kitas", "skirtingą",
      "dar kitą", "ne šitą", "rodyk daugiau", "daugiau",
      "dar kazka", "dar kažką", "kitka", "ne sita", "ne tas", "kita varianta", "kitą variantą",
      "another", "different", "more", "show more", "other options",
      "ещё", "другое", "покажи ещё",
      "keisk", "parodyk kitą", "kitko",
    ],
    singleWordBoost: 2,
  },

  NEGATIVE: {
    keywords: [
      "ne", "nereikia", "nenoriu", "nenoriu", "netinka", "netinkamas",
      "nieko", "nieko nenoriu", "no", "nope", "not that", "no thanks",
      "ne sita", "ne šita", "ne tas", "nenoriu sito", "nenoriu šito", "blogai",
      "нет", "не надо", "не хочу",
      "nepatinka", "negerai",
    ],
    singleWordBoost: 3,
  },

  POSITIVE: {
    keywords: [
      "taip", "gerai", "puiku", "nuostabu", "tiksliai", "tobulai",
      "prašau", "norėčiau", "noriu", "imsiu", "paimsu", "užsisakysiu",
      "tinka", "imu", "paimsiu", "noriu sito", "noriu šito", "sita", "šita", "sita imsiu",
      "yes", "ok", "okay", "great", "perfect", "sure", "sounds good",
      "да", "хорошо", "отлично", "хочу", "возьму",
    ],
    singleWordBoost: 2,
  },

  // ── FOOD CATEGORIES ───────────────────────────────────────────────────────

  PIZZA: {
    keywords: [
      "pica", "picos", "picą", "picai", "pizza", "margherita", "pepperoni",
      "пицца",
    ],
  },

  SALAD: {
    keywords: [
      "salotos", "salotų", "salotą", "salotas", "salotu", "cezario", "graikiskos", "graikiškos", "burrata",
      "salad", "салат",
    ],
  },

  SOUP: {
    keywords: [
      "sriuba", "sriubos", "sriubą", "sriubai",
      "soup", "суп",
    ],
  },

  DESSERT: {
    keywords: [
      "desertas", "deserto", "desertą", "desertai", "desertų",
      "tortas", "tortą", "tortai", "ledai", "ledų",
      "saldumynai", "saldus", "saldžio", "desertui", "saldaus", "saldumyno",
      "pyragas", "po vakarienes", "po vakarienės", "napoleonas", "strudelis", "brownie",
      "dessert", "sweets", "cake", "ice cream",
      "десерт", "сладкое", "торт", "мороженое",
    ],
    singleWordBoost: 2,
  },

  WOK: {
    keywords: [
      "wok", "makaronai", "makaronų", "ryžiai", "ryžių",
      "noodles", "rice", "asian", "лапша", "рис",
    ],
  },

  POTATO: {
    keywords: [
      "bulviniai", "cepelinai", "cepelinas", "didžkukuliai",
      "bulvė", "bulvių", "bulviniai blynai", "bulviniu blynu", "bulvinių blynų",
      "blynai", "didzkukuliai", "kukuliai",
      "potato", "dumpling", "картофель", "цеппелины",
    ],
  },

  BBQ_GRILL: {
    keywords: [
      "šašlykas", "šašlyko", "šašlykų",
      "griliniai", "grilio", "grilinis",
      "bbq", "grill", "barbekiu",
      "шашлык", "гриль",
    ],
  },

  KIDS: {
    keywords: [
      "vaikams", "vaikų", "vaikas", "vaikiškas", "vaikui",
      "vaikiskas", "dukrai", "sunui", "sūnui", "mazam", "mažam",
      "kids", "children", "child",
      "детское", "для детей",
    ],
    singleWordBoost: 3,
  },

  // ── ALLERGENS ─────────────────────────────────────────────────────────────

  ALLERGY_NUTS: {
    keywords: [
      "riešutai", "riešutų", "riešutams", "riesutai", "riesutu", "alergija riešutams",
      "nuts", "nut allergy", "peanuts",
      "орехи", "аллергия на орехи",
    ],
  },

  ALLERGY_GLUTEN: {
    keywords: [
      "glitimas", "glitimo", "alergija glitimui",
      "gluten allergy", "celiac", "celiakija",
      "аллергия на глютен",
    ],
  },

  ALLERGY_DAIRY: {
    keywords: [
      "pienas", "pieno", "alergija pienui", "pieno alergija",
      "dairy allergy", "milk allergy",
      "аллергия на молоко",
    ],
  },

  ALLERGY_EGGS: {
    keywords: [
      "kiaušiniai", "kiaušinių", "kiausiniai", "kiausiniu", "alergija kiaušiniams",
      "egg allergy",
      "аллергия на яйца",
    ],
  },

  ALLERGY_FISH: {
    keywords: [
      "žuvis", "žuvies", "alergija žuviai",
      "fish allergy", "seafood allergy",
      "аллергия на рыбу",
    ],
  },

  // ── DISLIKED INGREDIENTS ──────────────────────────────────────────────────

  DISLIKE_MUSHROOMS: {
    keywords: [
      "be grybų", "be grybu", "grybai", "grybų", "nemėgstu grybų", "nemegstu grybu", "nenoriu grybų",
      "no mushrooms", "without mushrooms",
      "без грибов",
    ],
  },

  DISLIKE_ONION: {
    keywords: [
      "be svogūnų", "svogūnas", "svogūnų", "nemėgstu svogūnų",
      "no onions", "without onions",
      "без лука",
    ],
  },

  DISLIKE_TOMATO: {
    keywords: [
      "be pomidorų", "pomidoras", "pomidorų", "nemėgstu pomidorų",
      "no tomatoes", "without tomatoes",
      "без помидоров",
    ],
  },

  DISLIKE_CHEESE: {
    keywords: [
      "be sūrio", "sūris", "sūrio", "nemėgstu sūrio",
      "no cheese", "without cheese",
      "без сыра",
    ],
  },

  DISLIKE_CHILI: {
    keywords: [
      "be čili", "be aštraus", "nenoriu aštraus",
      "no spice", "not spicy", "mild",
      "без чили",
    ],
  },

  // ── RESTAURANT INFO ───────────────────────────────────────────────────────

  RESTAURANT_INFO: {
    keywords: [
      "adresas", "kur esate", "kur jūs", "kaip pas jus patekti",
      "darbo laikas", "kada dirbate", "kada atidarytas", "kada uždaromas",
      "address", "where are you", "location", "hours", "open", "close",
      "адрес", "где вы", "часы работы",
    ],
  },

  ALLERGY: {
    keywords: [
      "alergija", "alergiskas", "alergiškas", "alergiska", "alergiška",
      "negaliu valgyti", "netoleruoju",
    ],
  },

  DISLIKE: {
    keywords: [
      "nemegstu", "nemėgstu", "nepatinka", "be", "nenoriu", "nevalgau",
    ],
  },

  NOT_SPICY: {
    keywords: [
      "neaštru", "neastru", "ne aštru", "be astrumo", "be aštrumo", "nenoriu aštraus",
    ],
  },

  INGREDIENTS: {
    keywords: [
      "sudetis", "sudėtis", "ingredientai", "is ko", "iš ko", "kas ieina", "kas įeina", "su kuo",
    ],
  },

  ALLERGENS: {
    keywords: [
      "alergenai", "alergenu", "alergenų", "glitimas", "glutenas", "pienas",
      "riesutai", "riešutai", "kiausiniai", "kiaušiniai",
    ],
  },

  PRICE: {
    keywords: [
      "kaina", "kainuoja", "kiek kainuoja", "kiek", "eur", "euro", "euru", "€",
    ],
  },

  POPULAR: {
    keywords: [
      "populiaru", "populiariausia", "megstamiausia", "mėgstamiausia", "best seller", "top", "perkamiausia",
    ],
  },

  GREETING: {
    keywords: [
      "labas", "laba", "sveiki", "sveikas", "hello", "hi", "hey",
    ],
  },

} as const;

export type SynonymGroupKey = keyof typeof synonyms;

/**
 * Score how well an input matches a synonym group.
 * Returns 0-1 where 1 = perfect match.
 */
export function scoreGroup(input: string, groupKey: SynonymGroupKey): number {
  const group = synonyms[groupKey];
  const normalized = normalizeText(input);
  const words = normalized.split(/\s+/);

  let score = 0;
  const maxScore = 10;

  for (const keyword of group.keywords) {
    const kw = normalizeText(keyword);
    if (kwMatches(normalized, words, kw)) {
      // Longer keyword matches score higher (more specific)
      const kwWords = kw.split(/\s+/).length;
      score += kwWords * 2;

      // If it's the entire input, boost
      if (normalized === kw || (words.length === 1 && words[0] === kw)) {
        score += (group as { keywords: readonly string[]; singleWordBoost?: number }).singleWordBoost ?? 1;
      }
    }
  }

  return Math.min(score / maxScore, 1);
}

/**
 * Check if input contains ANY keyword from a group (boolean match).
 */
export function matchesGroup(input: string, groupKey: SynonymGroupKey): boolean {
  const group = synonyms[groupKey];
  const normalized = normalizeText(input);
  const words = normalized.split(/\s+/);
  return group.keywords.some((kw) => kwMatches(normalized, words, normalizeText(kw)));
}

/**
 * Match a keyword against normalized input with word-boundary protection.
 * Short keywords (≤4 chars) require exact word match to avoid substring collisions
 * (e.g. "ne" matching "nenoriu", "no" matching "noriu", "ok" matching "kokį").
 */
export function kwMatchesInText(text: string, keyword: string): boolean {
  const normalized = normalizeText(text);
  const words = normalized.split(/\s+/);
  const kw = normalizeText(keyword);
  return kwMatches(normalized, words, kw);
}

function kwMatches(normalized: string, words: string[], kw: string): boolean {
  if (kw.length <= 4) {
    // Require that the keyword is a standalone word in the input
    return words.includes(kw);
  }
  // Longer keywords: substring match is safe
  return normalized.includes(kw);
}

/**
 * Normalize text: lowercase, remove excess punctuation, normalize LT diacritics optionally.
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ė/g, "e")
    .replace(/š/g, "s")
    .replace(/č/g, "c")
    .replace(/ž/g, "z")
    .replace(/ą/g, "a")
    .replace(/ę/g, "e")
    .replace(/į/g, "i")
    .replace(/ų/g, "u")
    .replace(/ū/g, "u")
    .replace(/[!?.,:;()[\]{}"“”'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract a budget amount from input text (e.g. "iki 20€", "15 eurų", "budget 25").
 * NOTE: Does NOT use normalizeText to preserve decimal separators.
 */
export function extractBudget(input: string): number | null {
  // Lowercase but preserve decimal separators
  const t = input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ė/g, "e")
    .replace(/š/g, "s")
    .replace(/č/g, "c")
    .replace(/ž/g, "z")
    .replace(/ą/g, "a")
    .replace(/ę/g, "e")
    .replace(/į/g, "i")
    .replace(/ų/g, "u")
    .replace(/ū/g, "u")
    .replace(/[!?:;]/g, " ");

  // Priority: keyword-prefixed pattern first, then bare number with currency
  const patterns = [
    /(?:iki|up to|budget|biudzetas|не более|до)\s*€?\s*(\d+(?:[.,]\d+)?)/i,
    /(\d+(?:[.,]\d+)?)\s*(?:€|eur[oųu]?)/i,
    /(?:iki|per)\s+(\d+)/i,
  ];

  for (const re of patterns) {
    const m = t.match(re);
    if (m) return parseFloat(m[1].replace(",", "."));
  }
  return null;
}
