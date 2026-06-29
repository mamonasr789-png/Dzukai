import type { Category, Product } from "../data.ts";
import { normalizeText } from "./normalizer.ts";

export type RestrictionConcept =
  | "minor"
  | "noAlcohol"
  | "vegetarian"
  | "vegan"
  | "noPork"
  | "halal"
  | "kosher";

export interface RestrictionMatch {
  concept: RestrictionConcept;
  confidence: number;
}

export interface AllergenKnowledge {
  allergen: string;
  patterns: RegExp[];
  riskStems: string[];
}

export interface DislikeKnowledge {
  ingredient: string;
  patterns: RegExp[];
  riskStems: string[];
}

const ageWords = "(septyniolikos|sesiolikos|penkiolikos|keturiolikos|septyniolika|sesiolika|penkiolika|keturiolika)";

export const restrictionConcepts: Record<RestrictionConcept, RegExp[]> = {
  minor: [
    /\bnepilnamet[ei]s?\b/i,
    /\b(?:ne|nesu|dar nesu)\s+pilnamet[ei]s?\b/i,
    /\bman\s+(?:dar\s+)?nera\s+18\b/i,
    /\b(?:dar\s+)?neturiu\s+18\b/i,
    /\b(?:dar\s+)?ne\s+18\b/i,
    /\biki\s+18\b/i,
    /\bman\s+maziau\s+nei\s+18\b/i,
    /\b(?:man|esu)\s+(?:tik\s+)?(?:1[0-7]|[0-9])\b/i,
    new RegExp(`\\b(?:man|esu)\\s+${ageWords}\\b`, "i"),
    /\bper\s+jaun(?:as|a)\b/i,
    /\b(?:dar\s+)?(?:esu\s+)?vaikas\b/i,
    /\bmokausi\s+mokykloje\b/i,
    /\bunderage\b/i,
    /\bminor\b/i,
    /\bi(?:\s+am|\s+m|'m)\s+under\s+18\b/i,
    /\bi(?:\s+am|\s+m|'m)\s+(?:1[0-7]|[0-9])\b/i,
    /\bnot\s+18\s+yet\b/i,
    /\bnot\s+old\s+enough\b/i,
    /\btoo\s+young\b/i,
  ],
  noAlcohol: [
    /\b(?:negeriu|nevartoju|nenoriu)\s+alkoholio\b/i,
    /\bnevartoju\b/i,
    /\balkoholio\s+(?:negeriu|nevartoju|nenoriu|negalima)\b/i,
    /\balkoholio\s+man\s+negalima\b/i,
    /\bbe\s+alkoholio\b/i,
    /\b(?:bealkoholinis|nealkoholinis|nealkoholinio|nealkoholini)\b/i,
    /\btik\s+nealkoholini\b/i,
    /\b(?:as\s+)?vairuoju\b/i,
    /\besu\s+vairuotoj(?:as|a)\b/i,
    /\b(?:rytoj\s+i\s+darba|siandien\s+dirbu)\b/i,
    /\bnegaliu\s+(?:gerti|vartoti)(?:\s+alkoholio)?\b/i,
    /\bman\s+negalima\s+alkoholio\b/i,
    /\bpo\s+vaistu\b/i,
    /\bvartoju\s+vaistus\b/i,
    /\besu\s+su\s+masina\b/i,
    /\bno\s+alcohol\b/i,
    /\bnon.?alcohol(?:ic)?\b/i,
    /\bcan(?:not|\s+t|'t)\s+drink\s+alcohol\b/i,
  ],
  vegetarian: [
    /\bvegetar[ae]s?\b/i,
    /\bvegetarisk/i,
    /\bvegetarin/i,
    /\bbe\s+mesos\b/i,
    /\bmesos\s+nevalgau\b/i,
    /\bnevalgau\s+mesos\b/i,
    /\bnenoriu\s+mesos\b/i,
    /\bbe\s+(?:jautienos|kiaulienos|vistienos|zuvies)\b/i,
    /\bvalgau\s+tik\s+darzoves\b/i,
    /\bnoriu\s+be\s+mesos\b/i,
    /\b(?:ka|ką)\s+be\s+mesos\b/i,
    /\bvegetarian\b/i,
    /\bmeatless\b/i,
    /\bno\s+meat\b/i,
  ],
  vegan: [
    /\bvegan[ae]s?\b/i,
    /\bveganisk/i,
    /\btik\s+augalinis(?:\s+maistas)?\b/i,
    /\bbe\s+gyvuniniu\s+produktu\b/i,
    /\bbe\s+(?:pieno|surio|kiausiniu|sviesto|grietines|medaus)\b/i,
    /\bnevalgau\s+(?:pieno\s+produktu|kiausiniu)\b/i,
    /\bvegan\b/i,
    /\bplant.?based\b/i,
  ],
  noPork: [
    /\bbe\s+kiaulienos\b/i,
    /\bkiaulienos\s+(?:ne|negalima)\b/i,
    /\bnevalgau\s+kiaulienos\b/i,
    /\bnenoriu\s+kiaulienos\b/i,
    /\bkiauliena\s+netinka\b/i,
    /\bbe\s+sonines\b/i,
    /\bsonines\s+nevalgau\b/i,
    /\bnenoriu\s+sonines\b/i,
    /\bnevalgau\s+kumpio\b/i,
    /\bbe\s+kumpio\b/i,
    /\bbe\s+sonkauliu\b/i,
    /\bno\s+pork\b/i,
  ],
  halal: [
    /\bhalal\b/i,
    /\bhalal\s+maistas\b/i,
    /\bmusulmon[ae]s?\b/i,
    /\bmuslim\b/i,
  ],
  kosher: [
    /\bkosher\b/i,
    /\bkoserinis\b/i,
    /\bkosher\s+maistas\b/i,
  ],
};

export const allergenKnowledge: AllergenKnowledge[] = [
  {
    allergen: "Riešutai",
    patterns: [/\briesut/i, /\bmigdol/i, /\blazdyno\s+riesut/i, /\bgraikiniai\s+riesut/i],
    riskStems: ["riesut", "migdol", "lazdyno riesut", "graikiniai riesut"],
  },
  {
    allergen: "Glitimas",
    patterns: [/\bglitim/i, /\bgliuten/i, /\bgluten/i, /\bkvieci/i, /\bmilt/i, /\bduon/i, /\bmakaron/i],
    riskStems: ["glitim", "gliuten", "gluten", "kvieci", "milt", "duon", "makaron", "kruton"],
  },
  {
    allergen: "Pienas",
    patterns: [/\bpien/i, /\blaktoz/i, /\bsur/i, /\bgrietin/i, /\bsviest/i, /\bvars/i, /\bfet/i, /\bparmezan/i],
    riskStems: ["pien", "laktoz", "sur", "grietin", "sviest", "vars", "feta", "parmezan", "burrata", "jogurt"],
  },
  {
    allergen: "Kiaušiniai",
    patterns: [/\bkiausin/i],
    riskStems: ["kiausin", "egg"],
  },
  {
    allergen: "Žuvis",
    patterns: [/\bzuv/i, /\blasis/i, /\btun/i, /\bmenk/i],
    riskStems: ["zuv", "lasis", "tun", "menk", "silk", "skumbr", "esery"],
  },
  {
    allergen: "Vėžiagyviai",
    patterns: [/\bkrevet/i, /\bjuru\s+geryb/i, /\bmoliusk/i, /\baustr/i],
    riskStems: ["krevet", "juru geryb", "moliusk", "austr", "vezagyv"],
  },
  {
    allergen: "Garstyčios",
    patterns: [/\bgarsty/i],
    riskStems: ["garsty"],
  },
  {
    allergen: "Salierai",
    patterns: [/\bsalier/i],
    riskStems: ["salier"],
  },
  {
    allergen: "Sezamas",
    patterns: [/\bsezam/i],
    riskStems: ["sezam"],
  },
  {
    allergen: "Soja",
    patterns: [/\bsoj/i],
    riskStems: ["soj"],
  },
];

export const dislikeKnowledge: DislikeKnowledge[] = [
  { ingredient: "grybai", patterns: [/\bgryb/i, /\bbaravyk/i, /\bpievagryb/i], riskStems: ["gryb", "baravyk", "pievagryb"] },
  { ingredient: "svogūnas", patterns: [/\bsvogun/i], riskStems: ["svogun"] },
  { ingredient: "pomidoras", patterns: [/\bpomidor/i], riskStems: ["pomidor"] },
  { ingredient: "sūris", patterns: [/\bsur/i], riskStems: ["sur", "feta", "parmezan", "burrata"] },
  { ingredient: "žuvis", patterns: [/\bzuv/i, /\blasis/i, /\btun/i, /\bmenk/i], riskStems: ["zuv", "lasis", "tun", "menk", "silk", "skumbr"] },
  { ingredient: "kiauliena", patterns: [/\bkiaul/i, /\bsonin/i, /\bkump/i, /\bsonkaul/i], riskStems: ["kiaul", "sonin", "kump", "sonkaul", "spirg"] },
];

export const meatStems = [
  "mesa", "jautien", "kiaulien", "vistien", "visciuk", "antien", "avien",
  "sonin", "kump", "lasin", "sonkaul", "juru geryb", "krevet", "zuv",
  "lasis", "tun", "menk", "silk", "skumbr", "astuunkoj", "moliusk",
];

export const animalProductStems = [
  ...meatStems,
  "pien", "sur", "grietin", "sviest", "kiausin", "med", "vars", "feta",
  "parmezan", "burrata", "jogurt", "ledai", "grietinele",
];

export const porkStems = ["kiaul", "sonin", "kump", "sonkaul", "lasin", "spirg", "porchetta", "pork", "ribs"];

export const shellfishStems = ["krevet", "juru geryb", "moliusk", "austr", "vezagyv"];

const alcoholicCategories = new Set<Category>([
  "alus", "sidras", "alus-kokteiliai", "stiprieji", "vynas",
]);

const maybeAlcoholicCategories = new Set<Category>(["kokteiliai", "sampanas"]);
const nonAlcoholicCategories = new Set<Category>(["limonadai", "gerimai", "nealko-alus", "kava"]);

export function productText(product: Product): string {
  return normalizeText([product.name, product.description, ...product.ingredients, ...product.allergens].join(" "));
}

export function isExplicitlyNonAlcoholic(product: Product): boolean {
  if (product.category === "nealko-alus") return true;
  const text = productText(product);
  return /\b(nealkohol\w*|alkoholfree|non alcohol\w*|nonalcohol\w*|be alkoholio)\b/i.test(text);
}

export function isAlcoholicProduct(product: Product): boolean {
  if (nonAlcoholicCategories.has(product.category) || isExplicitlyNonAlcoholic(product)) return false;
  if (alcoholicCategories.has(product.category)) return true;
  if (maybeAlcoholicCategories.has(product.category)) return true;
  const text = productText(product);
  return /\b(?:alus|sidras|vynas|degtin|visk|whiskey|rum|romas|dzin|gin|tekil|brend|liker|prosecco|sampan|aperol|vodka|ipa|lager|porter)\b/i.test(text)
    || /\b\d+(?:[,.]\d+)?\s*%/i.test(text);
}

export function matchesAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}
