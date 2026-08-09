import {
  CreateDiningSessionRequestSchema,
  DiningSessionSnapshotResponseSchema,
  type ConversationState,
  type DiningSessionRequest,
} from "../../../../lib/ai-waiter/schemas.ts";
import {
  methodNotAllowedResponse,
  optionsResponse,
  readLimitedJson,
  safeJsonResponse,
} from "../../../../lib/ai-waiter/server/http.ts";
import { requestFingerprint } from "../../../../lib/ai-waiter/server/rateLimitPort.ts";
import {
  cartPort,
  conversationStateStore,
  getAiWaiterRuntimeAvailability,
  isProductionInMemoryDemoOverride,
  rateLimitPort,
} from "../../../../lib/ai-waiter/server/runtime.ts";
import {
  getTableTokenSecret,
  verifyTableToken,
} from "../../../../lib/ai-waiter/server/tableToken.ts";

const MAXIMUM_SESSION_REQUEST_BYTES = 2_048;
const ALLOWED_METHODS = ["OPTIONS", "POST"];

export const runtime = "nodejs";

async function sessionSnapshot(
  state: ConversationState,
  status = 200
): Promise<Response> {
  const cart = await cartPort.getCart(state.sessionId);
  if (!cart.ok) {
    return safeJsonResponse(
      {
        ok: false,
        error: {
          code:
            cart.error.code === "session_not_found"
              ? "session_not_found"
              : "internal_error",
          message: "The dining-session cart could not be restored safely.",
        },
      },
      { status: cart.error.code === "session_not_found" ? 404 : 500 }
    );
  }
  const staffRequestsAvailable = Boolean(
    state.restaurantId && state.tableNumber && state.tableTokenId
  );
  return safeJsonResponse(
    DiningSessionSnapshotResponseSchema.parse({
      ok: true,
      state,
      cart: cart.data.cart,
      capabilities: {
        mode: staffRequestsAvailable ? "table" : "demo",
        staffRequestsAvailable,
        persistent: false,
      },
    }),
    { status }
  );
}

async function createSession(
  request: Extract<
    DiningSessionRequest,
    { action: "create_demo_session" | "create_table_session" }
  >,
  demoOnly: boolean
): Promise<Response> {
  let tableContext = null;
  if (request.action === "create_table_session") {
    if (demoOnly) {
      return safeJsonResponse(
        {
          ok: false,
          error: {
            code: "invalid_table_token",
            message: "Table sessions are unavailable in demo mode.",
          },
        },
        { status: 401 }
      );
    }
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
    const verified = verifyTableToken(request.tableToken, secret);
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
    language: request.language,
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
  return sessionSnapshot(created.data, 201);
}

async function restoreSession(
  request: Extract<DiningSessionRequest, { action: "restore_session" }>,
  demoOnly: boolean
): Promise<Response> {
  const state = await conversationStateStore.getSession(request.sessionId);
  if (
    !state ||
    (demoOnly &&
      Boolean(
        state.restaurantId || state.tableNumber || state.tableTokenId
      ))
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
  return sessionSnapshot(state);
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
    const fingerprint = requestFingerprint(request);
    const rateDecision = await rateLimitPort.consume({
      key: `session-${parsed.data.action}:${fingerprint}`,
      limit: parsed.data.action === "restore_session" ? 120 : 20,
      windowMs: 60_000,
    });
    if (!rateDecision.allowed) {
      return safeJsonResponse(
        {
          ok: false,
          error: {
            code: "rate_limited",
            message: "Dining-session request rate limit exceeded. Retry later.",
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

    return parsed.data.action === "restore_session"
      ? restoreSession(parsed.data, demoOnly)
      : createSession(parsed.data, demoOnly);
  } catch {
    return safeJsonResponse(
      {
        ok: false,
        error: {
          code: "internal_error",
          message: "Dining session request could not be completed safely.",
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
