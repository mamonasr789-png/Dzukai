import "server-only";

import { z } from "zod";
import type {
  AIProvider,
  AIProviderStepRequest,
  ProviderToolResult,
} from "./aiProvider.ts";
import {
  PROVIDER_TOOL_DEFINITIONS,
  PROVIDER_CLAIMS_JSON_SCHEMA,
  PROVIDER_STATE_UPDATE_JSON_SCHEMA,
  ProviderClaimSchema,
  ProviderStateUpdateSchema,
  ProviderStepSchema,
} from "./providerTooling.ts";
import { WAITER_POLICY } from "./waiterPolicy.ts";

const FINAL_RESPONSE_TOOL = "final_waiter_response";
const CLARIFICATION_TOOL = "clarify_waiter_response";
const STAFF_ESCALATION_TOOL = "recommend_staff_escalation";

/**
 * Output-token budget for one provider step. See the derivation comment in the
 * constructor: the response contract bounds a final answer at roughly 1300
 * tokens, so the default clears it with headroom and the cap bounds any
 * caller-supplied override.
 */
export const DEFAULT_MAXIMUM_OUTPUT_TOKENS = 2_048;
export const MAXIMUM_OUTPUT_TOKENS_CAP = 4_096;

const AnthropicContentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }).passthrough(),
  z
    .object({
      type: z.literal("tool_use"),
      id: z.string().min(1).max(120),
      name: z.string().min(1).max(80),
      input: z.unknown(),
    })
    .passthrough(),
]);

const AnthropicResponseSchema = z
  .object({
    content: z.array(AnthropicContentBlockSchema).max(32),
    stop_reason: z.string().nullable().optional(),
  })
  .passthrough();

const FinalInputSchema = z
  .object({
    message: z.string().trim().min(1).max(1_500),
    referencedProductIds: z.array(z.string()).max(10).default([]),
    claims: z.array(ProviderClaimSchema).max(20).default([]),
    stateUpdate: ProviderStateUpdateSchema.optional(),
  })
  .strict();

const ClarificationInputSchema = z
  .object({
    message: z.string().trim().min(1).max(1_500),
    unresolvedQuestion: z.unknown(),
    ambiguity: z.unknown().nullable().default(null),
    stateUpdate: ProviderStateUpdateSchema.optional(),
  })
  .strict();

const StaffEscalationInputSchema = z
  .object({
    message: z.string().trim().min(1).max(1_500),
    recommendedAction: z.enum(["request_waiter", "request_bill", "none"]),
    stateUpdate: ProviderStateUpdateSchema.optional(),
  })
  .strict();

interface AnthropicProviderOptions {
  apiKey?: string;
  apiKeyProvider?: () => string | undefined;
  model?: string;
  timeoutMs?: number;
  fetchImplementation?: typeof fetch;
  maximumRequestBytes?: number;
  maximumResponseBytes?: number;
  maximumOutputTokens?: number;
}

function compactToolResult(result: ProviderToolResult): string {
  if (!result.result.ok) {
    return JSON.stringify({
      ok: false,
      toolName: result.toolName,
      error: result.result.error,
    });
  }
  const data = structuredClone(result.result.data) as Record<string, unknown>;
  if ("cart" in data && data.cart && typeof data.cart === "object") {
    const cart = data.cart as { lines?: Array<Record<string, unknown>> };
    cart.lines = cart.lines?.map((line) => ({
      ...line,
      customerNote: null,
    }));
  }
  return JSON.stringify({ ok: true, toolName: result.toolName, data });
}

function providerMessages(request: AIProviderStepRequest): unknown[] {
  const messages: unknown[] = [
    {
      role: "user",
      content: JSON.stringify({
        task: "Handle this customer turn using only grounded facts and tools.",
        groundedContext: request.context,
      }),
    },
  ];
  for (const exchange of request.exchanges) {
    messages.push({
      role: "assistant",
      content: exchange.calls.map((call) => ({
        type: "tool_use",
        id: call.callId,
        name: call.toolName,
        input: call.input,
      })),
    });
    messages.push({
      role: "user",
      content: exchange.results.map((result) => ({
        type: "tool_result",
        tool_use_id: result.callId,
        content: compactToolResult(result),
        is_error: !result.result.ok,
      })),
    });
  }
  return messages;
}

const responseTools = [
  {
    name: FINAL_RESPONSE_TOOL,
    description:
      "Submit the final concise grounded customer response. Every mentioned or recommended menu product must appear in referencedProductIds.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["message", "referencedProductIds"],
      properties: {
        message: { type: "string", minLength: 1, maxLength: 1500 },
        referencedProductIds: {
          type: "array",
          items: { type: "string" },
          maxItems: 10,
        },
        claims: PROVIDER_CLAIMS_JSON_SCHEMA,
        stateUpdate: PROVIDER_STATE_UPDATE_JSON_SCHEMA,
      },
    },
  },
  {
    name: CLARIFICATION_TOOL,
    description:
      "Ask exactly one useful clarification when a product, cart line, variant, modifier, quantity, or safety fact is ambiguous.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["message", "unresolvedQuestion"],
      properties: {
        message: { type: "string", minLength: 1, maxLength: 1500 },
        unresolvedQuestion: { type: "object" },
        ambiguity: { type: ["object", "null"] },
        stateUpdate: PROVIDER_STATE_UPDATE_JSON_SCHEMA,
      },
    },
  },
  {
    name: STAFF_ESCALATION_TOOL,
    description:
      "Recommend staff help for information or safety that cannot be confirmed. This recommendation does not itself create a staff task.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["message", "recommendedAction"],
      properties: {
        message: { type: "string", minLength: 1, maxLength: 1500 },
        recommendedAction: {
          enum: ["request_waiter", "request_bill", "none"],
        },
        stateUpdate: PROVIDER_STATE_UPDATE_JSON_SCHEMA,
      },
    },
  },
];

export class AnthropicAIProvider implements AIProvider {
  readonly providerId = "anthropic";
  private readonly apiKeyProvider: () => string | undefined;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;
  private readonly maximumRequestBytes: number;
  private readonly maximumResponseBytes: number;
  private readonly maximumOutputTokens: number;

  constructor(options: AnthropicProviderOptions = {}) {
    this.apiKeyProvider =
      options.apiKey !== undefined
        ? () => options.apiKey?.trim() || undefined
        : options.apiKeyProvider ??
          (() => process.env.ANTHROPIC_API_KEY?.trim() || undefined);
    this.model =
      options.model ??
      process.env.AI_WAITER_ANTHROPIC_MODEL ??
      "claude-sonnet-4-6";
    // Must stay strictly below WaiterTurnController.providerTimeoutMs so the
    // provider's own AbortSignal fires first and the loop can fall back
    // cleanly. Observed real turns (full policy + tool schemas + grounded
    // menu context) ran 9.6–12.0 s and were being killed by the old 12 s cap.
    this.timeoutMs = options.timeoutMs ?? 45_000;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.maximumRequestBytes = options.maximumRequestBytes ?? 128_000;
    this.maximumResponseBytes = options.maximumResponseBytes ?? 128_000;
    // Sized from the response contract's own bounds, not guesswork: a final
    // response allows message ≤ 1500 chars (~400 tokens) + up to 20 claims
    // (~700 tokens) + up to 10 referencedProductIds + JSON overhead ≈ 1300
    // tokens worst case. The old 700/1024 pair sat below that, so ordinary
    // multi-item grounded menu answers terminated with stop_reason
    // "max_tokens" and were (correctly) rejected as truncated. 2048 clears the
    // contract-bounded worst case with headroom; 4096 caps configuration so an
    // over-large override cannot make turns unboundedly slow or expensive.
    this.maximumOutputTokens = Math.min(
      options.maximumOutputTokens ?? DEFAULT_MAXIMUM_OUTPUT_TOKENS,
      MAXIMUM_OUTPUT_TOKENS_CAP
    );
  }

  isAvailable(): boolean {
    return Boolean(this.apiKeyProvider());
  }

  async generateStep(request: AIProviderStepRequest): Promise<unknown> {
    const apiKey = this.apiKeyProvider();
    if (!apiKey) throw new Error("provider_unavailable");
    const body = JSON.stringify({
      model: this.model,
      max_tokens: this.maximumOutputTokens,
      system: `${WAITER_POLICY}\n\nReturn exactly one response-contract tool when you are ready to answer. Put sensitive factual claims only in the structured claims array. Do not emit customer-facing free text outside that tool.`,
      messages: providerMessages(request),
      tools: [
        ...PROVIDER_TOOL_DEFINITIONS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema,
        })),
        ...responseTools,
      ],
      tool_choice: { type: "auto" },
    });
    if (new TextEncoder().encode(body).byteLength > this.maximumRequestBytes) {
      throw new Error("provider_request_too_large");
    }
    const response = await this.fetchImplementation(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      }
    );
    if (!response.ok) throw new Error("provider_request_failed");
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > this.maximumResponseBytes
    ) {
      throw new Error("provider_response_too_large");
    }
    const responseText = await response.text();
    if (
      new TextEncoder().encode(responseText).byteLength >
      this.maximumResponseBytes
    ) {
      throw new Error("provider_response_too_large");
    }
    let responseJson: unknown;
    try {
      responseJson = JSON.parse(responseText);
    } catch {
      throw new Error("provider_response_invalid");
    }
    const raw = AnthropicResponseSchema.safeParse(responseJson);
    if (!raw.success) throw new Error("provider_response_invalid");

    const toolBlocks = raw.data.content.filter(
      (block): block is Extract<typeof block, { type: "tool_use" }> =>
        block.type === "tool_use"
    );
    switch (raw.data.stop_reason) {
      case "tool_use":
        // Accompanying text blocks are permitted alongside tool_use blocks —
        // the model routinely emits a short lead-in or trailing remark next to
        // the tool call. That text is deliberately DISCARDED here: it is never
        // surfaced to the customer and never treated as a grounded final
        // answer. Only the validated structured tool payload below is used.
        // A response with no tool block is still rejected.
        if (toolBlocks.length === 0) {
          throw new Error("provider_response_invalid");
        }
        break;
      case "end_turn":
        throw new Error("provider_end_turn_without_contract");
      case "max_tokens":
        throw new Error("provider_output_truncated");
      case "refusal":
        throw new Error("provider_refused");
      case "pause_turn":
        throw new Error("provider_paused");
      case undefined:
      case null:
        throw new Error("provider_stop_reason_missing");
      default:
        throw new Error("provider_stop_reason_unknown");
    }

    const controlBlocks = toolBlocks.filter((block) =>
      [FINAL_RESPONSE_TOOL, CLARIFICATION_TOOL, STAFF_ESCALATION_TOOL].includes(
        block.name
      )
    );
    if (controlBlocks.length > 0) {
      if (controlBlocks.length !== 1 || toolBlocks.length !== 1) {
        throw new Error("provider_response_invalid");
      }
      const block = controlBlocks[0];
      if (block.name === FINAL_RESPONSE_TOOL) {
        const input = FinalInputSchema.parse(block.input);
        return ProviderStepSchema.parse({ kind: "final", ...input });
      }
      if (block.name === CLARIFICATION_TOOL) {
        const input = ClarificationInputSchema.parse(block.input);
        return ProviderStepSchema.parse({ kind: "clarification", ...input });
      }
      const input = StaffEscalationInputSchema.parse(block.input);
      return ProviderStepSchema.parse({ kind: "staff_escalation", ...input });
    }

    return {
      kind: "tool_requests",
      toolCalls: toolBlocks.map((block) => ({
        callId: block.id,
        toolName: block.name,
        input: block.input,
      })),
    };
  }
}
