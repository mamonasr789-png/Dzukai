/**
 * Keyword-ranked product search.
 *
 * Search strategy (in order):
 *   1. Score every product by how many user keywords match name/description/ingredients
 *   2. Return products sorted by score (highest first) — more matches = ranked higher
 *   3. Callers fall back to category-based recommendation only when score === 0
 *
 * Exact intent always beats category.  More keyword matches always rank above fewer.
 * Recommendation is the LAST fallback, never the first.
 */

import type { Product } from "../data.ts";
import { normalizeText } from "./synonyms.ts";

// ── Stop words ────────────────────────────────────────────────────────────────
// Describes HOW or WHY the user wants something, not WHAT.
// These must not contribute to product match scores.

const STOP_WORDS = new Set([
  // Lithuanian request verbs / politeness
  "noriu", "noreciau", "noréciau", "galétuméte", "galetumete",
  "galiu", "galite", "duokite", "duok",
  "rekomenduokite", "rekomenduok", "rekomenduoti",
  "pateikite", "patiekite", "padekite", "siulote",
  "prasom", "prasau",
  "imk", "paimk", "paimsiu", "imsiu", "paimsiu",
  // Greeting / affirmation
  "labas", "sveiki", "sveikas", "aciu", "dekui",
  "gerai", "taip", "tinka",
  // Diet person-nouns — "esu vegetaras" describes the PERSON, not a dish;
  // dish adjectives ("vegetariska") stay searchable.
  "vegetaras", "vegetare", "veganas", "vegane",
  "nesu", "nebesu", "apsigalvojau",
  // Generic filler — "vis dėlto picos" must not match "VIStienos" via "vis"
  "vis", "delto", "tada", "dabar", "gal", "tai", "tik", "jau", "bet", "arba",
  "kad", "nes", "dar", "irgi", "kartu",
  "kazka", "kazko", "kazkas", "kazkaip",
  "koka", "koki", "kokia", "kokiu",
  "yra", "buvo", "bus", "turi", "turiu", "turite", "turit",
  "siek", "tiek", "kiek",
  "daro", "gali",
  "labai", "visai", "tiesiog",
  // Mood descriptors — handled by filter engine, not by keyword scoring
  "sotaus", "sociai", "sotus", "sociu", "sociau", "sotos", "soto",
  "sotesnio", "sotesni", "sotesniu", "sotesne",
  "lengvo", "lengva", "lengviau", "lengvai", "lengvas", "lengvesni", "lengvesnio",
  "astraus", "astrias", "astriau",
  "astresnio", "astresni",
  "skanis", "skaniai", "skanus", "skaniu", "skanesnis", "skanesni",
  "geras", "gera", "gero", "geri", "geru", "geriau", "geresnis", "geresni",
  "sotesne", "pilnesnio",
  // English
  "want", "give", "bring", "order", "some", "please",
  "something", "anything", "great", "nice",
  // Russian
  "хочу", "дайте", "принесите", "пожалуйста",
]);

// ── Term extraction ───────────────────────────────────────────────────────────

/**
 * Extract meaningful search terms from a pre-normalized input string.
 * Drops stop words and very short tokens.
 */
export function extractSearchTerms(normalizedInput: string): string[] {
  return normalizedInput
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

// ── Term matching with Lithuanian stem relaxation ────────────────────────────

/**
 * Match a (normalized) search term against a (normalized) haystack.
 * Tries exact match first, then progressively shorter stems to handle
 * Lithuanian declension without a full morphological analyser.
 *
 * Examples:
 *   "lasiso" (lašišos genitive) → stem "lasis" → ✓ in "lasisa" (Lašiša)
 *   "snicelio"                  → stem "snicel" → ✓ in "snicelis"
 *   "šonkauliu"                 → "sonkauli" → ✓ in "sonkaulius"
 */
function termMatchesHaystack(term: string, haystack: string): boolean {
  if (haystack.includes(term)) return true;
  if (term.length >= 6 && haystack.includes(term.slice(0, -2))) return true;
  if (term.length >= 8 && haystack.includes(term.slice(0, -3))) return true;
  return false;
}

// ── Scoring ───────────────────────────────────────────────────────────────────

/**
 * Score a single product against extracted search terms.
 *
 * Weights:
 *   name match        → 3 pts  (product is literally called this)
 *   description match → 2 pts  (characteristic of the dish)
 *   ingredient match  → 1 pt   (contains this ingredient)
 *
 * Each term contributes at most once (takes the highest matching field).
 */
export function scoreProduct(product: Product, terms: string[]): number {
  const name = normalizeText(product.name);
  const firstWord = name.split(/\s+/)[0];
  const desc = normalizeText(product.description);
  const ings = normalizeText(product.ingredients.join(" "));

  let score = 0;
  for (const term of terms) {
    // 4 pts: term matches the PRIMARY subject (first word of name)
    // e.g. "lasisa" matches "lasisos" in "Lašišos kepsnys" → this IS a salmon dish
    if (termMatchesHaystack(term, firstWord))      score += 4;
    // 3 pts: term appears anywhere in product name
    else if (termMatchesHaystack(term, name))      score += 3;
    // 2 pts: term in description
    else if (termMatchesHaystack(term, desc))      score += 2;
    // 1 pt:  term in ingredients list
    else if (termMatchesHaystack(term, ings))      score += 1;
  }
  return score;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface KeywordSearchResult {
  /** Products sorted by descending match score. Empty if nothing matched. */
  products: { product: Product; score: number }[];
  /** Highest score achieved (0 if nothing matched). */
  topScore: number;
  /** Terms actually used for scoring (after stop-word removal). */
  terms: string[];
}

/**
 * Rank products in `pool` by how many user keywords they match.
 *
 * Priority:
 *   1. Products matching ALL keywords (top score)
 *   2. Products matching MOST keywords
 *   3. Products with any partial match
 *   4. Empty → caller falls back to generic recommendation
 */
export function keywordSearch(
  input: string,
  pool: Product[]
): KeywordSearchResult {
  const terms = extractSearchTerms(normalizeText(input));

  if (terms.length === 0) {
    return { products: [], topScore: 0, terms };
  }

  const scored = pool
    .map((p) => ({ product: p, score: scoreProduct(p, terms) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  return {
    products: scored,
    topScore: scored[0]?.score ?? 0,
    terms,
  };
}

/**
 * Pick the best `n` products from a keyword search, rotating to prefer
 * products not already shown (`excludeIds`).
 *
 * When there are multiple score tiers, products from the top tier are
 * always preferred even if they've been shown before.
 *
 * Returns `null` if `result` has no products (caller should use fallback).
 */
export function pickKeywordResults(
  result: KeywordSearchResult,
  n: number,
  excludeIds: string[]
): Product[] | null {
  if (result.products.length === 0) return null;

  const excludeSet = new Set(excludeIds);
  const topScore = result.products[0].score;

  // Top-tier products (matching the highest score) are always eligible —
  // if the user explicitly names a product they just saw recommended, the
  // rotation must not demote it. Lower-tier products rotate normally.
  const topTier  = result.products.filter((r) => r.score === topScore);
  const fresh     = result.products.filter((r) => !excludeSet.has(r.product.id));
  const all       = result.products;

  // Fill: top-tier first (regardless of exclusion), then fresh, then all
  const selected: Product[] = [];
  const seen = new Set<string>();

  for (const r of [...topTier, ...fresh, ...all]) {
    if (selected.length >= n) break;
    if (!seen.has(r.product.id)) {
      selected.push(r.product);
      seen.add(r.product.id);
    }
  }

  return selected.length > 0 ? selected : null;
}
