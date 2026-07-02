/**
 * Storage-layer regression tests — orders, table sessions, waiter tasks, analytics.
 *
 * Locks in the fixes from the full app audit:
 *   - purgeOldHistory never deletes orders belonging to an open session
 *   - revenue / average / popular items exclude CANCELLED orders
 *   - completeTasksForOrders keeps undelivered ready_to_serve tasks active
 *   - additional-order task dedup
 *   - session lifecycle invariants
 *
 * Run: node --experimental-strip-types src/lib/tests/storage-flows.test.ts
 */

// ── Browser globals shim (must run before dynamic imports) ────────────────────
const mem = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
(globalThis as Record<string, unknown>).window = Object.assign(new EventTarget(), {
  localStorage: (globalThis as Record<string, unknown>).localStorage,
});

const { describe, it, expect, printResults } = await import("../assistant/tests/runner.ts");
const orders = await import("../orders.ts");
const sessions = await import("../tableSession.ts");
const tasks = await import("../waiterTasks.ts");
const analytics = await import("../analytics.ts");

function reset() {
  mem.clear();
}

function makeOrder(total = 10, table = "5") {
  return orders.createOrder({
    tableNumber: table,
    items: [{ productId: "p1", name: "Pica", price: total, quantity: 1 }],
    total,
  });
}

/** Rewrite an order's createdAt to `minutes` minutes ago (test-only). */
function ageOrder(id: string, minutes: number) {
  const raw = JSON.parse(mem.get("dzukai-orders")!) as { id: string; createdAt: string }[];
  const o = raw.find((r) => r.id === id)!;
  o.createdAt = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  mem.set("dzukai-orders", JSON.stringify(raw));
}

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 1 — purge vs open sessions (CRITICAL fix)
// ══════════════════════════════════════════════════════════════════════════════

describe("purgeOldHistory session guard", () => {
  it("keeps an old COMPLETED order while its session is still open", () => {
    reset();
    const o = makeOrder(10);
    sessions.addOrderToSession(o.id, "5");
    orders.updateOrderStatus(o.id, "COMPLETED");
    ageOrder(o.id, 40);

    const removed = orders.purgeOldHistory();
    expect(removed).toBe(0);
    expect(orders.getOrder(o.id)?.id).toBe(o.id);
  });

  it("purges the same order once the session is paid", () => {
    reset();
    const o = makeOrder(10);
    sessions.addOrderToSession(o.id, "5");
    orders.updateOrderStatus(o.id, "COMPLETED");
    ageOrder(o.id, 40);
    sessions.markSessionPaid("WAITER");

    const removed = orders.purgeOldHistory();
    expect(removed).toBe(1);
    expect(orders.getOrder(o.id)).toBeFalsy();
  });

  it("never purges active orders regardless of age", () => {
    reset();
    const o = makeOrder(10);
    ageOrder(o.id, 120);
    expect(orders.purgeOldHistory()).toBe(0);
    expect(orders.getOrder(o.id)?.status).toBe("NEW");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 2 — analytics exclude cancelled (CRITICAL fix)
// ══════════════════════════════════════════════════════════════════════════════

describe("analytics vs cancelled orders", () => {
  it("revenue excludes cancelled orders", () => {
    reset();
    makeOrder(20);
    const bad = makeOrder(99);
    orders.updateOrderStatus(bad.id, "CANCELLED");
    expect(analytics.calculateRevenue(orders.listOrders())).toBe(20);
  });

  it("average order value excludes cancelled orders", () => {
    reset();
    makeOrder(20);
    makeOrder(40);
    const bad = makeOrder(999);
    orders.updateOrderStatus(bad.id, "CANCELLED");
    expect(analytics.averageOrderValue(orders.listOrders())).toBe(30);
  });

  it("popular items exclude cancelled orders' dishes", () => {
    reset();
    makeOrder(20);
    const bad = orders.createOrder({
      tableNumber: "9",
      items: [{ productId: "ghost", name: "Atšaukta pica", price: 99, quantity: 5 }],
      total: 495,
    });
    orders.updateOrderStatus(bad.id, "CANCELLED");
    const popular = analytics.getPopularItems(orders.listOrders());
    expect(popular.some((p) => p.productId === "ghost")).toBeFalsy();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 3 — payment must not swallow food-delivery tasks (HIGH fix)
// ══════════════════════════════════════════════════════════════════════════════

describe("completeTasksForOrders scope", () => {
  it("keeps active ready_to_serve tasks, completes bill tasks", () => {
    reset();
    const o = makeOrder(15);
    sessions.addOrderToSession(o.id, "5");
    // Kitchen finishes food → ready task appears
    orders.updateOrderStatus(o.id, "READY");
    tasks.syncReadyToServeTasks(orders.listOrders());
    // Customer requests bill
    tasks.createUniqueTask(`session:test:bill`, {
      type: "bill_requested", orderId: o.id, tableNumber: "5",
    });

    tasks.completeTasksForOrders([o.id]);

    const all = tasks.listTasks();
    const food = all.find((t) => t.type === "ready_to_serve")!;
    const bill = all.find((t) => t.type === "bill_requested")!;
    expect(food.status).toBe("waiting"); // food still must be delivered
    expect(bill.status).toBe("completed");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 4 — session lifecycle
// ══════════════════════════════════════════════════════════════════════════════

describe("table session invariants", () => {
  it("at most one open session; new orders join the open one", () => {
    reset();
    const o1 = makeOrder(10);
    const o2 = makeOrder(12);
    const s1 = sessions.addOrderToSession(o1.id, "5");
    const s2 = sessions.addOrderToSession(o2.id, "5");
    expect(s1.id).toBe(s2.id);
    expect(s2.orderIds).toHaveLength(2);
  });

  it("markSessionPaid closes the session and records the method", () => {
    reset();
    const o = makeOrder(10);
    sessions.addOrderToSession(o.id, "5");
    const paid = sessions.markSessionPaid("APP");
    expect(paid?.status).toBe("PAID");
    expect(paid?.paymentMethod).toBe("APP");
    expect(sessions.getActiveSession()).toBeFalsy();
  });

  it("adding an order after payment starts a NEW session", () => {
    reset();
    const o1 = makeOrder(10);
    const s1 = sessions.addOrderToSession(o1.id, "5");
    sessions.markSessionPaid("APP");
    const o2 = makeOrder(12);
    const s2 = sessions.addOrderToSession(o2.id, "5");
    expect(s2.id).not.toBe(s1.id);
    expect(s2.orderIds).toHaveLength(1);
  });

  it("allOrdersPaid reflects per-order payments", () => {
    reset();
    const o1 = makeOrder(10);
    const o2 = makeOrder(12);
    expect(orders.allOrdersPaid([o1.id, o2.id])).toBeFalsy();
    orders.markOrderPaid(o1.id);
    expect(orders.allOrdersPaid([o1.id, o2.id])).toBeFalsy();
    orders.markOrderPaid(o2.id);
    expect(orders.allOrdersPaid([o1.id, o2.id])).toBeTruthy();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 5 — task dedup + status derivation
// ══════════════════════════════════════════════════════════════════════════════

describe("task dedup", () => {
  it("createUniqueTask with the same key creates only one task", () => {
    reset();
    const o = makeOrder(10);
    const a = tasks.createUniqueTask(`order:${o.id}:additional_order`, {
      type: "additional_order", orderId: o.id, tableNumber: "5",
    });
    const b = tasks.createUniqueTask(`order:${o.id}:additional_order`, {
      type: "additional_order", orderId: o.id, tableNumber: "5",
    });
    expect(a).toBeTruthy();
    expect(b).toBeFalsy();
    expect(tasks.listTasks()).toHaveLength(1);
  });
});

describe("order status derivation", () => {
  it("together: READY only when all items READY", () => {
    const items = [
      { productId: "a", name: "A", price: 1, quantity: 1, itemStatus: "READY" as const },
      { productId: "b", name: "B", price: 1, quantity: 1, itemStatus: "PREPARING" as const },
    ];
    expect(orders.deriveOrderStatus(items, "together")).toBe("PREPARING");
    items[1].itemStatus = "READY" as never;
    expect(orders.deriveOrderStatus(items, "together")).toBe("READY");
  });

  it("as_ready: READY as soon as one item is READY", () => {
    const items = [
      { productId: "a", name: "A", price: 1, quantity: 1, itemStatus: "READY" as const },
      { productId: "b", name: "B", price: 1, quantity: 1, itemStatus: "NEW" as const },
    ];
    expect(orders.deriveOrderStatus(items, "as_ready")).toBe("READY");
  });

  it("all items cancelled → order CANCELLED", () => {
    const items = [
      { productId: "a", name: "A", price: 1, quantity: 1, itemStatus: "CANCELLED" as const },
    ];
    expect(orders.deriveOrderStatus(items)).toBe("CANCELLED");
  });

  it("invalid ids: getOrder / updateItemStatus return undefined, no throw", () => {
    reset();
    expect(orders.getOrder("NOPE")).toBeFalsy();
    expect(orders.updateItemStatus("NOPE", "x", "READY")).toBeFalsy();
    expect(orders.updateOrderStatus("NOPE", "READY")).toBeFalsy();
  });
});

printResults();
