import "server-only";

import type {
  AIProvider,
  AIProviderStepRequest,
  ProviderToolResult,
} from "./aiProvider.ts";
import type { ProviderStep } from "./providerTooling.ts";
import { safeLegacyGreeting } from "./legacyDeterministicBoundary.ts";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function referencedOrdinal(message: string): number {
  const numeric = message.match(
    /(?:recommendation|pasiul\w*|предлож)[^\d]{0,12}([1-9])|([1-9])[^\d]{0,12}(?:recommendation|pasiul\w*|предлож)/u
  );
  if (numeric) return Number(numeric[1] ?? numeric[2]) - 1;
  if (/\b(antr\w*|second)\b|втор/u.test(message)) return 1;
  if (/\b(treci\w*|third)\b|трет/u.test(message)) return 2;
  return 0;
}

const text = {
  lt: {
    clarifyReference: "Kurį konkretų patiekalą turite omenyje?",
    clarifyVariant: "Kurį dydį ar variantą norėtumėte pasirinkti?",
    clarifyModifier:
      "Šio pakeitimo meniu duomenys nepatvirtina. Ar pakviesti darbuotoją patikslinti?",
    allergy:
      "Alergiją pasižymėjau, tačiau saugumo ir kryžminės taršos patvirtinti negaliu. Ar pakviesti darbuotoją?",
    noResults:
      "Pagal šiuos kriterijus patikimo pasiūlymo neradau. Kurį kriterijų galime pakeisti?",
    added: "Pasirinkimas saugiai pridėtas į krepšelį.",
    staff: "Prašymas perduotas darbuotojams.",
    viewedCart: "Parodžiau dabartinį krepšelį.",
    staffUnavailable:
      "Šiame demonstraciniame režime padavėjo ir sąskaitos užklausos nepasiekiamos.",
    generic: "Kuo galėčiau padėti išsirinkti: maistu, gėrimu ar užsakymu?",
  },
  en: {
    clarifyReference: "Which specific item do you mean?",
    clarifyVariant: "Which size or variant would you like?",
    clarifyModifier:
      "The menu data does not confirm that modification. Shall I ask a staff member to check?",
    allergy:
      "I’ve recorded the allergy, but I cannot confirm safety or cross-contamination. Shall I ask a staff member?",
    noResults:
      "I couldn’t find a reliable match for those criteria. Which criterion can we adjust?",
    added: "The selection was safely added to your cart.",
    staff: "The request has been sent to staff.",
    viewedCart: "I’ve shown the current cart.",
    staffUnavailable:
      "Waiter and bill requests are unavailable in this demo session.",
    generic: "How can I help: choosing food, a drink, or managing the order?",
  },
  ru: {
    clarifyReference: "Какое именно блюдо вы имеете в виду?",
    clarifyVariant: "Какой размер или вариант вы хотите выбрать?",
    clarifyModifier:
      "Данные меню не подтверждают такую модификацию. Позвать сотрудника для уточнения?",
    allergy:
      "Я отметил аллергию, но не могу подтвердить безопасность или отсутствие перекрёстного загрязнения. Позвать сотрудника?",
    noResults:
      "Не удалось найти надёжный вариант по этим критериям. Какой критерий можно изменить?",
    added: "Выбранная позиция безопасно добавлена в корзину.",
    staff: "Запрос передан сотрудникам.",
    viewedCart: "Я показал текущую корзину.",
    staffUnavailable:
      "В демонстрационном режиме вызов официанта и запрос счёта недоступны.",
    generic: "С чем помочь: выбрать еду, напиток или изменить заказ?",
  },
} as const;

function successfulProducts(results: ProviderToolResult[]) {
  for (const item of results) {
    if (!item.result.ok) continue;
    if (
      item.result.toolName === "recommend_products" ||
      item.result.toolName === "search_menu"
    ) {
      return item.result.data.products;
    }
  }
  return [];
}

function resultStep(
  request: AIProviderStepRequest,
  results: ProviderToolResult[]
): ProviderStep {
  const language = request.context.language;
  const copy = text[language];
  const products = successfulProducts(results);
  if (products.length > 0) {
    const summary = products
      .slice(0, 3)
      .map((product) => product.name)
      .join(", ");
    return {
      kind: "final",
      message:
        language === "en"
          ? `These official options fit best: ${summary}.`
          : language === "ru"
            ? `Лучше всего подходят эти позиции: ${summary}.`
            : `Geriausiai tinka šie oficialūs variantai: ${summary}.`,
      referencedProductIds: products
        .slice(0, 3)
        .map((product) => product.productId),
      claims: products.slice(0, 3).map((product) => ({
        claimType: "product_price" as const,
        productId: product.productId,
        proposedValue: Math.round(product.officialUnitPrice * 100),
        provenance: "official_menu" as const,
      })),
      stateUpdate: { stage: "recommending" },
    };
  }
  const cartResult = results.find(
    (item) =>
      item.result.ok &&
      [
        "add_to_cart",
        "update_cart_item",
        "remove_from_cart",
        "clear_cart",
      ].includes(item.toolName)
  );
  if (cartResult?.result.ok) {
    return {
      kind: "final",
      message: copy.added,
      referencedProductIds: [],
      stateUpdate: { stage: "cart_review" },
    };
  }
  const staffResult = results.find(
    (item) =>
      item.result.ok &&
      ["request_waiter", "request_bill"].includes(item.toolName)
  );
  if (staffResult) {
    return {
      kind: "final",
      message: copy.staff,
      referencedProductIds: [],
      stateUpdate: { stage: "service_request" },
    };
  }
  const viewCartResult = results.find(
    (item) => item.result.ok && item.toolName === "view_cart"
  );
  if (viewCartResult) {
    return {
      kind: "final",
      message: copy.viewedCart,
      referencedProductIds: [],
      stateUpdate: { stage: "cart_review" },
    };
  }
  const error = results.find((item) => !item.result.ok);
  if (error && !error.result.ok) {
    const staffUnavailable =
      error.result.error.code === "table_context_required" &&
      ["request_waiter", "request_bill"].includes(error.toolName);
    const requiredVariant = error.result.error.code === "required_variant_missing";
    const modifier =
      error.result.error.code === "unsupported_modifier" ||
      error.result.error.code === "requires_staff_confirmation";
    return {
      kind: "clarification",
      message: staffUnavailable
        ? copy.staffUnavailable
        : requiredVariant
        ? copy.clarifyVariant
        : modifier
          ? copy.clarifyModifier
          : copy.clarifyReference,
      unresolvedQuestion: {
        kind: requiredVariant
          ? "product_reference"
          : staffUnavailable
            ? "other"
          : modifier
            ? "modifier_confirmation"
            : "other",
        promptKey: requiredVariant
          ? "required_variant"
          : staffUnavailable
            ? "demo_staff_unavailable"
          : modifier
            ? "unsupported_modifier"
            : "tool_error",
        relatedProductIds: request.context.state.latestReferencedProductIds,
      },
      ambiguity: request.context.state.ambiguity,
      stateUpdate: { stage: "clarifying" },
    };
  }
  return {
    kind: "clarification",
    message: copy.noResults,
    unresolvedQuestion: {
      kind: "other",
      promptKey: "no_grounded_match",
      relatedProductIds: [],
    },
    ambiguity: null,
    stateUpdate: { stage: "clarifying" },
  };
}

export class DeterministicFallbackProvider implements AIProvider {
  readonly providerId = "deterministic-fallback";

  isAvailable(): boolean {
    return true;
  }

  generateStep(request: AIProviderStepRequest): Promise<unknown> {
    const lastExchange = request.exchanges.at(-1);
    if (lastExchange) {
      return Promise.resolve(resultStep(request, lastExchange.results));
    }

    const { context } = request;
    const copy = text[context.language];
    const message = normalize(context.customerMessage);
    if (/\b(saskait\w*|bill)\b|сч[её]т/u.test(message)) {
      return Promise.resolve({
        kind: "tool_requests",
        toolCalls: [
          { callId: "fallback_bill", toolName: "request_bill", input: {} },
        ],
      } satisfies ProviderStep);
    }
    if (/\b(padavej\w*|waiter)\b|официант/u.test(message)) {
      return Promise.resolve({
        kind: "tool_requests",
        toolCalls: [
          {
            callId: "fallback_waiter",
            toolName: "request_waiter",
            input: {},
          },
        ],
      } satisfies ProviderStep);
    }
    if (
      /(?:\b(parodyk|show|view)\b|покаж)[^.!?]{0,40}(?:\b(krepsel\w*|cart)\b|корзин)/u.test(
        message
      )
    ) {
      return Promise.resolve({
        kind: "tool_requests",
        toolCalls: [
          { callId: "fallback_view_cart", toolName: "view_cart", input: {} },
        ],
      } satisfies ProviderStep);
    }
    if (
      /(?:\b(isvalyk|istustink|clear|empty)\b|очист|опустош)[^.!?]{0,30}(?:\b(krepsel\w*|cart)\b|корзин)/u.test(
        message
      )
    ) {
      return Promise.resolve({
        kind: "tool_requests",
        toolCalls: [
          {
            callId: "fallback_clear",
            toolName: "clear_cart",
            input: { confirm: true },
          },
        ],
      } satisfies ProviderStep);
    }
    if (/\b(pakeisk|atnaujink|update|change)\b|измен|обнов/u.test(message)) {
      const secondLine = /\b(antr\w*|second)\b|втор/u.test(message);
      const line = secondLine ? context.cart.lines[1] : context.cart.lines[0];
      const quantityMatch = message.match(/\b(\d{1,2})\b/u);
      const quantity = quantityMatch ? Number(quantityMatch[1]) : null;
      if (!line || !quantity || quantity < 1 || quantity > 20) {
        return Promise.resolve({
          kind: "clarification",
          message: copy.clarifyReference,
          unresolvedQuestion: {
            kind: "cart_line_reference",
            promptKey: "missing_cart_line_or_quantity",
            relatedProductIds: [],
          },
          ambiguity: null,
          stateUpdate: { stage: "clarifying" },
        } satisfies ProviderStep);
      }
      return Promise.resolve({
        kind: "tool_requests",
        toolCalls: [
          {
            callId: "fallback_update",
            toolName: "update_cart_item",
            input: { lineId: line.lineId, quantity },
          },
        ],
      } satisfies ProviderStep);
    }
    if (/\b(pasalink|remove)\b|удал|убер/u.test(message)) {
      const secondLine = /\b(antr\w*|second)\b|втор/u.test(message);
      const line = secondLine ? context.cart.lines[1] : context.cart.lines[0];
      if (!line) {
        return Promise.resolve({
          kind: "clarification",
          message: copy.clarifyReference,
          unresolvedQuestion: {
            kind: "cart_line_reference",
            promptKey: "missing_cart_line",
            relatedProductIds: [],
          },
          ambiguity: null,
          stateUpdate: { stage: "clarifying" },
        } satisfies ProviderStep);
      }
      return Promise.resolve({
        kind: "tool_requests",
        toolCalls: [
          {
            callId: "fallback_remove",
            toolName: "remove_from_cart",
            input: { lineId: line.lineId },
          },
        ],
      } satisfies ProviderStep);
    }
    const foodSafetyOrSelection =
      /\b(valgyti|patiekal|maist|eat|food|dish|safe|saug\w*|recommend|pasiulyk|noriu)\b|ед|блюд|безопас|рекоменд|хочу/u.test(
        message
      );
    if (
      (context.state.allergies.length > 0 && foodSafetyOrSelection) ||
      /\b(alerg\w*|allerg\w*)\b|аллерг/u.test(message)
    ) {
      return Promise.resolve({
        kind: "staff_escalation",
        message: copy.allergy,
        recommendedAction: "none",
        stateUpdate: { stage: "clarifying" },
      } satisfies ProviderStep);
    }
    if (
      /\b(be |without|papildomai |extra |gerai iske|well[- ]done)\S+|без\s+\S+|добав(?:ьте|ь)?\s+ещ[её]/u.test(
        message
      )
    ) {
      return Promise.resolve({
        kind: "clarification",
        message: copy.clarifyModifier,
        unresolvedQuestion: {
          kind: "modifier_confirmation",
          promptKey: "unsupported_modifier",
          relatedProductIds: context.state.latestReferencedProductIds,
        },
        ambiguity: context.state.ambiguity,
        stateUpdate: { stage: "clarifying" },
      } satisfies ProviderStep);
    }

    const same =
      /\b(tok[iy] pat|same)\b|тако[йе]\s+же/u.test(message);
    const add = /\b(pridek|add|imsiu|take)\b|добав|полож/u.test(message);
    const reference =
      context.state.latestReferencedProductIds[referencedOrdinal(message)];
    if ((add || same) && reference) {
      const grounded = context.relevantProducts.find(
        (product) => product.productId === reference
      );
      if (grounded?.orderability.status === "requires_variant") {
        return Promise.resolve({
          kind: "clarification",
          message: copy.clarifyVariant,
          unresolvedQuestion: {
            kind: "product_reference",
            promptKey: "required_variant",
            relatedProductIds: [reference],
          },
          ambiguity: null,
          stateUpdate: { stage: "clarifying" },
        } satisfies ProviderStep);
      }
      return Promise.resolve({
        kind: "tool_requests",
        toolCalls: [
          {
            callId: "fallback_add",
            toolName: "add_to_cart",
            input: {
              productId: reference,
              quantity: 1,
              modifiers: [],
              customerNote:
                context.customerMessage.match(
                  /(?:pastaba|note|примечание)\s*:\s*([^.!?\n]{1,180})/iu
                )?.[1]?.trim() ?? null,
            },
          },
        ],
      } satisfies ProviderStep);
    }
    if (add || same) {
      return Promise.resolve({
        kind: "clarification",
        message: copy.clarifyReference,
        unresolvedQuestion: {
          kind: "product_reference",
          promptKey: "missing_reference",
          relatedProductIds: [],
        },
        ambiguity: context.state.ambiguity,
        stateUpdate: { stage: "clarifying" },
      } satisfies ProviderStep);
    }

    if (
      (/\b(labas|sveiki|hello|hi|hey)\b/u.test(message) ||
        /привет|здравств/u.test(message)) &&
      !/\b(noriu|want|recommend|pasiulyk|parodyk|something|kazko)\b|хочу|рекоменд|покаж/u.test(
        message
      )
    ) {
      return Promise.resolve({
        kind: "final",
        message:
          safeLegacyGreeting(
            context.customerMessage,
            context.language
          ) ?? copy.generic,
        referencedProductIds: [],
        stateUpdate: { stage: "discovering_preferences" },
      } satisfies ProviderStep);
    }

    if (context.restaurantKnowledge.length > 0) {
      return Promise.resolve({
        kind: "final",
        message:
          context.language === "lt"
            ? "Štai patvirtinta restorano informacija."
            : context.language === "en"
              ? "Here is the verified restaurant information."
              : "Вот подтверждённая информация о ресторане.",
        referencedProductIds: [],
        claims: context.restaurantKnowledge.map((record) => ({
          claimType: "restaurant_fact" as const,
          proposedValue: record.value,
          provenance: "restaurant_knowledge" as const,
        })),
      } satisfies ProviderStep);
    }

    if (
      /\b(noriu|want|recommend|pasiulyk|parodyk|something|kazko|vegetar\w*|beef|jautien\w*)\b|хочу|рекоменд|посовет|покаж|вегетари|говядин/u.test(
        message
      )
    ) {
      return Promise.resolve({
        kind: "tool_requests",
        toolCalls: [
          {
            callId: "fallback_recommend",
            toolName: "recommend_products",
            input: {
              ...(context.state.budget
                ? { maxPrice: context.state.budget }
                : {}),
              excludeProductIds: [],
              dietaryRequirements: context.state.dietaryRequirements,
              allergies: context.state.allergies,
              limit: /\b(du|dvi|two)\b/u.test(message) ? 2 : 3,
            },
          },
        ],
      } satisfies ProviderStep);
    }

    return Promise.resolve({
      kind: "final",
      message: copy.generic,
      referencedProductIds: [],
      stateUpdate: { stage: "discovering_preferences" },
    } satisfies ProviderStep);
  }
}
