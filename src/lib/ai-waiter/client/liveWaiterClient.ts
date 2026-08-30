import { z } from "zod";
import {
  CartSchema,
  CreateDiningSessionResponseSchema,
  DevelopmentProviderModeSchema,
  DiningSessionIdSchema,
  DiningSessionSnapshotResponseSchema,
  WaiterTurnResultSchema,
  type Cart,
  type ClientSelectionHint,
  type DiningSessionCapabilities,
  type DiningSessionId,
  type DevelopmentProviderMode,
  type SupportedLanguage,
  type WaiterTurnData,
} from "../schemas.ts";
import { readTableAccessCookie } from "../../tableAccessCookie.ts";

export const LIVE_WAITER_SESSION_KEY = "vaise-ai-waiter-session-v1";
export const LIVE_WAITER_DEVELOPMENT_PROVIDER_MODE_KEY =
  "vaise-ai-waiter-development-provider-mode-v1";

const ApiErrorEnvelopeSchema = z
  .object({
    ok: z.literal(false),
    error: z
      .object({
        code: z.string().trim().min(1).max(80),
        message: z.string().trim().min(1).max(240),
      })
      .strict(),
  })
  .strict();

const StoredSessionSchema = z
  .object({
    version: z.literal(1),
    sessionId: DiningSessionIdSchema,
  })
  .strict();

export type ClientApiErrorCode =
  | "network_error"
  | "invalid_response"
  | "invalid_request"
  | "invalid_table_token"
  | "session_not_found"
  | "turn_id_conflict"
  | "rate_limited"
  | "storage_not_configured"
  | "storage_capacity_exceeded"
  | "provider_not_configured"
  | "provider_limit_exceeded"
  | "safe_fallback_failed"
  | "internal_error"
  | string;

export interface ClientApiError {
  code: ClientApiErrorCode;
  message: string;
  outcome: "definitive" | "unknown";
}

export type ClientApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ClientApiError };

export interface DiningSessionSnapshot {
  state: z.infer<typeof DiningSessionSnapshotResponseSchema>["state"];
  cart: Cart;
  capabilities: DiningSessionCapabilities;
}

export type LiveWaiterTurnResult =
  | { ok: true; data: WaiterTurnData }
  | { ok: false; error: ClientApiError };

export interface SessionStoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LiveWaiterClientOptions {
  fetchImplementation?: typeof fetch;
  developmentProviderModeProvider?: () => DevelopmentProviderMode | null;
  requestTimeoutMs?: number;
}

function clientFailure(
  code: ClientApiErrorCode,
  message: string,
  outcome: ClientApiError["outcome"] = "definitive"
): { ok: false; error: ClientApiError } {
  return { ok: false, error: { code, message, outcome } };
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function parseServerError(value: unknown): ClientApiError | null {
  const parsed = ApiErrorEnvelopeSchema.safeParse(value);
  return parsed.success
    ? { ...parsed.data.error, outcome: "definitive" }
    : null;
}

export class LiveWaiterClient {
  private readonly fetchImplementation: typeof fetch;
  private readonly developmentProviderModeProvider: () =>
    | DevelopmentProviderMode
    | null;
  private readonly requestTimeoutMs: number;

  constructor(options: LiveWaiterClientOptions = {}) {
    this.fetchImplementation =
      options.fetchImplementation ?? globalThis.fetch.bind(globalThis);
    this.developmentProviderModeProvider =
      options.developmentProviderModeProvider ??
      (() =>
        process.env.NODE_ENV === "development" ? "deterministic" : null);
    this.requestTimeoutMs = options.requestTimeoutMs ?? 20_000;
  }

  private async request(
    input: string,
    init: RequestInit,
    externalSignal?: AbortSignal
  ): Promise<
    | { ok: true; response: Response; json: unknown }
    | { ok: false; error: ClientApiError }
  > {
    if (externalSignal?.aborted) {
      return clientFailure(
        "request_aborted",
        "The request was cancelled before it was sent."
      );
    }
    const controller = new AbortController();
    let timedOut = false;
    let requestStarted = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.requestTimeoutMs);
    const abortFromExternal = () => controller.abort();
    externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
    try {
      requestStarted = true;
      const response = await this.fetchImplementation(input, {
        ...init,
        signal: controller.signal,
      });
      return { ok: true, response, json: await responseJson(response) };
    } catch {
      return clientFailure(
        timedOut
          ? "request_timeout"
          : controller.signal.aborted
            ? "request_aborted"
            : "network_error",
        "The service response could not be confirmed.",
        requestStarted ? "unknown" : "definitive"
      );
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    }
  }

  async createSession(
    language: SupportedLanguage,
    tableToken: string | null,
    signal?: AbortSignal
  ): Promise<ClientApiResult<DiningSessionSnapshot>> {
    const requested = await this.request(
      "/api/ai/session",
      {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          tableToken
            ? {
                action: "create_table_session",
                language,
                tableToken,
              }
            : { action: "create_demo_session", language }
        ),
      },
      signal
    );
    if (!requested.ok) return requested;
    const parsed = CreateDiningSessionResponseSchema.safeParse(requested.json);
    if (requested.response.ok && parsed.success) {
      try {
        return {
          ok: true,
          data: {
            state: parsed.data.state,
            cart: reconcileServerCart(parsed.data.cart, {
              expectedSessionId: parsed.data.state.sessionId,
            }),
            capabilities: parsed.data.capabilities,
          },
        };
      } catch {
        return clientFailure(
          "invalid_response",
          "The dining session cart could not be verified."
        );
      }
    }
    const error = parseServerError(requested.json);
    return clientFailure(
      error?.code ?? "invalid_response",
      "The dining session could not be created safely."
    );
  }

  async restoreSession(
    sessionId: string,
    signal?: AbortSignal
  ): Promise<ClientApiResult<DiningSessionSnapshot>> {
    const parsedSessionId = DiningSessionIdSchema.safeParse(sessionId);
    if (!parsedSessionId.success) {
      return clientFailure(
        "invalid_request",
        "The stored dining session is invalid."
      );
    }
    const requested = await this.request(
      "/api/ai/session",
      {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "restore_session",
          sessionId: parsedSessionId.data,
        }),
      },
      signal
    );
    if (!requested.ok) return requested;
    const parsed = DiningSessionSnapshotResponseSchema.safeParse(requested.json);
    if (requested.response.ok && parsed.success) {
      try {
        return {
          ok: true,
          data: {
            state: parsed.data.state,
            cart: reconcileServerCart(parsed.data.cart, {
              expectedSessionId: parsed.data.state.sessionId,
            }),
            capabilities: parsed.data.capabilities,
          },
        };
      } catch {
        return clientFailure(
          "invalid_response",
          "The restored dining-session cart could not be verified."
        );
      }
    }
    const error = parseServerError(requested.json);
    return clientFailure(
      error?.code ?? "invalid_response",
      "The dining session could not be restored safely."
    );
  }

  async sendTurn(
    command: {
      sessionId: string;
      message: string;
      clientTurnId: string;
      requestedLanguage: SupportedLanguage;
      selectionHint?: ClientSelectionHint;
    },
    options: {
      signal?: AbortSignal;
      developmentProviderMode?: DevelopmentProviderMode;
    } = {}
  ): Promise<LiveWaiterTurnResult> {
    const developmentProviderMode =
      options.developmentProviderMode ??
      this.developmentProviderModeProvider();
    const requested = await this.request(
      "/api/ai/turn",
      {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          ...(developmentProviderMode === "deterministic"
            ? { "x-ai-waiter-test-mode": "deterministic" }
            : {}),
          ...(developmentProviderMode === "anthropic" ||
          developmentProviderMode === "auto"
            ? {
                "x-ai-waiter-provider-mode": developmentProviderMode,
              }
            : {}),
        },
        body: JSON.stringify(command),
      },
      options.signal
    );
    if (!requested.ok) return requested;
    const parsed = WaiterTurnResultSchema.safeParse(requested.json);
    if (parsed.success) {
      return parsed.data.ok
        ? parsed.data
        : {
            ok: false,
            error: { ...parsed.data.error, outcome: "definitive" },
          };
    }
    const error = parseServerError(requested.json);
    if (error) {
      return clientFailure(
        error.code,
        "The waiter request was rejected safely."
      );
    }
    return clientFailure(
      "invalid_response",
      "The waiter response could not be read safely.",
      "unknown"
    );
  }
}

export function readDevelopmentProviderMode(
  storage: SessionStoragePort
): DevelopmentProviderMode {
  try {
    const parsed = DevelopmentProviderModeSchema.safeParse(
      storage.getItem(LIVE_WAITER_DEVELOPMENT_PROVIDER_MODE_KEY)
    );
    return parsed.success ? parsed.data : "deterministic";
  } catch {
    return "deterministic";
  }
}

export function storeDevelopmentProviderMode(
  storage: SessionStoragePort,
  mode: DevelopmentProviderMode
): void {
  const parsed = DevelopmentProviderModeSchema.parse(mode);
  try {
    storage.setItem(LIVE_WAITER_DEVELOPMENT_PROVIDER_MODE_KEY, parsed);
  } catch {
    // Development ergonomics remain optional if browser storage is blocked.
  }
}

export type SessionEstablishmentSource =
  | "created_demo"
  | "created_table"
  | "restored"
  | "recovered_expired";

export interface EstablishedDiningSession {
  snapshot: DiningSessionSnapshot;
  source: SessionEstablishmentSource;
  warningCode: ClientApiErrorCode | null;
}

export function readStoredSessionId(
  storage: SessionStoragePort
): string | null {
  try {
    const parsed = StoredSessionSchema.safeParse(
      JSON.parse(storage.getItem(LIVE_WAITER_SESSION_KEY) ?? "null")
    );
    if (parsed.success) return parsed.data.sessionId;
  } catch {
    // Invalid local display state is discarded below.
  }
  try {
    storage.removeItem(LIVE_WAITER_SESSION_KEY);
  } catch {
    // Session restore remains optional if browser storage is unavailable.
  }
  return null;
}

export function storeSessionId(
  storage: SessionStoragePort,
  sessionId: string
): void {
  const parsed = DiningSessionIdSchema.parse(sessionId);
  try {
    storage.setItem(
      LIVE_WAITER_SESSION_KEY,
      JSON.stringify({ version: 1, sessionId: parsed })
    );
  } catch {
    // A later mutation turn still fails closed if its identity cannot persist.
  }
}

function cookieTableNumber(): string | null {
  try {
    return readTableAccessCookie()?.tableNumber ?? null;
  } catch {
    return null;
  }
}

function createdSource(
  snapshot: DiningSessionSnapshot
): "created_table" | "created_demo" {
  return snapshot.capabilities.mode === "table" ? "created_table" : "created_demo";
}

function snapshotMatchesCookie(
  snapshot: DiningSessionSnapshot,
  cookieTable: string | null
): boolean {
  if (!cookieTable) return true;
  return snapshot.state.tableNumber === cookieTable;
}

export async function establishDiningSession(command: {
  client: LiveWaiterClient;
  storage: SessionStoragePort;
  language: SupportedLanguage;
  tableToken: string | null;
}): Promise<ClientApiResult<EstablishedDiningSession>> {
  if (command.tableToken) {
    const tableSession = await command.client.createSession(
      command.language,
      command.tableToken
    );
    if (tableSession.ok) {
      storeSessionId(command.storage, tableSession.data.state.sessionId);
      return {
        ok: true,
        data: {
          snapshot: tableSession.data,
          source: "created_table",
          warningCode: null,
        },
      };
    }
    if (tableSession.error.code !== "invalid_table_token") return tableSession;
    const demo = await command.client.createSession(command.language, null);
    if (!demo.ok) return demo;
    storeSessionId(command.storage, demo.data.state.sessionId);
    return {
      ok: true,
      data: {
        snapshot: demo.data,
        source: createdSource(demo.data),
        warningCode: "invalid_table_token",
      },
    };
  }

  const cookieTable = cookieTableNumber();
  const storedSessionId = readStoredSessionId(command.storage);
  if (storedSessionId) {
    const restored = await command.client.restoreSession(storedSessionId);
    if (restored.ok && snapshotMatchesCookie(restored.data, cookieTable)) {
      return {
        ok: true,
        data: {
          snapshot: restored.data,
          source: "restored",
          warningCode: null,
        },
      };
    }
    if (restored.ok || restored.error.code === "session_not_found") {
      try {
        command.storage.removeItem(LIVE_WAITER_SESSION_KEY);
      } catch {
        // Session restoration is optional; the replacement remains server-owned.
      }
      if (!restored.ok && restored.error.code !== "session_not_found") {
        return restored;
      }
      const replacement = await command.client.createSession(
        command.language,
        null
      );
      if (!replacement.ok) return replacement;
      storeSessionId(command.storage, replacement.data.state.sessionId);
      return {
        ok: true,
        data: {
          snapshot: replacement.data,
          source: restored.ok ? createdSource(replacement.data) : "recovered_expired",
          warningCode: restored.ok ? null : "session_not_found",
        },
      };
    }
    return restored;
  }

  const created = await command.client.createSession(command.language, null);
  if (!created.ok) return created;
  storeSessionId(command.storage, created.data.state.sessionId);
  return {
    ok: true,
    data: {
      snapshot: created.data,
      source: createdSource(created.data),
      warningCode: null,
    },
  };
}

export interface TurnAttempt {
  message: string;
  clientTurnId: string;
  selectionHint?: ClientSelectionHint;
}

export class TurnSubmissionGate {
  private active = false;
  private retryableAttempt: TurnAttempt | null = null;
  private readonly createTurnId: () => string;

  constructor(
    createTurnId: () => string = () =>
      `turn_${crypto.randomUUID().replaceAll("-", "")}`
  ) {
    this.createTurnId = createTurnId;
  }

  beginNew(
    message: string,
    selectionHint?: ClientSelectionHint
  ): TurnAttempt | null {
    if (this.active || this.retryableAttempt) return null;
    const attempt = {
      message,
      clientTurnId: this.createTurnId(),
      ...(selectionHint ? { selectionHint } : {}),
    };
    this.active = true;
    this.retryableAttempt = null;
    return attempt;
  }

  beginRetry(): TurnAttempt | null {
    if (this.active || !this.retryableAttempt) return null;
    this.active = true;
    return { ...this.retryableAttempt };
  }

  recover(attempt: TurnAttempt): boolean {
    if (this.active) return false;
    this.retryableAttempt = { ...attempt };
    return true;
  }

  complete(attempt: TurnAttempt, retryable: boolean): void {
    this.active = false;
    this.retryableAttempt = retryable ? { ...attempt } : null;
  }

  cancel(): void {
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }
}

export function isRetryableTurnResult(
  result: LiveWaiterTurnResult
): boolean {
  if (result.ok) {
    return [
      "provider_failed_without_side_effect",
      "internal_failure_without_side_effect",
    ].includes(result.data.status);
  }
  return ![
    "invalid_request",
    "turn_id_conflict",
    "invalid_table_token",
  ].includes(result.error.code);
}

export type TurnRetryMode = "same_id" | "new_id" | null;

export function retryModeForTurnResult(
  result: LiveWaiterTurnResult
): TurnRetryMode {
  if (!result.ok) {
    if (result.error.outcome === "unknown") return "same_id";
    return ["rate_limited", "provider_limit_exceeded"].includes(
      result.error.code
    )
      ? "new_id"
      : null;
  }
  return [
    "provider_failed_without_side_effect",
    "internal_failure_without_side_effect",
  ].includes(result.data.status)
    ? "new_id"
    : null;
}

export interface CartReconciliationOptions {
  expectedSessionId?: DiningSessionId;
  minimumRevision?: number;
}

export function reconcileServerCart(
  cart: Cart,
  options: CartReconciliationOptions = {}
): Cart {
  const parsed = CartSchema.parse(structuredClone(cart));
  if (
    options.expectedSessionId &&
    parsed.sessionId !== options.expectedSessionId
  ) {
    throw new Error("The authoritative cart belongs to another session.");
  }
  if (
    options.minimumRevision !== undefined &&
    parsed.revision < options.minimumRevision
  ) {
    throw new Error("The authoritative cart revision is stale.");
  }
  return parsed;
}

export function cartItemCount(cart: Cart): number {
  return cart.lines.reduce((total, line) => total + line.quantity, 0);
}

export function tableTokenFromUrl(rawUrl: string): {
  tableToken: string | null;
  cleanedUrl: string;
} {
  const url = new URL(rawUrl);
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  const tableToken =
    fragment.get("tableToken") ?? fragment.get("table_token");
  fragment.delete("tableToken");
  fragment.delete("table_token");
  url.searchParams.delete("tableToken");
  url.searchParams.delete("table_token");
  url.hash = fragment.size > 0 ? `#${fragment.toString()}` : "";
  return {
    tableToken,
    cleanedUrl: `${url.pathname}${url.search}${url.hash}`,
  };
}
