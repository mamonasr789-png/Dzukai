import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  LIVE_WAITER_SESSION_KEY,
  LiveWaiterClient,
  TurnSubmissionGate,
  establishDiningSession,
  isRetryableTurnResult,
  readStoredSessionId,
  reconcileServerCart,
  retryModeForTurnResult,
  tableTokenFromUrl,
  type SessionStoragePort,
} from "../client/liveWaiterClient.ts";
import {
  cleanupExpiredPendingTurns,
  loadDisplayTranscript,
  readPendingTurn,
  saveDisplayTranscript,
  storePendingTurn,
} from "../client/liveWaiterStorage.ts";
import {
  friendlyClientError,
  liveWaiterCopy,
  turnPresentation,
} from "../client/liveWaiterUi.ts";
import {
  conversationStateStore,
  resetDevelopmentRuntime,
} from "../server/runtime.ts";
import { safeCapabilityIdentifier } from "../server/safeLogger.ts";
import { createDevelopmentTableToken } from "../server/tableToken.ts";
import {
  DELETE as sessionDelete,
  GET as sessionGet,
  OPTIONS as sessionOptions,
  POST as sessionPost,
} from "../../../app/api/ai/session/route.ts";
import {
  GET as turnGet,
  OPTIONS as turnOptions,
  POST as turnPost,
} from "../../../app/api/ai/turn/route.ts";

class MemorySessionStorage implements SessionStoragePort {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function routeFetch(): typeof fetch {
  return (async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    const rawUrl =
      input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    const url = new URL(rawUrl, "http://ui.test");
    const request =
      input instanceof Request
        ? input
        : new Request(url, {
            ...init,
            headers: {
              "x-forwarded-for": "203.0.113.212",
              ...(init?.headers ?? {}),
            },
          });
    if (url.pathname === "/api/ai/session") {
      if (request.method === "POST") return sessionPost(request);
      if (request.method === "OPTIONS") return sessionOptions();
      return request.method === "GET" ? sessionGet() : sessionDelete();
    }
    if (url.pathname === "/api/ai/turn") {
      if (request.method === "POST") return turnPost(request);
      if (request.method === "OPTIONS") return turnOptions();
      return turnGet();
    }
    return Response.json(
      { ok: false, error: { code: "not_found", message: "Not found." } },
      { status: 404 }
    );
  }) as typeof fetch;
}

function client(fetchImplementation: typeof fetch = routeFetch()) {
  return new LiveWaiterClient({
    fetchImplementation,
    deterministicDevelopmentMode: true,
  });
}

async function createDemo() {
  const storage = new MemorySessionStorage();
  const established = await establishDiningSession({
    client: client(),
    storage,
    language: "lt",
    tableToken: null,
  });
  assert.equal(established.ok, true);
  if (!established.ok) throw new Error("session setup failed");
  return { storage, established: established.data, api: client() };
}

async function recommendation(
  api: LiveWaiterClient,
  sessionId: string,
  clientTurnId = "ui_recommend_001"
) {
  const result = await api.sendTurn({
    sessionId,
    message: "Noriu kažko sotaus iki 20 eurų",
    clientTurnId,
    requestedLanguage: "lt",
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("recommendation failed");
  return result.data;
}

test("live client creates a demo session and restores its authoritative cart", async () => {
  await resetDevelopmentRuntime();
  const { storage, established, api } = await createDemo();
  assert.equal(established.source, "created_demo");
  assert.equal(established.snapshot.capabilities.staffRequestsAvailable, false);
  assert.equal(
    readStoredSessionId(storage),
    established.snapshot.state.sessionId
  );

  await recommendation(api, established.snapshot.state.sessionId);
  const added = await api.sendTurn({
    sessionId: established.snapshot.state.sessionId,
    message: "Pridėk pirmą",
    clientTurnId: "ui_restore_add_001",
    requestedLanguage: "lt",
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  assert.equal(added.data.cart.lines.length, 1);

  const restored = await establishDiningSession({
    client: api,
    storage,
    language: "lt",
    tableToken: null,
  });
  assert.equal(restored.ok, true);
  if (!restored.ok) return;
  assert.equal(restored.data.source, "restored");
  assert.equal(restored.data.snapshot.cart.lines.length, 1);
  assert.equal(
    restored.data.snapshot.cart.lines[0].lineId,
    added.data.cart.lines[0].lineId
  );
});

test("expired stored sessions are replaced without replaying a turn", async () => {
  await resetDevelopmentRuntime();
  const { storage, established, api } = await createDemo();
  const expiredId = established.snapshot.state.sessionId;
  await conversationStateStore.deleteSession(expiredId);

  const recovered = await establishDiningSession({
    client: api,
    storage,
    language: "lt",
    tableToken: null,
  });
  assert.equal(recovered.ok, true);
  if (!recovered.ok) return;
  assert.equal(recovered.data.source, "recovered_expired");
  assert.notEqual(recovered.data.snapshot.state.sessionId, expiredId);
  assert.equal(
    readStoredSessionId(storage),
    recovered.data.snapshot.state.sessionId
  );
});

test("valid table tokens create staff-capable sessions and invalid tokens degrade to demo", async () => {
  await resetDevelopmentRuntime();
  const token = createDevelopmentTableToken({
    restaurantId: "dzuku_ainiai",
    tableNumber: "B12",
    tokenId: "ui_signed_table",
  });
  const table = await establishDiningSession({
    client: client(),
    storage: new MemorySessionStorage(),
    language: "lt",
    tableToken: token,
  });
  assert.equal(table.ok, true);
  if (!table.ok) return;
  assert.equal(table.data.source, "created_table");
  assert.equal(table.data.snapshot.capabilities.staffRequestsAvailable, true);

  const invalid = await establishDiningSession({
    client: client(),
    storage: new MemorySessionStorage(),
    language: "lt",
    tableToken: `${token}x`,
  });
  assert.equal(invalid.ok, true);
  if (!invalid.ok) return;
  assert.equal(invalid.data.source, "created_demo");
  assert.equal(invalid.data.warningCode, "invalid_table_token");
  assert.equal(
    invalid.data.snapshot.capabilities.staffRequestsAvailable,
    false
  );
});

test("submission gate prevents duplicates and reuses clientTurnId for manual retry", () => {
  let counter = 0;
  const gate = new TurnSubmissionGate(() => `ui_turn_${++counter}`);
  const first = gate.beginNew("Labas");
  assert.deepEqual(first, {
    message: "Labas",
    clientTurnId: "ui_turn_1",
  });
  assert.equal(gate.beginNew("Duplicate"), null);
  assert.ok(first);
  gate.complete(first, true);
  assert.deepEqual(gate.beginRetry(), first);
  gate.complete(first, false);
  assert.equal(gate.beginRetry(), null);
});

test("server replays the same turn ID and rejects conflicting reuse", async () => {
  await resetDevelopmentRuntime();
  const { established, api } = await createDemo();
  const sessionId = established.snapshot.state.sessionId;
  const first = await api.sendTurn({
    sessionId,
    message: "Labas",
    clientTurnId: "ui_replay_001",
    requestedLanguage: "lt",
  });
  const replay = await api.sendTurn({
    sessionId,
    message: "Labas",
    clientTurnId: "ui_replay_001",
    requestedLanguage: "lt",
  });
  assert.equal(first.ok, true);
  assert.equal(replay.ok, true);
  if (replay.ok) assert.equal(replay.data.replayed, true);

  const conflict = await api.sendTurn({
    sessionId,
    message: "Kita žinutė",
    clientTurnId: "ui_replay_001",
    requestedLanguage: "lt",
  });
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.error.code, "turn_id_conflict");
});

test("product references retain server order and authorized add updates only the server cart", async () => {
  await resetDevelopmentRuntime();
  const { established, api } = await createDemo();
  const sessionId = established.snapshot.state.sessionId;
  const suggested = await recommendation(api, sessionId);
  assert.ok(suggested.references.length >= 2);
  assert.deepEqual(
    suggested.references.map((reference) => reference.productId),
    ["u1", "u2", "u3"].slice(0, suggested.references.length)
  );
  assert.ok(
    suggested.references.every(
      (reference) =>
        reference.currency === "EUR" &&
        Number.isFinite(reference.officialUnitPrice)
    )
  );

  const added = await api.sendTurn({
    sessionId,
    message: "Pridėk antrą",
    clientTurnId: "ui_authorized_add_001",
    requestedLanguage: "lt",
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  assert.equal(added.data.cart.lines.length, 1);
  assert.equal(
    added.data.cart.lines[0].productId,
    suggested.references[1].productId
  );
  assert.equal(added.data.actions[0]?.type, "cart_updated");
});

test("informational add wording and unsupported modifiers do not mutate the cart", async () => {
  await resetDevelopmentRuntime();
  const { established, api } = await createDemo();
  const sessionId = established.snapshot.state.sessionId;
  const informational = await api.sendTurn({
    sessionId,
    message: "Tik parodyk silkę, dar nepridėk.",
    clientTurnId: "ui_rejected_add_001",
    requestedLanguage: "lt",
  });
  assert.equal(informational.ok, true);
  if (!informational.ok) return;
  assert.equal(informational.data.cart.lines.length, 0);
  assert.equal(
    informational.data.actions.some(
      (action) => action.type === "cart_updated"
    ),
    false
  );

  await recommendation(api, sessionId, "ui_modifier_rec_001");
  const modifier = await api.sendTurn({
    sessionId,
    message: "Pridėk burgerį be svogūnų",
    clientTurnId: "ui_modifier_001",
    requestedLanguage: "lt",
  });
  assert.equal(modifier.ok, true);
  if (!modifier.ok) return;
  assert.equal(modifier.data.status, "clarification_required");
  assert.equal(modifier.data.cart.lines.length, 0);
});

test("server cart keeps the same product as distinct lines with distinct notes", async () => {
  await resetDevelopmentRuntime();
  const { established, api } = await createDemo();
  const sessionId = established.snapshot.state.sessionId;
  await recommendation(api, sessionId);

  const first = await api.sendTurn({
    sessionId,
    message: "Pridėk pirmą. Pastaba: raudona lėkštė",
    clientTurnId: "ui_note_add_001",
    requestedLanguage: "lt",
  });
  const second = await api.sendTurn({
    sessionId,
    message: "Pridėk pirmą. Pastaba: mėlyna lėkštė",
    clientTurnId: "ui_note_add_002",
    requestedLanguage: "lt",
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(second.data.cart.lines.length, 2);
  const [firstLine, secondLine] = second.data.cart.lines;
  assert.equal(firstLine.productId, secondLine.productId);
  assert.notEqual(firstLine.lineId, secondLine.lineId);
  assert.deepEqual(
    second.data.cart.lines.map((line) => line.customerNote),
    ["raudona lėkštė", "mėlyna lėkštė"]
  );
  assert.equal(
    second.data.cart.lines.every(
      (line) => line.requiresStaffConfirmation
    ),
    true
  );
});

test("cart update, remove, and clear requests remain server-authorized turn actions", async () => {
  await resetDevelopmentRuntime();
  const { established, api } = await createDemo();
  const sessionId = established.snapshot.state.sessionId;
  await recommendation(api, sessionId);
  await api.sendTurn({
    sessionId,
    message: "Pridėk pirmą",
    clientTurnId: "ui_cart_add_001",
    requestedLanguage: "lt",
  });
  await api.sendTurn({
    sessionId,
    message: "Pridėk pirmą",
    clientTurnId: "ui_cart_add_002",
    requestedLanguage: "lt",
  });
  const updated = await api.sendTurn({
    sessionId,
    message: "Pakeisk pirmos prekės kiekį į 2",
    clientTurnId: "ui_cart_update_001",
    requestedLanguage: "lt",
  });
  assert.equal(updated.ok, true);
  if (!updated.ok) return;
  assert.equal(updated.data.cart.lines[0].quantity, 2);

  const removed = await api.sendTurn({
    sessionId,
    message: "Pašalink antrą krepšelio prekę",
    clientTurnId: "ui_cart_remove_001",
    requestedLanguage: "lt",
  });
  assert.equal(removed.ok, true);
  if (!removed.ok) return;
  assert.equal(removed.data.cart.lines.length, 1);

  const cleared = await api.sendTurn({
    sessionId,
    message: "Išvalyk krepšelį",
    clientTurnId: "ui_cart_clear_001",
    requestedLanguage: "lt",
  });
  assert.equal(cleared.ok, true);
  if (cleared.ok) assert.equal(cleared.data.cart.lines.length, 0);
});

test("demo staff requests cannot fabricate success while signed-table requests succeed", async () => {
  await resetDevelopmentRuntime();
  const demo = await createDemo();
  const rejected = await demo.api.sendTurn({
    sessionId: demo.established.snapshot.state.sessionId,
    message: "Pakviesk padavėją",
    clientTurnId: "ui_demo_waiter_001",
    requestedLanguage: "lt",
  });
  assert.equal(rejected.ok, true);
  if (!rejected.ok) return;
  assert.equal(
    rejected.data.actions.some(
      (action) => action.type === "staff_requested"
    ),
    false
  );
  assert.match(rejected.data.message, /demonstraciniame režime/iu);
  assert.match(
    turnPresentation(rejected.data, "lt").notice ?? "",
    /demonstraciniame režime/iu
  );

  const token = createDevelopmentTableToken({
    restaurantId: "dzuku_ainiai",
    tableNumber: "T7",
    tokenId: "ui_staff_success",
  });
  const signed = await establishDiningSession({
    client: demo.api,
    storage: new MemorySessionStorage(),
    language: "lt",
    tableToken: token,
  });
  assert.equal(signed.ok, true);
  if (!signed.ok) return;
  const accepted = await demo.api.sendTurn({
    sessionId: signed.data.snapshot.state.sessionId,
    message: "Pakviesk padavėją",
    clientTurnId: "ui_signed_waiter_001",
    requestedLanguage: "lt",
  });
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  assert.equal(accepted.data.actions[0]?.type, "staff_requested");
  assert.equal(accepted.data.actionLedger[0]?.status, "succeeded");
});

test("turn presentation preserves partial success, fallback, replay, and no-side-effect retry semantics", async () => {
  await resetDevelopmentRuntime();
  const { established, api } = await createDemo();
  const baseline = await api.sendTurn({
    sessionId: established.snapshot.state.sessionId,
    message: "Labas",
    clientTurnId: "ui_presentation_001",
    requestedLanguage: "lt",
  });
  assert.equal(baseline.ok, true);
  if (!baseline.ok) return;

  const partial = turnPresentation(
    {
      ...baseline.data,
      status: "partial_success_state_update_failed",
      fallbackUsed: true,
    },
    "lt"
  );
  assert.equal(partial.preservesSuccessfulAction, true);
  assert.equal(partial.retryable, false);
  assert.match(partial.notice ?? "", /Veiksmas atliktas/iu);

  const fallback = turnPresentation(
    {
      ...baseline.data,
      status: "success_with_response_fallback",
      fallbackUsed: true,
    },
    "en"
  );
  assert.equal(fallback.preservesSuccessfulAction, true);
  assert.match(fallback.notice ?? "", /safe fallback/iu);

  const failed = {
    ...baseline.data,
    status: "provider_failed_without_side_effect" as const,
  };
  assert.equal(turnPresentation(failed, "ru").retryable, true);
  assert.equal(
    isRetryableTurnResult({ ok: true, data: failed }),
    true
  );
});

test("client renders safe rate-limit, storage, and conflict messages in supported languages", async () => {
  const errorFetch = (code: string, status: number) =>
    (async () =>
      Response.json(
        { ok: false, error: { code, message: "Internal server wording." } },
        { status }
      )) as typeof fetch;
  const storageFailure = await client(
    errorFetch("storage_not_configured", 503)
  ).createSession("lt", null);
  assert.equal(storageFailure.ok, false);
  if (!storageFailure.ok) {
    assert.equal(storageFailure.error.code, "storage_not_configured");
  }
  assert.match(
    friendlyClientError("rate_limited", "en"),
    /Too many requests/iu
  );
  assert.match(
    friendlyClientError("storage_not_configured", "ru"),
    /Хранилище/iu
  );
  assert.match(
    friendlyClientError("turn_id_conflict", "lt"),
    /pakartojimo numeris/iu
  );
  assert.equal(liveWaiterCopy("ru").waiter, "Официант");
});

test("server response language remains authoritative for English turns", async () => {
  await resetDevelopmentRuntime();
  const storage = new MemorySessionStorage();
  const established = await establishDiningSession({
    client: client(),
    storage,
    language: "en",
    tableToken: null,
  });
  assert.equal(established.ok, true);
  if (!established.ok) return;
  const result = await client().sendTurn({
    sessionId: established.data.snapshot.state.sessionId,
    message: "Hello",
    clientTurnId: "ui_language_001",
    requestedLanguage: "en",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.language, "en");
  assert.match(result.data.message, /Hello|Welcome|How can I help/iu);
});

test("cart reconciliation rejects duplicate line IDs and preserves distinct official lines", async () => {
  await resetDevelopmentRuntime();
  const { established, api } = await createDemo();
  const suggested = await recommendation(
    api,
    established.snapshot.state.sessionId
  );
  assert.ok(suggested.references.length > 0);
  const added = await api.sendTurn({
    sessionId: established.snapshot.state.sessionId,
    message: "Pridėk pirmą",
    clientTurnId: "ui_reconcile_001",
    requestedLanguage: "lt",
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  const valid = reconcileServerCart(added.data.cart);
  assert.equal(valid.lines.length, 1);
  assert.throws(() =>
    reconcileServerCart({
      ...valid,
      lines: [valid.lines[0], structuredClone(valid.lines[0])],
    })
  );
});

test("table token URLs are consumed without persisting token material", () => {
  const parsed = tableTokenFromUrl(
    "http://localhost:3000/ai?source=qr#tableToken=payload.signature&menu=open"
  );
  assert.equal(parsed.tableToken, "payload.signature");
  assert.equal(parsed.cleanedUrl, "/ai?source=qr#menu=open");
  const storage = new MemorySessionStorage();
  storage.setItem(
    LIVE_WAITER_SESSION_KEY,
    JSON.stringify({
      version: 1,
      sessionId: "ds_00000000000000000000000000000001",
    })
  );
  assert.doesNotMatch(
    storage.getItem(LIVE_WAITER_SESSION_KEY) ?? "",
    /payload|signature/u
  );

  const legacyQuery = tableTokenFromUrl(
    "http://localhost:3000/ai?tableToken=legacy.capability&source=old"
  );
  assert.equal(legacyQuery.tableToken, null);
  assert.equal(legacyQuery.cleanedUrl, "/ai?source=old");
});

test("session client keeps table tokens and session capabilities out of request URLs", async () => {
  const urls: string[] = [];
  const bodies: unknown[] = [];
  const sessionId = "ds_00000000000000000000000000000099";
  const now = new Date().toISOString();
  const snapshot = {
    ok: true as const,
    state: {
      schemaVersion: 1 as const,
      sessionId,
      restaurantId: null,
      tableNumber: null,
      tableTokenId: null,
      language: "en" as const,
      stage: "greeting" as const,
      preferences: {
        preferredProductIds: [],
        preferredCategories: [],
        preferredProteins: [],
        preferredDrinks: [],
      },
      temporaryPreferences: {
        preferredProductIds: [],
        preferredCategories: [],
        preferredProteins: [],
        preferredDrinks: [],
      },
      dislikedIngredients: [],
      dietaryRequirements: [],
      allergies: [],
      budget: null,
      budgetScope: null,
      hungerLevel: null,
      latestReferencedProductIds: [],
      unresolvedQuestion: null,
      ambiguity: null,
      cartRevision: 0,
      lastIntent: null,
      lastToolNames: [],
      lastInteractionAt: null,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    cart: {
      sessionId,
      revision: 0,
      lines: [],
      total: 0,
      currency: "EUR" as const,
      updatedAt: now,
    },
    capabilities: {
      mode: "demo" as const,
      staffRequestsAvailable: false,
    },
  };
  const transport = (async (
    input: string | URL | Request,
    init?: RequestInit
  ) => {
    const url =
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : input;
    urls.push(url);
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json(snapshot, { status: 200 });
  }) as typeof fetch;
  const api = new LiveWaiterClient({ fetchImplementation: transport });
  await api.createSession("en", "payload_payload.signature_signature");
  await api.restoreSession(sessionId);
  assert.deepEqual(urls, ["/api/ai/session", "/api/ai/session"]);
  assert.equal(urls.some((url) => url.includes(sessionId)), false);
  assert.equal(urls.some((url) => url.includes("payload_payload")), false);
  assert.deepEqual(bodies, [
    {
      action: "create_table_session",
      language: "en",
      tableToken: "payload_payload.signature_signature",
    },
    { action: "restore_session", sessionId },
  ]);
});

test("pending turns survive ambiguous transport, expire, and retain exact retry identity", async () => {
  const storage = new MemorySessionStorage();
  const sessionId = "ds_00000000000000000000000000000098";
  const pending = storePendingTurn(
    storage,
    {
      version: 1,
      sessionId,
      clientTurnId: "ui_pending_001",
      message: "Exact customer message",
      createdAt: 1_000,
      transportState: "sending",
      lastAttemptAt: 1_001,
    },
    1_001
  );
  assert.deepEqual(readPendingTurn(storage, sessionId, 2_000), pending);
  const gate = new TurnSubmissionGate(() => "ui_fresh_001");
  assert.equal(
    gate.recover({
      message: pending.message,
      clientTurnId: pending.clientTurnId,
    }),
    true
  );
  assert.deepEqual(gate.beginRetry(), {
    message: "Exact customer message",
    clientTurnId: "ui_pending_001",
  });
  cleanupExpiredPendingTurns(storage, 1_000 + 20 * 60 * 1_000 + 1);
  assert.equal(readPendingTurn(storage, sessionId, Date.now()), null);
});

test("transcripts are session-scoped, bounded display data and never conversation authority", () => {
  const storage = new MemorySessionStorage();
  const first = {
    sessionId: "ds_00000000000000000000000000000096" as const,
    restaurantId: "dzuku_ainiai",
  };
  const second = {
    sessionId: "ds_00000000000000000000000000000097" as const,
    restaurantId: "dzuku_ainiai",
  };
  saveDisplayTranscript(
    storage,
    first,
    [
      {
        id: "stored-user",
        role: "user",
        content: "I am allergic to nuts",
        time: "12:00",
      },
    ],
    1_000
  );
  assert.equal(loadDisplayTranscript(storage, second, 1_001), null);
  assert.equal(loadDisplayTranscript(storage, first, 1_001)?.length, 1);
  const storedValues = [...storage.values.values()].join("\n");
  assert.doesNotMatch(storedValues, /tableToken|signature/u);
  assert.equal(
    loadDisplayTranscript(storage, first, 1_000 + 24 * 60 * 60 * 1_000 + 1),
    null
  );
});

test("timeouts and post-send aborts are ambiguous while pre-send abort is definitive", async () => {
  const hangingFetch = (async (
    _input: string | URL | Request,
    init?: RequestInit
  ) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        { once: true }
      );
    })) as typeof fetch;
  const timedOut = await new LiveWaiterClient({
    fetchImplementation: hangingFetch,
    requestTimeoutMs: 5,
  }).sendTurn({
    sessionId: "ds_00000000000000000000000000000095",
    message: "Add it",
    clientTurnId: "ui_timeout_001",
    requestedLanguage: "en",
  });
  assert.equal(timedOut.ok, false);
  if (!timedOut.ok) {
    assert.equal(timedOut.error.code, "request_timeout");
    assert.equal(timedOut.error.outcome, "unknown");
    assert.equal(retryModeForTurnResult(timedOut), "same_id");
  }

  const controller = new AbortController();
  controller.abort();
  const preSend = await new LiveWaiterClient({
    fetchImplementation: hangingFetch,
  }).sendTurn(
    {
      sessionId: "ds_00000000000000000000000000000095",
      message: "Add it",
      clientTurnId: "ui_abort_001",
      requestedLanguage: "en",
    },
    { signal: controller.signal }
  );
  assert.equal(preSend.ok, false);
  if (!preSend.ok) {
    assert.equal(preSend.error.outcome, "definitive");
    assert.equal(retryModeForTurnResult(preSend), null);
  }
});

test("structured card selection adds the exact visible reference and rejects stale or guessed hints", async () => {
  await resetDevelopmentRuntime();
  const { established, api } = await createDemo();
  const sessionId = established.snapshot.state.sessionId;
  const suggested = await recommendation(api, sessionId, "ui_hint_rec_001");
  const clicked = suggested.references[1];
  assert.ok(clicked.referenceSetId);
  assert.equal(clicked.ordinal, 1);
  const exact = await api.sendTurn({
    sessionId,
    message: "Pridėk 2 pasiūlymą.",
    clientTurnId: "ui_hint_add_001",
    requestedLanguage: "lt",
    selectionHint: {
      actionType: "add_to_cart",
      referenceSetId: clicked.referenceSetId!,
      productId: clicked.productId,
      ordinal: clicked.ordinal!,
    },
  });
  assert.equal(exact.ok, true);
  if (!exact.ok) return;
  assert.equal(exact.data.cart.lines[0]?.productId, clicked.productId);
  assert.equal(exact.data.cart.lines[0]?.quantity, 1);

  const guessed = await api.sendTurn({
    sessionId,
    message: "Pridėk 1 pasiūlymą.",
    clientTurnId: "ui_hint_guess_001",
    requestedLanguage: "lt",
    selectionHint: {
      actionType: "add_to_cart",
      referenceSetId: clicked.referenceSetId!,
      productId: "guessed_product",
      ordinal: 0,
    },
  });
  assert.equal(guessed.ok, true);
  if (guessed.ok) {
    assert.equal(guessed.data.status, "rejected_action");
    assert.equal(guessed.data.cart.lines.length, 1);
  }

  await conversationStateStore.setLatestReferences(sessionId, ["u3"]);
  const stale = await api.sendTurn({
    sessionId,
    message: "Pridėk 2 pasiūlymą.",
    clientTurnId: "ui_hint_stale_001",
    requestedLanguage: "lt",
    selectionHint: {
      actionType: "add_to_cart",
      referenceSetId: clicked.referenceSetId!,
      productId: clicked.productId,
      ordinal: clicked.ordinal!,
    },
  });
  assert.equal(stale.ok, true);
  if (stale.ok) {
    assert.ok(
      ["rejected_action", "clarification_required"].includes(
        stale.data.status
      )
    );
    assert.equal(stale.data.cart.lines.length, 1);
    assert.equal(
      stale.data.actions.some((action) => action.type === "cart_updated"),
      false
    );
  }
});

test("Russian recommendations and explicit, negated, modifier, cart, and staff actions are coherent", async () => {
  await resetDevelopmentRuntime();
  const storage = new MemorySessionStorage();
  const established = await establishDiningSession({
    client: client(),
    storage,
    language: "ru",
    tableToken: null,
  });
  assert.equal(established.ok, true);
  if (!established.ok) return;
  const sessionId = established.data.snapshot.state.sessionId;
  const recommended = await client().sendTurn({
    sessionId,
    message: "Что порекомендуете из сытных блюд?",
    clientTurnId: "ui_ru_recommend_001",
    requestedLanguage: "ru",
  });
  assert.equal(recommended.ok, true);
  if (!recommended.ok) return;
  assert.equal(recommended.data.language, "ru");
  assert.ok(recommended.data.references.length > 1);
  const second = recommended.data.references[1];
  const added = await client().sendTurn({
    sessionId,
    message: "Добавь 2 предложение.",
    clientTurnId: "ui_ru_add_001",
    requestedLanguage: "ru",
    selectionHint: {
      actionType: "add_to_cart",
      referenceSetId: second.referenceSetId!,
      productId: second.productId,
      ordinal: second.ordinal!,
    },
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  assert.equal(added.data.cart.lines[0]?.productId, second.productId);
  assert.equal(added.data.cart.lines[0]?.quantity, 1);

  const negated = await client().sendTurn({
    sessionId,
    message: "Не добавляй первое предложение.",
    clientTurnId: "ui_ru_negated_001",
    requestedLanguage: "ru",
  });
  assert.equal(negated.ok, true);
  if (negated.ok) assert.equal(negated.data.cart.lines.length, 1);

  const modifier = await client().sendTurn({
    sessionId,
    message: "Добавь первое без лука.",
    clientTurnId: "ui_ru_modifier_001",
    requestedLanguage: "ru",
  });
  assert.equal(modifier.ok, true);
  if (modifier.ok) assert.equal(modifier.data.cart.lines.length, 1);

  const cleared = await client().sendTurn({
    sessionId,
    message: "Очисти корзину.",
    clientTurnId: "ui_ru_clear_001",
    requestedLanguage: "ru",
  });
  assert.equal(cleared.ok, true);
  if (cleared.ok) assert.equal(cleared.data.cart.lines.length, 0);

  const waiter = await client().sendTurn({
    sessionId,
    message: "Позови официанта.",
    clientTurnId: "ui_ru_waiter_001",
    requestedLanguage: "ru",
  });
  assert.equal(waiter.ok, true);
  if (waiter.ok) {
    assert.equal(
      waiter.data.actions.some((action) => action.type === "staff_requested"),
      false
    );
    assert.match(waiter.data.message, /демонстрационном режиме/iu);
  }
});

test("log-safe identifiers hash capability-like values", () => {
  const sessionId = "ds_00000000000000000000000000000094";
  const redacted = safeCapabilityIdentifier(sessionId);
  assert.match(redacted, /^sha256:[a-f0-9]{12}$/u);
  assert.doesNotMatch(redacted, new RegExp(sessionId, "u"));
});

test("live /ai source has no old brain, ADD tag, tool endpoint, or browser cart mutation path", async () => {
  const source = await readFile(
    new URL("../../../app/ai/page.tsx", import.meta.url),
    "utf8"
  );
  const clientSource = await readFile(
    new URL("../client/liveWaiterClient.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /@\/lib\/ai-engine/u);
  assert.doesNotMatch(source, /generateReply|updateContext|emptyContext/u);
  assert.doesNotMatch(source, /\[ADD:|extractAddIds|stripAddTags/u);
  assert.doesNotMatch(source, /\/api\/ai\/tools/u);
  assert.doesNotMatch(
    source,
    /useCartStore\([^)]*\b(addItem|removeItem|updateQuantity|clearCart)\b/u
  );
  assert.match(clientSource, /\/api\/ai\/turn/u);
});
