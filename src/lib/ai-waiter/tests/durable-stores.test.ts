/**
 * The point of this migration: session state must survive the process that
 * wrote it going away (a redeploy, a fresh serverless instance). Every test
 * here proves that by writing through one store instance and reading back
 * through a brand-new one pointed at the same SQLite file — never reusing
 * the writer's in-process object, the way InMemory* tests do.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { createDurableConversationStateStore } from "../server/conversationStateStore.ts";
import { createDurableCartAdapter } from "../server/cartPort.ts";
import { createDurableStaffTaskAdapter } from "../server/staffTaskPort.ts";
import { createDurableTurnIdempotencyStore } from "../server/turnIdempotencyStore.ts";
import { createDurableActionLedger } from "../server/actionLedger.ts";
import { createDurableSessionTurnCoordinator } from "../server/sessionTurnCoordinator.ts";
import { resetAiWaiterBackendForTests } from "../server/aiWaiterDb.ts";
import { StaticMenuRepository } from "../server/menuRepository.ts";
import { WaiterTurnResultSchema, type DiningSessionId } from "../schemas.ts";

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  resetAiWaiterBackendForTests(db);
  return db;
}

test("conversation state survives a fresh store instance against the same db (simulated redeploy)", async () => {
  freshDb();
  const writer = await createDurableConversationStateStore();
  const created = await writer.createSession({
    language: "lt",
    tableContext: null,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const reader = await createDurableConversationStateStore();
  const reloaded = await reader.getSession(created.data.sessionId);
  assert.equal(reloaded?.sessionId, created.data.sessionId);
  assert.equal(reloaded?.language, "lt");
});

test("expired sessions are not returned and trigger cleanup handlers", async () => {
  freshDb();
  let now = 1_000_000;
  const store = await createDurableConversationStateStore({
    ttlMs: 1_000,
    now: () => now,
  });
  const cleaned: DiningSessionId[] = [];
  store.registerSessionCleanup((sessionId) => {
    cleaned.push(sessionId);
  });
  const created = await store.createSession({ language: "en", tableContext: null });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  now += 2_000;
  const afterExpiry = await store.getSession(created.data.sessionId);
  assert.equal(afterExpiry, null);
  assert.deepEqual(cleaned, [created.data.sessionId]);
});

test("cart contents and revision persist across a fresh cart adapter instance", async () => {
  freshDb();
  const menu = new StaticMenuRepository();
  const conversationStore = await createDurableConversationStateStore();
  const session = await conversationStore.createSession({
    language: "lt",
    tableContext: null,
  });
  assert.equal(session.ok, true);
  if (!session.ok) return;

  const writerCart = await createDurableCartAdapter(menu, conversationStore);
  const added = await writerCart.addCartItem(session.data.sessionId, {
    productId: "u1",
    quantity: 2,
    modifiers: [],
    customerNote: null,
    expectedRevision: 0,
    idempotencyKey: "add_1",
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  assert.equal(added.data.cart.revision, 1);
  assert.equal(added.data.cart.lines.length, 1);

  const readerCart = await createDurableCartAdapter(menu, conversationStore);
  const reloaded = await readerCart.getCart(session.data.sessionId);
  assert.equal(reloaded.ok, true);
  if (!reloaded.ok) return;
  assert.equal(reloaded.data.cart.revision, 1);
  assert.equal(reloaded.data.cart.lines[0]?.productId, "u1");
  assert.equal(reloaded.data.cart.lines[0]?.quantity, 2);
});

test("a stale expectedRevision is rejected as a revision conflict", async () => {
  freshDb();
  const menu = new StaticMenuRepository();
  const conversationStore = await createDurableConversationStateStore();
  const session = await conversationStore.createSession({
    language: "lt",
    tableContext: null,
  });
  assert.equal(session.ok, true);
  if (!session.ok) return;
  const cart = await createDurableCartAdapter(menu, conversationStore);
  const first = await cart.addCartItem(session.data.sessionId, {
    productId: "u1",
    quantity: 1,
    modifiers: [],
    customerNote: null,
    expectedRevision: 0,
    idempotencyKey: "add_1",
  });
  assert.equal(first.ok, true);

  const stale = await cart.addCartItem(session.data.sessionId, {
    productId: "u2",
    quantity: 1,
    modifiers: [],
    customerNote: null,
    expectedRevision: 0,
    idempotencyKey: "add_2",
  });
  assert.equal(stale.ok, false);
  if (stale.ok) return;
  assert.equal(stale.error.code, "revision_conflict");
});

test("idempotent add-to-cart replays across a fresh cart adapter instance", async () => {
  freshDb();
  const menu = new StaticMenuRepository();
  const conversationStore = await createDurableConversationStateStore();
  const session = await conversationStore.createSession({
    language: "lt",
    tableContext: null,
  });
  assert.equal(session.ok, true);
  if (!session.ok) return;
  const writerCart = await createDurableCartAdapter(menu, conversationStore);
  const first = await writerCart.addCartItem(session.data.sessionId, {
    productId: "u1",
    quantity: 1,
    modifiers: [],
    customerNote: null,
    expectedRevision: 0,
    idempotencyKey: "same_key",
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const readerCart = await createDurableCartAdapter(menu, conversationStore);
  const replay = await readerCart.addCartItem(session.data.sessionId, {
    productId: "u1",
    quantity: 1,
    modifiers: [],
    customerNote: null,
    expectedRevision: 0,
    idempotencyKey: "same_key",
  });
  assert.equal(replay.ok, true);
  if (!replay.ok) return;
  assert.equal(replay.data.replayed, true);
  assert.equal(replay.data.cart.lines.length, 1);
});

test("staff request idempotency replays across a fresh staff task adapter instance", async () => {
  freshDb();
  const conversationStore = await createDurableConversationStateStore();
  const session = await conversationStore.createSession({
    language: "lt",
    tableContext: null,
  });
  assert.equal(session.ok, true);
  if (!session.ok) return;
  const writerTasks = await createDurableStaffTaskAdapter(conversationStore);
  const first = await writerTasks.requestWaiter(session.data.sessionId, {
    idempotencyKey: "call_1",
    note: undefined,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.data.replayed, false);

  const readerTasks = await createDurableStaffTaskAdapter(conversationStore);
  const replay = await readerTasks.requestWaiter(session.data.sessionId, {
    idempotencyKey: "call_1",
    note: undefined,
  });
  assert.equal(replay.ok, true);
  if (!replay.ok) return;
  assert.equal(replay.data.replayed, true);
  assert.equal(replay.data.requestId, first.data.requestId);
});

test("a completed turn replays its persisted result on a fresh idempotency store (post-redeploy retry)", async () => {
  freshDb();
  const sessionId = "ds_00000000000000000000000000000001" as DiningSessionId;
  const writer = await createDurableTurnIdempotencyStore();
  let calls = 0;
  const first = await writer.execute(sessionId, "turn_1", "Labas", async () => {
    calls += 1;
    return WaiterTurnResultSchema.parse({
      ok: false,
      error: { code: "internal_error", message: "deliberate test result" },
    });
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.replayed, false);
  assert.equal(calls, 1);

  const reader = await createDurableTurnIdempotencyStore();
  const replay = await reader.execute(sessionId, "turn_1", "Labas", async () => {
    calls += 1;
    throw new Error("must not run again — the DB copy should be replayed instead");
  });
  assert.equal(replay.ok, true);
  if (!replay.ok) return;
  assert.equal(replay.replayed, true);
  assert.equal(calls, 1);
  assert.deepEqual(replay.result, first.result);

  const conflict = await reader.execute(sessionId, "turn_1", "Something else", async () =>
    WaiterTurnResultSchema.parse({
      ok: false,
      error: { code: "internal_error", message: "should not run" },
    })
  );
  assert.equal(conflict.ok, false);
  if (conflict.ok) return;
  assert.equal(conflict.code, "turn_id_conflict");
});

test("action ledger entries are queryable by turn from a fresh instance", async () => {
  freshDb();
  const sessionId = "ds_00000000000000000000000000000002" as DiningSessionId;
  const writer = await createDurableActionLedger();
  const begun = await writer.beginAuthorizedAction({
    sessionId,
    turnId: "turn_a",
    ordinal: 0,
    intent: {
      actionType: "add_to_cart",
      affirmation: "affirmative",
      negated: false,
      hypothetical: false,
      ambiguous: false,
      informationalOnly: false,
      comparisonOnly: false,
      futureIntent: false,
      thirdPartyIntent: false,
      targetType: "product",
      targetIds: ["u1"],
      quantity: 1,
      customerNote: null,
      evidence: "test",
      confidence: "high",
      clarificationReason: null,
    },
    toolName: "add_to_cart",
    canonicalInput: { productId: "u1" },
    cartRevision: 0,
  });
  assert.ok(begun);
  if (!begun) return;
  await writer.markExecuting(begun.entry.actionId);
  await writer.markCompleted(begun.entry.actionId, {
    ok: true,
    toolName: "add_to_cart",
    data: {
      cart: {
        sessionId,
        revision: 1,
        lines: [],
        total: 0,
        currency: "EUR",
        updatedAt: new Date().toISOString(),
      },
      affectedLineId: "line_1",
      operationId: "op_1",
      replayed: false,
    },
  });

  const reader = await createDurableActionLedger();
  const entries = await reader.getByTurn(sessionId, "turn_a");
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.entry.status, "succeeded");
  assert.equal(entries[0]?.entry.affectedId, "line_1");
});

test("session turn coordinator serializes concurrent turns for the same session", async () => {
  freshDb();
  const coordinator = await createDurableSessionTurnCoordinator();
  const sessionId = "ds_00000000000000000000000000000003" as DiningSessionId;
  const order: number[] = [];

  async function slow(id: number, ms: number) {
    return coordinator.runExclusive(sessionId, async () => {
      order.push(id);
      await new Promise((resolve) => setTimeout(resolve, ms));
      order.push(-id);
    });
  }

  await Promise.all([slow(1, 30), slow(2, 5)]);
  // Whichever ran first must fully finish (push its -id) before the other starts:
  // interleavings like [1, 2, -2, -1] would mean both ran concurrently.
  const valid =
    JSON.stringify(order) === JSON.stringify([1, -1, 2, -2]) ||
    JSON.stringify(order) === JSON.stringify([2, -2, 1, -1]);
  assert.ok(valid, `expected serialized order, got ${JSON.stringify(order)}`);
});

test("session turn coordinator lets independent sessions run in parallel", async () => {
  freshDb();
  const coordinator = await createDurableSessionTurnCoordinator();
  const started: string[] = [];
  await Promise.all([
    coordinator.runExclusive("ds_00000000000000000000000000000004" as DiningSessionId, async () => {
      started.push("a");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }),
    coordinator.runExclusive("ds_00000000000000000000000000000005" as DiningSessionId, async () => {
      started.push("b");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }),
  ]);
  assert.deepEqual(started.sort(), ["a", "b"]);
});
