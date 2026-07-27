import {
  methodNotAllowedResponse,
  optionsResponse,
  readLimitedJson,
  safeJsonResponse,
} from "../../../../lib/ai-waiter/server/http.ts";
import { requestFingerprint } from "../../../../lib/ai-waiter/server/rateLimitPort.ts";
import {
  getAiWaiterRuntimeAvailability,
  rateLimitPort,
  safeToolRegistry,
} from "../../../../lib/ai-waiter/server/runtime.ts";

const MAXIMUM_TOOL_REQUEST_BYTES = 16_384;
const ALLOWED_METHODS = ["OPTIONS", "POST"];

export const runtime = "nodejs";

function statusForResult(
  result: Awaited<ReturnType<typeof safeToolRegistry.execute>>
): number {
  if (result.ok) return 200;
  switch (result.error.code) {
    case "session_not_found":
    case "product_not_found":
    case "cart_line_not_found":
      return 404;
    case "invalid_table_token":
      return 401;
    case "revision_conflict":
    case "idempotency_conflict":
      return 409;
    case "rate_limited":
      return 429;
    case "storage_not_configured":
    case "storage_capacity_exceeded":
      return 503;
    case "internal_error":
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
    const ipRateDecision = await rateLimitPort.consume({
      key: `tool-ip:${fingerprint}`,
      limit: 300,
      windowMs: 60_000,
    });
    if (!ipRateDecision.allowed) {
      return safeJsonResponse(
        {
          ok: false,
          error: {
            code: "rate_limited",
            message: "Tool endpoint rate limit exceeded. Retry later.",
          },
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(
              Math.max(1, Math.ceil(ipRateDecision.retryAfterMs / 1_000))
            ),
          },
        }
      );
    }

    const json = await readLimitedJson(request, MAXIMUM_TOOL_REQUEST_BYTES);
    if (!json.ok) {
      return safeJsonResponse(
        { ok: false, error: { code: json.code, message: json.message } },
        { status: json.status }
      );
    }
    const result = await safeToolRegistry.execute(json.value, {
      requestFingerprint: fingerprint,
    });
    return safeJsonResponse(result, { status: statusForResult(result) });
  } catch {
    return safeJsonResponse(
      {
        ok: false,
        error: {
          code: "internal_error",
          message: "Tool request could not be completed safely.",
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
