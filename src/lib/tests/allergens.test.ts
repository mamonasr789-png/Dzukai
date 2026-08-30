/**
 * Honesty rules for guest allergen prompting.
 * Empty catalog arrays are unknown, never safe.
 *
 * Run: node --experimental-strip-types src/lib/tests/allergens.test.ts
 */

const { describe, it, expect, printResults } = await import("../assistant/tests/runner.ts");
const allergens = await import("../allergens.ts");
const i18n = await import("../i18n.ts");

import type { GuestAllergenId } from "../allergens.ts";

const {
  guestAllergenHonesty,
  allergenRowFlag,
  declaredMatchesGuestAllergen,
  isAllergenSafeKind,
  uniqueValidGuestAllergens,
  guestAllergyChatContext,
  GUEST_ALLERGEN_IDS,
} = allergens;

describe("empty declared list is unknown, never safe", () => {
  it("empty allergens + guest milk allergy => unknown", () => {
    const honesty = guestAllergenHonesty([], ["milk"]);
    expect(honesty.kind).toBe("unknown");
    expect(isAllergenSafeKind(honesty.kind)).toBeFalsy();
    expect(allergenRowFlag([], ["milk"])).toBe("unknown");
  });

  it("empty allergens + several guest allergies => unknown", () => {
    const honesty = guestAllergenHonesty([], ["gluten", "nuts", "eggs"]);
    expect(honesty.kind).toBe("unknown");
    expect(allergenRowFlag([], ["gluten", "nuts"])).toBe("unknown");
  });

  it("whitespace-only declared list is treated as empty / unknown", () => {
    const honesty = guestAllergenHonesty(["  ", ""], ["fish"]);
    expect(honesty.kind).toBe("unknown");
  });
});

describe("declared match is a warning, not a clearance", () => {
  it("Pienas matches milk case-insensitively", () => {
    const honesty = guestAllergenHonesty(["Pienas"], ["milk"]);
    expect(honesty.kind).toBe("declared_match");
    expect(honesty.matchedDeclared).toEqual(["Pienas"]);
    expect(honesty.matchedGuestAllergens).toEqual(["milk"]);
    expect(allergenRowFlag(["Pienas"], ["milk"])).toBe("match");
  });

  it("PIENAS still matches milk", () => {
    expect(declaredMatchesGuestAllergen("PIENAS", "milk")).toBeTruthy();
    expect(guestAllergenHonesty(["PIENAS"], ["milk"]).kind).toBe("declared_match");
  });

  it("Lithuanian stem glitim matches gluten", () => {
    expect(declaredMatchesGuestAllergen("Glitimas", "gluten")).toBeTruthy();
    expect(declaredMatchesGuestAllergen("glitimo pėdsakai", "gluten")).toBeTruthy();
    expect(guestAllergenHonesty(["Glitimas"], ["gluten"]).kind).toBe("declared_match");
  });

  it("Kiaušiniai matches eggs via diacritic-stripped stem", () => {
    expect(declaredMatchesGuestAllergen("Kiaušiniai", "eggs")).toBeTruthy();
    expect(guestAllergenHonesty(["Kiaušiniai"], ["eggs"]).kind).toBe("declared_match");
  });

  it("a match does not become a safe classification", () => {
    const honesty = guestAllergenHonesty(["Riešutai"], ["nuts"]);
    expect(honesty.kind).toBe("declared_match");
    expect(isAllergenSafeKind(honesty.kind)).toBeFalsy();
  });
});

describe("declared list without a match is still not safe", () => {
  it("Glitimas + guest milk => unmatched, no row badge, not safe", () => {
    const honesty = guestAllergenHonesty(["Glitimas"], ["milk"]);
    expect(honesty.kind).toBe("declared_unmatched");
    expect(allergenRowFlag(["Glitimas"], ["milk"])).toBe(null);
    expect(isAllergenSafeKind(honesty.kind)).toBeFalsy();
  });

  it("partial declared list never implies the missing allergen is absent", () => {
    const honesty = guestAllergenHonesty(["Pienas", "Kiaušiniai"], ["nuts"]);
    expect(honesty.kind).toBe("declared_unmatched");
    expect(isAllergenSafeKind(honesty.kind)).toBeFalsy();
  });
});

describe("guest selected none", () => {
  it("does not invent a safe label on an empty catalog list", () => {
    const honesty = guestAllergenHonesty([], []);
    expect(honesty.kind).toBe("no_guest_allergies");
    expect(allergenRowFlag([], [])).toBe(null);
    expect(isAllergenSafeKind(honesty.kind)).toBeFalsy();
  });

  it("does not invent a safe label on a declared list", () => {
    const honesty = guestAllergenHonesty(["Pienas"], []);
    expect(honesty.kind).toBe("no_guest_allergies");
    expect(allergenRowFlag(["Pienas"], [])).toBe(null);
  });
});

describe("input sanitization", () => {
  it("drops unknown allergen ids", () => {
    const cleaned: GuestAllergenId[] = uniqueValidGuestAllergens(["milk", "safe", "gluten", "milk"]);
    expect(cleaned).toEqual(["milk", "gluten"]);
  });

  it("covers the EU-style set used by catalog/AI", () => {
    expect(GUEST_ALLERGEN_IDS).toEqual([
      "gluten",
      "milk",
      "eggs",
      "nuts",
      "fish",
      "soy",
      "mustard",
      "crustaceans",
      "molluscs",
    ]);
  });
});

describe("AI chat context stays a simple list", () => {
  it("returns null when the guest selected none", () => {
    expect(guestAllergyChatContext([])).toBe(null);
  });

  it("passes Lithuanian labels and forbids a safe claim", () => {
    const note = guestAllergyChatContext(["milk", "nuts"]);
    expect(note).toContain("Pienas");
    expect(note).toContain("Riešutai");
    expect(note).toContain("nepilnas");
    expect(note).toContain("niekada nesakykite");
  });
});

describe("allergen UI copy never claims a dish is safe", () => {
  const keys = [
    "allergen_prompt_title",
    "allergen_prompt_body",
    "allergen_prompt_none",
    "allergen_prompt_continue",
    "allergen_warning",
    "allergen_unknown",
    "allergen_incomplete",
    "allergen_none_known",
  ] as const;
  const forbidden = ["be alergenų", "allergen-free", "без аллергенов"];

  for (const lang of ["lt", "en", "ru"] as const) {
    it(`${lang} allergen strings exist and do not claim allergen-free`, () => {
      const copy = i18n.t[lang] as Record<string, string | string[]>;
      for (const key of keys) {
        const value = copy[key];
        expect(typeof value).toBe("string");
        expect(String(value).length).toBeGreaterThan(0);
        const lower = String(value).toLowerCase();
        for (const word of forbidden) {
          if (lower.includes(word)) {
            throw new Error(`${lang}.${key} contains forbidden claim "${word}"`);
          }
        }
      }
    });
  }

  it("unknown copy tells the guest to ask staff", () => {
    expect(i18n.t.lt.allergen_unknown).toContain("klauskite padavėjo");
    expect(i18n.t.en.allergen_unknown.toLowerCase()).toContain("ask");
    expect(i18n.t.lt.allergen_prompt_body).toContain("nepilnas");
    expect(i18n.t.lt.allergen_prompt_none).toBe("Nėra žinomų alergijų");
  });
});

printResults();
