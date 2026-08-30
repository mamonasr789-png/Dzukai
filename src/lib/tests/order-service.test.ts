/**
 * Server-side order/session/task service — the atomic, authoritative twin of
 * the old localStorage modules. Runs against an in-memory SQLite sync store.
 * Run: node --experimental-strip-types src/lib/tests/order-service.test.ts
 *
 * Note on harness: the shared runner (assistant/tests/runner.ts) wraps `it`'s
 * callback in a plain try/catch, so it never awaits an async test body — fine
 * for other suites here because they each construct their own isolated store
 * instance per test. This suite instead swaps a module-level singleton
 * (__setSyncStoreForTests) between tests, so tests MUST run strictly
 * sequentially or a later test's freshStore() call clobbers an earlier test's
 * still-in-flight store. itAsync() below awaits each test body fully before
 * handing a already-resolved (or already-thrown) result to the shared `it`.
 */

const { describe, it, expect, printResults } = await import("../assistant/tests/runner.ts");
const { DatabaseSync } = await import("node:sqlite");

// server-only throws outside a React Server Component build, so stub it before
// any server module is imported (same trick sync-store.test.ts uses).
const require0 = (await import("node:module")).createRequire(import.meta.url);
const serverOnly = require0.resolve("server-only");
require0.cache[serverOnly] = { id: serverOnly, filename: serverOnly, loaded: true, exports: {} } as never;

const { SqliteSyncStore, __setSyncStoreForTests } = await import("../server/syncStore.ts");
const { SqliteMenuOverrideStore, __setMenuOverrideStoreForTests } = await import("../server/menuOverrideStore.ts");
const orderService = await import("../server/orderService.ts");
const taskService = await import("../server/taskService.ts");

function freshStore() {
  __setSyncStoreForTests(new SqliteSyncStore(new DatabaseSync(":memory:")));
  __setMenuOverrideStoreForTests(new SqliteMenuOverrideStore(new DatabaseSync(":memory:")));
}

function items(total = 10) {
  return [{ productId: "p1", name: "Pica", price: total, quantity: 1 }];
}

async function itAsync(name: string, fn: () => Promise<void>): Promise<void> {
  let error: unknown = null;
  try {
    await fn();
  } catch (e) {
    error = e;
  }
  it(name, () => {
    if (error) throw error;
  });
}

async function main() {
  describe("submitOrder", () => {});
  await itAsync("first order of a visit becomes PENDING_CONFIRMATION with an order_confirmation task", async () => {
    freshStore();
    const { order, session } = await orderService.submitOrder({ tableNumber: "5", items: items(), total: 10 });
    expect(order.status).toBe("PENDING_CONFIRMATION");
    expect(session.orderIds).toEqual([order.id]);

    const tasks = await taskService.listTasks();
    expect(tasks.length).toBe(1);
    expect(tasks[0].type).toBe("order_confirmation");
    expect(tasks[0].tableNumber).toBe("5");
  });

  await itAsync(
    "second order in the same session becomes NEW with an additional_order task, not a new session",
    async () => {
      freshStore();
      const first = await orderService.submitOrder({ tableNumber: "5", items: items(), total: 10 });
      const second = await orderService.submitOrder({ tableNumber: "5", items: items(12), total: 12 });

      expect(second.order.status).toBe("NEW");
      expect(second.session.id).toBe(first.session.id);
      expect(second.session.orderIds).toEqual([first.order.id, second.order.id]);

      const tasks = await taskService.listTasks();
      expect(tasks.find((t) => t.orderId === second.order.id)?.type).toBe("additional_order");
    }
  );

  await itAsync("keeps two different tables' sessions completely separate", async () => {
    freshStore();
    const t5 = await orderService.submitOrder({ tableNumber: "5", items: items(), total: 10 });
    const t7 = await orderService.submitOrder({ tableNumber: "7", items: items(), total: 10 });
    expect(t5.session.id).not.toBe(t7.session.id);
    expect(t5.order.status).toBe("PENDING_CONFIRMATION");
    expect(t7.order.status).toBe("PENDING_CONFIRMATION"); // first order of table 7's OWN visit
  });

  describe("createUniqueTask dedup", () => {});
  await itAsync("a second call with the same key is a no-op", async () => {
    freshStore();
    const a = await taskService.createUniqueTask("key1", { type: "waiter_called", orderId: "o1", tableNumber: "5" });
    const b = await taskService.createUniqueTask("key1", { type: "waiter_called", orderId: "o1", tableNumber: "5" });
    expect(a).toBeTruthy();
    expect(b).toBeFalsy();
    expect((await taskService.listTasks()).length).toBe(1);
  });

  describe("item status → ready_to_serve generation", () => {});
  await itAsync("together preference: order-level task fires only once every item is READY", async () => {
    freshStore();
    const { order } = await orderService.submitOrder({
      tableNumber: "5",
      items: [
        { productId: "p1", name: "Pica", price: 10, quantity: 1 },
        { productId: "p2", name: "Kola", price: 3, quantity: 1 },
      ],
      total: 13,
    });
    await orderService.confirmFirstOrder(order.id);
    await orderService.updateItemStatus(order.id, "p1", "READY");
    expect((await taskService.listTasks()).filter((t) => t.type === "ready_to_serve").length).toBe(0);

    await orderService.updateItemStatus(order.id, "p2", "READY");
    const readyTasks = (await taskService.listTasks()).filter((t) => t.type === "ready_to_serve");
    expect(readyTasks.length).toBe(1);
    expect(readyTasks[0].items.length).toBe(2);
  });

  await itAsync("as_ready preference: one task per item as it becomes READY", async () => {
    freshStore();
    const { order } = await orderService.submitOrder({
      tableNumber: "5",
      items: [
        { productId: "p1", name: "Pica", price: 10, quantity: 1 },
        { productId: "p2", name: "Kola", price: 3, quantity: 1 },
      ],
      total: 13,
      servingPreference: "as_ready",
    });
    await orderService.confirmFirstOrder(order.id);
    await orderService.updateItemStatus(order.id, "p1", "READY");
    expect((await taskService.listTasks()).filter((t) => t.type === "ready_to_serve").length).toBe(1);

    await orderService.updateItemStatus(order.id, "p2", "READY");
    expect((await taskService.listTasks()).filter((t) => t.type === "ready_to_serve").length).toBe(2);
  });

  await itAsync("stamps preparedBy only on the READY transition", async () => {
    freshStore();
    const { order } = await orderService.submitOrder({ tableNumber: "5", items: items(), total: 10 });
    await orderService.confirmFirstOrder(order.id);
    const cook = { id: "acc_1", username: "Karolis" };
    await orderService.updateItemStatus(order.id, "p1", "PREPARING", cook);
    let fresh = await orderService.getOrder(order.id);
    expect(fresh?.items[0].preparedBy).toBeFalsy();

    await orderService.updateItemStatus(order.id, "p1", "READY", cook);
    fresh = await orderService.getOrder(order.id);
    expect(fresh?.items[0].preparedBy?.username).toBe("Karolis");
  });

  describe("settleSessionByWaiter", () => {});
  await itAsync("marks every order in the session paid and completes non-ready_to_serve tasks", async () => {
    freshStore();
    const first = await orderService.submitOrder({ tableNumber: "5", items: items(10), total: 10 });
    await orderService.confirmFirstOrder(first.order.id);
    const second = await orderService.submitOrder({ tableNumber: "5", items: items(15), total: 15 });

    // Bring first order's item to READY so a ready_to_serve task exists.
    await orderService.updateItemStatus(first.order.id, "p1", "READY");

    const waiter = { id: "acc_2", username: "Rytis" };
    const result = await orderService.settleSessionByWaiter("5", waiter);
    expect(result?.session.status).toBe("CLOSED");
    expect(result?.session.paymentMethod).toBe("WAITER");

    const o1 = await orderService.getOrder(first.order.id);
    const o2 = await orderService.getOrder(second.order.id);
    expect(o1?.isPaid).toBeTruthy();
    expect(o2?.isPaid).toBeTruthy();

    const tasks = await taskService.listTasks();
    const readyTask = tasks.find((t) => t.type === "ready_to_serve");
    expect(readyTask?.status).not.toBe("completed"); // survives payment — food not delivered yet
    const confirmationTask = tasks.find((t) => t.type === "order_confirmation");
    expect(confirmationTask?.status).toBe("completed");
  });

  await itAsync("does not touch another table's open session", async () => {
    freshStore();
    await orderService.submitOrder({ tableNumber: "5", items: items(), total: 10 });
    await orderService.submitOrder({ tableNumber: "7", items: items(), total: 10 });

    await orderService.settleSessionByWaiter("5");

    const sessions = await orderService.listSessions();
    const s5 = sessions.find((s) => s.tableNumber === "5");
    const s7 = sessions.find((s) => s.tableNumber === "7");
    expect(s5?.status).toBe("CLOSED");
    expect(s7?.status).toBe("ACTIVE");
  });

  describe("payOrdersByCustomer", () => {});
  await itAsync("marks the session PAID via APP once every order is paid", async () => {
    freshStore();
    const first = await orderService.submitOrder({ tableNumber: "5", items: items(10), total: 10 });
    await orderService.confirmFirstOrder(first.order.id);
    const second = await orderService.submitOrder({ tableNumber: "5", items: items(15), total: 15 });

    const partial = await orderService.payOrdersByCustomer("5", [first.order.id]);
    expect(partial.allPaid).toBe(false);

    const full = await orderService.payOrdersByCustomer("5", [second.order.id]);
    expect(full.allPaid).toBe(true);

    const { session } = await orderService.getTrackableSessionWithOrders("5");
    expect(session?.paymentMethod).toBe("APP");
    expect(session?.status).toBe("CLOSED");
  });

  await itAsync("refuses to pay an order id that does not belong to the table's session", async () => {
    freshStore();
    const t5 = await orderService.submitOrder({ tableNumber: "5", items: items(), total: 10 });
    await orderService.submitOrder({ tableNumber: "7", items: items(), total: 10 });

    // Attempt to pay table 5's order while impersonating table 7.
    const result = await orderService.payOrdersByCustomer("7", [t5.order.id]);
    const order = await orderService.getOrder(t5.order.id);
    expect(order?.isPaid).toBeFalsy();
    expect(result.allPaid).toBe(false);
  });

  describe("submitOrder server prices", () => {});
  await itAsync("ignores client price/total and persists official menu prices", async () => {
    freshStore();
    const { order } = await orderService.submitOrder({
      tableNumber: "5",
      items: [{ productId: "p1", name: "Hacked", price: 0, quantity: 2 }],
      total: 0,
    });
    // p1 is Margarita at €9.00 in data.ts
    expect(order.items[0].price).toBe(9);
    expect(order.items[0].name).toBe("Margarita");
    expect(order.total).toBe(18);
  });

  await itAsync("rejects unknown product ids so an underpay cannot persist", async () => {
    freshStore();
    let code = "";
    try {
      await orderService.submitOrder({
        tableNumber: "5",
        items: [{ productId: "not-a-real-dish", name: "Free", price: 0, quantity: 1 }],
        total: 0,
      });
    } catch (error) {
      code = error instanceof orderService.OrderPricingError ? error.code : "other";
    }
    expect(code).toBe("unknown_product");
    expect((await orderService.listOrders()).length).toBe(0);
  });

  await itAsync("uses live override price and refuses a sold-out dish", async () => {
    freshStore();
    const { getMenuOverrideStore } = await import("../server/menuOverrideStore.ts");
    const store = await getMenuOverrideStore();
    if (!store) throw new Error("override store missing");
    await store.upsert({ productId: "p1", price: 12.5 });
    const priced = await orderService.submitOrder({
      tableNumber: "5",
      items: [{ productId: "p1", name: "Hacked", price: 1, quantity: 1 }],
      total: 1,
    });
    expect(priced.order.items[0].price).toBe(12.5);
    expect(priced.order.total).toBe(12.5);

    await store.upsert({ productId: "p1", soldOut: true });
    let code = "";
    try {
      await orderService.submitOrder({
        tableNumber: "5",
        items: [{ productId: "p1", quantity: 1 }],
        total: 0,
      });
    } catch (error) {
      code = error instanceof orderService.OrderPricingError ? error.code : "other";
    }
    expect(code).toBe("sold_out");
    expect((await orderService.listOrders()).length).toBe(1);
  });

  describe("requestBill / callWaiter", () => {});
  describe("session close after waiter settle", () => {});
  await itAsync("waiter settle closes the session", async () => {
    freshStore();
    const first = await orderService.submitOrder({
      tableNumber: "5",
      items: items(),
      total: 10,
      visitId: "visit-aaaa",
    });
    const result = await orderService.settleSessionByWaiter("5");
    expect(result?.session.status).toBe("CLOSED");
    expect(result?.session.paymentStatus).toBe("PAID");
    expect(result?.session.paymentMethod).toBe("WAITER");
    expect(result?.session.id).toBe(first.session.id);
  });

  await itAsync("submitOrder on a closed/paid session fails", async () => {
    freshStore();
    await orderService.submitOrder({ tableNumber: "5", items: items(), total: 10, visitId: "visit-aaaa" });
    await orderService.settleSessionByWaiter("5");
    let code = "";
    try {
      await orderService.submitOrder({ tableNumber: "5", items: items(), total: 10, visitId: "visit-aaaa" });
    } catch (error) {
      code = error instanceof orderService.SessionClosedError ? error.code : "other";
    }
    expect(code).toBe("session_closed");
    expect((await orderService.listOrders()).length).toBe(1);
  });

  await itAsync("a stale cookie without a new visit cannot order after settle", async () => {
    freshStore();
    await orderService.submitOrder({ tableNumber: "5", items: items(), total: 10 });
    await orderService.settleSessionByWaiter("5");
    let code = "";
    try {
      await orderService.submitOrder({ tableNumber: "5", items: items(), total: 10 });
    } catch (error) {
      code = error instanceof orderService.SessionClosedError ? error.code : "other";
    }
    expect(code).toBe("session_closed");
    expect((await orderService.listOrders()).length).toBe(1);
  });

  await itAsync("a new visit/session after close can order again", async () => {
    freshStore();
    const first = await orderService.submitOrder({
      tableNumber: "5",
      items: items(),
      total: 10,
      visitId: "visit-aaaa",
    });
    await orderService.settleSessionByWaiter("5");
    const next = await orderService.submitOrder({
      tableNumber: "5",
      items: items(),
      total: 10,
      visitId: "visit-bbbb",
    });
    expect(next.session.id).not.toBe(first.session.id);
    expect(next.session.status).toBe("ACTIVE");
    expect(next.session.visitId).toBe("visit-bbbb");
    expect(next.order.status).toBe("PENDING_CONFIRMATION");
    expect((await orderService.listOrders()).length).toBe(2);
  });

  await itAsync("bill request transitions the session and creates exactly one task even if called twice", async () => {
    freshStore();
    await orderService.submitOrder({ tableNumber: "5", items: items(), total: 10 });
    await orderService.requestBill("5");
    await orderService.requestBill("5"); // second tap — must not duplicate

    const { session } = await orderService.getTrackableSessionWithOrders("5");
    expect(session?.status).toBe("BILL_REQUESTED");
    const billTasks = (await taskService.listTasks()).filter((t) => t.type === "bill_requested");
    expect(billTasks.length).toBe(1);
  });

  printResults();
}

await main();
