import "server-only";

import type {
  Cart,
  ConversationState,
  ProductDetails,
} from "../schemas.ts";
import type {
  GroundedRestaurantRecord,
  GroundedProductProvenance,
} from "./aiProvider.ts";
import type { StoredActionLedgerEntry } from "./actionLedger.ts";
import type { MenuRepository } from "./menuRepository.ts";
import {
  ProviderClaimSchema,
  type ProviderClaim,
} from "./providerTooling.ts";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const PRICE_WORDS =
  /\b(kaina|kainuoja|eurai?|euru|price|costs?|about|approximately|mazdaug)\b[^.!?]{0,50}\b(vienas|du|trys|keturi|penki|sesi|septyni|astuoni|devyni|desimt|one|two|three|four|five|six|seven|eight|nine|ten)\b/iu;
const NUMERIC_PRICE =
  /\b\d{1,5}(?:[.,]\d{1,2})?\s*(?:€|eur)(?=$|\s|[.,!?])/iu;
const UNSUPPORTED_FACT =
  /\b(populiariaus\w*|perkamiaus\w*|megstamiaus\w*|most popular|best seller|top seller|customer favorite|nuolaid\w*|discount\w*|akcij\w*|special offer|sutaup\w*|save money|sertifikuot\w*|certified|halal approved|kosher approved|turime dabar|available now|tikrai pagamins|kitchen accepted|virtuve prieme|mokejimas patvirtintas|payment confirmed)\b/iu;
const ACTION_SUCCESS =
  /\b(prideta|pridejau|pasalinta|pasalinau|krepselis isvalytas|uzklausa issiusta|padavejas jau eina|added to (?:the )?cart|removed from (?:the )?cart|cart cleared|request (?:was )?sent|waiter is coming)\b/iu;
const INGREDIENT_FACT =
  /\b(sudetyje|sudaro|pagaminta su|ingredient|contains?|made with)\b/iu;
const SAFETY_FACT =
  /\b(visiskai saug\w*|saugu jums|saugu valgyti|completely safe|safe for you|safe to eat|allergen[- ]free|be alergenu)\b/iu;
const RESTAURANT_FACT =
  /\b(adresas yra|randasi|located at|address is|dirba iki|open until|parking is|parkavimas yra)\b/iu;

export function containsUnstructuredSensitiveClaim(message: string): boolean {
  const value = normalize(message);
  return (
    NUMERIC_PRICE.test(value) ||
    PRICE_WORDS.test(value) ||
    UNSUPPORTED_FACT.test(value) ||
    ACTION_SUCCESS.test(value) ||
    INGREDIENT_FACT.test(value) ||
    SAFETY_FACT.test(value) ||
    RESTAURANT_FACT.test(value)
  );
}

export interface ClaimValidationContext {
  state: ConversationState;
  cart: Cart;
  relevantProducts: ProductDetails[];
  productProvenance: GroundedProductProvenance[];
  restaurantKnowledge: GroundedRestaurantRecord[];
  actionLedger: StoredActionLedgerEntry[];
  menuRepository: MenuRepository;
}

export interface ValidatedClaim {
  claim: ProviderClaim;
  product: ProductDetails | null;
}

export class ClaimValidation {
  async validate(
    message: string,
    rawClaims: ProviderClaim[],
    context: ClaimValidationContext
  ): Promise<ValidatedClaim[] | null> {
    if (containsUnstructuredSensitiveClaim(message)) return null;
    const parsedClaims = rawClaims.map((claim) =>
      ProviderClaimSchema.safeParse(claim)
    );
    if (parsedClaims.some((claim) => !claim.success)) return null;

    const permitted = new Set(
      context.productProvenance.map((item) => item.productId)
    );
    const validated: ValidatedClaim[] = [];
    for (const parsed of parsedClaims) {
      if (!parsed.success) return null;
      const claim = parsed.data;
      let product: ProductDetails | null = null;
      if (claim.productId) {
        if (!permitted.has(claim.productId)) return null;
        product =
          context.relevantProducts.find(
            (candidate) => candidate.productId === claim.productId
          ) ??
          (await context.menuRepository.getProductDetails(
            claim.productId,
            context.state.language
          ));
        if (!product) return null;
      }

      switch (claim.claimType) {
        case "product_price":
          if (
            !product ||
            claim.provenance !== "official_menu" ||
            typeof claim.proposedValue !== "number" ||
            claim.proposedValue !==
              Math.round(product.officialUnitPrice * 100)
          ) {
            return null;
          }
          break;
        case "cart_total":
          if (
            claim.provenance !== "current_cart" ||
            typeof claim.proposedValue !== "number" ||
            claim.proposedValue !== Math.round(context.cart.total * 100)
          ) {
            return null;
          }
          break;
        case "ingredient":
          if (
            !product ||
            claim.provenance !== "official_menu" ||
            typeof claim.proposedValue !== "string" ||
            !product.ingredients.some(
              (ingredient) =>
                normalize(ingredient) === normalize(claim.proposedValue as string)
            )
          ) {
            return null;
          }
          break;
        case "allergen":
          if (
            !product ||
            product.allergenStatus.certainty === "unknown" ||
            typeof claim.proposedValue !== "string" ||
            !product.allergenStatus.declaredAllergens.some(
              (allergen) =>
                normalize(allergen) === normalize(claim.proposedValue as string)
            )
          ) {
            return null;
          }
          break;
        case "staff_action": {
          const action = context.actionLedger.find(
            (entry) =>
              entry.entry.actionId === claim.actionId &&
              entry.entry.status === "succeeded"
          );
          if (!action || claim.provenance !== "action_ledger") return null;
          break;
        }
        case "restaurant_fact":
          if (
            claim.provenance !== "restaurant_knowledge" ||
            typeof claim.proposedValue !== "string" ||
            !context.restaurantKnowledge.some(
              (record) =>
                normalize(record.value) === normalize(claim.proposedValue as string)
            )
          ) {
            return null;
          }
          break;
        case "dietary":
        case "certification":
        case "availability":
        case "discount":
        case "popularity":
        case "kitchen_status":
        case "payment_status":
          // No current authoritative source can establish these claims.
          return null;
      }
      validated.push({ claim, product });
    }
    return validated;
  }
}
