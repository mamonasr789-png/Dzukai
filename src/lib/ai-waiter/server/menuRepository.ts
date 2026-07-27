import "server-only";

import { products, type Product } from "../../data.ts";
import {
  ProductDetailsSchema,
  type ConversationState,
  type ProductDetails,
  type SupportedLanguage,
} from "../schemas.ts";

export interface ProductSearchOptions {
  category?: string;
  limit: number;
}

export interface RecommendationCandidateOptions {
  category?: string;
  maxPrice?: number;
  excludeProductIds: string[];
  dietaryRequirements: ConversationState["dietaryRequirements"];
  allergies: ConversationState["allergies"];
  preferredProteins?: string[];
  limit: number;
}

export interface MenuRepository {
  searchProducts(
    query: string,
    options: ProductSearchOptions,
    language?: SupportedLanguage
  ): Promise<ProductDetails[]>;
  getProductById(productId: string): Promise<Product | null>;
  getProductsByIds(productIds: string[]): Promise<Product[]>;
  getProductDetails(
    productId: string,
    language?: SupportedLanguage
  ): Promise<ProductDetails | null>;
  getOfficialPrice(productId: string): Promise<number | null>;
  getAllergenStatus(
    productId: string
  ): Promise<ProductDetails["allergenStatus"] | null>;
  getSupportedModifiers(
    productId: string
  ): Promise<ProductDetails["supportedModifiers"] | null>;
  getRecommendationCandidates(
    options: RecommendationCandidateOptions,
    language?: SupportedLanguage
  ): Promise<ProductDetails[]>;
}

const ALLERGEN_MATCHES: Record<string, string[]> = {
  gluten: ["glitim", "milt", "makaron"],
  milk: ["pien", "sūr", "sur", "griet", "sviest", "jogurt"],
  eggs: ["kiaušin", "kiausin"],
  nuts: ["rieš", "ries"],
  fish: ["žuv", "zuv", "tunas", "lašiš", "lasis", "silk"],
  soy: ["soj"],
  mustard: ["garsty"],
  crustaceans: ["krevet", "vėžiagy", "veziagy"],
  molluscs: ["moliusk", "kalmar", "aštuonkoj", "astuonkoj"],
};

const DIETARY_EXCLUSIONS: Partial<
  Record<ConversationState["dietaryRequirements"][number], string[]>
> = {
  vegetarian: [
    "jautien",
    "kiaulien",
    "vištien",
    "vistien",
    "avien",
    "antien",
    "kump",
    "šonin",
    "sonin",
    "mės",
    "mes",
    "žuvis",
    "zuv",
    "tunas",
    "lašiš",
    "lasis",
    "krevet",
  ],
  vegan: [
    "jautien",
    "kiaulien",
    "vištien",
    "vistien",
    "avien",
    "antien",
    "kump",
    "šonin",
    "sonin",
    "mės",
    "mes",
    "žuvis",
    "zuv",
    "tunas",
    "lašiš",
    "lasis",
    "krevet",
    "pien",
    "sūr",
    "sur",
    "griet",
    "sviest",
    "kiaušin",
    "kiausin",
    "medus",
  ],
  no_pork: ["kiaul", "šonin", "sonin", "kump", "šonkaul", "sonkaul", "porchetta"],
};

const ALCOHOL_TERMS = [
  "alus",
  "vynas",
  "sidras",
  "kokteil",
  "degtin",
  "viskis",
  "romas",
  "džinas",
  "dzinas",
];

const PROTEIN_TERMS: Record<string, string[]> = {
  beef: ["jautien"],
  chicken: ["vistien"],
  pork: ["kiaulien", "sonin", "kump"],
  fish: ["zuv", "tunas", "lasis", "silk"],
};

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function productText(product: Product): string {
  return normalize(
    [product.name, product.description, ...product.ingredients, ...product.allergens].join(" ")
  );
}

function containsEverySearchTerm(product: Product, query: string): boolean {
  const terms = normalize(query)
    .split(/\s+/)
    .filter((term) => term.length >= 2);
  if (terms.length === 0) return false;
  const searchable = productText(product);
  return terms.every((term) => searchable.includes(term));
}

function hasExplicitAllergenConflict(
  product: Product,
  allergies: ConversationState["allergies"]
): boolean {
  const searchable = productText(product);
  return allergies.some((allergy) => {
    const terms =
      allergy.allergen === "other"
        ? [normalize(allergy.otherLabel ?? "")]
        : ALLERGEN_MATCHES[allergy.allergen] ?? [];
    return terms.some((term) => term.length > 0 && searchable.includes(term));
  });
}

function violatesIngredientBasedRequirement(
  product: Product,
  requirements: ConversationState["dietaryRequirements"]
): boolean {
  const searchable = productText(product);
  return requirements.some((requirement) => {
    if (requirement === "halal" || requirement === "kosher") {
      // Certification and preparation cannot be inferred from ingredient text.
      return false;
    }
    if (requirement === "gluten_free") {
      return ALLERGEN_MATCHES.gluten.some((term) => searchable.includes(term));
    }
    if (requirement === "lactose_free") {
      return ALLERGEN_MATCHES.milk.some((term) => searchable.includes(term));
    }
    if (requirement === "no_alcohol") {
      return ALCOHOL_TERMS.some((term) => searchable.includes(term));
    }
    const exclusions = DIETARY_EXCLUSIONS[requirement] ?? [];
    return exclusions.some((term) => searchable.includes(term));
  });
}

export function productRequiresVariantSelection(product: Product): boolean {
  return typeof product.priceNote === "string" && product.priceNote.trim().length > 0;
}

function toDetails(product: Product): ProductDetails {
  return ProductDetailsSchema.parse({
    productId: product.id,
    name: product.name,
    category: product.category,
    officialUnitPrice: product.price,
    currency: "EUR",
    description: product.description,
    ingredients: [...product.ingredients],
    priceNote: product.priceNote ?? null,
    allergenStatus:
      product.allergens.length === 0
        ? {
            certainty: "unknown",
            declaredAllergens: [],
            reason: "no_allergen_record",
          }
        : {
            certainty: "incomplete",
            declaredAllergens: [...product.allergens],
            reason: "unverified_declared_record",
          },
    // The current menu has no authoritative modifier catalogue.
    supportedModifiers: [],
    orderability: productRequiresVariantSelection(product)
      ? {
          status: "requires_variant",
          reason: "variant_data_missing",
        }
      : {
          status: "orderable",
          reason: "confirmed_base_price",
        },
  });
}

export class StaticMenuRepository implements MenuRepository {
  async searchProducts(
    query: string,
    options: ProductSearchOptions,
    language?: SupportedLanguage
  ): Promise<ProductDetails[]> {
    void language;
    return products
      .filter((product) => !options.category || product.category === options.category)
      .filter((product) => containsEverySearchTerm(product, query))
      .slice(0, options.limit)
      .map(toDetails);
  }

  async getProductById(productId: string): Promise<Product | null> {
    return products.find((product) => product.id === productId) ?? null;
  }

  async getProductsByIds(productIds: string[]): Promise<Product[]> {
    const requestedIds = new Set(productIds);
    return products.filter((product) => requestedIds.has(product.id));
  }

  async getProductDetails(
    productId: string,
    language?: SupportedLanguage
  ): Promise<ProductDetails | null> {
    void language;
    const product = await this.getProductById(productId);
    return product ? toDetails(product) : null;
  }

  async getOfficialPrice(productId: string): Promise<number | null> {
    return (await this.getProductById(productId))?.price ?? null;
  }

  async getAllergenStatus(
    productId: string
  ): Promise<ProductDetails["allergenStatus"] | null> {
    return (await this.getProductDetails(productId))?.allergenStatus ?? null;
  }

  async getSupportedModifiers(
    productId: string
  ): Promise<ProductDetails["supportedModifiers"] | null> {
    return (await this.getProductDetails(productId))?.supportedModifiers ?? null;
  }

  async getRecommendationCandidates(
    options: RecommendationCandidateOptions,
    language?: SupportedLanguage
  ): Promise<ProductDetails[]> {
    void language;
    if (
      options.dietaryRequirements.includes("halal") ||
      options.dietaryRequirements.includes("kosher")
    ) {
      // No current menu record carries verified certification/preparation data.
      return [];
    }

    const excluded = new Set(options.excludeProductIds);
    return products
      .filter((product) => !options.category || product.category === options.category)
      .filter((product) => !excluded.has(product.id))
      .filter(
        (product) =>
          options.maxPrice === undefined ||
          (product.price > 0 && product.price <= options.maxPrice)
      )
      .filter(
        (product) =>
          !violatesIngredientBasedRequirement(
            product,
            options.dietaryRequirements
          )
      )
      .filter((product) => !hasExplicitAllergenConflict(product, options.allergies))
      .filter((product) => {
        if (!options.preferredProteins?.length) return true;
        const searchable = productText(product);
        return options.preferredProteins.some((protein) =>
          (PROTEIN_TERMS[protein] ?? [normalize(protein)]).some((term) =>
            searchable.includes(term)
          )
        );
      })
      .slice(0, options.limit)
      .map(toDetails);
  }
}
