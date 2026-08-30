/**
 * Guest-menu allergen honesty.
 *
 * Catalog allergen arrays are incomplete. An empty list is "we do not know",
 * never "safe" / "be alergenų". A declared list is an unverified partial
 * record — matching a guest allergy is a warning, not a clearance, and a
 * non-match is still not a green light.
 */

export const GUEST_ALLERGEN_IDS = [
  "gluten",
  "milk",
  "eggs",
  "nuts",
  "fish",
  "soy",
  "mustard",
  "crustaceans",
  "molluscs",
] as const;

export type GuestAllergenId = (typeof GUEST_ALLERGEN_IDS)[number];

/** Lithuanian stems plus common EN/RU forms, aligned with AI waiter ALLERGEN_MATCHES. */
const ALLERGEN_STEMS: Record<GuestAllergenId, string[]> = {
  gluten: ["glitim", "gliuten", "gluten", "kvieci"],
  milk: ["pien", "laktoz", "milk", "dairy", "molok"],
  eggs: ["kiausin", "egg"],
  nuts: ["riesut", "nut"],
  fish: ["zuv", "fish"],
  soy: ["soj", "soy"],
  mustard: ["garsty", "mustard"],
  crustaceans: ["veziagyv", "krevet", "crustacean"],
  molluscs: ["moliusk", "mollusc", "mollusk", "kalmar", "astuonkoj"],
};

/** Canonical Lithuanian labels used when talking to the kitchen / AI waiter. */
export const GUEST_ALLERGEN_LT_LABEL: Record<GuestAllergenId, string> = {
  gluten: "Glitimas",
  milk: "Pienas",
  eggs: "Kiaušiniai",
  nuts: "Riešutai",
  fish: "Žuvis",
  soy: "Soja",
  mustard: "Garstyčios",
  crustaceans: "Vėžiagyviai",
  molluscs: "Moliuskai",
};

export const ALLERGEN_I18N_KEY: Record<GuestAllergenId, `allergen_${GuestAllergenId}`> = {
  gluten: "allergen_gluten",
  milk: "allergen_milk",
  eggs: "allergen_eggs",
  nuts: "allergen_nuts",
  fish: "allergen_fish",
  soy: "allergen_soy",
  mustard: "allergen_mustard",
  crustaceans: "allergen_crustaceans",
  molluscs: "allergen_molluscs",
};

const ALLERGEN_PROMPT_SESSION_PREFIX = "dzukai-allergen-prompt:";

export type AllergenHonestyKind =
  | "unknown"
  | "declared_match"
  | "declared_unmatched"
  | "no_guest_allergies";

export interface AllergenHonesty {
  kind: AllergenHonestyKind;
  /** Guest allergens whose stems matched a declared catalog string. */
  matchedGuestAllergens: GuestAllergenId[];
  /** Catalog strings that matched a guest allergen. */
  matchedDeclared: string[];
}

export function isGuestAllergenId(value: unknown): value is GuestAllergenId {
  return (
    typeof value === "string" &&
    (GUEST_ALLERGEN_IDS as readonly string[]).includes(value)
  );
}

export function uniqueValidGuestAllergens(value: unknown): GuestAllergenId[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<GuestAllergenId>();
  const out: GuestAllergenId[] = [];
  for (const item of value) {
    if (isGuestAllergenId(item) && !seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

export function normalizeAllergenText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function declaredMatchesGuestAllergen(
  declared: string,
  guestAllergen: GuestAllergenId
): boolean {
  const haystack = normalizeAllergenText(declared);
  if (!haystack) return false;
  return ALLERGEN_STEMS[guestAllergen].some(
    (stem) => stem.length > 0 && haystack.includes(stem)
  );
}

/**
 * Honesty rules for a dish vs the guest's declared allergies.
 * There is no "safe" kind. Empty declared list + any guest allergy => unknown.
 */
export function guestAllergenHonesty(
  declaredAllergens: readonly string[],
  guestAllergens: readonly string[]
): AllergenHonesty {
  const selected = uniqueValidGuestAllergens(guestAllergens);
  if (selected.length === 0) {
    return {
      kind: "no_guest_allergies",
      matchedGuestAllergens: [],
      matchedDeclared: [],
    };
  }

  const declared = declaredAllergens
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (declared.length === 0) {
    return {
      kind: "unknown",
      matchedGuestAllergens: [],
      matchedDeclared: [],
    };
  }

  const matchedGuestAllergens: GuestAllergenId[] = [];
  const matchedDeclared: string[] = [];
  for (const guest of selected) {
    for (const item of declared) {
      if (!declaredMatchesGuestAllergen(item, guest)) continue;
      if (!matchedGuestAllergens.includes(guest)) matchedGuestAllergens.push(guest);
      if (!matchedDeclared.includes(item)) matchedDeclared.push(item);
    }
  }

  if (matchedGuestAllergens.length > 0) {
    return {
      kind: "declared_match",
      matchedGuestAllergens,
      matchedDeclared,
    };
  }

  return {
    kind: "declared_unmatched",
    matchedGuestAllergens: [],
    matchedDeclared: [],
  };
}

/** Row badge: warn on a declared match or on total absence of records. Never "safe". */
export function allergenRowFlag(
  declaredAllergens: readonly string[],
  guestAllergens: readonly string[]
): "match" | "unknown" | null {
  const honesty = guestAllergenHonesty(declaredAllergens, guestAllergens);
  if (honesty.kind === "declared_match") return "match";
  if (honesty.kind === "unknown") return "unknown";
  return null;
}

/** Hard rule: this module never classifies a dish as safe. */
export function isAllergenSafeKind(_kind: AllergenHonestyKind): boolean {
  return false;
}

export function allergenPromptSessionKey(tableNumber: string): string {
  return `${ALLERGEN_PROMPT_SESSION_PREFIX}${tableNumber}`;
}

export function wasAllergenPromptSeen(tableNumber: string): boolean {
  if (typeof sessionStorage === "undefined") return false;
  try {
    return sessionStorage.getItem(allergenPromptSessionKey(tableNumber)) === "1";
  } catch {
    return false;
  }
}

export function markAllergenPromptSeen(tableNumber: string): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(allergenPromptSessionKey(tableNumber), "1");
  } catch {
    // Prompt re-shows next visit if sessionStorage is blocked.
  }
}

/**
 * Compact list for the existing AI waiter message field.
 * Does not change the turn protocol — just grounds chat in the same declaration.
 */
export function guestAllergyChatContext(
  guestAllergens: readonly string[]
): string | null {
  const selected = uniqueValidGuestAllergens(guestAllergens);
  if (selected.length === 0) return null;
  const labels = selected.map((id) => GUEST_ALLERGEN_LT_LABEL[id]).join(", ");
  return (
    `Svečias nurodė alergijas meniu pradžioje: ${labels}. ` +
    "Katalogo alergenų sąrašas nepilnas ir nepatikrintas — niekada nesakykite, kad patiekalas saugus, be alergenų ar tinka."
  );
}
