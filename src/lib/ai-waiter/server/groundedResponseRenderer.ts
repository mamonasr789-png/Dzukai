import "server-only";

import type {
  Cart,
  ConversationState,
  SupportedLanguage,
} from "../schemas.ts";
import { tProduct } from "../../product-translations.ts";
import type { StoredActionLedgerEntry } from "./actionLedger.ts";
import type { ValidatedClaim } from "./claimValidation.ts";
import {
  actionNotDone,
  actionNotDoneYet,
  allergyCaution,
  billRequested,
  cartAdded,
  cartCleared,
  cartRemoved,
  cartUpdated,
  certificationCaution,
  modifierUnsure,
  staffOffer,
  waiterCalled,
  whichItem,
  type VoiceContext,
} from "./waiterVoice.ts";

function price(cents: number, language: SupportedLanguage): string {
  const amount = cents / 100;
  if (language === "lt") {
    return `${amount.toFixed(2).replace(".", ",")} €`;
  }
  return `€${amount.toFixed(2)}`;
}

const fallbackItemName: Record<SupportedLanguage, string> = {
  lt: "pasirinktą patiekalą",
  en: "the selected item",
  ru: "выбранную позицию",
};

const cartTotalLabel: Record<SupportedLanguage, string> = {
  lt: "Iš viso",
  en: "Total",
  ru: "Итого",
};

const containsLabel: Record<SupportedLanguage, (name: string) => string> = {
  lt: (name) => `„${name}“ sudėtyje:`,
  en: (name) => `“${name}” contains:`,
  ru: (name) => `В составе «${name}»:`,
};

const allergenLabel: Record<SupportedLanguage, (name: string) => string> = {
  lt: (name) => `Svarbu dėl „${name}“ — alergenai:`,
  en: (name) => `Worth knowing about “${name}” — allergens:`,
  ru: (name) => `Важно о «${name}» — аллергены:`,
};

export class GroundedResponseRenderer {
  clarification(voice: VoiceContext, reason: string | null): string {
    if (reason === "negated_action") return actionNotDone(voice);
    if (
      reason === "hypothetical_action" ||
      reason === "future_action" ||
      reason === "informational_only"
    ) {
      return actionNotDoneYet(voice);
    }
    if (reason === "unsupported_modifier") return modifierUnsure(voice);
    return whichItem(voice);
  }

  staffEscalation(voice: VoiceContext): string {
    return staffOffer(voice);
  }

  allergySafety(voice: VoiceContext): string {
    return allergyCaution(voice);
  }

  certificationSafety(voice: VoiceContext): string {
    return certificationCaution(voice);
  }

  actionSuccess(command: {
    voice: VoiceContext;
    ledger: StoredActionLedgerEntry;
    beforeCart: Cart;
    currentCart: Cart;
  }): string {
    const { voice, ledger, beforeCart, currentCart } = command;
    const language = voice.language;
    const toolName = ledger.entry.toolName;
    const affectedId = ledger.entry.affectedId;
    const currentLine = currentCart.lines.find(
      (line) => line.lineId === affectedId
    );
    const previousLine = beforeCart.lines.find(
      (line) => line.lineId === ledger.entry.intent.targetIds[0]
    );
    const productId = currentLine?.productId ?? previousLine?.productId;
    const originalName =
      currentLine?.product.name ?? previousLine?.product.name;
    const name =
      (productId && originalName
        ? tProduct(productId, language, "name", originalName)
        : null) ?? fallbackItemName[language];

    if (toolName === "add_to_cart") return cartAdded(name, voice);
    if (toolName === "update_cart_item") return cartUpdated(name, voice);
    if (toolName === "remove_from_cart") return cartRemoved(name, voice);
    if (toolName === "clear_cart") return cartCleared(voice);
    if (toolName === "request_waiter") return waiterCalled(voice);
    return billRequested(voice);
  }

  renderClaims(
    conversationalText: string,
    claims: ValidatedClaim[],
    state: ConversationState
  ): string {
    const language = state.language;
    // The turn schema rejects control characters, so this stays single-line.
    const lines: string[] = [];
    const intro = conversationalText.trim();
    if (intro) lines.push(intro);

    const priced: string[] = [];
    for (const { claim, product } of claims) {
      if (claim.claimType === "product_price" && product) {
        const name = tProduct(product.productId, language, "name", product.name);
        priced.push(
          `**${name}** — ${price(claim.proposedValue as number, language)}`
        );
      }
    }
    if (priced.length > 0) lines.push(priced.join(" · "));

    for (const { claim, product } of claims) {
      if (claim.claimType === "cart_total") {
        lines.push(
          `${cartTotalLabel[language]}: **${price(claim.proposedValue as number, language)}**`
        );
      } else if (claim.claimType === "ingredient" && product) {
        const name = tProduct(product.productId, language, "name", product.name);
        lines.push(
          `${containsLabel[language](name)} ${String(claim.proposedValue)}`
        );
      } else if (claim.claimType === "allergen" && product) {
        const name = tProduct(product.productId, language, "name", product.name);
        lines.push(
          `${allergenLabel[language](name)} ${String(claim.proposedValue)}`
        );
      } else if (claim.claimType === "restaurant_fact") {
        lines.push(String(claim.proposedValue));
      }
    }
    return lines.filter(Boolean).join(" ").slice(0, 1_500);
  }
}
