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

export const DEFAULT_MAXIMUM_OUTPUT_TOKENS = 2_048;
export const MAXIMUM_OUTPUT_TOKENS_CAP = 4_096;

// ── Gemini response shape ────────────────────────────────────────────────────

const GeminiFunctionCallSchema = z.object({
  name: z.string().min(1).max(80),
  args: z.unknown(),
});

const GeminiPartSchema = z
  .object({
    text: z.string().optional(),
    functionCall: GeminiFunctionCallSchema.optional(),
  })
  .passthrough();

const GeminiResponseSchema = z
  .object({
    candidates: z
      .array(
        z
          .object({
            content: z
              .object({
                parts: z.array(GeminiPartSchema).max(32).default([]),
              })
              .passthrough()
              .optional(),
            finishReason: z.string().optional(),
          })
          .passthrough()
      )
      .max(4)
      .optional(),
    promptFeedback: z.unknown().optional(),
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

interface GeminiProviderOptions {
  apiKey?: string;
  apiKeyProvider?: () => string | undefined;
  model?: string;
  timeoutMs?: number;
  fetchImplementation?: typeof fetch;
  maximumRequestBytes?: number;
  maximumResponseBytes?: number;
  maximumOutputTokens?: number;
}

function compactToolResult(result: ProviderToolResult): Record<string, unknown> {
  if (!result.result.ok) {
    return { ok: false, toolName: result.toolName, error: result.result.error };
  }
  const data = structuredClone(result.result.data) as Record<string, unknown>;
  if ("cart" in data && data.cart && typeof data.cart === "object") {
    const cart = data.cart as { lines?: Array<Record<string, unknown>> };
    cart.lines = cart.lines?.map((line) => ({ ...line, customerNote: null }));
  }
  return { ok: true, toolName: result.toolName, data };
}

/**
 * Gemini's function schema is an OpenAPI 3.0 subset — no `additionalProperties`,
 * no `type` arrays. The tool/claim schemas here come from Zod's draft-7 JSON
 * Schema output, so nullable fields land as `type: [X, "null"]` or an `anyOf`
 * branch with `{type:"null"}`; both get folded into Gemini's `nullable: true`.
 */
export function toGeminiSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (node === null || typeof node !== "object") return node;

  const obj = { ...(node as Record<string, unknown>) };
  delete obj.additionalProperties;
  delete obj.$schema;
  delete obj.$id;
  // Gemini's function-parameter schema is a narrower OpenAPI 3.0 subset: it
  // has no exclusiveMinimum/Maximum (found by an actual 400 from the API,
  // not from docs) and no `const` — folded into `enum` instead, which it
  // does support and is exactly equivalent for a single value.
  delete obj.exclusiveMinimum;
  delete obj.exclusiveMaximum;
  // Fine-grained constraints (regex patterns, length/count/range bounds) blow
  // up Gemini's constrained-decoding grammar once enough tools carry them at
  // once — a real 400: "schema produces a constraint that has too many
  // states for serving". They're dropped here, not weakened: every tool call
  // is re-validated against the real Zod schema before it touches the cart,
  // so this only affects what the model is hinted with, never what runs.
  delete obj.pattern;
  delete obj.minLength;
  delete obj.maxLength;
  delete obj.minimum;
  delete obj.maximum;
  delete obj.minItems;
  delete obj.maxItems;
  delete obj.format;
  delete obj.default;
  if ("const" in obj) {
    // Gemini's enum accepts string values only (confirmed by a 400: "Invalid
    // value ... TYPE_STRING" for enum:[true]). A boolean/number const just
    // loses its single-value pin here — our own Zod schema still enforces
    // the exact value when the tool call is executed.
    if (typeof obj.const === "string") obj.enum = [obj.const];
    delete obj.const;
  }

  if (Array.isArray(obj.type)) {
    const types = obj.type as unknown[];
    const hasNull = types.includes("null");
    const rest = types.filter((t) => t !== "null");
    if (rest.length >= 1) obj.type = rest[0];
    else delete obj.type;
    if (hasNull) obj.nullable = true;
  }

  if (Array.isArray(obj.anyOf)) {
    const branches = obj.anyOf as Record<string, unknown>[];
    const hasNullBranch = branches.some(
      (b) => b && typeof b === "object" && b.type === "null" && Object.keys(b).length === 1
    );
    const rest = branches.filter(
      (b) => !(b && typeof b === "object" && b.type === "null" && Object.keys(b).length === 1)
    );
    if (hasNullBranch) obj.nullable = true;
    if (rest.length === 1) {
      Object.assign(obj, toGeminiSchema(rest[0]) as Record<string, unknown>);
      delete obj.anyOf;
    } else if (rest.length > 1) {
      obj.anyOf = rest.map(toGeminiSchema);
    } else {
      delete obj.anyOf;
    }
  }

  for (const key of ["properties", "items"] as const) {
    if (obj[key] !== undefined) {
      if (key === "properties" && obj[key] && typeof obj[key] === "object") {
        const props = obj[key] as Record<string, unknown>;
        obj[key] = Object.fromEntries(
          Object.entries(props).map(([k, v]) => [k, toGeminiSchema(v)])
        );
      } else {
        obj[key] = toGeminiSchema(obj[key]);
      }
    }
  }

  return obj;
}

function geminiFunctionDeclarations(): unknown[] {
  const actionTools = PROVIDER_TOOL_DEFINITIONS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: toGeminiSchema(tool.inputSchema),
  }));
  const responseTools = [
    {
      name: FINAL_RESPONSE_TOOL,
      description:
        "Submit the final concise grounded customer response. Every mentioned or recommended menu product must appear in referencedProductIds.",
      parameters: toGeminiSchema({
        type: "object",
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
      }),
    },
    {
      name: CLARIFICATION_TOOL,
      description:
        "Ask exactly one useful clarification when a product, cart line, variant, modifier, quantity, or safety fact is ambiguous.",
      parameters: toGeminiSchema({
        type: "object",
        required: ["message", "unresolvedQuestion"],
        properties: {
          message: { type: "string", minLength: 1, maxLength: 1500 },
          unresolvedQuestion: { type: "object" },
          ambiguity: { type: "object", nullable: true },
          stateUpdate: PROVIDER_STATE_UPDATE_JSON_SCHEMA,
        },
      }),
    },
    {
      name: STAFF_ESCALATION_TOOL,
      description:
        "Recommend staff help for information or safety that cannot be confirmed. This recommendation does not itself create a staff task.",
      parameters: toGeminiSchema({
        type: "object",
        required: ["message", "recommendedAction"],
        properties: {
          message: { type: "string", minLength: 1, maxLength: 1500 },
          recommendedAction: {
            type: "string",
            enum: ["request_waiter", "request_bill", "none"],
          },
          stateUpdate: PROVIDER_STATE_UPDATE_JSON_SCHEMA,
        },
      }),
    },
  ];
  return [...actionTools, ...responseTools];
}

/**
 * Builds the Gemini `contents` history from this turn's tool exchanges so
 * far. Gemini pairs functionResponse parts to functionCall parts by name and
 * position within the model/user turn pair, not by an id — unlike Anthropic
 * it never hands back a call id, so none is threaded through here.
 */
function geminiContents(request: AIProviderStepRequest): unknown[] {
  const contents: unknown[] = [
    {
      role: "user",
      parts: [
        {
          text: JSON.stringify({
            task: "Handle this customer turn using only grounded facts and tools.",
            groundedContext: request.context,
          }),
        },
      ],
    },
  ];
  for (const exchange of request.exchanges) {
    contents.push({
      role: "model",
      parts: exchange.calls.map((call) => ({
        functionCall: { name: call.toolName, args: call.input },
      })),
    });
    contents.push({
      role: "user",
      parts: exchange.results.map((result) => ({
        functionResponse: {
          name: result.toolName,
          response: compactToolResult(result),
        },
      })),
    });
  }
  return contents;
}

export class GeminiAIProvider implements AIProvider {
  readonly providerId = "gemini";
  private readonly apiKeyProvider: () => string | undefined;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;
  private readonly maximumRequestBytes: number;
  private readonly maximumResponseBytes: number;
  private readonly maximumOutputTokens: number;

  constructor(options: GeminiProviderOptions = {}) {
    this.apiKeyProvider =
      options.apiKey !== undefined
        ? () => options.apiKey?.trim() || undefined
        : options.apiKeyProvider ??
          (() => process.env.GEMINI_API_KEY?.trim() || undefined);
    this.model =
      options.model ?? process.env.AI_WAITER_GEMINI_MODEL ?? "gemini-2.5-flash";
    // Must stay strictly below WaiterTurnController.providerTimeoutMs (60s
    // default) so this provider's own AbortSignal fires first and the loop
    // can fall back cleanly, mirroring the Anthropic provider's margin.
    this.timeoutMs = options.timeoutMs ?? 45_000;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.maximumRequestBytes = options.maximumRequestBytes ?? 128_000;
    this.maximumResponseBytes = options.maximumResponseBytes ?? 128_000;
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
      systemInstruction: {
        parts: [
          {
            text: `${WAITER_POLICY}\n\nWhen the guest asks what goes with a dish, what to drink, sides, or pairing: call search_menu to resolve the named dish, then recommend_products for 1-3 available complementary items. Never invent dishes. For allergens, ingredients, wait times, or glass/bottle sizes: call get_product_details or search_menu and answer from catalog. Incomplete allergen records are unknown, never safe. Restaurant, menu, service, and table questions are always in-scope. Never say you cannot help with those. Pay: do not take in-app payment; call request_bill so a waiter settles. Use add_to_cart and remove_from_cart for orders; if two dishes could match, ask which one.\n\nReturn exactly one response-contract function call when you are ready to answer. Put sensitive factual claims only in the structured claims array. Do not emit customer-facing free text outside that function call.`,
          },
        ],
      },
      contents: geminiContents(request),
      tools: [{ functionDeclarations: geminiFunctionDeclarations() }],
      // Forces a function call every turn — this provider's response contract
      // has no valid plain-text ending, so letting the model choose is pure
      // downside (AUTO can end the turn with bare text, which we'd only reject).
      toolConfig: { functionCallingConfig: { mode: "ANY" } },
      generationConfig: { maxOutputTokens: this.maximumOutputTokens },
    });
    if (new TextEncoder().encode(body).byteLength > this.maximumRequestBytes) {
      throw new Error("provider_request_too_large");
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    const response = await this.fetchImplementation(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error("provider_request_failed");
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > this.maximumResponseBytes) {
      throw new Error("provider_response_too_large");
    }
    const responseText = await response.text();
    if (new TextEncoder().encode(responseText).byteLength > this.maximumResponseBytes) {
      throw new Error("provider_response_too_large");
    }
    let responseJson: unknown;
    try {
      responseJson = JSON.parse(responseText);
    } catch {
      throw new Error("provider_response_invalid");
    }
    const raw = GeminiResponseSchema.safeParse(responseJson);
    if (!raw.success) throw new Error("provider_response_invalid");

    const candidate = raw.data.candidates?.[0];
    if (!candidate) throw new Error("provider_response_invalid");

    switch (candidate.finishReason) {
      case undefined:
      case "STOP":
      case "FINISH_REASON_UNSPECIFIED":
        break;
      case "MAX_TOKENS":
        throw new Error("provider_output_truncated");
      case "SAFETY":
      case "RECITATION":
      case "PROHIBITED_CONTENT":
      case "BLOCKLIST":
      case "SPII":
        throw new Error("provider_refused");
      default:
        throw new Error("provider_stop_reason_unknown");
    }

    const parts = candidate.content?.parts ?? [];
    const functionCalls = parts
      .filter((part): part is { functionCall: z.infer<typeof GeminiFunctionCallSchema> } =>
        Boolean(part.functionCall)
      )
      .map((part) => part.functionCall);
    if (functionCalls.length === 0) {
      // The model answered with plain text instead of a function call —
      // never a valid end state for this response contract.
      throw new Error("provider_end_turn_without_contract");
    }

    const controlCalls = functionCalls.filter((call) =>
      [FINAL_RESPONSE_TOOL, CLARIFICATION_TOOL, STAFF_ESCALATION_TOOL].includes(call.name)
    );
    if (controlCalls.length > 0) {
      if (controlCalls.length !== 1 || functionCalls.length !== 1) {
        throw new Error("provider_response_invalid");
      }
      const call = controlCalls[0];
      if (call.name === FINAL_RESPONSE_TOOL) {
        const input = FinalInputSchema.parse(call.args);
        return ProviderStepSchema.parse({ kind: "final", ...input });
      }
      if (call.name === CLARIFICATION_TOOL) {
        const input = ClarificationInputSchema.parse(call.args);
        return ProviderStepSchema.parse({ kind: "clarification", ...input });
      }
      const input = StaffEscalationInputSchema.parse(call.args);
      return ProviderStepSchema.parse({ kind: "staff_escalation", ...input });
    }

    return {
      kind: "tool_requests",
      toolCalls: functionCalls.map((call, index) => ({
        callId: `call_${index}_${call.name}`,
        toolName: call.name,
        input: call.args,
      })),
    };
  }
}
