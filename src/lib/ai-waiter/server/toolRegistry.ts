import "server-only";

import type { z } from "zod";
import {
  AddCartItemInputSchema,
  CartOutputSchema,
  ClearCartInputSchema,
  GetProductDetailsInputSchema,
  ProductDetailsOutputSchema,
  RecommendProductsInputSchema,
  RecommendProductsOutputSchema,
  RemoveCartItemInputSchema,
  SearchMenuInputSchema,
  SearchMenuOutputSchema,
  StaffRequestInputSchema,
  StaffRequestOutputSchema,
  ToolExecutionRequestSchema,
  ToolNameSchema,
  UpdateCartItemInputSchema,
  ViewCartInputSchema,
  type ConversationState,
  type DiningSessionId,
  type ToolErrorCode,
  type ToolName,
} from "../schemas.ts";
import type { CartPort } from "./cartPort.ts";
import type { ConversationStateStore } from "./conversationStateStore.ts";
import type { MenuRepository } from "./menuRepository.ts";
import type { SafeOperationResult } from "./operationResult.ts";
import type { RateLimitPort } from "./rateLimitPort.ts";
import { logSafeToolEvent } from "./safeLogger.ts";
import type { StaffTaskPort } from "./staffTaskPort.ts";

type SearchMenuOutput = z.infer<typeof SearchMenuOutputSchema>;
type ProductDetailsOutput = z.infer<typeof ProductDetailsOutputSchema>;
type RecommendProductsOutput = z.infer<typeof RecommendProductsOutputSchema>;
type CartOutput = z.infer<typeof CartOutputSchema>;
type StaffRequestOutput = z.infer<typeof StaffRequestOutputSchema>;

export interface ToolDataMap {
  search_menu: SearchMenuOutput;
  get_product_details: ProductDetailsOutput;
  recommend_products: RecommendProductsOutput;
  add_to_cart: CartOutput;
  update_cart_item: CartOutput;
  remove_from_cart: CartOutput;
  view_cart: CartOutput;
  clear_cart: CartOutput;
  request_waiter: StaffRequestOutput;
  request_bill: StaffRequestOutput;
}

export type ToolSuccessResponse<N extends ToolName = ToolName> = {
  [K in N]: {
    ok: true;
    toolName: K;
    data: ToolDataMap[K];
  };
}[N];

export type ToolErrorResponse<N extends ToolName = ToolName> = {
  ok: false;
  toolName?: N;
  error: {
    code: ToolErrorCode;
    message: string;
  };
};

export type ToolExecutionResponse<N extends ToolName = ToolName> =
  | ToolSuccessResponse<N>
  | ToolErrorResponse<N>;

export interface ToolExecutionContext {
  requestFingerprint?: string;
}

export interface ToolRateLimitPolicy {
  sessionToolLimit: number;
  sessionToolWindowMs: number;
  staffActionLimit: number;
  staffActionWindowMs: number;
}

const DEFAULT_RATE_LIMIT_POLICY: ToolRateLimitPolicy = {
  sessionToolLimit: 120,
  sessionToolWindowMs: 60_000,
  staffActionLimit: 3,
  staffActionWindowMs: 5 * 60_000,
};

function errorResponse<N extends ToolName>(
  code: ToolErrorCode,
  message: string,
  toolName?: N
): ToolErrorResponse<N> {
  return { ok: false, toolName, error: { code, message } };
}

function summaryFromDetails(
  product: Awaited<
    ReturnType<MenuRepository["getRecommendationCandidates"]>
  >[number]
) {
  return {
    productId: product.productId,
    name: product.name,
    category: product.category,
    officialUnitPrice: product.officialUnitPrice,
    currency: product.currency,
    allergenStatus: product.allergenStatus,
    orderability: product.orderability,
  };
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export class SafeToolRegistry {
  private readonly conversationStore: ConversationStateStore;
  private readonly menuRepository: MenuRepository;
  private readonly cartPort: CartPort;
  private readonly staffTaskPort: StaffTaskPort;
  private readonly rateLimitPort: RateLimitPort;
  private readonly rateLimitPolicy: ToolRateLimitPolicy;

  constructor(
    conversationStore: ConversationStateStore,
    menuRepository: MenuRepository,
    cartPort: CartPort,
    staffTaskPort: StaffTaskPort,
    rateLimitPort: RateLimitPort,
    rateLimitPolicy: Partial<ToolRateLimitPolicy> = {}
  ) {
    this.conversationStore = conversationStore;
    this.menuRepository = menuRepository;
    this.cartPort = cartPort;
    this.staffTaskPort = staffTaskPort;
    this.rateLimitPort = rateLimitPort;
    this.rateLimitPolicy = {
      ...DEFAULT_RATE_LIMIT_POLICY,
      ...rateLimitPolicy,
    };
  }

  async execute(
    rawRequest: unknown,
    context: ToolExecutionContext = {}
  ): Promise<ToolExecutionResponse> {
    const startedAt = Date.now();
    const request = ToolExecutionRequestSchema.safeParse(rawRequest);
    if (!request.success) {
      const possibleToolName =
        typeof rawRequest === "object" &&
        rawRequest !== null &&
        "toolName" in rawRequest &&
        typeof rawRequest.toolName === "string"
          ? rawRequest.toolName
          : undefined;
      const toolName = ToolNameSchema.safeParse(possibleToolName);
      const code: ToolErrorCode =
        possibleToolName !== undefined && !toolName.success
          ? "unknown_tool"
          : "invalid_request";
      logSafeToolEvent({
        event: "tool_validation_failed",
        toolName: toolName.success ? toolName.data : undefined,
        category: code,
        status: "error",
        durationMs: Date.now() - startedAt,
      });
      return errorResponse(
        code,
        code === "unknown_tool"
          ? "Requested tool is not registered."
          : "Tool execution request failed validation.",
        toolName.success ? toolName.data : undefined
      );
    }

    const { sessionId, toolName, input } = request.data;
    logSafeToolEvent({ event: "tool_started", toolName, sessionId });
    const rateKey = `tool-session:${sessionId}:${
      context.requestFingerprint ?? "internal"
    }`;
    const rateDecision = await this.rateLimitPort.consume({
      key: rateKey,
      limit: this.rateLimitPolicy.sessionToolLimit,
      windowMs: this.rateLimitPolicy.sessionToolWindowMs,
    });
    if (!rateDecision.allowed) {
      return this.complete(
        startedAt,
        sessionId,
        toolName,
        errorResponse(
          "rate_limited",
          "Tool request rate limit exceeded. Retry later.",
          toolName
        )
      );
    }

    const touched = await this.conversationStore.touchSession(sessionId);
    if (!touched.ok) {
      return this.complete(
        startedAt,
        sessionId,
        toolName,
        errorResponse(
          "session_not_found",
          "Dining session was not found or expired.",
          toolName
        )
      );
    }

    try {
      const response = await this.executeRegisteredTool(
        sessionId,
        toolName,
        input
      );
      return this.complete(startedAt, sessionId, toolName, response);
    } catch {
      logSafeToolEvent({
        event: "tool_unexpected_error",
        toolName,
        sessionId,
        category: "unexpected_server_error",
        status: "error",
        durationMs: Date.now() - startedAt,
      });
      return errorResponse(
        "internal_error",
        "The tool could not be completed safely.",
        toolName
      );
    }
  }

  private async executeRegisteredTool(
    sessionId: DiningSessionId,
    toolName: ToolName,
    input: unknown
  ): Promise<ToolExecutionResponse> {
    switch (toolName) {
      case "search_menu":
        return this.searchMenu(sessionId, input);
      case "get_product_details":
        return this.getProductDetails(sessionId, input);
      case "recommend_products":
        return this.recommendProducts(sessionId, input);
      case "add_to_cart":
        return this.cartMutation(
          toolName,
          sessionId,
          input,
          AddCartItemInputSchema,
          (command) => this.cartPort.addCartItem(sessionId, command)
        );
      case "update_cart_item":
        return this.cartMutation(
          toolName,
          sessionId,
          input,
          UpdateCartItemInputSchema,
          (command) => this.cartPort.updateCartItem(sessionId, command)
        );
      case "remove_from_cart":
        return this.cartMutation(
          toolName,
          sessionId,
          input,
          RemoveCartItemInputSchema,
          (command) => this.cartPort.removeCartItem(sessionId, command)
        );
      case "view_cart":
        return this.cartMutation(
          toolName,
          sessionId,
          input,
          ViewCartInputSchema,
          () => this.cartPort.getCart(sessionId)
        );
      case "clear_cart":
        return this.cartMutation(
          toolName,
          sessionId,
          input,
          ClearCartInputSchema,
          (command) => this.cartPort.clearCart(sessionId, command)
        );
      case "request_waiter":
        return this.staffRequest(toolName, sessionId, input, "waiter");
      case "request_bill":
        return this.staffRequest(toolName, sessionId, input, "bill");
    }
  }

  private async searchMenu(
    sessionId: DiningSessionId,
    input: unknown
  ): Promise<ToolExecutionResponse<"search_menu">> {
    const parsed = SearchMenuInputSchema.safeParse(input);
    if (!parsed.success) return this.invalidToolInput("search_menu");
    const state = await this.requireState(sessionId);
    if (!state) {
      return errorResponse(
        "session_not_found",
        "Dining session was not found or expired.",
        "search_menu"
      );
    }
    const products = await this.menuRepository.searchProducts(
      parsed.data.query,
      parsed.data,
      state.language
    );
    await this.rememberProducts(
      sessionId,
      products.map((product) => product.productId)
    );
    const output = SearchMenuOutputSchema.parse({
      products: products.map(summaryFromDetails),
    });
    return { ok: true, toolName: "search_menu", data: output };
  }

  private async getProductDetails(
    sessionId: DiningSessionId,
    input: unknown
  ): Promise<ToolExecutionResponse<"get_product_details">> {
    const parsed = GetProductDetailsInputSchema.safeParse(input);
    if (!parsed.success) return this.invalidToolInput("get_product_details");
    const state = await this.requireState(sessionId);
    if (!state) {
      return errorResponse(
        "session_not_found",
        "Dining session was not found or expired.",
        "get_product_details"
      );
    }
    const product = await this.menuRepository.getProductDetails(
      parsed.data.productId,
      state.language
    );
    if (!product) {
      return errorResponse(
        "product_not_found",
        "Product does not exist in the official menu.",
        "get_product_details"
      );
    }
    await this.rememberProducts(sessionId, [product.productId]);
    const output = ProductDetailsOutputSchema.parse({ product });
    return { ok: true, toolName: "get_product_details", data: output };
  }

  private async recommendProducts(
    sessionId: DiningSessionId,
    input: unknown
  ): Promise<ToolExecutionResponse<"recommend_products">> {
    const parsed = RecommendProductsInputSchema.safeParse(input);
    if (!parsed.success) return this.invalidToolInput("recommend_products");
    const state = await this.requireState(sessionId);
    if (!state) {
      return errorResponse(
        "session_not_found",
        "Dining session was not found or expired.",
        "recommend_products"
      );
    }
    const dietaryRequirements = unique([
      ...state.dietaryRequirements,
      ...parsed.data.dietaryRequirements,
    ]);
    const certificationUnknown =
      dietaryRequirements.includes("halal") ||
      dietaryRequirements.includes("kosher");
    const products = await this.menuRepository.getRecommendationCandidates(
      {
        ...parsed.data,
        maxPrice: parsed.data.maxPrice ?? state.budget ?? undefined,
        excludeProductIds: unique([
          ...parsed.data.excludeProductIds,
          ...state.latestReferencedProductIds,
        ]),
        dietaryRequirements,
        allergies: uniqueAllergies([
          ...state.allergies,
          ...parsed.data.allergies,
        ]),
        preferredProteins: state.preferences.preferredProteins,
      },
      state.language
    );
    await this.rememberProducts(
      sessionId,
      products.map((product) => product.productId)
    );
    const output = RecommendProductsOutputSchema.parse({
      products: products.map(summaryFromDetails),
      allergySafetyConfirmed: false,
      certificationStatus: certificationUnknown ? "unknown" : "not_requested",
      requiresStaffConfirmation: certificationUnknown,
    });
    return { ok: true, toolName: "recommend_products", data: output };
  }

  private async cartMutation<
    N extends
      | "add_to_cart"
      | "update_cart_item"
      | "remove_from_cart"
      | "view_cart"
      | "clear_cart",
    T,
  >(
    toolName: N,
    sessionId: DiningSessionId,
    input: unknown,
    schema: z.ZodType<T>,
    execute: (
      command: T
    ) => Promise<SafeOperationResult<z.infer<typeof CartOutputSchema>>>
  ): Promise<ToolExecutionResponse<N>> {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return this.invalidToolInput(toolName);
    const result = await execute(parsed.data);
    if (!result.ok) {
      return errorResponse(result.error.code, result.error.message, toolName);
    }
    const output = CartOutputSchema.parse(result.data);
    await this.conversationStore.updateConversationStage(
      sessionId,
      "cart_review"
    );
    return { ok: true, toolName, data: output } as ToolSuccessResponse<N>;
  }

  private async staffRequest<
    N extends "request_waiter" | "request_bill",
  >(
    toolName: N,
    sessionId: DiningSessionId,
    input: unknown,
    kind: "waiter" | "bill"
  ): Promise<ToolExecutionResponse<N>> {
    const parsed = StaffRequestInputSchema.safeParse(input);
    if (!parsed.success) return this.invalidToolInput(toolName);
    const rateDecision = await this.rateLimitPort.consume({
      key: `staff:${sessionId}:${toolName}`,
      limit: this.rateLimitPolicy.staffActionLimit,
      windowMs: this.rateLimitPolicy.staffActionWindowMs,
    });
    if (!rateDecision.allowed) {
      return errorResponse(
        "rate_limited",
        "Staff-request rate limit exceeded. Retry later.",
        toolName
      );
    }
    const result =
      kind === "waiter"
        ? await this.staffTaskPort.requestWaiter(sessionId, parsed.data)
        : await this.staffTaskPort.requestBill(sessionId, parsed.data);
    if (!result.ok) {
      return errorResponse(result.error.code, result.error.message, toolName);
    }
    const output = StaffRequestOutputSchema.parse(result.data);
    await this.conversationStore.updateConversationStage(
      sessionId,
      "service_request"
    );
    return { ok: true, toolName, data: output } as ToolSuccessResponse<N>;
  }

  private invalidToolInput<N extends ToolName>(
    toolName: N
  ): ToolErrorResponse<N> {
    return errorResponse(
      "invalid_tool_input",
      "Tool input failed runtime validation.",
      toolName
    );
  }

  private requireState(
    sessionId: DiningSessionId
  ): Promise<ConversationState | null> {
    return this.conversationStore.getSession(sessionId);
  }

  private async rememberProducts(
    sessionId: DiningSessionId,
    productIds: string[]
  ): Promise<void> {
    if (productIds.length === 0) return;
    await this.conversationStore.setLatestReferences(sessionId, productIds);
  }

  private complete<N extends ToolName>(
    startedAt: number,
    sessionId: DiningSessionId,
    toolName: N,
    response: ToolExecutionResponse<N>
  ): ToolExecutionResponse<N> {
    logSafeToolEvent({
      event: "tool_completed",
      toolName,
      sessionId,
      category: response.ok ? undefined : response.error.code,
      status: response.ok ? "success" : "error",
      durationMs: Date.now() - startedAt,
    });
    return response;
  }
}

function uniqueAllergies(
  allergies: ConversationState["allergies"]
): ConversationState["allergies"] {
  const seen = new Set<string>();
  return allergies.filter((allergy) => {
    const key = `${allergy.allergen}:${allergy.otherLabel ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
