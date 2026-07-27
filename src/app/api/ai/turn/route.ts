import { ConversationTurnRequestSchema } from "../../../../lib/ai-waiter/schemas.ts";
import {
  methodNotAllowedResponse,
  optionsResponse,
  readLimitedJson,
  safeJsonResponse,
} from "../../../../lib/ai-waiter/server/http.ts";
import { requestFingerprint } from "../../../../lib/ai-waiter/server/rateLimitPort.ts";
import {
  conversationStateStore,
  getAiWaiterRuntimeAvailability,
  rateLimitPort,
  waiterTurnController,
} from "../../../../lib/ai-waiter/server/runtime.ts";

const MAXIMUM_TURN_REQUEST_BYTES = 4_096;
const ALLOWED_METHODS = ["OPTIONS", "POST"];

export const runtime = "nodejs";

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

    const result = await waiterTurnController.handleWaiterTurn(parsed.data);
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
