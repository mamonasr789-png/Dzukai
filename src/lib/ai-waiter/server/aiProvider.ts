import "server-only";

import type {
  Cart,
  ConversationState,
  ProductDetails,
  SupportedLanguage,
  ToolName,
} from "../schemas.ts";
import type {
  ProviderStep,
  ProviderToolCall,
} from "./providerTooling.ts";
import type { ToolExecutionResponse } from "./toolRegistry.ts";

export interface GroundedRestaurantRecord {
  key: string;
  value: string;
}

export type ProductProvenance =
  | "current_query"
  | "explicit_current_reference"
  | "explicit_prior_reference"
  | "cart"
  | "current_tool_result";

export interface GroundedProductProvenance {
  productId: string;
  provenance: ProductProvenance;
}

export interface GroundedCartSummary {
  revision: number;
  total: number;
  currency: "EUR";
  lines: Array<{
    lineId: string;
    productId: string;
    name: string;
    quantity: number;
    officialUnitPrice: number;
    requiresStaffConfirmation: boolean;
  }>;
}

export interface GroundedWaiterContext {
  policyVersion: string;
  language: SupportedLanguage;
  customerMessage: string;
  clientTurnId: string | null;
  state: Pick<
    ConversationState,
    | "stage"
    | "preferences"
    | "temporaryPreferences"
    | "dislikedIngredients"
    | "dietaryRequirements"
    | "allergies"
    | "budget"
    | "budgetScope"
    | "hungerLevel"
    | "latestReferencedProductIds"
    | "unresolvedQuestion"
    | "ambiguity"
  >;
  cart: GroundedCartSummary;
  relevantProducts: ProductDetails[];
  productProvenance: GroundedProductProvenance[];
  restaurantKnowledge: GroundedRestaurantRecord[];
}

export interface ProviderToolResult {
  callId: string;
  toolName: ToolName;
  result: ToolExecutionResponse;
}

export interface ProviderToolExchange {
  calls: ProviderToolCall[];
  results: ProviderToolResult[];
}

export interface AIProviderStepRequest {
  context: GroundedWaiterContext;
  exchanges: ProviderToolExchange[];
}

/**
 * Provider-neutral contract. Implementations return unknown so the controller,
 * not the adapter or model, remains the final runtime validation boundary.
 */
export interface AIProvider {
  readonly providerId: string;
  isAvailable(): boolean;
  generateStep(request: AIProviderStepRequest): Promise<unknown>;
}

export function summarizeCart(cart: Cart): GroundedCartSummary {
  return {
    revision: cart.revision,
    total: cart.total,
    currency: cart.currency,
    lines: cart.lines.map((line) => ({
      lineId: line.lineId,
      productId: line.productId,
      name: line.product.name,
      quantity: line.quantity,
      officialUnitPrice: line.product.officialUnitPrice,
      requiresStaffConfirmation: line.requiresStaffConfirmation,
    })),
  };
}

export type TestProviderScriptItem =
  | ProviderStep
  | Error
  | (() => ProviderStep | Promise<ProviderStep>);

export class ScriptedTestAIProvider implements AIProvider {
  readonly providerId = "scripted-test";
  private cursor = 0;
  private readonly script: TestProviderScriptItem[];
  private readonly available: boolean;

  constructor(
    script: TestProviderScriptItem[],
    available = true
  ) {
    this.script = script;
    this.available = available;
  }

  isAvailable(): boolean {
    return this.available;
  }

  async generateStep(): Promise<unknown> {
    const item = this.script[this.cursor];
    this.cursor += 1;
    if (!item) throw new Error("Test provider script exhausted.");
    if (item instanceof Error) throw item;
    return typeof item === "function" ? item() : item;
  }
}

export class HangingTestAIProvider implements AIProvider {
  readonly providerId = "hanging-test";

  isAvailable(): boolean {
    return true;
  }

  generateStep(): Promise<unknown> {
    return new Promise(() => undefined);
  }
}
