import {
  ConversationTurnRequestSchema,
  DevelopmentProviderModeSchema,
  type DevelopmentProviderMode,
} from "../../../../lib/ai-waiter/schemas.ts";
import {
  methodNotAllowedResponse,
  optionsResponse,
  readLimitedJson,
  safeJsonResponse,
} from "../../../../lib/ai-waiter/server/http.ts";
import { requestFingerprint } from "../../../../lib/ai-waiter/server/rateLimitPort.ts";
import {
  geminiProvider,
  conversationStateStore,
  deterministicWaiterTurnController,
  getAiWaiterRuntimeAvailability,
  isProductionInMemoryDemoOverride,
  rateLimitPort,
  waiterTurnController,
} from "../../../../lib/ai-waiter/server/runtime.ts";
import type { WaiterTurnExecutionOptions } from "../../../../lib/ai-waiter/server/turnController.ts";

const MAXIMUM_TURN_REQUEST_BYTES = 4_096;
const ALLOWED_METHODS = ["OPTIONS", "POST"];

export const runtime = "nodejs";

export type WaiterControllerSelection =
  | {
      kind: "standard" | "deterministic";
      requestedMode: DevelopmentProviderMode | null;
      initialProviderPath: "anthropic" | "deterministic" | null;
    }
  | {
      kind: "anthropic_not_configured";
      requestedMode: "anthropic";
      initialProviderPath: null;
    };

export function resolveWaiterControllerSelection(
  request: Request,
  options: {
    nodeEnvironment?: string;
    anthropicAvailable?: boolean;
  } = {}
): WaiterControllerSelection {
  const nodeEnvironment = options.nodeEnvironment ?? process.env.NODE_ENV;
  if (nodeEnvironment === "production") {
    return {
      kind: "standard",
      requestedMode: null,
      initialProviderPath: null,
    };
  }

  const explicitMode = DevelopmentProviderModeSchema.safeParse(
    request.headers.get("x-ai-waiter-provider-mode")
  );
  const requestedMode: DevelopmentProviderMode =
    request.headers.get("x-ai-waiter-test-mode") === "deterministic"
      ? "deterministic"
      : explicitMode.success
        ? explicitMode.data
        : "auto";
  // The "anthropic" dev-mode label predates this provider swap and is kept
  // as-is (see /lib/ai-waiter/server/geminiProvider.ts) rather than renamed
  // throughout schemas/tests/UI copy — it now means "the configured real-API
  // provider", which is Gemini. What matters is that this check reflects
  // whichever provider actually backs waiterTurnController.
  const anthropicAvailable =
    options.anthropicAvailable ?? geminiProvider.isAvailable();

  if (requestedMode === "deterministic") {
    return {
      kind: "deterministic",
      requestedMode,
      initialProviderPath: "deterministic",
    };
  }
  if (requestedMode === "anthropic" && !anthropicAvailable) {
    return {
      kind: "anthropic_not_configured",
      requestedMode,
      initialProviderPath: null,
    };
  }
  return {
    kind: "standard",
    requestedMode,
    initialProviderPath: anthropicAvailable
      ? "anthropic"
      : "deterministic",
  };
}

interface WaiterControllerPort {
  handleWaiterTurn(
    command: unknown,
    options?: WaiterTurnExecutionOptions
  ): ReturnType<typeof waiterTurnController.handleWaiterTurn>;
}

export function executeWaiterControllerSelection(
  selection: Exclude<
    WaiterControllerSelection,
    { kind: "anthropic_not_configured" }
  >,
  command: unknown,
  controllers: {
    standard: WaiterControllerPort;
    deterministic: WaiterControllerPort;
  } = {
    standard: waiterTurnController,
    deterministic: deterministicWaiterTurnController,
  }
): ReturnType<typeof waiterTurnController.handleWaiterTurn> {
  const controller =
    selection.kind === "deterministic"
      ? controllers.deterministic
      : controllers.standard;
  return controller.handleWaiterTurn(command, {
    allowProviderFallback: selection.requestedMode !== "anthropic",
  });
}

function statusForResult(
  result: Awaited<ReturnType<typeof waiterTurnController.handleWaiterTurn>>
): number {
  if (result.ok) return 200;
  switch (result.error.code) {
    case "session_not_found":
      return 404;
    case "turn_id_conflict":
      return 409;
    case "rate_limited":
      return 429;
    case "storage_not_configured":
    case "storage_capacity_exceeded":
    case "provider_not_configured":
      return 503;
    case "internal_error":
    case "safe_fallback_failed":
      return 500;
    default:
      return 400;
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const availability = getAiWaiterRuntimeAvailability();
    if (!availability.available) {
      return safeJsonResponse(
        {
          ok: false,
          error: {
            code: availability.code,
            message: availability.message,
          },
        },
        { status: 503 }
      );
    }
    const demoOnly = isProductionInMemoryDemoOverride();

    const fingerprint = requestFingerprint(request);
    const ipDecision = await rateLimitPort.consume({
      key: `turn-ip:${fingerprint}`,
      limit: 60,
      windowMs: 60_000,
    });
    if (!ipDecision.allowed) {
      return safeJsonResponse(
        {
          ok: false,
          error: {
            code: "rate_limited",
            message: "Waiter turn rate limit exceeded. Retry later.",
          },
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(
              Math.max(1, Math.ceil(ipDecision.retryAfterMs / 1_000))
            ),
          },
        }
      );
    }

    const json = await readLimitedJson(
      request,
      MAXIMUM_TURN_REQUEST_BYTES
    );
    if (!json.ok) {
      return safeJsonResponse(
        { ok: false, error: { code: json.code, message: json.message } },
        { status: json.status }
      );
    }
    const parsed = ConversationTurnRequestSchema.safeParse(json.value);
    if (!parsed.success) {
      return safeJsonResponse(
        {
          ok: false,
          error: {
            code: "invalid_request",
            message: "Waiter turn request failed validation.",
          },
        },
        { status: 400 }
      );
    }

    // The opaque 128-bit session identifier is the development ownership
    // capability. No table or restaurant context is accepted from this route.
    const state = await conversationStateStore.getSession(
      parsed.data.sessionId
    );
    if (!state) {
      return safeJsonResponse(
        {
          ok: false,
          error: {
            code: "session_not_found",
            message: "Dining session was not found or expired.",
          },
        },
        { status: 404 }
      );
    }
    if (
      demoOnly &&
      Boolean(state.restaurantId || state.tableNumber || state.tableTokenId)
    ) {
      return safeJsonResponse(
        {
          ok: false,
          error: {
            code: "session_not_found",
            message: "Dining session was not found or expired.",
          },
        },
        { status: 404 }
      );
    }
    const sessionDecision = await rateLimitPort.consume({
      key: `turn-session:${state.sessionId}`,
      limit: 30,
      windowMs: 60_000,
    });
    if (!sessionDecision.allowed) {
      return safeJsonResponse(
        {
          ok: false,
          error: {
            code: "rate_limited",
            message: "Dining-session turn rate limit exceeded. Retry later.",
          },
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(
              Math.max(1, Math.ceil(sessionDecision.retryAfterMs / 1_000))
            ),
          },
        }
      );
    }

    const selection = resolveWaiterControllerSelection(request);
    if (selection.kind === "anthropic_not_configured") {
      return safeJsonResponse(
        {
          ok: false,
          error: {
            code: "provider_not_configured",
            message:
              "Anthropic is not configured for this development server.",
          },
        },
        { status: 503 }
      );
    }
    const result = await executeWaiterControllerSelection(
      selection,
      parsed.data
    );
    return safeJsonResponse(result, { status: statusForResult(result) });
  } catch {
    return safeJsonResponse(
      {
        ok: false,
        error: {
          code: "internal_error",
          message: "Waiter turn could not be completed safely.",
        },
      },
      { status: 500 }
    );
  }
}

export function GET(): Response {
  return methodNotAllowedResponse(ALLOWED_METHODS);
}

export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;

export function OPTIONS(): Response {
  return optionsResponse(ALLOWED_METHODS);
}
