import type { Category, Product } from "../data.ts";
import type { ConversationState } from "./types.ts";
import { allProducts } from "./menuSearch.ts";
import { productViolatesRestrictions } from "./restrictionEngine.ts";
import { normalizeText } from "./normalizer.ts";

export interface AvailabilityQuery {
  category?: Category[];
  categoryLabel?: string;
  strictKind?: RegExp;
  modifiers: string[][];
  requestedLabel: string;
}

export interface AvailabilityResult {
  handled: boolean;
  found: Product[];
  alternatives: Product[];
  reply: string;
}

const availabilityPatterns = [
  /\bar\s+turite\b/i,
  /\bturite\b/i,
  /\bturit\b/i,
  /\byra\b/i,
  /\bar\s+yra\b/i,
  /\bgal\s+turite\b/i,
  /\bpas\s+jus\s+yra\b/i,
  /\bar\s+galima\s+gauti\b/i,
  /\bar\s+meniu\s+yra\b/i,
];

const categoryRules: { label: string; categories: Category[]; patterns: RegExp[]; strictKind?: RegExp }[] = [
  { label: "kokteilių", categories: ["kokteiliai", "alus-kokteiliai", "limonadai"], patterns: [/\bkokteil/i] },
  { label: "alaus", categories: ["alus", "nealko-alus"], patterns: [/\bal(?:us|aus|u|umi)\b/i] },
  { label: "vyno", categories: ["vynas", "sampanas"], patterns: [/\bvyn/i] },
  { label: "limonadų", categories: ["limonadai"], patterns: [/\blimonad/i], strictKind: /\blimonad/i },
  { label: "sulčių", categories: ["gerimai", "limonadai"], patterns: [/\bsult/i] },
  { label: "giros", categories: ["gerimai"], patterns: [/\bgir/i] },
  { label: "kavos", categories: ["kava"], patterns: [/\bkav/i] },
  { label: "arbatos", categories: ["kava"], patterns: [/\barbat/i] },
  { label: "picos", categories: ["picos"], patterns: [/\bpic|pizza/i] },
  { label: "burgerių", categories: ["jautiena", "vaikiskas"], patterns: [/\bburger/i] },
  { label: "salotų", categories: ["salotos"], patterns: [/\bsalot/i] },
  { label: "sriubų", categories: ["sriubos"], patterns: [/\bsriub/i] },
  { label: "desertų", categories: ["desertai"], patterns: [/\bdesert|pyrag|tort|brownie/i] },
  { label: "ledų", categories: ["desertai"], patterns: [/\bled/i] },
  { label: "kepsnių", categories: ["jautiena", "kiauliena", "vistiena", "zuvis"], patterns: [/\bkepsn/i] },
  { label: "žuvies", categories: ["zuvis"], patterns: [/\bzuv|lasis|tun|menk/i] },
  { label: "vištienos", categories: ["vistiena"], patterns: [/\bvistien|visciuk/i] },
  { label: "kiaulienos", categories: ["kiauliena"], patterns: [/\bkiaulien|sonin|sonkaul/i] },
  { label: "jautienos", categories: ["jautiena"], patterns: [/\bjautien|steik|antrekot/i] },
  { label: "vaikiško meniu", categories: ["vaikiskas"], patterns: [/\bvaikisk|vaiku\s+meniu|vaikams/i] },
];

const modifierRules: { label: string; stems: string[]; patterns: RegExp[]; impliedCategory?: Category[]; impliedLabel?: string }[] = [
  { label: "bananinio", stems: ["banan"], patterns: [/\bbanan/i] },
  { label: "braškinio", stems: ["brask", "braske"], patterns: [/\bbrask|braske/i] },
  { label: "mango", stems: ["mang"], patterns: [/\bmang/i] },
  { label: "vyšnių", stems: ["vysni", "vysn"], patterns: [/\bvysni|vysn/i] },
  { label: "aviečių", stems: ["aviet"], patterns: [/\baviet/i] },
  { label: "obuolių", stems: ["obuol"], patterns: [/\bobuol/i] },
  { label: "apelsinų", stems: ["apelsin"], patterns: [/\bapelsin/i] },
  { label: "citrinų", stems: ["citrin"], patterns: [/\bcitrin/i] },
  { label: "ananasų", stems: ["ananas"], patterns: [/\bananas/i] },
  { label: "persikų", stems: ["persik"], patterns: [/\bpersik/i] },
  { label: "mėlynių", stems: ["melyn"], patterns: [/\bmelyn/i] },
  { label: "kokosų", stems: ["kokos"], patterns: [/\bkokos/i] },
  { label: "šokoladinio", stems: ["sokolad"], patterns: [/\bsokolad/i] },
  { label: "vanilinio", stems: ["vanil"], patterns: [/\bvanil/i] },
  { label: "karamelinio", stems: ["karamel"], patterns: [/\bkaramel/i] },
  { label: "alkoholinio", stems: ["alkohol"], patterns: [/\balkoholinis\b/i] },
  { label: "nealkoholinio", stems: ["nealkohol", "alkoholfree"], patterns: [/\bnealkohol|be\s+alkoholio|alkoholfree/i] },
  { label: "stipraus", stems: ["stipr"], patterns: [/\bstipr/i] },
  { label: "silpno", stems: ["silpn"], patterns: [/\bsilpn/i] },
  { label: "šviesaus", stems: ["svies"], patterns: [/\bsvies/i] },
  { label: "tamsaus", stems: ["tams"], patterns: [/\btams/i] },
  { label: "IPA", stems: ["ipa", "indijos sviesusis elis"], patterns: [/\bipa\b/i], impliedCategory: ["alus"], impliedLabel: "alaus" },
  { label: "lagerio", stems: ["lager"], patterns: [/\blager/i], impliedCategory: ["alus"], impliedLabel: "alaus" },
  { label: "kvietinio", stems: ["kviet"], patterns: [/\bkviet/i], impliedCategory: ["alus"], impliedLabel: "alaus" },
  { label: "porterio", stems: ["porter"], patterns: [/\bporter/i], impliedCategory: ["alus"], impliedLabel: "alaus" },
  { label: "sidro", stems: ["sidr"], patterns: [/\bsidr/i], impliedCategory: ["sidras", "nealko-alus"], impliedLabel: "sidro" },
  { label: "sauso", stems: ["sausas", "dry"], patterns: [/\bsausas/i], impliedCategory: ["vynas"], impliedLabel: "vyno" },
  { label: "balto", stems: ["balt", "riesling", "sauvignon", "chardonnay", "pinot gris"], patterns: [/\bbalt/i], impliedCategory: ["vynas"], impliedLabel: "vyno" },
  { label: "raudono", stems: ["raudon", "malbec", "saperavi", "chianti", "rosso", "pinot nero", "grenache", "syrah", "sangiovese"], patterns: [/\braudon/i], impliedCategory: ["vynas"], impliedLabel: "vyno" },
  { label: "rožinio", stems: ["roz", "rose"], patterns: [/\brozin|rozin|rose/i], impliedCategory: ["vynas"], impliedLabel: "vyno" },
  { label: "putojančio", stems: ["putoj", "prosecco", "sampan", "cava", "cremant"], patterns: [/\bputoj/i], impliedCategory: ["sampanas"], impliedLabel: "vyno" },
  { label: "veganiško", stems: ["vegan", "augal"], patterns: [/\bvegan|augal/i] },
  { label: "vegetariško", stems: ["vegetar"], patterns: [/\bvegetar/i] },
  { label: "be glitimo", stems: ["be glitimo"], patterns: [/\bbe\s+glitim/i] },
  { label: "be laktozės", stems: ["be laktozes"], patterns: [/\bbe\s+laktoz/i] },
  { label: "be cukraus", stems: ["be cukraus"], patterns: [/\bbe\s+cukraus/i] },
  { label: "aštraus", stems: ["astr", "cili"], patterns: [/\bastr|cili/i] },
  { label: "saldaus", stems: ["sald"], patterns: [/\bsald/i] },
  { label: "rūgštaus", stems: ["rugst"], patterns: [/\brugst/i] },
  { label: "šalto", stems: ["salt"], patterns: [/\bsalt/i] },
  { label: "karšto", stems: ["karst"], patterns: [/\bkarst/i] },
];

export function answerAvailability(input: string, state: ConversationState): AvailabilityResult | null {
  const text = normalizeText(input);
  if (!availabilityPatterns.some((pattern) => pattern.test(text))) return null;

  const query = parseAvailabilityQuery(text);
  if (!query.category && query.modifiers.length === 0) return null;

  const safeProducts = allProducts.filter((p) => !productViolatesRestrictions(p, state));
  const pool = query.category ? safeProducts.filter((p) => productMatchesCategory(p, query)) : safeProducts;
  const exact = exactNameMatches(text, pool);
  const modifierMatches = query.modifiers.length > 0
    ? pool.filter((p) => productMatchesAllModifiers(p, query.modifiers))
    : [];
  const semanticMatches = query.modifiers.length === 0 ? pool : [];
  const found = sortByQueryCategory(uniqueProducts([...exact, ...modifierMatches, ...semanticMatches]), query);

  if (found.length > 0) {
    const shown = found.slice(0, 4);
    return {
      handled: true,
      found: shown,
      alternatives: [],
      reply: `Taip, turime ${query.requestedLabel}:\n${formatProducts(shown)}`,
    };
  }

  const alternatives = sortByQueryCategory(closestAlternatives(query, pool, safeProducts), query).slice(0, 4);
  return {
    handled: true,
    found: [],
    alternatives,
    reply: buildNotFoundReply(query, alternatives),
  };
}

function parseAvailabilityQuery(text: string): AvailabilityQuery {
  const categoryRule = categoryRules.find((rule) => rule.patterns.some((pattern) => pattern.test(text)));
  const modifierRulesMatched = modifierRules.filter((rule) => rule.patterns.some((pattern) => pattern.test(text)));
  const impliedRule = modifierRulesMatched.find((rule) => rule.impliedCategory);
  const modifiers = modifierRulesMatched.map((rule) => rule.stems);
  const modifierLabel = modifierRulesMatched[0]?.label;
  const categoryLabel = categoryRule?.label ?? impliedRule?.impliedLabel;
  const requestedLabel = [modifierLabel, categoryLabel].filter(Boolean).join(" ") || "šio produkto";

  return {
    category: categoryRule?.categories ?? impliedRule?.impliedCategory,
    categoryLabel,
    strictKind: categoryRule?.strictKind,
    modifiers,
    requestedLabel,
  };
}

function productMatchesCategory(product: Product, query: AvailabilityQuery): boolean {
  if (!query.category?.includes(product.category)) return false;
  if (!query.strictKind) return true;
  return query.strictKind.test(normalizeText([product.name, product.description].join(" ")));
}

function exactNameMatches(text: string, pool: Product[]): Product[] {
  const queryWords = text
    .replace(/\b(ar|gal|turite|turit|yra|pas|jus|galima|gauti|meniu)\b/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);

  return pool.filter((p) => {
    const name = normalizeText(p.name);
    return queryWords.length > 0 && queryWords.every((word) => name.includes(word));
  });
}

function productMatchesAllModifiers(product: Product, modifiers: string[][]): boolean {
  const text = normalizeText([product.name, product.description, ...product.ingredients].join(" "));
  return modifiers.every((group) => group.some((stem) => text.includes(normalizeText(stem))));
}

function closestAlternatives(query: AvailabilityQuery, categoryPool: Product[], safeProducts: Product[]): Product[] {
  if (query.category && categoryPool.length > 0) {
    return categoryPool;
  }
  return safeProducts.filter((p) => {
    if (!query.category) return false;
    return query.category.includes(p.category);
  });
}

function buildNotFoundReply(query: AvailabilityQuery, alternatives: Product[]): string {
  const base = `${capitalize(query.requestedLabel)} meniu nematau.`;
  if (alternatives.length === 0) {
    return `${base} Šiuo metu artimų alternatyvų pagal šį užklausimą neturiu.`;
  }
  return `${base} Galiu pasiūlyti artimiausias alternatyvas:\n${formatProducts(alternatives)}`;
}

function formatProducts(products: Product[]): string {
  return products.map((p) => {
    const price = p.price > 0 ? ` — **${p.price.toFixed(2)} €**` : "";
    return `• **${p.name}**${price}`;
  }).join("\n");
}

function uniqueProducts(products: Product[]): Product[] {
  const seen = new Set<string>();
  return products.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

function sortByQueryCategory(products: Product[], query: AvailabilityQuery): Product[] {
  if (!query.category) return products;
  const order = new Map(query.category.map((category, index) => [category, index]));
  return [...products].sort((a, b) => (order.get(a.category) ?? 99) - (order.get(b.category) ?? 99));
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
