/**
 * Menu search engine — finds products by various criteria.
 * NEVER invents products. Only returns items that exist in data.ts.
 */

import { products as allProducts } from "../data.ts";
import type { Product, Category } from "../data.ts";
import { tProduct } from "../product-translations.ts";
import { normalizeText } from "./synonyms.ts";

export { allProducts };

/** Get all products in a category or list of categories */
export function byCategory(cats: Category | Category[]): Product[] {
  const catSet = new Set(Array.isArray(cats) ? cats : [cats]);
  return allProducts.filter((p) => catSet.has(p.category));
}

/** Get food categories only (not drinks, desserts) */
export const FOOD_CATEGORIES: Category[] = [
  "uzkandziai", "salotos", "sriubos", "lietiniai", "koldumai",
  "wok", "bulviniai", "picos", "grilinis", "vistiena",
  "kiauliena", "jautiena", "zuvis", "vaikiskas", "prie-alaus",
];

/** Drink categories */
export const DRINK_CATEGORIES: Category[] = [
  "alus", "vynas", "kokteiliai", "alus-kokteiliai", "limonadai",
  "gerimai", "nealko-alus", "sidras", "sampanas", "stiprieji", "kava",
];

/** Dessert categories */
export const DESSERT_CATEGORIES: Category[] = ["desertai"];

/** Main course categories */
export const MAIN_CATEGORIES: Category[] = [
  "vistiena", "kiauliena", "jautiena", "zuvis",
  "picos", "wok", "bulviniai", "grilinis",
];

/** Starter categories */
export const STARTER_CATEGORIES: Category[] = ["uzkandziai", "salotos", "sriubos", "prie-alaus"];

/** Map protein preference to food categories */
export function categoriesForProtein(protein: string): Category[] {
  const map: Record<string, Category[]> = {
    chicken: ["vistiena"],
    pork:    ["kiauliena", "grilinis"],
    beef:    ["jautiena", "grilinis"],
    fish:    ["zuvis"],
    lamb:    ["jautiena"],
  };
  return map[protein] ?? MAIN_CATEGORIES;
}

/** Free-text search across name, description, ingredients */
export function textSearch(query: string, pool: Product[] = allProducts): Product[] {
  const terms = normalizeText(query).split(/\s+/).filter((t) => t.length > 2);
  if (!terms.length) return [];

  return pool.filter((p) => {
    const haystack = normalizeText([p.name, p.description, ...p.ingredients].join(" "));
    return terms.some((t) => haystack.includes(t));
  });
}

/** Find a specific product by ID */
export function findById(id: string): Product | undefined {
  return allProducts.find((p) => p.id === id);
}

export type ProductNameMatch =
  | { kind: "match"; product: Product; confidence: number }
  | { kind: "ambiguous"; products: Product[] }
  | { kind: "none"; alternatives: Product[] };

const PRODUCT_QUERY_FILLERS = new Set([
  "add", "put", "place", "please", "one", "the", "a", "an", "to", "into", "in", "on", "my",
  "cart", "basket", "bag", "pridek", "prideti", "idek", "ideti", "dek", "prasau", "viena",
  "i", "mano", "krepseli", "krepselis", "krepselį",
]);

const NAME_CONNECTORS = new Set(["with", "and", "su", "ir", "bei", "of"]);
const GENERIC_PRODUCT_TERMS = new Set([
  "duck", "antiena", "antienos", "chicken", "vistiena", "pork", "kiauliena", "beef", "jautiena",
  "fish", "zuvis", "pizza", "pica", "salad", "salotos", "soup", "sriuba", "beer", "alus",
]);
const PRODUCT_TYPE_TERMS = new Set([
  "salad", "salotos", "pizza", "pica", "soup", "sriuba", "wok", "noodles", "makaronai", "rice",
  "ryziai", "snack", "uzkandis", "pancakes", "blynai", "lemonade", "limonadas", "cocktail", "kokteilis",
]);

function meaningfulNameTerms(text: string): string[] {
  return normalizeText(text)
    .split(/\s+/)
    .filter((term) => term.length > 1 && !PRODUCT_QUERY_FILLERS.has(term) && !NAME_CONNECTORS.has(term));
}

function nameTokenMatches(queryTerm: string, nameTerm: string): boolean {
  if (queryTerm === nameTerm) return true;
  if (queryTerm.length < 5 || nameTerm.length < 5) return false;
  const prefixLength = Math.min(queryTerm.length, nameTerm.length) - 1;
  return prefixLength >= 4 && queryTerm.slice(0, prefixLength) === nameTerm.slice(0, prefixLength);
}

function productAliases(product: Product): string[] {
  return [...new Set([
    product.name,
    tProduct(product.id, "en", "name", product.name),
    tProduct(product.id, "ru", "name", product.name),
  ])];
}

/**
 * Match a direct product-name request against canonical and translated menu names.
 * Returns ambiguity instead of silently choosing when candidates are too close.
 */
export function matchProductName(query: string): ProductNameMatch {
  const normalizedQuery = normalizeText(query);
  const queryTerms = meaningfulNameTerms(normalizedQuery);
  if (queryTerms.length === 0) return { kind: "none", alternatives: [] };

  const scored = allProducts.map((product) => {
    let bestScore = 0;
    for (const alias of productAliases(product)) {
      const normalizedAlias = normalizeText(alias);
      const aliasTerms = meaningfulNameTerms(normalizedAlias);
      const matchedTerms = queryTerms.filter((queryTerm) =>
        aliasTerms.some((nameTerm) => nameTokenMatches(queryTerm, nameTerm))
      );
      if (matchedTerms.length === 0) continue;

      const coverage = matchedTerms.length / queryTerms.length;
      const exactAliasInCommand = normalizedQuery.includes(normalizedAlias);
      const queryPhrase = queryTerms.join(" ");
      const aliasPhrase = aliasTerms.join(" ");
      const startsWithQuery = aliasPhrase.startsWith(queryPhrase);
      let score = exactAliasInCommand
        ? 1
        : coverage === 1
        ? 0.82 + (startsWithQuery ? 0.08 : 0) + (queryTerms.length >= 3 ? 0.03 : 0)
        : coverage * 0.65 + (matchedTerms.length / aliasTerms.length) * 0.2;

      const missingType = aliasTerms.some((term) => PRODUCT_TYPE_TERMS.has(term)) &&
        !queryTerms.some((term) => PRODUCT_TYPE_TERMS.has(term));
      if (missingType) score -= 0.18;
      bestScore = Math.max(bestScore, score);
    }
    return { product, score: bestScore };
  }).filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.product.id.localeCompare(b.product.id));

  if (scored.length === 0) return { kind: "none", alternatives: [] };

  const plausible = scored.filter((candidate) => candidate.score >= 0.55);
  const onlyGenericTerm = queryTerms.length === 1 && GENERIC_PRODUCT_TERMS.has(queryTerms[0]);
  if (onlyGenericTerm && plausible.length > 1) {
    return { kind: "ambiguous", products: plausible.slice(0, 4).map((candidate) => candidate.product) };
  }

  const [best, second] = scored;
  if (best.score >= 0.78 && (!second || best.score - second.score >= 0.08)) {
    return { kind: "match", product: best.product, confidence: best.score };
  }
  if (plausible.length > 1) {
    return { kind: "ambiguous", products: plausible.slice(0, 4).map((candidate) => candidate.product) };
  }
  if (best.score >= 0.78) {
    return { kind: "match", product: best.product, confidence: best.score };
  }
  return { kind: "none", alternatives: scored.filter((candidate) => candidate.score >= 0.2).slice(0, 3).map((candidate) => candidate.product) };
}

/** Find product(s) whose name best matches user input */
export function findByName(query: string): Product[] {
  const q = normalizeText(query);
  const exact = allProducts.filter((p) => normalizeText(p.name) === q);
  if (exact.length) return exact;

  const partial = allProducts.filter((p) => normalizeText(p.name).includes(q));
  if (partial.length) return partial;

  // Try Lithuanian inflected forms before fuzzy fallback
  const inflected = findByInflectedName(q);
  if (inflected) return [inflected];

  // Fuzzy: any word from query in name. Common verbs/fillers are excluded —
  // "turi" must not match "Ke-turi-ų sūrių".
  const FUZZY_STOP = new Set(["turi", "turit", "turite", "noriu", "kokia", "koks", "koki", "yra", "gal", "prasau", "prasom", "kiek", "kada", "kur"]);
  const words = q.split(/\s+/).filter((w) => w.length > 3 && !FUZZY_STOP.has(w));
  return allProducts.filter((p) => {
    const name = normalizeText(p.name);
    return words.some((w) => name.includes(w));
  });
}

/**
 * Derive nominative-like variants from an already-normalized word.
 * Works on post-normalizeText strings (Lithuanian diacritics already removed).
 * Conservative — only applies suffixes long enough to be unambiguous.
 */
function deriveStemVariants(word: string): string[] {
  const variants = new Set([word]);
  // [normalized_suffix, replacement] — applied to post-normalizeText strings
  const rules: Array<[string, string]> = [
    ["acijos", "acija"],  // degustacijos → degustacija
    ["aciju",  "acija"],  // degustaciju (ų→u after normalize) → degustacija
    ["acijas", "acija"],  // degustacijas → degustacija
    ["ienos",  "iena"],   // kiaulienos → kiauliena
    ["ienu",   "iena"],   // ienu (ų→u) → iena
    ["ienai",  "iena"],   // kiauliena (dative) → kiauliena
    ["iojas",  "iojus"],  // waiters
    ["eles",   "ele"],    // taureles → taurele
    ["uoliu",  "uoliai"], // uoliu (ų→u) → uoliai
  ];
  for (const [suffix, replacement] of rules) {
    if (word.endsWith(suffix)) {
      variants.add(word.slice(0, -suffix.length) + replacement);
    }
  }
  // Short general suffixes — only when remaining stem is 4+ chars
  if (word.endsWith("os") && word.length > 6)  variants.add(word.slice(0, -2) + "a");
  if (word.endsWith("es") && word.length > 6)  variants.add(word.slice(0, -2) + "e");
  if (word.endsWith("ius") && word.length > 6) variants.add(word.slice(0, -3) + "is");
  return [...variants];
}

/**
 * Find a product whose name matches the query in any Lithuanian grammatical form.
 * Only considers words with 7+ characters to avoid false positives from short words.
 * Works on already-normalized input.
 */
function findByInflectedName(normalizedQuery: string): Product | undefined {
  const words = normalizedQuery.split(/\s+/).filter((w) => w.length >= 7);
  // All query words (3+ chars) used for disambiguation scoring
  const allWords = normalizedQuery.split(/\s+/).filter((w) => w.length >= 3);

  const candidates: Product[] = [];
  for (const word of words) {
    const variants = deriveStemVariants(word).filter((v) => v.length >= 5);
    for (const product of allProducts) {
      const nameWords = normalizeText(product.name).split(/\s+/);
      if (variants.some((v) => nameWords.some((nw) => nw === v || nw.startsWith(v)))) {
        if (!candidates.includes(product)) candidates.push(product);
      }
    }
  }

  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];

  // Multiple candidates — score by how many query words appear in product name
  let best = candidates[0];
  let bestScore = 0;
  for (const product of candidates) {
    const name = normalizeText(product.name);
    const score = allWords.filter((w) => name.includes(w)).length;
    if (score > bestScore) { bestScore = score; best = product; }
  }
  return best;
}

/**
 * Public: find a product by its name in any Lithuanian grammatical form.
 * Useful when user refers to a product in genitive/accusative
 * (e.g. "noriu degustacijos" → "Alaus degustacija").
 */
export function findProductByInflectedName(query: string): Product | undefined {
  const normalized = normalizeText(query);
  return findByInflectedName(normalized) ?? findByExactNameWord(normalized);
}

/** Generic words that appear in many product names — never enough to identify one. */
const AMBIGUOUS_NAME_WORDS = new Set([
  "alus", "alaus", "vynas", "vyno", "kava", "kavos", "arbata", "arbatos",
  "sultys", "sulciu", "vanduo", "vandens", "sriuba", "sriubos", "salotos", "salotu",
  "mesa", "mesos", "padazas", "padazu", "duona", "duonos",
]);

/**
 * Fallback for short distinctive product names ("Čystas", "Šposas") that the
 * 7-char inflection matcher can't reach. Requires an EXACT word match (5+ chars)
 * against a product-name word that isn't generic.
 */
function findByExactNameWord(normalizedQuery: string): Product | undefined {
  const words = normalizedQuery
    .split(/\s+/)
    .filter((w) => w.length >= 5 && !AMBIGUOUS_NAME_WORDS.has(w));
  for (const word of words) {
    for (const product of allProducts) {
      const nameWords = normalizeText(product.name).split(/\s+/);
      if (nameWords.includes(word)) return product;
    }
  }
  return undefined;
}

/** Find a dish from conversational references, including common inflected names. */
export function findDishReference(query: string): Product | undefined {
  const normalized = normalizeText(query);
  const aliases: [RegExp, string][] = [
    [/\b(bbq|barbekiu).*(sonkaul|ribs)/i, "ki9"],
    [/\bsonkaul/i, "ki9"],
    [/\bkiaulienos?\s+sonin/i, "ki5"],
    [/\bsonin/i, "ki5"],
    [/\blasis/i, "z5"],
    [/\bbulvin(?:iai|iu|iu)?\s+blyn/i, "b4"],
    [/\bdidzkukul/i, "b1"],
    [/\bcepelin/i, "b1"],
    [/\bvistien/i, "v5"],
    [/\bzuv/i, "z5"],
    [/\bsalot/i, "s2"],
    [/\bpic|pizza/i, "p1"],
  ];

  for (const [pattern, id] of aliases) {
    if (pattern.test(normalized)) return findById(id);
  }

  const byNameMatches = findByName(normalized);
  if (byNameMatches.length > 0) return byNameMatches[0];
  return undefined;
}

/** Get all products priced within [min, max] */
export function byPriceRange(min: number, max: number, pool: Product[] = allProducts): Product[] {
  return pool.filter((p) => p.price >= min && p.price <= max);
}

/** Get products available for a specific allergen constraint */
export function withoutAllergen(allergen: string, pool: Product[] = allProducts): Product[] {
  return pool.filter((p) => !p.allergens.includes(allergen));
}

/** Shuffle array (deterministic seed not needed — random rotation is desired) */
export function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Pick n items from pool, preferring items not in excludeIds */
export function pickFresh(
  pool: Product[],
  n: number,
  excludeIds: string[]
): { items: Product[]; poolExhausted: boolean } {
  const excludeSet = new Set(excludeIds);
  const fresh = pool.filter((p) => !excludeSet.has(p.id));

  if (fresh.length >= n) {
    return { items: shuffle(fresh).slice(0, n), poolExhausted: false };
  }
  if (fresh.length > 0) {
    // Use what's left plus some from excluded to fill up to n
    const extra = shuffle(pool.filter((p) => excludeSet.has(p.id))).slice(0, n - fresh.length);
    return { items: shuffle([...fresh, ...extra]).slice(0, n), poolExhausted: false };
  }
  // Pool exhausted — reset and show from full pool
  return { items: shuffle(pool).slice(0, n), poolExhausted: true };
}
