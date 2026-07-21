/**
 * Waiter audit regression tests — locks in behaviors fixed during the full
 * assistant audit: ordinal selection, cart summary detection, remove/undo verbs,
 * beer snacks, Cyrillic/EN ordering triggers, quantity parsing, restriction
 * cancellation, greeting handling, browse-vs-order guard.
 *
 * Run: node --experimental-strip-types src/lib/assistant/tests/waiter-audit.test.ts
 */

import { describe, it, expect, printResults } from "./runner.ts";
import { processMessage, createState } from "../brain.ts";
import { findById } from "../menuSearch.ts";
import type { ConversationState } from "../types.ts";
import { tProduct } from "../../product-translations.ts";

function state(lang = "lt"): ConversationState {
  return createState(lang);
}

function addedProduct(s: ConversationState) {
  const a = s.pendingActions?.[0];
  return a && a.type === "ADD_TO_CART" ? findById(a.productId) : undefined;
}

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 1 — Ordinal / superlative selection from shown list
// ══════════════════════════════════════════════════════════════════════════════

describe("Audit: ordinal selection", () => {
  it("'Antrą prašau' adds the SECOND shown product", () => {
    const s = state();
    processMessage("Ką rekomenduojate?", s);
    const secondId = s.lastRecommendedIds[1];
    processMessage("Antrą prašau", s);
    expect(s.pendingActions!.length).toBeGreaterThan(0);
    expect(s.pendingActions![0].type).toBe("ADD_TO_CART");
    expect((s.pendingActions![0] as { productId: string }).productId).toBe(secondId);
  });

  it("'Imsiu pirmą' adds the FIRST shown product", () => {
    const s = state();
    processMessage("Ką rekomenduojate?", s);
    const firstId = s.lastRecommendedIds[0];
    processMessage("Imsiu pirmą", s);
    expect((s.pendingActions![0] as { productId: string }).productId).toBe(firstId);
  });

  it("'paskutinį' adds the LAST shown product", () => {
    const s = state();
    processMessage("Ką rekomenduojate?", s);
    const lastId = s.lastRecommendedIds[s.lastRecommendedIds.length - 1];
    processMessage("Imsiu paskutinį", s);
    expect((s.pendingActions![0] as { productId: string }).productId).toBe(lastId);
  });

  it("'Tą pigiausią' adds the cheapest of the shown products", () => {
    const s = state();
    processMessage("Ką rekomenduojate?", s);
    const cheapest = s.lastRecommendedIds
      .map(findById)
      .filter((p) => p !== undefined)
      .sort((a, b) => a!.price - b!.price)[0]!;
    processMessage("Tą pigiausią", s);
    expect((s.pendingActions![0] as { productId: string }).productId).toBe(cheapest.id);
  });

  it("'Duok tą brangiausią' adds the most expensive of the shown products", () => {
    const s = state();
    processMessage("Ką rekomenduojate?", s);
    const priciest = s.lastRecommendedIds
      .map(findById)
      .filter((p) => p !== undefined)
      .sort((a, b) => b!.price - a!.price)[0]!;
    processMessage("Duok tą brangiausią", s);
    expect((s.pendingActions![0] as { productId: string }).productId).toBe(priciest.id);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 2 — Cart summary detection
// ══════════════════════════════════════════════════════════════════════════════

describe("Audit: cart summary phrasings", () => {
  const phrasings = [
    "Kas mano krepšelyje?",
    "Parodyk krepšelį",
    "Kiek moku už viską?",
  ];
  phrasings.forEach((q) => {
    it(`'${q}' shows the cart, not a recommendation`, () => {
      const s = state();
      s.cartItems = [{ productId: "p1", quantity: 1, name: "Margarita", price: 9 }];
      const r = processMessage(q, s);
      expect(r).toContain("Margarita");
    });
  });

  it("empty cart says it's empty", () => {
    const s = state();
    const r = processMessage("Kas mano krepšelyje?", s);
    expect(r).toContain("tuščias");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 3 — Remove / undo verbs
// ══════════════════════════════════════════════════════════════════════════════

describe("Audit: remove and undo", () => {
  it("'Nuimk jį' removes the just-added product", () => {
    const s = state();
    processMessage("Ką rekomenduojate?", s);
    processMessage("Imsiu pirmą", s);
    const added = (s.pendingActions![0] as { productId: string }).productId;
    processMessage("Nuimk jį", s);
    expect(s.pendingActions![0].type).toBe("REMOVE_FROM_CART");
    expect((s.pendingActions![0] as { productId: string }).productId).toBe(added);
  });

  it("'Atšauk paskutinį' removes the last added product", () => {
    const s = state();
    processMessage("Ką rekomenduojate?", s);
    processMessage("Taip", s);
    const added = (s.pendingActions![0] as { productId: string }).productId;
    processMessage("Atšauk paskutinį", s);
    expect(s.pendingActions![0].type).toBe("REMOVE_FROM_CART");
    expect((s.pendingActions![0] as { productId: string }).productId).toBe(added);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 4 — Beer snacks are food, not beer
// ══════════════════════════════════════════════════════════════════════════════

describe("Audit: beer snacks", () => {
  const phrasings = ["Ką užkąsti prie alaus?", "Duok užkandžių prie alaus"];
  phrasings.forEach((q) => {
    it(`'${q}' recommends FOOD from prie-alaus, not beer`, () => {
      const s = state();
      processMessage(q, s);
      expect(s.lastRecommendedIds.length).toBeGreaterThan(0);
      const categories = s.lastRecommendedIds.map((id) => findById(id)?.category);
      const hasBeer = categories.some((c) => c === "alus" || c === "nealko-alus");
      expect(hasBeer).toBeFalsy();
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 5 — Cyrillic and English ordering triggers
// ══════════════════════════════════════════════════════════════════════════════

describe("Audit: RU/EN ordering triggers", () => {
  it("RU 'Возьму первое' actually adds to cart", () => {
    const s = state("ru");
    processMessage("Что порекомендуете?", s);
    const firstId = s.lastRecommendedIds[0];
    processMessage("Возьму первое", s);
    expect(s.pendingActions!.length).toBeGreaterThan(0);
    expect(s.pendingActions![0].type).toBe("ADD_TO_CART");
    expect((s.pendingActions![0] as { productId: string }).productId).toBe(firstId);
  });

  it("EN 'I'll take the first one' actually adds to cart", () => {
    const s = state("en");
    processMessage("What do you recommend?", s);
    const firstId = s.lastRecommendedIds[0];
    processMessage("I'll take the first one", s);
    expect(s.pendingActions!.length).toBeGreaterThan(0);
    expect((s.pendingActions![0] as { productId: string }).productId).toBe(firstId);
  });

  it("EN 'Remove it' removes", () => {
    const s = state("en");
    processMessage("What do you recommend?", s);
    processMessage("I'll take it", s);
    processMessage("Remove it", s);
    expect(s.pendingActions![0].type).toBe("REMOVE_FROM_CART");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 6 — Quantity parsing
// ══════════════════════════════════════════════════════════════════════════════

describe("Audit: quantity", () => {
  it("'Imsiu dvi pirmas' adds quantity 2", () => {
    const s = state();
    processMessage("Ką rekomenduojate?", s);
    processMessage("Imsiu dvi pirmas", s);
    const a = s.pendingActions![0];
    expect(a.type).toBe("ADD_TO_CART");
    expect((a as { quantity: number }).quantity).toBe(2);
  });

  it("'Imsiu 3 pirmus' adds quantity 3", () => {
    const s = state();
    processMessage("Ką rekomenduojate?", s);
    processMessage("Imsiu 3 pirmus", s);
    expect((s.pendingActions![0] as { quantity: number }).quantity).toBe(3);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 7 — Restriction cancellation
// ══════════════════════════════════════════════════════════════════════════════

describe("Audit: restriction cancellation", () => {
  it("'nesu vegetaras' clears the vegetarian flag", () => {
    const s = state();
    processMessage("Esu vegetaras", s);
    expect(s.vegetarian).toBeTruthy();
    processMessage("Apsigalvojau, nesu vegetaras", s);
    expect(s.vegetarian).toBeFalsy();
    expect(s.noMeat).toBeFalsy();
  });

  it("'valgau viską' clears vegan too", () => {
    const s = state();
    processMessage("Esu veganas", s);
    expect(s.vegan).toBeTruthy();
    processMessage("Valgau viską", s);
    expect(s.vegan).toBeFalsy();
    expect(s.noAnimalProducts).toBeFalsy();
  });

  it("after cancelling, pork recommendations are pork", () => {
    const s = state();
    processMessage("Esu vegetaras", s);
    processMessage("Apsigalvojau, nesu vegetaras. Noriu kiaulienos", s);
    const cats = s.lastRecommendedIds.map((id) => findById(id)?.category);
    expect(cats.includes("kiauliena")).toBeTruthy();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 8 — Browse vs order guard
// ══════════════════════════════════════════════════════════════════════════════

describe("Audit: category browse does not add to cart", () => {
  it("'Noriu kiaulienos' after recommendations browses, not orders", () => {
    const s = state();
    processMessage("Ką rekomenduojate?", s);
    processMessage("Noriu kiaulienos", s);
    const acts = s.pendingActions ?? [];
    expect(acts.length).toBe(0);
    const cats = s.lastRecommendedIds.map((id) => findById(id)?.category);
    expect(cats.includes("kiauliena")).toBeTruthy();
  });

  it("'Noreciau tuno karpacio' after recommendations DOES add (specific product)", () => {
    const s = state();
    processMessage("Ka rekomenduojate", s);
    processMessage("Noreciau tuno karpacio", s);
    expect(s.pendingActions!.length).toBeGreaterThan(0);
    expect(addedProduct(s)?.id).toBe("u5");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 9 — Greeting and misc conversational sanity
// ══════════════════════════════════════════════════════════════════════════════

describe("Audit: greeting", () => {
  it("'Labas' gets a greeting, not a recommendation dump", () => {
    const s = state();
    const r = processMessage("Labas", s);
    expect(r).toContain("Sveiki");
    expect(s.lastRecommendedIds.length).toBe(0);
  });

  it("greeting followed by request works normally", () => {
    const s = state();
    processMessage("Labas", s);
    processMessage("Ką rekomenduojate?", s);
    expect(s.lastRecommendedIds.length).toBeGreaterThan(0);
  });
});

describe("Audit: short beer name ordering", () => {
  it("'Gerai, imsiu alaus Čystas' after pairing adds Čystas 5%", () => {
    const s = state();
    processMessage("Ką rekomenduojate?", s);
    processMessage("Imsiu pirmą", s);
    processMessage("Ką prie jo gerti?", s);
    processMessage("Gerai, imsiu alaus Čystas", s);
    expect(s.pendingActions!.length).toBeGreaterThan(0);
    const p = addedProduct(s);
    expect(p?.name).toContain("Čystas");
  });
});

describe("Audit: ingredient question beats protein group", () => {
  it("'Iš ko pagamintas Tuno karpačio?' returns ingredients", () => {
    const s = state();
    const r = processMessage("Iš ko pagamintas Tuno karpačio?", s);
    expect(r).toContain("Sudėtis");
    expect(r).toContain("Tuno karpačio");
  });
});

describe("Audit: category switch clears stale category", () => {
  it("pizza then beef switches to beef products", () => {
    const s = state();
    processMessage("Noriu picos", s);
    processMessage("O dabar kažko su jautiena", s);
    const cats = s.lastRecommendedIds.map((id) => findById(id)?.category);
    expect(cats.every((c) => c !== "picos")).toBeTruthy();
  });
});

describe("Audit: no hallucinated cart adds", () => {
  it("confirmation replies never claim 'added' without an ADD_TO_CART action", () => {
    // 30 randomized confirmation turns — reply may claim an add only when an
    // ADD_TO_CART action is actually attached.
    for (let i = 0; i < 30; i++) {
      const s = state();
      processMessage("Ką rekomenduojate?", s);
      const r = processMessage("Taip", s);
      const hasAdd = (s.pendingActions ?? []).some((a) => a.type === "ADD_TO_CART");
      const claimsAdd = /pridedu|pridėta|added|добавил/i.test(r);
      if (claimsAdd) expect(hasAdd).toBeTruthy();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 10 — Second audit round: swap, out-of-range ordinal, honesty, hours
// ══════════════════════════════════════════════════════════════════════════════

describe("Audit: mind-change swap", () => {
  it("'Ne, palauk, geriau antrą' removes the added item and adds the second", () => {
    const s = state();
    processMessage("Ką rekomenduojate?", s);
    const secondId = s.lastRecommendedIds[1];
    processMessage("Imsiu pirmą", s);
    const firstId = (s.pendingActions![0] as { productId: string }).productId;
    processMessage("Ne, palauk, geriau antrą", s);
    const acts = s.pendingActions!;
    expect(acts.length).toBe(2);
    expect(acts[0].type).toBe("REMOVE_FROM_CART");
    expect((acts[0] as { productId: string }).productId).toBe(firstId);
    expect(acts[1].type).toBe("ADD_TO_CART");
    expect((acts[1] as { productId: string }).productId).toBe(secondId);
  });
});

describe("Audit: out-of-range ordinal", () => {
  it("'Imsiu penktą' with 3 shown does NOT blind-add anything", () => {
    const s = state();
    processMessage("Ką rekomenduojate?", s);
    if (s.lastRecommendedIds.length < 5) {
      processMessage("Imsiu penktą", s);
      const adds = (s.pendingActions ?? []).filter((a) => a.type === "ADD_TO_CART");
      expect(adds.length).toBe(0);
    }
  });
});

describe("Audit: honesty about unavailable dishes", () => {
  it("'Ar turite sushi?' admits we don't have it", () => {
    const s = state();
    const r = processMessage("Ar turite sushi?", s);
    expect(r).toContain("nėra");
  });

  it("'Ar turite kebabu?' finds the kebabs we DO have", () => {
    const s = state();
    const r = processMessage("Ar turite kebabu?", s);
    expect(r).toContain("kebab");
    expect(r).notToContain("nėra");
  });
});

describe("Audit: opening hours phrasing", () => {
  it("'Ar dirbate pirmadienį?' returns working hours", () => {
    const s = state();
    const r = processMessage("Ar dirbate pirmadienį?", s);
    expect(r).toContain("Darbo laikas");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 11 — Mass customer simulation fixes (1008-conversation run)
// ══════════════════════════════════════════════════════════════════════════════

describe("Sim: negation never adds to cart", () => {
  const rejections = ["Ne šitą", "ne sita", "nu ne šitą", "Ne šitą...", "Ne, nenoriu"];
  rejections.forEach((phrase) => {
    it(`'${phrase}' after recommendations does NOT add`, () => {
      const s = state();
      processMessage("Ką rekomenduojate?", s);
      processMessage(phrase, s);
      const adds = (s.pendingActions ?? []).filter((a) => a.type === "ADD_TO_CART");
      expect(adds.length).toBe(0);
    });
  });

  it("rejection then ordinal still works", () => {
    const s = state();
    processMessage("Ką rekomenduojate?", s);
    processMessage("Ne šitą", s);
    const firstId = s.lastRecommendedIds[0];
    processMessage("Gerai, tada tą pirmą", s);
    const adds = (s.pendingActions ?? []).filter((a) => a.type === "ADD_TO_CART");
    expect(adds.length).toBe(1);
    expect((adds[0] as { productId: string }).productId).toBe(firstId);
  });
});

describe("Sim: typo'd content word never blind-adds", () => {
  it("'noriu kazko soatus' (typo) does not add the context product", () => {
    const s = state();
    processMessage("Ka rekomenduojat?", s);
    processMessage("noriu kazko soatus", s);
    const adds = (s.pendingActions ?? []).filter((a) => a.type === "ADD_TO_CART");
    expect(adds.length).toBe(0);
  });

  it("pure 'Taip, imsiu' still adds", () => {
    const s = state();
    processMessage("Ka rekomenduojat?", s);
    processMessage("Taip, imsiu", s);
    const adds = (s.pendingActions ?? []).filter((a) => a.type === "ADD_TO_CART");
    expect(adds.length).toBe(1);
  });
});

describe("Sim: mushroom-free request is a filter, not a dish lookup", () => {
  it("'Turi ką be grybų?' recommends products, no 'Keturių sūrių' ingredient dump", () => {
    const s = state();
    const r = processMessage("Turi ką be grybų?", s);
    expect(r).notToContain("Sudėtis");
    expect(s.lastRecommendedIds.length).toBeGreaterThan(0);
    expect(s.dislikedIngredients).toContain("grybai");
  });
});

describe("Sim: explicit category locks the search pool", () => {
  it("'Ne, vis dėlto picos' returns pizzas ('vis' must not match VIStiena)", () => {
    const s = state();
    processMessage("Noriu picos", s);
    processMessage("Ne, sriubos", s);
    processMessage("Ne, vis dėlto picos", s);
    const cats = s.lastRecommendedIds.map((id) => findById(id)?.category);
    expect(cats.every((c) => c === "picos")).toBeTruthy();
  });
});

describe("Sim: alcohol restriction is hard and persistent", () => {
  it("'Nevartoju alkoholio' then 'alaus duok' gives NO alcohol", () => {
    const s = state();
    processMessage("Nevartoju alkoholio", s);
    processMessage("nu alaus duok", s);
    const cats = s.lastRecommendedIds.map((id) => findById(id)?.category);
    expect(cats.some((c) => c === "alus" || c === "stiprieji" || c === "vynas")).toBeFalsy();
    expect(s.allowAlcohol).toBeFalsy();
  });

  it("'Ką turi be alkoholio?' sets the hard flag too", () => {
    const s = state();
    processMessage("Ką turi be alkoholio?", s);
    expect(s.allowAlcohol).toBeFalsy();
  });

  it("pairing after no-alcohol never suggests beer/wine", () => {
    const s = state();
    processMessage("Nevartoju alkoholio", s);
    processMessage("Noriu picos", s);
    processMessage("O kas prie to tinka?", s);
    const cats = s.lastRecommendedIds.map((id) => findById(id)?.category);
    expect(cats.some((c) => ["alus", "vynas", "stiprieji", "kokteiliai", "sidras", "sampanas", "alus-kokteiliai"].includes(c ?? ""))).toBeFalsy();
  });

  it("'Taip' after restricted beer request must not add the tasting board", () => {
    const s = state();
    processMessage("Nevartoju alkoholio", s);
    processMessage("alaus duok", s);
    processMessage("Taip", s);
    const adds = (s.pendingActions ?? []).filter((a) => a.type === "ADD_TO_CART");
    for (const a of adds) {
      const p = findById((a as { productId: string }).productId);
      expect(p?.category === "alus").toBeFalsy();
    }
  });
});

describe("Sim: greeting with filler prefix", () => {
  it("'nu labas vakaras' greets without dumping recommendations", () => {
    const s = state();
    processMessage("nu labas vakaras", s);
    expect(s.lastRecommendedIds.length).toBe(0);
  });
});

describe("Audit: localized product names in chatbot replies", () => {
  const englishPrompts = [
    "Can you recommend something?",
    "What fish dishes do you have?",
    "Recommend a traditional Lithuanian dish.",
    "Do you have anything under €15?",
  ];

  for (const prompt of englishPrompts) {
    it(`localizes every recommended product for: ${prompt}`, () => {
      const s = state("en");
      const reply = processMessage(prompt, s);
      expect(s.lastRecommendedIds.length).toBeGreaterThan(0);
      for (const id of s.lastRecommendedIds) {
        const product = findById(id);
        expect(product).toBeTruthy();
        if (!product) continue;
        const englishName = tProduct(product.id, "en", "name", product.name);
        expect(reply).toContain(englishName);
        if (englishName !== product.name) expect(reply).notToContain(product.name);
      }
    });
  }

  it("keeps canonical Lithuanian names in Lithuanian replies", () => {
    const s = state("lt");
    const reply = processMessage("Ką rekomenduojate?", s);
    for (const id of s.lastRecommendedIds) {
      const product = findById(id);
      if (product) expect(reply).toContain(product.name);
    }
  });

  it("localizes add-to-cart confirmations and cart summaries", () => {
    const s = state("en");
    processMessage("Can you recommend something?", s);
    const product = findById(s.lastRecommendedIds[0]);
    expect(product).toBeTruthy();
    if (!product) return;

    const addReply = processMessage("I'll take the first one", s);
    const englishName = tProduct(product.id, "en", "name", product.name);
    expect(addReply).toContain(englishName);

    s.cartItems = [{ productId: product.id, quantity: 1, name: product.name, price: product.price }];
    const cartReply = processMessage("What's in my cart?", s);
    expect(cartReply).toContain(englishName);
    if (englishName !== product.name) expect(cartReply).notToContain(product.name);
  });
});

printResults();
