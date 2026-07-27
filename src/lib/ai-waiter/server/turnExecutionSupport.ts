import "server-only";

import type {
  ActionType,
  Cart,
  ToolName,
  WaiterAction,
} from "../schemas.ts";
import type { ToolExecutionResponse } from "./toolRegistry.ts";
import type { ConversationTurnMetadataUpdate } from "./conversationStateStore.ts";

export const READ_ONLY_TOOLS = new Set<ToolName>([
  "search_menu",
  "get_product_details",
  "recommend_products",
  "view_cart",
]);

export const TURN_COPY = {
  lt: {
    failure:
      "Šiuo metu negaliu saugiai užbaigti atsakymo. Pabandykite dar kartą.",
    toolFailure:
      "Veiksmo atlikti nepavyko. Patikrinkite pasirinkimą ir bandykite dar kartą.",
    staffUnavailable:
      "Šiame demonstraciniame režime padavėjo ir sąskaitos užklausos nepasiekiamos.",
    limit: "Kad išvengčiau klaidos, patikslinkite vieną konkretų pasirinkimą.",
    uncertainAllergy:
      "Ar alergija taikoma jums? Patvirtinkite alergeną, kad galėčiau tai saugiai pasižymėti.",
  },
  en: {
    failure:
      "I cannot safely complete the response right now. Please try again.",
    toolFailure:
      "The action could not be completed. Check the selection and try again.",
    staffUnavailable:
      "Waiter and bill requests are unavailable in this demo session.",
    limit: "To avoid a mistake, please clarify one specific selection.",
    uncertainAllergy:
      "Does the allergy apply to you? Please confirm the allergen so I can record it safely.",
  },
  ru: {
    failure:
      "Сейчас я не могу безопасно завершить ответ. Попробуйте ещё раз.",
    toolFailure:
      "Не удалось выполнить действие. Проверьте выбор и попробуйте ещё раз.",
    staffUnavailable:
      "В демонстрационном режиме вызов официанта и запрос счёта недоступны.",
    limit: "Чтобы избежать ошибки, уточните один конкретный вариант.",
    uncertainAllergy:
      "Аллергия относится к вам? Подтвердите аллерген, чтобы я мог безопасно это записать.",
  },
} as const;

export function sanitizeTurnText(message: string): string {
  const clean = message
    .replace(/\[ADD:[^\]]+\]/gu, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/giu, "")
    .trim();
  let questions = 0;
  return clean.replace(/\?/gu, () => {
    questions += 1;
    return questions === 1 ? "?" : ".";
  });
}

export function isFoodSafetyQuestion(message: string): boolean {
  const normalized = message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /\b(ar galiu.*valgyti|saugu|tinka man|can i eat|safe for me|safe to eat|allergen)\b/u.test(
    normalized
  );
}

export function cartFromToolResult(
  result: ToolExecutionResponse
): Cart | null {
  if (
    result.ok &&
    (result.toolName === "add_to_cart" ||
      result.toolName === "update_cart_item" ||
      result.toolName === "remove_from_cart" ||
      result.toolName === "view_cart" ||
      result.toolName === "clear_cart")
  ) {
    return result.data.cart;
  }
  return null;
}

export function productIdsFromToolResult(
  result: ToolExecutionResponse
): string[] {
  if (!result.ok) return [];
  if (
    result.toolName === "search_menu" ||
    result.toolName === "recommend_products"
  ) {
    return result.data.products.map((product) => product.productId);
  }
  if (result.toolName === "get_product_details") {
    return [result.data.product.productId];
  }
  return [];
}

export function waiterActionFromToolResult(
  result: ToolExecutionResponse
): WaiterAction | null {
  if (!result.ok) return null;
  if (
    result.toolName === "add_to_cart" ||
    result.toolName === "update_cart_item" ||
    result.toolName === "remove_from_cart" ||
    result.toolName === "clear_cart"
  ) {
    return {
      type: "cart_updated",
      toolName: result.toolName,
      targetId: result.data.affectedLineId,
    };
  }
  if (
    result.toolName === "request_waiter" ||
    result.toolName === "request_bill"
  ) {
    return {
      type: "staff_requested",
      toolName: result.toolName,
      targetId: result.data.requestId,
    };
  }
  return null;
}

export function attachServerOwnedActionInput(command: {
  toolName: ActionType;
  input: unknown;
  cart: Cart;
  idempotencyKey: string;
}): unknown {
  const input = command.input as Record<string, unknown>;
  switch (command.toolName) {
    case "add_to_cart":
      return {
        ...input,
        expectedRevision: command.cart.revision,
        idempotencyKey: command.idempotencyKey,
      };
    case "update_cart_item":
    case "remove_from_cart":
      return { ...input, expectedRevision: command.cart.revision };
    case "clear_cart":
      return { expectedRevision: command.cart.revision };
    case "request_waiter":
    case "request_bill":
      return {
        ...(input.note === undefined ? {} : { note: input.note }),
        idempotencyKey: command.idempotencyKey,
      };
  }
}

export function turnMetadata(
  now: () => number,
  intent: string | null,
  toolNames: ToolName[]
): ConversationTurnMetadataUpdate {
  return {
    lastIntent: intent,
    lastToolNames: toolNames,
    lastInteractionAt: new Date(now()).toISOString(),
  };
}
