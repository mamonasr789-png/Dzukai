import "server-only";

import type {
  Cart,
  ConversationState,
  SupportedLanguage,
} from "../schemas.ts";
import type { StoredActionLedgerEntry } from "./actionLedger.ts";
import type { ValidatedClaim } from "./claimValidation.ts";

function price(cents: number, language: SupportedLanguage): string {
  const amount = cents / 100;
  if (language === "lt") {
    return `${amount.toFixed(2).replace(".", ",")} €`;
  }
  return `€${amount.toFixed(2)}`;
}

const copy = {
  lt: {
    genericClarification: "Prašau patikslinkite vieną konkretų veiksmą.",
    negated: "Veiksmo neatlikau.",
    hypothetical:
      "Veiksmo neatlikau. Ar norite, kad atlikčiau jį dabar?",
    ambiguous: "Kurį konkretų pasirinkimą turite omenyje?",
    modifier:
      "Šio pakeitimo meniu duomenys nepatvirtina. Ar pridėti įprastą variantą, ar pirmiau pakviesti darbuotoją?",
    staffOffer:
      "Galiu pakviesti padavėją. Ar norite, kad tai padaryčiau?",
    allergy:
      "Saugumo ir kryžminės taršos patvirtinti negaliu. Galiu pakviesti darbuotoją patikslinti.",
    certification:
      "Halal ar košerinio sertifikavimo ir paruošimo patvirtinti negaliu. Galiu pakviesti darbuotoją patikslinti.",
  },
  en: {
    genericClarification: "Please clarify one specific action.",
    negated: "I did not perform the action.",
    hypothetical: "I did not perform the action. Would you like me to do it now?",
    ambiguous: "Which specific selection do you mean?",
    modifier:
      "The menu does not confirm that modification. Should I add the standard item, or ask staff first?",
    staffOffer: "I can call a waiter. Would you like me to do that?",
    allergy:
      "I cannot confirm that this is safe for you or free from cross-contamination. I can ask a staff member to check.",
    certification:
      "I cannot confirm halal or kosher certification or preparation. I can ask a staff member to check.",
  },
  ru: {
    genericClarification: "Уточните, пожалуйста, одно конкретное действие.",
    negated: "Действие не выполнено.",
    hypothetical: "Действие не выполнено. Выполнить его сейчас?",
    ambiguous: "Какой именно вариант вы имеете в виду?",
    modifier:
      "Меню не подтверждает это изменение. Добавить обычный вариант или сначала позвать сотрудника?",
    staffOffer: "Я могу позвать официанта. Хотите, чтобы я это сделал?",
    allergy:
      "Я не могу подтвердить безопасность или отсутствие перекрёстного загрязнения. Могу попросить сотрудника уточнить.",
    certification:
      "Я не могу подтвердить халяльную или кошерную сертификацию и приготовление. Могу попросить сотрудника уточнить.",
  },
} as const;

export class GroundedResponseRenderer {
  clarification(
    language: SupportedLanguage,
    reason: string | null
  ): string {
    if (reason === "negated_action") return copy[language].negated;
    if (
      reason === "hypothetical_action" ||
      reason === "future_action" ||
      reason === "informational_only"
    ) {
      return copy[language].hypothetical;
    }
    if (reason === "unsupported_modifier") return copy[language].modifier;
    if (
      reason === "ambiguous_action" ||
      reason === "action_scope_mismatch"
    ) {
      return copy[language].ambiguous;
    }
    return copy[language].genericClarification;
  }

  staffEscalation(language: SupportedLanguage): string {
    return copy[language].staffOffer;
  }

  allergySafety(language: SupportedLanguage): string {
    return copy[language].allergy;
  }

  certificationSafety(language: SupportedLanguage): string {
    return copy[language].certification;
  }

  actionSuccess(command: {
    language: SupportedLanguage;
    ledger: StoredActionLedgerEntry;
    beforeCart: Cart;
    currentCart: Cart;
  }): string {
    const { language, ledger, beforeCart, currentCart } = command;
    const toolName = ledger.entry.toolName;
    const affectedId = ledger.entry.affectedId;
    const currentLine = currentCart.lines.find(
      (line) => line.lineId === affectedId
    );
    const previousLine = beforeCart.lines.find(
      (line) => line.lineId === ledger.entry.intent.targetIds[0]
    );
    const name =
      currentLine?.product.name ??
      previousLine?.product.name ??
      (language === "lt"
        ? "pasirinktą prekę"
        : language === "en"
          ? "the selected item"
          : "выбранную позицию");

    if (language === "lt") {
      if (toolName === "add_to_cart") return `Pridėjau „${name}“ į krepšelį.`;
      if (toolName === "update_cart_item") return `Atnaujinau „${name}“ krepšelyje.`;
      if (toolName === "remove_from_cart") return `Pašalinau „${name}“ iš krepšelio.`;
      if (toolName === "clear_cart") return "Išvaliau krepšelį.";
      if (toolName === "request_waiter") return "Padavėjo užklausa išsiųsta.";
      return "Sąskaitos užklausa išsiųsta.";
    }
    if (language === "en") {
      if (toolName === "add_to_cart") return `I added “${name}” to the cart.`;
      if (toolName === "update_cart_item") return `I updated “${name}” in the cart.`;
      if (toolName === "remove_from_cart") return `I removed “${name}” from the cart.`;
      if (toolName === "clear_cart") return "I cleared the cart.";
      if (toolName === "request_waiter") return "The waiter request was sent.";
      return "The bill request was sent.";
    }
    if (toolName === "add_to_cart") return `Я добавил «${name}» в корзину.`;
    if (toolName === "update_cart_item") return `Я обновил «${name}» в корзине.`;
    if (toolName === "remove_from_cart") return `Я удалил «${name}» из корзины.`;
    if (toolName === "clear_cart") return "Корзина очищена.";
    if (toolName === "request_waiter") return "Запрос официанту отправлен.";
    return "Запрос счёта отправлен.";
  }

  renderClaims(
    conversationalText: string,
    claims: ValidatedClaim[],
    state: ConversationState
  ): string {
    const rendered: string[] = [conversationalText.trim()];
    for (const { claim, product } of claims) {
      if (claim.claimType === "product_price" && product) {
        const formatted = price(
          claim.proposedValue as number,
          state.language
        );
        rendered.push(
          state.language === "lt"
            ? `„${product.name}“ kainuoja ${formatted}.`
            : state.language === "en"
              ? `“${product.name}” costs ${formatted}.`
              : `«${product.name}» стоит ${formatted}.`
        );
      } else if (claim.claimType === "cart_total") {
        const formatted = price(
          claim.proposedValue as number,
          state.language
        );
        rendered.push(
          state.language === "lt"
            ? `Krepšelio suma: ${formatted}.`
            : state.language === "en"
              ? `Cart total: ${formatted}.`
              : `Сумма корзины: ${formatted}.`
        );
      } else if (claim.claimType === "ingredient" && product) {
        rendered.push(
          state.language === "lt"
            ? `Oficialiame „${product.name}“ apraše nurodyta: ${String(claim.proposedValue)}.`
            : state.language === "en"
              ? `The official “${product.name}” record lists: ${String(claim.proposedValue)}.`
              : `В официальной записи «${product.name}» указано: ${String(claim.proposedValue)}.`
        );
      } else if (claim.claimType === "allergen" && product) {
        rendered.push(
          state.language === "lt"
            ? `„${product.name}“ įraše nurodytas alergenas: ${String(claim.proposedValue)}; kryžminė tarša nepatvirtinta.`
            : state.language === "en"
              ? `The “${product.name}” record declares ${String(claim.proposedValue)}; cross-contamination is not confirmed.`
              : `В записи «${product.name}» указан аллерген ${String(claim.proposedValue)}; перекрёстное загрязнение не подтверждено.`
        );
      } else if (claim.claimType === "restaurant_fact") {
        rendered.push(String(claim.proposedValue));
      }
    }
    return rendered.filter(Boolean).join(" ").slice(0, 1_500);
  }
}
