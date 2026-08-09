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
    failure: "Atsiprašau, kažkas užstrigo. Pakartokite, prašau?",
    toolFailure:
      "Nepavyko to padaryti. Gal pasitikslinkime — ką tiksliai keičiam?",
    staffUnavailable:
      "Kolegos dabar nepasiekiu. Pabandykite dar kartą po akimirkos.",
    limit: "Kad nesuklysčiau — pasakykite vieną konkretų pasirinkimą.",
    uncertainAllergy:
      "Alergija jums pačiam? Pasakykite, kuriam produktui — pasižymėsiu.",
  },
  en: {
    failure: "Sorry, something got stuck there. Could you say that again?",
    toolFailure:
      "That didn't go through. Let's double-check — what exactly are we changing?",
    staffUnavailable:
      "I can't reach a colleague right now. Try again in a moment.",
    limit: "So I don't get it wrong — tell me one specific choice.",
    uncertainAllergy:
      "Is the allergy yours? Tell me which ingredient and I'll note it.",
  },
  ru: {
    failure: "Извините, что-то заело. Повторите, пожалуйста?",
    toolFailure:
      "Не получилось. Давайте уточним — что именно меняем?",
    staffUnavailable:
      "Сейчас не могу связаться с коллегой. Попробуйте через минутку.",
    limit: "Чтобы не ошибиться — назовите один конкретный вариант.",
    uncertainAllergy:
      "Аллергия у вас? Скажите, на какой продукт — отмечу.",
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
