import "server-only";

import {
  ActionIntentSchema,
  ActionTypeSchema,
  type ActionIntent,
  type ActionType,
  type Cart,
  type ClientSelectionHint,
  type ConversationState,
  type ProductDetails,
} from "../schemas.ts";
import type { GroundedProductProvenance } from "./aiProvider.ts";
import { referenceSetIdFor } from "./referenceSet.ts";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/gu, "");
}

function actionTypesIn(message: string): ActionType[] {
  const value = normalize(message);
  const types: ActionType[] = [];
  if (
    /\b(pridek|prideti|add|put in|imsiu|take)\b|nepridek|добав|полож/u.test(
      value
    )
  ) {
    types.push("add_to_cart");
  }
  if (/\b(pakeisk|atnaujink|update|change)\b|измен|обнов/u.test(value)) {
    types.push("update_cart_item");
  }
  if (
    /\b(pasalink|isimk|remove|delete item)\b|удал|убер/u.test(value)
  ) {
    types.push("remove_from_cart");
  }
  if (
    /(?:\b(isvalyk|istustink|clear|empty)\b|очист|опустош)[^.!?]{0,30}(?:\b(krepsel\w*|cart)\b|корзин)/u.test(
      value
    )
  ) {
    types.push("clear_cart");
  }
  if (/\b(padavej\w*|waiter)\b|официант/u.test(value)) {
    types.push("request_waiter");
  }
  if (/\b(saskait\w*|bill|check please)\b|сч[её]т/u.test(value)) {
    types.push("request_bill");
  }
  return [...new Set(types)];
}

function quantityIn(message: string): number | null {
  const value = normalize(message);
  const numeric = value.match(/\b(\d{1,2})\b/u);
  if (numeric) {
    const quantity = Number(numeric[1]);
    return quantity >= 1 && quantity <= 20 ? quantity : null;
  }
  const words: Array<[RegExp, number]> = [
    [/\b(viena|viena porcija|one)\b|один|одну/u, 1],
    [/\b(du|dvi|two)\b|два|две/u, 2],
    [/\b(trys|tris|three)\b|три/u, 3],
    [/\b(keturi|keturias|four)\b|четыр/u, 4],
  ];
  return words.find(([pattern]) => pattern.test(value))?.[1] ?? null;
}

function explicitNote(message: string): string | null {
  const match = message.match(
    /(?:pastaba|note|примечание)\s*:\s*([^.!?\n]{1,180})/iu
  );
  return match?.[1]?.trim() ?? null;
}

function productTargets(
  message: string,
  state: ConversationState,
  products: ProductDetails[],
  permittedIds: ReadonlySet<string>
): string[] {
  const value = normalize(message);
  const numericOrdinal = value.match(
    /(?:recommendation|pasiul\w*|предлож)[^\d]{0,12}([1-9])|([1-9])[^\d]{0,12}(?:recommendation|pasiul\w*|предлож)/u
  );
  const ordinal = numericOrdinal
    ? Number(numericOrdinal[1] ?? numericOrdinal[2]) - 1
    : /\b(antr\w*|second)\b|втор/u.test(value)
      ? 1
      : /\b(pirm\w*|first)\b|перв/u.test(value)
        ? 0
        : null;
  if (ordinal !== null) {
    const target = state.latestReferencedProductIds[ordinal];
    return target && permittedIds.has(target) ? [target] : [];
  }
  if (/\b(sita|sitas|this one|that one|toki pat|same)\b|эт[оа]|тако[йе]\s+же/u.test(value)) {
    if (state.latestReferencedProductIds.length !== 1) return [];
    const target = state.latestReferencedProductIds[0];
    return target && permittedIds.has(target) ? [target] : [];
  }
  if (/\b(antr\w*|second)\b|втор/u.test(value)) {
    const target = state.latestReferencedProductIds[1];
    return target && permittedIds.has(target) ? [target] : [];
  }
  if (/\b(pirm\w*|first)\b/u.test(value)) {
    const target = state.latestReferencedProductIds[0];
    return target && permittedIds.has(target) ? [target] : [];
  }
  if (/\b(sita|sitas|this one|that one|toki pat|same)\b/u.test(value)) {
    if (state.latestReferencedProductIds.length !== 1) return [];
    const target = state.latestReferencedProductIds[0];
    return target && permittedIds.has(target) ? [target] : [];
  }

  if (state.latestReferencedProductIds.length === 1) {
    const priorId = state.latestReferencedProductIds[0];
    const prior = products.find((product) => product.productId === priorId);
    if (
      prior &&
      permittedIds.has(priorId) &&
      normalize(prior.name)
        .split(/\s+/u)
        .filter((term) => term.length >= 4)
        .some((term) => value.includes(term))
    ) {
      return [priorId];
    }
  }

  const matches = products.filter((product) => {
    if (!permittedIds.has(product.productId)) return false;
    const terms = normalize(product.name)
      .split(/\s+/u)
      .filter((term) => term.length >= 4);
    return terms.some((term) => value.includes(term));
  });
  const matchIds = [...new Set(matches.map((product) => product.productId))].slice(0, 10);
  if (matchIds.length > 0) return matchIds;

  // No ordinal, pronoun, or name in the message pointed at anything — but if
  // exactly one product was on the table (the just-recommended dish), a bare
  // "add it" is unambiguous. Without this, every single-recommendation "add"
  // follow-up (the most common phrasing) failed authorization here even
  // though the provider itself correctly resolved the same reference,
  // permanently stalling the add-to-cart flow with a "which dish?" loop.
  if (state.latestReferencedProductIds.length === 1) {
    const onlyId = state.latestReferencedProductIds[0];
    if (permittedIds.has(onlyId)) return [onlyId];
  }
  return [];
}

function cartLineTargets(message: string, cart: Cart): string[] {
  const value = normalize(message);
  if (cart.lines.length === 1) return [cart.lines[0].lineId];
  if (/\b(pirm\w*|first)\b|перв/u.test(value)) {
    return cart.lines[0] ? [cart.lines[0].lineId] : [];
  }
  if (/\b(antr\w*|second)\b|втор/u.test(value)) {
    return cart.lines[1] ? [cart.lines[1].lineId] : [];
  }
  const matching = cart.lines.filter((line) =>
    normalize(line.product.name)
      .split(/\s+/u)
      .filter((term) => term.length >= 4)
      .some((term) => value.includes(term))
  );
  return [...new Set(matching.map((line) => line.lineId))].slice(0, 10);
}

export interface ActionIntentContext {
  message: string;
  state: ConversationState;
  cart: Cart;
  products: ProductDetails[];
  productProvenance: GroundedProductProvenance[];
  selectionHint?: ClientSelectionHint;
}

export interface ActionAuthorizationDecision {
  authorized: boolean;
  intent: ActionIntent;
  reason: string | null;
}

export class ActionAuthorizationPolicy {
  parseIntent(context: ActionIntentContext): ActionIntent {
    const normalized = normalize(context.message);
    const actionTypes = actionTypesIn(context.message);
    const actionType = actionTypes.length === 1 ? actionTypes[0] : null;
    const negated =
      /\b(nepridek|ne pridek|nekviesk|ne kviesk|nereikia|neuzsak\w*|dont|do not|not add|not call|without ordering)\b|не\s+(?:добав|клади|зови|вызывай|заказывай)|не\s+надо/u.test(
        normalized
      );
    const hypothetical =
      /\b(kas nutiktu|jei uzsak\w*|what if|if i ordered|would happen|hypothetical)\b|что\s+будет\s+если|если\s+закаж/u.test(
        normalized
      );
    const futureIntent =
      /\b(gal veliau|veliau|rytoj|planuoju|maybe later|later|tomorrow|will add|going to order)\b|может\s+позже|потом|завтра/u.test(
        normalized
      );
    const thirdPartyIntent =
      /\b(draug\w*|friend|jis|ji|he|she|kolega|colleague)\b[^.!?]{0,80}\b(nori|wants?|needs?)\b/u.test(
        normalized
      );
    const informationalOnly =
      /\b(tik parodyk|tik informacija|kiek kainuoja|ar galiu|ar galima|show me only|just show|how much|can i|could i)\b|только\s+покаж|сколько\s+стоит|можно\s+ли/u.test(
        normalized
      );
    const comparisonOnly =
      /\b(palygink|kuo skiriasi|compare|difference between)\b|сравни|чем\s+отлич/u.test(normalized);
    const unsupportedModifier =
      /\b(be\s+\S+|without\s+\S+|papildomai\s+\S+|extra\s+\S+|gerai iske\w*|well[- ]done)\b|без\s+\S+|добав(?:ьте|ь)?\s+ещ[её]/u.test(
        normalized
      );
    const permittedIds = new Set(
      context.productProvenance
        .filter((item) =>
          [
            "current_query",
            "explicit_current_reference",
            "explicit_prior_reference",
            "cart",
            "current_tool_result",
          ].includes(item.provenance)
        )
        .map((item) => item.productId)
    );
    const selectionHintValid =
      context.selectionHint?.actionType === "add_to_cart" &&
      context.selectionHint.referenceSetId ===
        referenceSetIdFor(
          context.state.sessionId,
          context.state.latestReferencedProductIds
        ) &&
      context.state.latestReferencedProductIds[context.selectionHint.ordinal] ===
        context.selectionHint.productId &&
      permittedIds.has(context.selectionHint.productId);
    const invalidSelectionHint =
      context.selectionHint !== undefined && !selectionHintValid;

    let targetType: ActionIntent["targetType"] = null;
    let targetIds: string[] = [];
    if (actionType === "add_to_cart") {
      targetType = "product";
      targetIds =
        context.selectionHint && selectionHintValid
          ? [context.selectionHint.productId]
          : context.selectionHint
            ? []
            : productTargets(
                context.message,
                context.state,
                context.products,
                permittedIds
              );
    } else if (
      actionType === "update_cart_item" ||
      actionType === "remove_from_cart"
    ) {
      targetType = "cart_line";
      targetIds = cartLineTargets(context.message, context.cart);
    } else if (actionType === "clear_cart") {
      targetType = "cart";
      targetIds = ["cart"];
    } else if (
      actionType === "request_waiter" ||
      actionType === "request_bill"
    ) {
      targetType = "staff";
      targetIds = [actionType];
    }

    const targetRequired =
      actionType === "add_to_cart" ||
      actionType === "update_cart_item" ||
      actionType === "remove_from_cart";
    const ambiguous =
      actionTypes.length > 1 ||
      unsupportedModifier ||
      (actionType === "update_cart_item" && quantityIn(context.message) === null) ||
      (targetRequired && targetIds.length !== 1) ||
      context.state.ambiguity !== null &&
        targetRequired &&
        targetIds.length !== 1;
    const blocked =
      actionType === null ||
      negated ||
      hypothetical ||
      futureIntent ||
      thirdPartyIntent ||
      informationalOnly ||
      comparisonOnly ||
      invalidSelectionHint ||
      ambiguous;
    const clarificationReason =
      actionType === null
        ? "no_customer_action"
        : negated
          ? "negated_action"
          : hypothetical
            ? "hypothetical_action"
            : futureIntent
              ? "future_action"
              : thirdPartyIntent
                ? "third_party_action"
                : informationalOnly
                  ? "informational_only"
                  : comparisonOnly
                  ? "comparison_only"
                  : invalidSelectionHint
                    ? "stale_reference_selection"
                  : unsupportedModifier
                      ? "unsupported_modifier"
                      : ambiguous
                        ? "ambiguous_action"
                        : null;

    return ActionIntentSchema.parse({
      actionType,
      affirmation: blocked ? (negated ? "negative" : "uncertain") : "affirmative",
      negated,
      hypothetical,
      ambiguous,
      informationalOnly,
      comparisonOnly,
      futureIntent,
      thirdPartyIntent,
      targetType,
      targetIds,
      quantity:
        actionType === "add_to_cart"
          ? context.selectionHint
            ? 1
            : quantityIn(context.message) ?? 1
          : quantityIn(context.message),
      customerNote: unsupportedModifier ? null : explicitNote(context.message),
      evidence: context.message.slice(0, 500),
      confidence: blocked ? "low" : "high",
      clarificationReason,
    });
  }

  authorize(
    intent: ActionIntent,
    toolName: string,
    canonicalInput: unknown,
    cart: Cart
  ): ActionAuthorizationDecision {
    if (!ActionTypeSchema.safeParse(toolName).success) {
      return { authorized: false, intent, reason: "not_irreversible_action" };
    }
    if (
      intent.affirmation !== "affirmative" ||
      intent.actionType !== toolName ||
      intent.negated ||
      intent.hypothetical ||
      intent.ambiguous ||
      intent.informationalOnly ||
      intent.comparisonOnly ||
      intent.futureIntent ||
      intent.thirdPartyIntent
    ) {
      return {
        authorized: false,
        intent,
        reason: intent.clarificationReason ?? "action_not_authorized",
      };
    }

    const input = canonicalInput as Record<string, unknown>;
    if (toolName === "add_to_cart") {
      if (
        input.productId !== intent.targetIds[0] ||
        input.quantity !== intent.quantity ||
        !Array.isArray(input.modifiers) ||
        input.modifiers.length !== 0 ||
        (input.customerNote ?? null) !== intent.customerNote
      ) {
        return { authorized: false, intent, reason: "action_scope_mismatch" };
      }
    } else if (
      toolName === "update_cart_item" ||
      toolName === "remove_from_cart"
    ) {
      if (
        input.lineId !== intent.targetIds[0] ||
        !cart.lines.some((line) => line.lineId === input.lineId)
      ) {
        return { authorized: false, intent, reason: "action_scope_mismatch" };
      }
      if (
        toolName === "update_cart_item" &&
        (intent.quantity === null ||
          input.quantity !== intent.quantity ||
          (Array.isArray(input.modifiers) && input.modifiers.length > 0) ||
          (input.customerNote ?? null) !== intent.customerNote)
      ) {
        return { authorized: false, intent, reason: "action_scope_mismatch" };
      }
    } else if (toolName === "clear_cart") {
      if (input.confirm !== true) {
        return { authorized: false, intent, reason: "action_scope_mismatch" };
      }
    } else if (
      toolName === "request_waiter" ||
      toolName === "request_bill"
    ) {
      if ((input.note ?? null) !== intent.customerNote) {
        return { authorized: false, intent, reason: "action_scope_mismatch" };
      }
    }
    return { authorized: true, intent, reason: null };
  }
}
