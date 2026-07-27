import {
  CreateDiningSessionRequestSchema,
  CreateDiningSessionResponseSchema,
} from "../../../../lib/ai-waiter/schemas.ts";
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
} from "../../../../lib/ai-waiter/server/runtime.ts";
import {
  getTableTokenSecret,
  verifyTableToken,
} from "../../../../lib/ai-waiter/server/tableToken.ts";

const MAXIMUM_SESSION_REQUEST_BYTES = 2_048;
const ALLOWED_METHODS = ["OPTIONS", "POST"];

export const runtime = "nodejs";

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
    const rateDecision = await rateLimitPort.consume({
      key: `session-create:${fingerprint}`,
      limit: 20,
      windowMs: 60_000,
    });
    if (!rateDecision.allowed) {
      return safeJsonResponse(
        {
          ok: false,
          error: {
            code: "rate_limited",
            message: "Dining-session creation rate limit exceeded. Retry later.",
          },
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(
              Math.max(1, Math.ceil(rateDecision.retryAfterMs / 1_000))
            ),
          },
        }
      );
    }

    const json = await readLimitedJson(request, MAXIMUM_SESSION_REQUEST_BYTES);
    if (!json.ok) {
      return safeJsonResponse(
        { ok: false, error: { code: json.code, message: json.message } },
        { status: json.status }
      );
    }
    const parsed = CreateDiningSessionRequestSchema.safeParse(json.value);
    if (!parsed.success) {
      return safeJsonResponse(
        {
          ok: false,
          error: {
            code: "invalid_request",
            message: "Dining session request failed validation.",
          },
        },
        { status: 400 }
      );
    }

    let tableContext = null;
    if (parsed.data.tableToken) {
      const secret = getTableTokenSecret();
      if (!secret) {
        return safeJsonResponse(
          {
            ok: false,
            error: {
              code: "storage_not_configured",
              message: "Table-token verification is not configured.",
            },
          },
          { status: 503 }
        );
      }
      const verified = verifyTableToken(parsed.data.tableToken, secret);
      if (!verified.ok) {
        return safeJsonResponse(
          {
            ok: false,
            error: {
              code: verified.code,
              message: verified.message,
            },
          },
          { status: 401 }
        );
      }
      tableContext = {
        restaurantId: verified.payload.restaurantId,
        tableNumber: verified.payload.tableNumber,
        tableTokenId: verified.payload.tokenId,
      };
    }

    const created = await conversationStateStore.createSession({
      language: parsed.data.language,
      tableContext,
    });
    if (!created.ok) {
      return safeJsonResponse(
        { ok: false, error: created.error },
        {
          status:
            created.error.code === "storage_capacity_exceeded" ? 503 : 400,
        }
      );
    }
    return safeJsonResponse(
      CreateDiningSessionResponseSchema.parse({
        ok: true,
        state: created.data,
      }),
      { status: 201 }
    );
  } catch {
    return safeJsonResponse(
      {
        ok: false,
        error: {
          code: "internal_error",
          message: "Dining session could not be created safely.",
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
