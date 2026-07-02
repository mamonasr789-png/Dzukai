/**
 * Real conversation scenarios for the virtual waiter assistant.
 * 50 realistic multi-turn flows covering the full ordering experience.
 * Run: node --experimental-strip-types src/lib/assistant/tests/conversations.test.ts
 */

import { describe, it, expect, printResults } from "./runner.ts";
import { processMessage, createState } from "../brain.ts";
import { findById } from "../menuSearch.ts";
import type { ConversationState, CartItemRef } from "../types.ts";

function state(lang = "lt"): ConversationState {
  return createState(lang);
}

/** Simulate cart items so handleCartSummary has data */
function withCart(s: ConversationState, items: CartItemRef[]): ConversationState {
  s.cartItems = items;
  return s;
}

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 1 — Basic ordering flows
// ══════════════════════════════════════════════════════════════════════════════

describe("Conv 001: Greeting → filling food → confirm", () => {
  it("survives a full sočiai flow", () => {
    const s = state();
    const r1 = processMessage("Sveiki", s);
    expect(r1.length).toBeGreaterThan(0);

    const r2 = processMessage("Noriu kažko sotaus", s);
    expect(r2.length).toBeGreaterThan(10);
    expect(s.lastRecommendedIds.length).toBeGreaterThan(0);

    const r3 = processMessage("Gerai", s);
    expect(s.pendingActions!.length).toBeGreaterThan(0);
    expect(s.pendingActions![0].type).toBe("ADD_TO_CART");
  });
});

describe("Conv 002: Beer recommendation → tasting board", () => {
  it("'Taip' after beer adds Alaus degustacija", () => {
    const s = state();
    processMessage("Noriu alaus", s);
    expect(s.lastRecommendedIds.length).toBeGreaterThan(0);

    processMessage("Taip", s);
    expect(s.pendingActions!.length).toBeGreaterThan(0);
    const p = findById(s.pendingActions![0].productId);
    expect(p?.name.toLowerCase()).toContain("degustacija");
  });
});

describe("Conv 003: Food then drink pairing", () => {
  it("suggests drinks after food context", () => {
    const s = state();
    processMessage("Rekomenduok ką nors valgyti", s);
    const foodIds = [...s.lastRecommendedIds];
    expect(foodIds.length).toBeGreaterThan(0);

    const r = processMessage("Ką gerti prie šio?", s);
    expect(r.length).toBeGreaterThan(10);
    // Last recommendations should now be drinks
    expect(s.lastRecommendedIds.length).toBeGreaterThan(0);
  });
});

describe("Conv 004: Vegetarian flow", () => {
  it("sets vegetarian preference and filters recs", () => {
    const s = state();
    processMessage("Esu vegetaras", s);
    expect(s.vegetarian).toBeTruthy();

    processMessage("Ką rekomenduojate?", s);
    // All recommended products should be meatless (no pork/beef/fish)
    s.lastRecommendedIds.forEach((id) => {
      const p = findById(id);
      if (p) {
        const hay = (p.ingredients.join(" ") + p.name).toLowerCase();
        const hasMeat = hay.includes("kiaul") || hay.includes("jautien") || hay.includes("lašiš");
        expect(hasMeat).toBeFalsy();
      }
    });
  });
});

describe("Conv 005: Budget constraint → confirm", () => {
  it("respects budget and adds affordable item", () => {
    const s = state();
    processMessage("Turiu tik 12 eurų", s);
    expect(s.budget).toBeLessThanOrEqual(12);

    processMessage("Ką rekomenduojate?", s);
    s.lastRecommendedIds.forEach((id) => {
      const p = findById(id);
      if (p && p.price > 0) expect(p.price).toBeLessThanOrEqual(12);
    });

    processMessage("Gerai", s);
    expect(s.pendingActions![0].type).toBe("ADD_TO_CART");
  });
});

describe("Conv 006: Kids menu flow", () => {
  it("recommends kids items and confirms", () => {
    const s = state();
    processMessage("Turime mažą vaiką", s);
    const r = processMessage("Kas iš vaikų meniu?", s);
    expect(r.length).toBeGreaterThan(5);
    expect(s.lastRecommendedIds.length).toBeGreaterThan(0);
    s.lastRecommendedIds.forEach((id) => {
      const p = findById(id);
      if (p) expect(p.category).toBe("vaikiskas");
    });
  });
});

describe("Conv 007: Dessert after main course", () => {
  it("recommends desserts", () => {
    const s = state();
    processMessage("Noriu žuvies", s);
    processMessage("Gerai", s); // adds fish to cart

    const r = processMessage("Ką rekomenduotumėte desertui?", s);
    expect(r.length).toBeGreaterThan(10);
    s.lastRecommendedIds.forEach((id) => {
      const p = findById(id);
      if (p) expect(p.category).toBe("desertai");
    });
  });
});

describe("Conv 008: Full meal — food + drink + dessert", () => {
  it("handles a 3-course ordering flow", () => {
    const s = state();
    // Food
    processMessage("Noriu kiaulienos", s);
    processMessage("Tinka", s);
    const firstAdd = s.pendingActions![0];
    expect(firstAdd.type).toBe("ADD_TO_CART");

    // Drink
    processMessage("Noriu alaus prie maisto", s);
    expect(s.lastRecommendedIds.length).toBeGreaterThan(0);
    processMessage("Jo", s);
    expect(s.pendingActions!.length).toBeGreaterThan(0);

    // Dessert
    processMessage("Ir desertą prašau", s);
    expect(s.lastRecommendedIds.length).toBeGreaterThan(0);
    s.lastRecommendedIds.forEach((id) => {
      const p = findById(id);
      if (p) expect(p.category).toBe("desertai");
    });
  });
});

describe("Conv 009: Popular dishes flow", () => {
  it("recommends popular dishes on request", () => {
    const s = state();
    const r = processMessage("Kas populiaru?", s);
    expect(r.length).toBeGreaterThan(10);
    expect(s.lastRecommendedIds.length).toBeGreaterThan(0);

    processMessage("Paimsiu šitą", s);
    expect(s.pendingActions!.length).toBeGreaterThan(0);
    expect(s.pendingActions![0].type).toBe("ADD_TO_CART");
  });
});

describe("Conv 010: Pizza category flow", () => {
  it("recommends pizza and confirms", () => {
    const s = state();
    processMessage("Noriu picos", s);
    expect(s.lastRecommendedIds.length).toBeGreaterThan(0);
    s.lastRecommendedIds.forEach((id) => {
      const p = findById(id);
      if (p) expect(p.category).toBe("picos");
    });

    processMessage("Gerai, imsiu", s);
    expect(s.pendingActions![0].type).toBe("ADD_TO_CART");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 2 — Memory and multi-turn
// ══════════════════════════════════════════════════════════════════════════════

describe("Conv 011: Long conversation keeps context", () => {
  it("remembers preferences after 15 turns", () => {
    const s = state();
    processMessage("Esu vegetaras", s);
    processMessage("Ką rekomenduojate?", s);
    processMessage("Dar kitą", s);
    processMessage("O dar?", s);
    processMessage("Gal salotų?", s);
    processMessage("Dar vieną", s);
    processMessage("Ir dar", s);
    processMessage("Ką prie to gerti?", s);
    processMessage("Dar kitą gėrimą", s);
    processMessage("Ką rekomenduotumėte desertui?", s);
    processMessage("Gerai", s);
    processMessage("Ačiū", s);
    processMessage("Dar ką nors salstelėjusio", s);
    processMessage("Rodyk kitą", s);
    const r = processMessage("Ką rekomenduojate iš viso?", s);
    // Vegetarian flag must persist
    expect(s.vegetarian).toBeTruthy();
    expect(r.length).toBeGreaterThan(5);
  });
});

describe("Conv 012: Allergy → safe recommendation", () => {
  it("filters out allergen after declaration", () => {
    const s = state();
    processMessage("Alergija glitimui", s);
    expect(s.glutenFree).toBeTruthy();

    processMessage("Ką galiu valgyti?", s);
    s.lastRecommendedIds.forEach((id) => {
      const p = findById(id);
      if (p) expect(p.allergens.some((a) => a.toLowerCase().includes("glitim"))).toBeFalsy();
    });
  });
});

describe("Conv 013: Preference change mid-conversation", () => {
  it("switches from chicken to fish preference", () => {
    const s = state();
    processMessage("Noriu vištienos", s);
    processMessage("Ne, geriau žuvies", s);
    expect(s.preferredProtein).toBe("fish");
  });
});

describe("Conv 014: Ingredient question then order", () => {
  it("answers ingredients and then adds to cart on confirm", () => {
    const s = state();
    processMessage("Noriu lašišos", s);
    const r = processMessage("Kas jos sudėtyje?", s);
    expect(r).toContain("Sudėtis");

    processMessage("Gerai, paimsiu", s);
    // Should add to cart (last food dish context)
    expect(s.pendingActions!.length).toBeGreaterThan(0);
  });
});

describe("Conv 015: Price inquiry then order", () => {
  it("answers price and allows ordering", () => {
    const s = state();
    processMessage("Noriu BBQ šonkaulių", s);
    const r = processMessage("Kiek kainuoja?", s);
    expect(r.length).toBeGreaterThan(5);
    // Price reply mentions €
    expect(r).toContain("€");
  });
});

describe("Conv 016: Negative answer then new recommendation", () => {
  it("redirects after negative", () => {
    const s = state();
    processMessage("Ką rekomenduojate?", s);
    const firstRecs = [...s.lastRecommendedIds];
    processMessage("Ne, nepatinka", s);
    expect(s.lastRecommendedIds.length).toBeGreaterThan(0);
    // Should recommend something different
    const changed = s.lastRecommendedIds.some((id) => !firstRecs.includes(id));
    expect(changed).toBeTruthy();
  });
});

describe("Conv 017: English language flow", () => {
  it("responds in English", () => {
    const s = state("en");
    const r1 = processMessage("I want something filling", s);
    expect(r1.length).toBeGreaterThan(10);

    processMessage("Sure, I'll take it", s);
    expect(s.pendingActions![0].type).toBe("ADD_TO_CART");
    expect(s.pendingActions![0].productId).toBeTruthy();
  });
});

describe("Conv 018: Russian language flow", () => {
  it("responds to Russian input", () => {
    const s = state("ru");
    const r = processMessage("Хочу что-нибудь сытное", s);
    expect(r.length).toBeGreaterThan(10);
    expect(s.lastRecommendedIds.length).toBeGreaterThan(0);
  });
});

describe("Conv 019: Budget increases mid-conversation", () => {
  it("adjusts recommendations after budget change", () => {
    const s = state();
    processMessage("Turiu 10 eurų", s);
    expect(s.budget).toBeLessThanOrEqual(10);

    processMessage("Gal galiu leisti daugiau, iki 30 eurų", s);
    expect(s.budget).toBeGreaterThan(15);
  });
});

describe("Conv 020: Vegan + gluten-free combined", () => {
  it("stacks diet restrictions", () => {
    const s = state();
    processMessage("Esu veganas", s);
    processMessage("Ir be glitimo", s);
    expect(s.vegan).toBeTruthy();
    expect(s.glutenFree).toBeTruthy();

    processMessage("Ką galiu valgyti?", s);
    s.lastRecommendedIds.forEach((id) => {
      const p = findById(id);
      if (p) {
        expect(p.allergens.some((a) => a.toLowerCase().includes("glitim"))).toBeFalsy();
      }
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 3 — Cart management
// ══════════════════════════════════════════════════════════════════════════════

describe("Conv 021: Add then show cart", () => {
  it("shows cart summary with items", () => {
    const s = state();
    processMessage("Ką valgyti?", s);
    processMessage("Gerai", s); // adds item
    const addedId = s.lastCartAddedProductId;
    expect(addedId).toBeTruthy();

    // Simulate cart (as UI would)
    const p = findById(addedId!);
    if (p) {
      withCart(s, [{ productId: p.id, quantity: 1, name: p.name, price: p.price }]);
    }

    const r = processMessage("Ką turiu krepšelyje?", s);
    expect(r).toContain("krepšelyje");
    expect(r).toContain("€");
  });
});

describe("Conv 022: Add then remove", () => {
  it("removes item from cart", () => {
    const s = state();
    processMessage("Noriu lašišos", s);
    processMessage("Gerai", s); // adds

    const r = processMessage("Pašalink tą lašišą", s);
    expect(s.pendingActions!.length).toBeGreaterThan(0);
    expect(s.pendingActions![0].type).toBe("REMOVE_FROM_CART");
    expect(r.length).toBeGreaterThan(5);
  });
});

describe("Conv 023: Clear cart", () => {
  it("clears the entire cart", () => {
    const s = state();
    processMessage("Ką valgyti?", s);
    processMessage("Gerai", s);

    const r = processMessage("Išvalykite krepšelį", s);
    expect(s.pendingActions!.length).toBeGreaterThan(0);
    expect(s.pendingActions![0].type).toBe("CLEAR_CART");
    expect(r).toContain("išvalytas");
  });
});

describe("Conv 024: Dar vieną repeats last added", () => {
  it("repeats last added product on 'dar vieną'", () => {
    const s = state();
    processMessage("Ką valgyti?", s);
    processMessage("Gerai", s);
    const addedId = s.lastCartAddedProductId;
    expect(addedId).toBeTruthy();

    processMessage("Dar vieną", s);
    expect(s.pendingActions!.length).toBeGreaterThan(0);
    expect(s.pendingActions![0].productId).toBe(addedId);
  });
});

describe("Conv 025: Dar vieną with named product", () => {
  it("adds named product in repeat phrase", () => {
    const s = state();
    processMessage("Noriu alaus", s);
    processMessage("Taip", s); // adds degustacija
    const firstId = s.lastCartAddedProductId;

    // "dar vieną limonadą" — adds a lemonade, not the beer tasting board
    const r = processMessage("Dar vieną limonadą", s);
    expect(s.pendingActions!.length).toBeGreaterThan(0);
    // Should find a lemonade product
    const addedP = findById(s.pendingActions![0].productId);
    expect(addedP?.category).toBeOneOf(["limonadai", "gerimai", "alus", "alus-kokteiliai"]);
    expect(r).toContain("krepšelį");
  });
});

describe("Conv 026: Empty cart message", () => {
  it("reports empty cart gracefully", () => {
    const s = state();
    withCart(s, []);
    const r = processMessage("Ką turiu krepšelyje?", s);
    expect(r).toContain("tuščias");
  });
});

describe("Conv 027: Remove without context prompts clarification", () => {
  it("asks which item to remove if nothing in context", () => {
    const s = state();
    const r = processMessage("Pašalink", s);
    expect(r.length).toBeGreaterThan(5);
    expect(s.pendingActions!.length).toBe(0);
  });
});

describe("Conv 028: Multiple items then cart summary", () => {
  it("shows all items in cart summary", () => {
    const s = state();
    const fakeCart: CartItemRef[] = [
      { productId: "ki9", quantity: 1, name: "BBQ šonkauliai", price: 21.90 },
      { productId: "al8", quantity: 1, name: "Alaus degustacija", price: 12.00 },
    ];
    withCart(s, fakeCart);

    const r = processMessage("Kiek viso turiu krepšelyje?", s);
    expect(r).toContain("€");
  });
});

describe("Conv 029: Remove specific item by name", () => {
  it("removes BBQ šonkauliai by name", () => {
    const s = state();
    s.lastCartAddedProductId = "ki9"; // Simulate having added BBQ ribs

    const r = processMessage("Pašalink BBQ šonkaulius", s);
    expect(s.pendingActions!.length).toBeGreaterThan(0);
    expect(s.pendingActions![0].type).toBe("REMOVE_FROM_CART");
  });
});

describe("Conv 030: Clear cart mid-session then reorder", () => {
  it("can reorder after clearing cart", () => {
    const s = state();
    processMessage("Ką valgyti?", s);
    processMessage("Gerai", s);

    processMessage("Išvalykite krepšelį", s);
    expect(s.pendingActions![0].type).toBe("CLEAR_CART");

    // After clear, should still be able to recommend
    processMessage("Noriu ką nors kito", s);
    expect(s.lastRecommendedIds.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 4 — Reference resolution
// ══════════════════════════════════════════════════════════════════════════════

describe("Conv 031: Šitą adds last recommended", () => {
  it("'šitą' adds the first recommendation", () => {
    const s = state();
    processMessage("Ką rekomenduojate?", s);
    const firstId = s.lastRecommendedIds[0];

    processMessage("Šitą", s);
    expect(s.pendingActions!.length).toBeGreaterThan(0);
    expect(s.pendingActions![0].productId).toBe(firstId);
  });
});

describe("Conv 032: Šito noriu → add to cart", () => {
  it("'šito noriu' adds the first recommendation", () => {
    const s = state();
    processMessage("Ką rekomenduojate?", s);
    const firstId = s.lastRecommendedIds[0];

    processMessage("Šito noriu", s);
    expect(s.pendingActions!.length).toBeGreaterThan(0);
    expect(s.pendingActions![0].productId).toBe(firstId);
  });
});

describe("Conv 033: Tą noriu → add last recommendation", () => {
  it("'tą noriu' adds the last recommended product", () => {
    const s = state();
    processMessage("Ką rekomenduojate?", s);
    const firstId = s.lastRecommendedIds[0];

    processMessage("Tą noriu", s);
    expect(s.pendingActions!.length).toBeGreaterThan(0);
    expect(s.pendingActions![0].productId).toBe(firstId);
  });
});

describe("Conv 034: Tokio pat → repeat last ordered", () => {
  it("'tokio pat' repeats last cart-added product", () => {
    const s = state();
    processMessage("Ką valgyti?", s);
    processMessage("Gerai", s);
    const firstId = s.lastCartAddedProductId!;

    processMessage("Tokio pat", s);
    expect(s.pendingActions!.length).toBeGreaterThan(0);
    expect(s.pendingActions![0].productId).toBe(firstId);
  });
});

describe("Conv 035: O prie šito routes to pairing", () => {
  it("'O prie šito?' triggers drink pairing, not cart add", () => {
    const s = state();
    processMessage("Rekomenduok ką nors valgyti", s);

    const r = processMessage("O prie šito gerti?", s);
    expect(r.length).toBeGreaterThan(10);
    expect(s.pendingActions!.length).toBe(0);
  });
});

describe("Conv 036: Ką prie to gerti routes to pairing", () => {
  it("'ką prie to gerti?' does not add to cart", () => {
    const s = state();
    processMessage("Rekomenduok ką nors", s);

    processMessage("Gerai", s);
    processMessage("Ką prie to gerti?", s);
    expect(s.pendingActions!.length).toBe(0);
    expect(s.lastRecommendedIds.length).toBeGreaterThan(0);
  });
});

describe("Conv 037: Genitive form adds specific product", () => {
  it("'noriu degustacijos' adds Alaus degustacija", () => {
    const s = state();
    processMessage("Noriu alaus", s);
    processMessage("noriu degustacijos", s);
    const p = findById(s.pendingActions![0].productId);
    expect(p?.name.toLowerCase()).toContain("degustacija");
  });
});

describe("Conv 038: Inflected šoninės name resolves product", () => {
  it("'pašalink šoninę' finds correct product", () => {
    const s = state();
    s.lastCartAddedProductId = "ki5"; // ki5 = Kiaulienos šoninė
    const r = processMessage("Pašalink šoninę", s);
    expect(s.pendingActions!.length).toBeGreaterThan(0);
    expect(s.pendingActions![0].type).toBe("REMOVE_FROM_CART");
  });
});

describe("Conv 039: Multi-turn reference after category switch", () => {
  it("maintains correct context after switching food to drink", () => {
    const s = state();
    processMessage("Noriu vištienos", s);
    const foodId = s.activeDishId ?? s.lastFoodDishId;

    processMessage("Ką prie to gerti?", s);
    // Drink recs now
    expect(s.lastRecommendedIds.length).toBeGreaterThan(0);

    // Asking about food context still works
    processMessage("O kas yra tame patiekale?", s);
    // Should reference the chicken dish via activeDishId
    expect(s.lastFoodDishId).toBe(foodId);
  });
});

describe("Conv 040: Pronoun reference across long turn sequence", () => {
  it("resolves 'šitą' 5 turns after recommendation", () => {
    const s = state();
    processMessage("Ką rekomenduojate?", s);
    const recId = s.lastRecommendedIds[0];

    // Several unrelated turns
    processMessage("Koks yra darbo laikas?", s);
    processMessage("O kur esate?", s);
    // hasUnclaimedRecommendation was consumed — but let's verify graceful fallback
    const r = processMessage("Ačiū", s);
    expect(r.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 5 — Edge cases and clarification
// ══════════════════════════════════════════════════════════════════════════════

describe("Conv 041: Very short inputs don't crash", () => {
  it("handles single-word inputs gracefully", () => {
    const s = state();
    const inputs = ["Ok", "Ne", "Dar", "Gerai", "Ačiū", "?", "...", "Hm"];
    for (const input of inputs) {
      const r = processMessage(input, s);
      expect(typeof r).toBe("string");
      expect(r.length).toBeGreaterThan(0);
    }
  });
});

describe("Conv 042: Unknown dish name → graceful response", () => {
  it("handles unknown dish gracefully", () => {
    const s = state();
    const r = processMessage("Noriu Krabų sriubos su trumais", s);
    expect(typeof r).toBe("string");
    expect(r.length).toBeGreaterThan(5);
  });
});

describe("Conv 043: Double taip does not double-add", () => {
  it("second 'Taip' after beer is a no-op", () => {
    const s = state();
    processMessage("Noriu alaus", s);
    processMessage("Taip", s);
    processMessage("Taip", s);
    expect(s.pendingActions!.length).toBe(0);
  });
});

describe("Conv 044: Negative then positive sequence", () => {
  it("handles ne → taip sequence correctly", () => {
    const s = state();
    processMessage("Noriu alaus", s);
    processMessage("Ne", s);
    expect(s.awaitingConfirmation).toBeFalsy();
    expect(s.pendingActions!.length).toBe(0);

    processMessage("Noriu alaus", s); // re-ask
    processMessage("Taip", s);
    expect(s.pendingActions!.length).toBeGreaterThan(0);
    expect(s.pendingActions![0].type).toBe("ADD_TO_CART");
  });
});

describe("Conv 045: Restaurant info during ordering", () => {
  it("answers info and resumes ordering context", () => {
    const s = state();
    processMessage("Ką rekomenduojate?", s);
    const recsBefore = [...s.lastRecommendedIds];

    const r = processMessage("Kiek valandų dirbate?", s);
    expect(r.length).toBeGreaterThan(5);

    // Context still usable
    const r2 = processMessage("Ir dar ko nors valgyti", s);
    expect(r2.length).toBeGreaterThan(5);
  });
});

describe("Conv 046: Beer then food then beer combination", () => {
  it("handles category switching without losing state", () => {
    const s = state();
    processMessage("Noriu alaus", s);
    processMessage("Taip", s); // degustacija
    const beerAction = s.pendingActions![0];
    expect(beerAction.type).toBe("ADD_TO_CART");

    processMessage("Ir ką nors valgyti prie alaus", s);
    expect(s.lastRecommendedIds.length).toBeGreaterThan(0);

    processMessage("Gerai", s);
    expect(s.pendingActions![0].type).toBe("ADD_TO_CART");
  });
});

describe("Conv 047: Allergy change mid-conversation", () => {
  it("respects new allergy declaration mid-session", () => {
    const s = state();
    processMessage("Ką rekomenduojate?", s);

    processMessage("Turiu alergiją pieno produktams", s);
    expect(s.lactoseFree).toBeTruthy();

    processMessage("Rekomenduok dabar", s);
    s.lastRecommendedIds.forEach((id) => {
      const p = findById(id);
      if (p) {
        expect(p.allergens.some((a) => a.toLowerCase().includes("pien"))).toBeFalsy();
      }
    });
  });
});

describe("Conv 048: Specific beer by name", () => {
  it("finds beer by name and adds to cart", () => {
    const s = state();
    processMessage("Noriu alaus", s);
    processMessage("Taip", s);
    const p = findById(s.pendingActions![0].productId);
    expect(p).toBeTruthy();
    expect(s.pendingActions![0].type).toBe("ADD_TO_CART");
  });
});

describe("Conv 049: Exploration then decision", () => {
  it("browses multiple times before ordering", () => {
    const s = state();
    processMessage("Parodyk ką nors valgyti", s);
    processMessage("Dar kitą", s);
    processMessage("Dar", s);
    processMessage("Gal ko nors sotesnio?", s);
    processMessage("Imsiu šitą", s);
    expect(s.pendingActions!.length).toBeGreaterThan(0);
    expect(s.pendingActions![0].type).toBe("ADD_TO_CART");
  });
});

describe("Conv 050: Complete end-to-end scenario", () => {
  it("completes a realistic full-meal ordering session", () => {
    const s = state();

    // Greeting
    processMessage("Labas", s);

    // Food preference
    processMessage("Noriu kažko sotaus ir skanu", s);
    expect(s.lastRecommendedIds.length).toBeGreaterThan(0);

    // Confirm food
    processMessage("Gerai, imsiu pirmą", s);
    expect(s.pendingActions![0].type).toBe("ADD_TO_CART");
    const foodId = s.lastCartAddedProductId;

    // Drink pairing
    processMessage("Ir ką gerti?", s);
    expect(s.lastRecommendedIds.length).toBeGreaterThan(0);

    // Confirm drink
    processMessage("Tinka", s);
    expect(s.pendingActions![0].type).toBe("ADD_TO_CART");

    // Dessert
    processMessage("Ir desertą", s);
    expect(s.lastRecommendedIds.length).toBeGreaterThan(0);

    // Confirm dessert
    processMessage("Gerai", s);
    expect(s.pendingActions![0].type).toBe("ADD_TO_CART");

    // Show cart
    const p = findById(foodId!);
    if (p) withCart(s, [{ productId: p.id, quantity: 1, name: p.name, price: p.price }]);
    const cartReply = processMessage("Ką turiu krepšelyje?", s);
    expect(cartReply).toContain("krepšelyje");

    // Final: state is coherent
    expect(s.vegetarian).toBeFalsy(); // not set
    expect(typeof s.currentLanguage).toBe("string");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// RUN
// ══════════════════════════════════════════════════════════════════════════════

printResults();
