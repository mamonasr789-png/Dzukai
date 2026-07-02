/**
 * Keyword search regression tests.
 *
 * Each test verifies that the keyword search pipeline ranks the most
 * specifically matching product above generic alternatives.
 *
 * Principle: exact intent beats category, more keyword matches rank higher.
 *
 * Run: node --experimental-strip-types src/lib/assistant/tests/keyword-search.test.ts
 */

import { describe, it, expect, printResults } from "./runner.ts";
import { keywordSearch, extractSearchTerms, scoreProduct } from "../keywordSearch.ts";
import { allProducts } from "../menuSearch.ts";
import { processMessage, createState } from "../brain.ts";
import { findById } from "../menuSearch.ts";
import { normalizeText } from "../synonyms.ts";
import type { ConversationState } from "../types.ts";

function state(lang = "lt"): ConversationState {
  return createState(lang);
}

// ── Helper: get top product from keyword search across all products ─────────

function topProduct(input: string, pool = allProducts) {
  const r = keywordSearch(input, pool);
  return r.products[0]?.product ?? null;
}

function topN(input: string, n: number, pool = allProducts) {
  const r = keywordSearch(input, pool);
  return r.products.slice(0, n).map((r) => r.product);
}

function topIds(input: string, n: number, pool = allProducts): string[] {
  return topN(input, n, pool).map((p) => p.id);
}

function topCategories(input: string, n: number, pool = allProducts): string[] {
  return topN(input, n, pool).map((p) => p.category);
}

// ── Helper: process message and check recommended ids/categories ───────────

function recIds(input: string): string[] {
  const s = state();
  processMessage(input, s);
  return s.lastRecommendedIds;
}

function recCategories(input: string): string[] {
  const ids = recIds(input);
  return ids.map((id) => findById(id)?.category ?? "unknown");
}

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 1 — Term extraction
// ══════════════════════════════════════════════════════════════════════════════

describe("Term extraction", () => {
  it("drops stop words", () => {
    const terms = extractSearchTerms("noriu kazka sotaus");
    expect(terms.every((t) => t !== "noriu")).toBeTruthy();
    expect(terms.every((t) => t !== "kazka")).toBeTruthy();
    expect(terms.every((t) => t !== "sotaus")).toBeTruthy();
  });

  it("drops words shorter than 3 chars", () => {
    const terms = extractSearchTerms("su ir ar ne");
    expect(terms.length).toBe(0);
  });

  it("keeps meaningful food terms", () => {
    const terms = extractSearchTerms("lasisa varske snicelis");
    expect(terms.length).toBeGreaterThan(0);
    expect(terms).toContain("lasisa");
  });

  it("keeps preparation method terms", () => {
    const terms = extractSearchTerms("grilije kepta vista");
    expect(terms).toContain("grilije");
  });

  it("returns empty for pure stop-word inputs", () => {
    const terms = extractSearchTerms("noriu kazko gero gerai taip");
    expect(terms.length).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 2 — Scoring basics
// ══════════════════════════════════════════════════════════════════════════════

describe("Product scoring", () => {
  it("name match scores higher than ingredient match", () => {
    const lasisaProduct = allProducts.find((p) => p.id === "z5")!; // Lašiša (salmon)
    const saladWithSalmon = allProducts.find((p) => p.id === "b6")!; // Bulviniai blynai su lašiša

    const scoreL = scoreProduct(lasisaProduct, ["lasisa"]);
    const scoreS = scoreProduct(saladWithSalmon, ["lasisa"]);
    expect(scoreL).toBeGreaterThan(scoreS);
  });

  it("more matched terms = higher score than fewer", () => {
    const bbqRibs = allProducts.find((p) => p.id === "ki9")!; // BBQ glazūruoti kiaulienos šonkauliai
    const plainPork = allProducts.find((p) => p.id === "ki6")!; // Kiaulienos išpjova

    const scoreRibs = scoreProduct(bbqRibs, ["bbq", "sonkauliai"]);
    const scorePlain = scoreProduct(plainPork, ["bbq", "sonkauliai"]);
    expect(scoreRibs).toBeGreaterThan(scorePlain);
  });

  it("zero score for irrelevant product", () => {
    const beer = allProducts.find((p) => p.id === "al1")!;
    const score = scoreProduct(beer, ["lasisa", "varske"]);
    expect(score).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 3 — Meat dishes
// ══════════════════════════════════════════════════════════════════════════════

describe("Meat keyword searches", () => {
  it("'BBQ šonkauliai' finds ki9 as top result", () => {
    const top = topProduct("bbq sonkauliai");
    expect(top?.id).toBe("ki9");
  });

  it("'Vienos šnicelis' finds a Vienos šnicelis dish (not generic pork)", () => {
    const top = topProduct("vienos snicelis");
    expect(top?.name.toLowerCase()).toContain("vienos");
    // Both ki2 (kiauliena) and v3 (vistiena) are valid — both are Vienos schnitzel
    expect(["kiauliena", "vistiena"]).toContain(top?.category);
  });

  it("'Vištienos šnicelis' finds chicken schnitzel specifically", () => {
    const top = topProduct("vistienos snicelis");
    expect(top?.id).toBe("v3"); // Vištienos Vienos šnicelis
  });

  it("'Kiaulienos šoninė' finds a belly/bacon dish, not ribs", () => {
    const top = topProduct("kiaulienos sonine");
    // ki5 = Kiaulienos šoninė (pork belly) or ki1 = BBQ šoninės juostelės
    expect(normalizeText(top?.name ?? "")).toContain("sonin");
    expect(top?.category).toBe("kiauliena");
  });

  it("'Jautienos antrekotas' finds the steak", () => {
    const top = topProduct("jautienos antrekotas");
    expect(top?.id).toBe("ja1");
  });

  it("'Jautienos antrekotas Surf and Turf' ranks ja2 above ja1", () => {
    const results = keywordSearch("jautienos antrekotas surf turf", allProducts);
    const ids = results.products.slice(0, 2).map((r) => r.product.id);
    expect(ids[0]).toBe("ja2");
  });

  it("'Avienos kebabas' finds the lamb kebab, not chicken kebab", () => {
    const top = topProduct("avienos kebabas");
    expect(top?.id).toBe("ja3");
  });

  it("'Tomahawk' finds the pork tomahawk", () => {
    const top = topProduct("tomahawk");
    expect(top?.id).toBe("ki8");
  });

  it("'Sparneliai' finds chicken wings", () => {
    const top = topProduct("sparneliai");
    expect(top?.id).toBe("v1");
  });

  it("'Vištienos sparneliai BBQ' ranks v1 as top", () => {
    const top = topProduct("vistienos sparneliai bbq");
    expect(top?.id).toBe("v1");
  });

  it("'Plėšyta jautiena' finds the pulled beef pizza above generic beef", () => {
    const top = topProduct("plesyta jautiena");
    expect(top?.id).toBe("p17"); // Pica su plėšyta jautiena
  });

  it("'Porchetta' finds the porchetta dish", () => {
    const top = topProduct("porchetta");
    expect(top?.id).toBe("ki10");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 4 — Fish dishes
// ══════════════════════════════════════════════════════════════════════════════

describe("Fish keyword searches", () => {
  it("'Lašiša' finds z5 (the salmon fillet)", () => {
    const top = topProduct("lasisa");
    expect(top?.id).toBe("z5");
  });

  it("'Tuno karpačio' ranks tuno karpačio above generic tuna", () => {
    const top = topProduct("tuno karpacio");
    expect(top?.id).toBe("u5");
  });

  it("'Silkė su grybais' finds u3 specifically", () => {
    const top = topProduct("silke gryb");
    expect(top?.id).toBe("u3");
  });

  it("'Silkė su svogūnais' finds u1 over other herring dishes", () => {
    const top = topProduct("silke svogunais");
    expect(top?.id).toBe("u1");
  });

  it("'Tom Yum sriuba' finds the tom yum soup", () => {
    // "tom" and "yum" are 3-char terms (min 3), so they are included
    const top = topProduct("Tom Yum sriuba");
    expect(top?.id).toBe("sr4");
  });

  it("'Tuno filė salotos' ranks s7 above generic tuna", () => {
    const top = topProduct("tuno file salotos");
    expect(top?.id).toBe("s7");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 5 — Salads
// ══════════════════════════════════════════════════════════════════════════════

describe("Salad keyword searches", () => {
  it("'Cezario salotos su vištiena' finds s2", () => {
    const top = topProduct("cezario salotos vistiena");
    expect(top?.id).toBe("s2");
  });

  it("'Cezario salotos su krevetėmis' ranks s3 above s2", () => {
    const top = topProduct("cezario salotos krevetems");
    expect(top?.id).toBe("s3");
  });

  it("'Salotos su antiena' finds duck salad s6", () => {
    const top = topProduct("salotos antiena");
    expect(top?.id).toBe("s6");
  });

  it("'Burrata sūris Serano kumpio salotos' finds s4", () => {
    const top = topProduct("burrata serano kumpio salotos");
    expect(top?.id).toBe("s4");
  });

  it("'Graikiškos salotos' finds s5", () => {
    const top = topProduct("graikiškos salotos");
    expect(top?.id).toBe("s5");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 6 — Soups
// ══════════════════════════════════════════════════════════════════════════════

describe("Soup keyword searches", () => {
  it("'Šaltibarščiai' finds the cold borscht", () => {
    // normalizeText("Šaltibarščiai") = "saltibarsciai" (š+č decompose differently)
    const top = topProduct("Šaltibarščiai");
    expect(top?.id).toBe("sr1");
  });

  it("'Kopūstienė su baravykais' finds sr2", () => {
    const top = topProduct("kopustiene baravykai");
    expect(top?.id).toBe("sr2");
  });

  it("'Aštri čili sriuba' finds sr3", () => {
    const top = topProduct("cili sriuba");
    expect(top?.id).toBe("sr3");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 7 — Potato dishes
// ══════════════════════════════════════════════════════════════════════════════

describe("Potato dish keyword searches", () => {
  it("'Didžkukuliai' finds b1", () => {
    const top = topProduct("didzkukuliai");
    expect(top?.id).toBe("b1");
  });

  it("'Bulviniai blynai su lašiša' finds b6 above plain blynai", () => {
    const top = topProduct("bulviniai blynai lasisa");
    expect(top?.id).toBe("b6");
  });

  it("'Bulvinės bandos su baravykais' finds b8", () => {
    const top = topProduct("bulvines bandos baravyku");
    expect(top?.id).toBe("b8");
  });

  it("'Žemaičių blynai' finds b3", () => {
    const top = topProduct("zemaiciai blynai");
    expect(top?.id).toBe("b3");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 8 — Pizza
// ══════════════════════════════════════════════════════════════════════════════

describe("Pizza keyword searches", () => {
  it("'Pepperoni' finds Pepperoni pizza above generic meat pizza", () => {
    const results = keywordSearch("pepperoni", allProducts);
    const top = results.products[0]?.product;
    expect(top?.name.toLowerCase()).toContain("pepperoni");
  });

  it("'Pepperoni aštri' ranks p16 above p15", () => {
    const top = topProduct("pepperoni astri");
    expect(top?.id).toBe("p16");
  });

  it("'Margarita' finds the Margherita pizza", () => {
    const top = topProduct("margarita");
    expect(top?.id).toBe("p1");
  });

  it("'Chačapuri su faršu' ranks p7 above p6", () => {
    const top = topProduct("cacapuri farsu");
    expect(top?.id).toBe("p7");
  });

  it("'Keturių sūrių' finds p3", () => {
    const top = topProduct("keturiu suriu");
    expect(top?.id).toBe("p3");
  });

  it("'Saliamis ir jalapeño pipirai' finds p8 (salami+jalapeño)", () => {
    const top = topProduct("saliamiu chalapos pipirai");
    expect(top?.id).toBe("p8");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 9 — Wok / Asian dishes
// ══════════════════════════════════════════════════════════════════════════════

describe("Wok keyword searches", () => {
  it("'Wok makaronai su jautiena' finds w2", () => {
    const top = topProduct("wok makaronai jautiena");
    expect(top?.id).toBe("w2");
  });

  it("'Wok ryžiai su antiena' finds w7 above w3", () => {
    const top = topProduct("wok ryziai antiena");
    expect(top?.id).toBe("w7");
  });

  it("'Wok jūros gėrybės' ranks seafood wok highest", () => {
    const results = keywordSearch("wok juros gerybemis", allProducts);
    const topCats = results.products.slice(0, 2).map((r) => r.product.id);
    // w4 or w8 should be at the top (seafood wok noodles or rice)
    expect(topCats.some((id) => id === "w4" || id === "w8")).toBeTruthy();
  });

  it("'Gyoza' finds the gyoza dumplings", () => {
    const top = topProduct("gyoza");
    expect(top?.id).toBe("k4");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 10 — Appetizers / Beer snacks
// ══════════════════════════════════════════════════════════════════════════════

describe("Appetizer keyword searches", () => {
  it("'Jautienos karpačio' finds u4", () => {
    const top = topProduct("jautienos karpacio");
    expect(top?.id).toBe("u4");
  });

  it("'Silkė' finds herring appetizers, not generic fish", () => {
    const top = topProduct("silke");
    expect(top?.category).toBe("uzkandziai");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 11 — Desserts
// ══════════════════════════════════════════════════════════════════════════════

describe("Dessert keyword searches", () => {
  it("Dessert query routes to dessert category", () => {
    const cats = recCategories("Noriu šokoladinio deserto");
    expect(cats.every((c) => c === "desertai")).toBeTruthy();
  });

  it("Dessert request via processMessage stays in desertai", () => {
    const s = state();
    processMessage("Noriu deserto", s);
    expect(s.lastRecommendedIds.length).toBeGreaterThan(0);
    s.lastRecommendedIds.forEach((id) => {
      expect(findById(id)?.category).toBe("desertai");
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 12 — Beer / Alcoholic drinks
// ══════════════════════════════════════════════════════════════════════════════

describe("Beer and spirits keyword searches", () => {
  it("'Alaus degustacija' finds al8 specifically", () => {
    const top = topProduct("alaus degustacija");
    expect(top?.id).toBe("al8");
  });

  it("'Sezoninis alus' finds the seasonal beer", () => {
    const top = topProduct("sezoninis alus");
    expect(top?.id).toBe("al7");
  });

  it("'Whiskey Sour' finds the cocktail", () => {
    const top = topProduct("whiskey sour");
    expect(top?.name.toLowerCase()).toContain("whiskey sour");
  });

  it("'Jameson' finds the Jameson whiskey", () => {
    const top = topProduct("jameson");
    expect(top?.name.toLowerCase()).toContain("jameson");
  });

  it("'Espresso Martini' finds the specific cocktail", () => {
    const top = topProduct("espresso martini");
    expect(top?.name.toLowerCase()).toContain("espresso martini");
  });

  it("'Aperol Spritz' finds the cocktail (not the non-alcoholic version)", () => {
    const top = topProduct("aperol spritz");
    expect(top?.name.toLowerCase()).toContain("aperol spritz");
  });

  it("'Braškinis Mojito' finds the strawberry mojito", () => {
    const top = topProduct("braskinis mojito");
    expect(top?.name.toLowerCase()).toContain("mojito");
  });

  it("'Midus' finds the mead (suktinis midus)", () => {
    const top = topProduct("midus");
    expect(top?.name.toLowerCase()).toContain("mid");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 13 — Non-alcoholic drinks
// ══════════════════════════════════════════════════════════════════════════════

describe("Non-alcoholic drink keyword searches", () => {
  it("'Nealkoholinis Mojito' finds the non-alcoholic mojito", () => {
    const top = topProduct("nealkoholinis mojito");
    expect(top?.name.toLowerCase()).toContain("mojito");
    expect(top?.name.toLowerCase()).toContain("nealkohol");
  });

  it("'Red Bull' finds the energy drink", () => {
    const top = topProduct("red bull");
    expect(top?.name.toLowerCase()).toContain("red bull");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 14 — Wine / Champagne
// ══════════════════════════════════════════════════════════════════════════════

describe("Wine keyword searches", () => {
  it("'Prosecco' finds the Prosecco", () => {
    const top = topProduct("prosecco");
    expect(top?.name.toLowerCase()).toContain("prosecco");
  });

  it("'Mojito nealkoholinis' ranks non-alcoholic mojito highest", () => {
    const top = topProduct("mojito nealkoholinis");
    expect(top?.name.toLowerCase()).toContain("nealkohol");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 15 — Keyword search via processMessage (full pipeline)
// ══════════════════════════════════════════════════════════════════════════════

describe("Keyword search via processMessage", () => {
  it("'Noriu BBQ šonkaulių' recommends ki9 specifically", () => {
    const s = state();
    processMessage("Noriu BBQ šonkaulių", s);
    expect(s.lastRecommendedIds).toContain("ki9");
  });

  it("'Noriu Vienos šnicelio' finds schnitzel, not random pork", () => {
    const s = state();
    processMessage("Noriu Vienos šnicelio", s);
    const products = s.lastRecommendedIds.map((id) => findById(id));
    const hasSchnitzel = products.some((p) => p?.name.toLowerCase().includes("vienos"));
    expect(hasSchnitzel).toBeTruthy();
  });

  it("'Noriu lašišos' recommends the salmon dish", () => {
    const s = state();
    processMessage("Noriu lašišos", s);
    expect(s.lastRecommendedIds[0]).toBe("z5");
  });

  it("'Noriu Cezario salotų su vištiena' recommends s2 specifically", () => {
    const s = state();
    processMessage("Noriu Cezario salotų su vištiena", s);
    expect(s.lastRecommendedIds[0]).toBe("s2");
  });

  it("'Noriu Cezario salotų su krevetėmis' recommends s3 over s2", () => {
    const s = state();
    processMessage("Noriu Cezario salotų su krevetėmis", s);
    expect(s.lastRecommendedIds[0]).toBe("s3");
  });

  it("'Noriu alaus degustacijos' finds the tasting board", () => {
    const s = state();
    processMessage("Noriu alaus degustacijos", s);
    expect(s.lastRecommendedIds).toContain("al8");
  });

  it("'Noriu silkės su grybais' finds u3", () => {
    const s = state();
    processMessage("Noriu silkės su grybais", s);
    expect(s.lastRecommendedIds[0]).toBe("u3");
  });

  it("'Noriu Tom Yum sriubos' finds the Tom Yum", () => {
    const s = state();
    processMessage("Noriu Tom Yum sriubos", s);
    expect(s.lastRecommendedIds).toContain("sr4");
  });

  it("'Noriu Porchetta' finds ki10", () => {
    const s = state();
    processMessage("Noriu Porchetta", s);
    expect(s.lastRecommendedIds).toContain("ki10");
  });

  it("'Noriu Gyoza koldūnų su aviena' finds k4", () => {
    const s = state();
    processMessage("Noriu Gyoza koldūnų su aviena", s);
    expect(s.lastRecommendedIds).toContain("k4");
  });

  it("'Noriu Wok makaronų su jautiena' finds w2", () => {
    const s = state();
    processMessage("Noriu wok makaronų su jautiena", s);
    expect(s.lastRecommendedIds[0]).toBe("w2");
  });

  it("'Noriu Margarita picos' finds p1", () => {
    const s = state();
    processMessage("Noriu Margarita picos", s);
    expect(s.lastRecommendedIds).toContain("p1");
  });

  it("'Noriu Chačapuri su faršu' finds p7", () => {
    const s = state();
    processMessage("Noriu Chačapuri su faršu", s);
    expect(s.lastRecommendedIds).toContain("p7");
  });

  it("Generic 'Noriu valgyti' still returns food (fallback)", () => {
    const s = state();
    processMessage("Noriu valgyti", s);
    expect(s.lastRecommendedIds.length).toBeGreaterThan(0);
    const cats = s.lastRecommendedIds.map((id) => findById(id)?.category ?? "");
    const foodCats = ["uzkandziai", "salotos", "sriubos", "lietiniai", "koldumai",
                      "wok", "bulviniai", "picos", "grilinis", "vistiena",
                      "kiauliena", "jautiena", "zuvis", "vaikiskas", "prie-alaus"];
    expect(cats.every((c) => foodCats.includes(c))).toBeTruthy();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 16 — Ranking: more keywords = higher rank
// ══════════════════════════════════════════════════════════════════════════════

describe("Ranking: more matched keywords = higher rank", () => {
  it("'BBQ šonkauliai kiauliena' ranks ki9 above all other pork", () => {
    const results = keywordSearch("bbq sonkauliai kiauliena", allProducts);
    expect(results.products[0]?.product.id).toBe("ki9");
  });

  it("'Cezario salotos krevetės' ranks s3 above s2", () => {
    const results = keywordSearch("cezario salotos krevetes", allProducts);
    const ids = results.products.slice(0, 2).map((r) => r.product.id);
    expect(ids[0]).toBe("s3");
  });

  it("'Vištienos Vienos šnicelis' outscores plain 'Vištienos šašlykas'", () => {
    const results = keywordSearch("vistienos vienos snicelis", allProducts);
    const v3 = results.products.find((r) => r.product.id === "v3");
    const v2 = results.products.find((r) => r.product.id === "v2");
    expect(v3!.score).toBeGreaterThan(v2?.score ?? 0);
  });

  it("'Wok ryžiai antiena' outscores 'Wok ryžiai jautiena' for w7", () => {
    const results = keywordSearch("wok ryziai antiena", allProducts);
    const w7 = results.products.find((r) => r.product.id === "w7");
    const w6 = results.products.find((r) => r.product.id === "w6");
    expect(w7!.score).toBeGreaterThan(w6?.score ?? 0);
  });

  it("'Silkė grybai bulvės' ranks u3 at top (3 terms matched)", () => {
    const top = topProduct("silke gryb bulves");
    expect(top?.id).toBe("u3");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 17 — Edge cases
// ══════════════════════════════════════════════════════════════════════════════

describe("Edge cases", () => {
  it("empty input returns empty results", () => {
    const r = keywordSearch("", allProducts);
    expect(r.products.length).toBe(0);
    expect(r.topScore).toBe(0);
  });

  it("only stop words returns empty results", () => {
    const r = keywordSearch("noriu gerai taip labas", allProducts);
    expect(r.products.length).toBe(0);
  });

  it("'noriu alaus' generic beer request goes to alus category", () => {
    const cats = recCategories("Noriu alaus");
    expect(cats.every((c) => ["alus", "alus-kokteiliai", "nealko-alus"].includes(c))).toBeTruthy();
  });

  it("vegetarian filter still applies during keyword search", () => {
    const s = state();
    s.vegetarian = true;
    processMessage("Noriu salotos", s);
    s.lastRecommendedIds.forEach((id) => {
      const p = findById(id);
      if (p) {
        const hasMeat = p.ingredients.join(" ").toLowerCase().includes("vistiena")
          || p.ingredients.join(" ").toLowerCase().includes("jautiena")
          || p.ingredients.join(" ").toLowerCase().includes("kiauliena");
        expect(hasMeat).toBeFalsy();
      }
    });
  });

  it("budget filter still applies during keyword search", () => {
    const s = state();
    s.budget = 10;
    processMessage("Noriu vištienos", s);
    s.lastRecommendedIds.forEach((id) => {
      const p = findById(id);
      if (p && p.price > 0) {
        expect(p.price).toBeLessThanOrEqual(10);
      }
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// RUN
// ══════════════════════════════════════════════════════════════════════════════

printResults();
