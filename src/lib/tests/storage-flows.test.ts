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
const i18n = await import("../i18n.ts");

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
// GROUP 4b — payment must NOT end order tracking (THE bug this fixes)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Mirror of store.clearCartStorage() — the real one lives in a "use client"
 * module that can't be imported here, but it's a plain localStorage write.
 */
function clearCartStorage() {
  const raw = JSON.parse(mem.get("dzukai-cart") ?? "{}");
  raw.state = { ...(raw.state ?? {}), items: [] };
  mem.set("dzukai-cart", JSON.stringify(raw));
}

/** Replicates the customer in-app payment flow from order/page.tsx. */
function payFullSession(session: { orderIds: string[] }) {
  session.orderIds.forEach((oid) => orders.markOrderPaid(oid));
  if (orders.allOrdersPaid(session.orderIds)) {
    sessions.markSessionPaid("APP");
    clearCartStorage();
  }
}

describe("payment keeps the order trackable", () => {
  it("full lifecycle: pay → cart empty → still tracked → closes only on completion", () => {
    reset();

    // 1. create order
    const o = makeOrder(18);
    const session = sessions.addOrderToSession(o.id, "7");

    // 2. pay order (before any food is delivered)
    payFullSession(session);

    // 3. cart becomes empty
    // (seed a non-empty cart first so we prove clearing actually empties it)
    mem.set("dzukai-cart", JSON.stringify({ state: { items: [{ x: 1 }] }, version: 0 }));
    clearCartStorage();
    const cart = JSON.parse(mem.get("dzukai-cart")!);
    expect(cart.state.items).toHaveLength(0);

    // 4. active order still visible despite being paid
    const tracked = sessions.getTrackableSession();
    expect(tracked?.id).toBe(session.id);
    expect(tracked?.paymentStatus).toBe("PAID");
    expect(orders.getOrder(o.id)?.isPaid).toBeTruthy();
    // Receipt needs a payment timestamp so the paid total can show "Apmokėta · HH:MM".
    expect(typeof orders.getOrder(o.id)?.paidAt).toBe("string");

    // 5. tracking still updates through READY / DELIVERING / COMPLETED
    orders.updateOrderStatus(o.id, "READY");
    expect(orders.getOrder(o.id)?.status).toBe("READY");
    expect(sessions.getTrackableSession()?.id).toBe(session.id); // still tracked

    orders.updateOrderStatus(o.id, "DELIVERING");
    expect(orders.getOrder(o.id)?.status).toBe("DELIVERING");
    expect(sessions.getTrackableSession()?.id).toBe(session.id); // still tracked

    // 6. session leaves tracking ONLY after final completion
    orders.updateOrderStatus(o.id, "COMPLETED");
    expect(orders.getOrder(o.id)?.status).toBe("COMPLETED");
    expect(sessions.getTrackableSession()).toBeFalsy(); // now, and only now, gone
  });

  it("paid order is not removed from tracking while a sibling is still cooking", () => {
    reset();
    const o1 = makeOrder(10);
    const o2 = makeOrder(12);
    const session = sessions.addOrderToSession(o1.id, "7");
    sessions.addOrderToSession(o2.id, "7");

    // Pay the whole session up front.
    payFullSession(session);
    expect(sessions.getTrackableSession()?.orderIds).toHaveLength(2);

    // First order delivered, second still on its way → still trackable.
    orders.updateOrderStatus(o1.id, "COMPLETED");
    expect(sessions.getTrackableSession()?.id).toBe(session.id);

    // Both delivered → tracking ends.
    orders.updateOrderStatus(o2.id, "COMPLETED");
    expect(sessions.getTrackableSession()).toBeFalsy();
  });

  it("purge keeps a paid session's completed order while a sibling is undelivered", () => {
    reset();
    const o1 = makeOrder(10); // will be completed + aged
    const o2 = makeOrder(12); // stays in the kitchen
    const session = sessions.addOrderToSession(o1.id, "7");
    sessions.addOrderToSession(o2.id, "7");
    payFullSession(session);

    orders.updateOrderStatus(o1.id, "COMPLETED");
    orders.updateOrderStatus(o2.id, "PREPARING");
    ageOrder(o1.id, 40);

    // o1 is old + completed but its session is still tracking o2 → must survive.
    expect(orders.purgeOldHistory()).toBe(0);
    expect(orders.getOrder(o1.id)?.id).toBe(o1.id);
  });

  it("getActiveSession still excludes a paid session (new orders start fresh)", () => {
    reset();
    const o = makeOrder(10);
    const s1 = sessions.addOrderToSession(o.id, "7");
    payFullSession(s1);
    // Paid → no longer 'open' for new orders, though still trackable.
    expect(sessions.getActiveSession()).toBeFalsy();
    expect(sessions.getTrackableSession()?.id).toBe(s1.id);
    // Ordering again opens a brand-new session.
    const o2 = makeOrder(5);
    const s2 = sessions.addOrderToSession(o2.id, "7");
    expect(s2.id).not.toBe(s1.id);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 4c — customer/waiter/kitchen see ONE shared active order across the flow
// ══════════════════════════════════════════════════════════════════════════════

const ACTIVE = ["NEW", "PREPARING", "READY", "DELIVERING"];

/** Mirrors the cart page's screen decision (post client storage-read). */
function cartScreen(cartItemCount: number): "cart" | "tracking" | "empty" {
  if (cartItemCount > 0) return "cart";
  return sessions.getTrackableSession() ? "tracking" : "empty";
}

/** What the customer's /order page would resolve to on a fresh mount / refresh. */
function refreshCustomerTracking() {
  // getTrackableSession re-reads storage every call — a fresh page mount is
  // exactly this. No React state is carried across a refresh.
  return sessions.getTrackableSession();
}

describe("tracking survives payment, cart clear and refresh (shared active order)", () => {
  it("full 10-step flow keeps one order visible everywhere until COMPLETED", () => {
    reset();

    // 1. create order
    const o = makeOrder(22.1);
    const session = sessions.addOrderToSession(o.id, "5");
    orders.updateOrderStatus(o.id, "PREPARING"); // kitchen picks it up

    // 2. pay
    payFullSession(session);

    // 3. cart becomes empty
    mem.set("dzukai-cart", JSON.stringify({ state: { items: [{ x: 1 }] }, version: 0 }));
    clearCartStorage();
    expect(JSON.parse(mem.get("dzukai-cart")!).state.items).toHaveLength(0);

    // 4. customer still sees tracking (cart empty must NOT hide it)
    expect(cartScreen(0)).toBe("tracking");
    expect(sessions.getTrackableSession()?.id).toBe(session.id);

    // 5. waiter references the SAME order id (ready task flows off it)
    orders.updateOrderStatus(o.id, "READY");
    tasks.syncReadyToServeTasks(orders.listOrders());
    const waiterTask = tasks.listTasks().find((t) => t.type === "ready_to_serve");
    expect(waiterTask?.orderId).toBe(o.id);
    expect(session.orderIds).toContain(o.id); // same session the customer tracks

    // 6. kitchen references the SAME order (appears in the active order list)
    const kitchenQueue = orders.listOrders().filter((x) => ACTIVE.includes(x.status));
    expect(kitchenQueue.some((x) => x.id === o.id)).toBeTruthy();

    // 7 + 8. refresh customer page → tracking still resolves to the same session
    expect(refreshCustomerTracking()?.id).toBe(session.id);
    expect(cartScreen(0)).toBe("tracking");

    // tracking updates through DELIVERING and stays visible the whole time
    orders.startItemsDelivery(o.id, [o.items[0].productId]);
    expect(orders.getOrder(o.id)?.status).toBe("DELIVERING");
    expect(cartScreen(0)).toBe("tracking");

    // 9. complete delivery
    orders.completeItemsDelivery(o.id, [o.items[0].productId]);
    expect(orders.getOrder(o.id)?.status).toBe("COMPLETED");

    // 10. only NOW does the empty cart show — and it survives a refresh too
    expect(cartScreen(0)).toBe("empty");
    expect(refreshCustomerTracking()).toBeFalsy();
  });

  it("with items still in the cart, the cart view always wins over tracking", () => {
    reset();
    const o = makeOrder(10);
    sessions.addOrderToSession(o.id, "5");
    // A non-empty cart shows the cart itself, regardless of an active session.
    expect(cartScreen(2)).toBe("cart");
  });

  it("no session at all → empty cart is correct", () => {
    reset();
    expect(cartScreen(0)).toBe("empty");
  });

  it("tracking is driven by ORDER status, not session lifecycle status", () => {
    reset();
    const o = makeOrder(15);
    const session = sessions.addOrderToSession(o.id, "5");
    payFullSession(session); // session → PAID
    orders.updateOrderStatus(o.id, "DELIVERING"); // food on its way, not delivered

    // Even if the session gets CLOSED (e.g. waiter action / legacy state),
    // an undelivered order MUST keep the session trackable.
    sessions.updateSessionStatus("BILL_REQUESTED"); // no-op: no open session
    sessions.closeSession(); // no-op: no open session either
    // Force a terminal CLOSED status directly to simulate legacy/edge data.
    const raw = JSON.parse(mem.get("dzukai-table-sessions")!);
    raw[0].status = "CLOSED";
    mem.set("dzukai-table-sessions", JSON.stringify(raw));

    expect(orders.hasActiveOrders()).toBeTruthy();
    expect(sessions.getTrackableSession()?.id).toBe(session.id); // still tracked
    expect(cartScreen(0)).toBe("tracking");

    // Only delivery ends it.
    orders.updateOrderStatus(o.id, "COMPLETED");
    expect(orders.hasActiveOrders()).toBeFalsy();
    expect(sessions.getTrackableSession()).toBeFalsy();
    expect(cartScreen(0)).toBe("empty");
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

describe("customer order tracking translations", () => {
  it("provides English labels for every order status", () => {
    expect(i18n.orderStatusLabels.en).toEqual({
      NEW: "New",
      PREPARING: "Preparing",
      READY: "Ready",
      DELIVERING: "Being served",
      COMPLETED: "Completed",
      CANCELLED: "Cancelled",
    });
  });

  it("localizes status descriptions, ETA text, and serving labels", () => {
    expect(i18n.orderStatusMessages.en.NEW).toContain("15 minutes");
    expect(i18n.orderStatusMessages.en.PREPARING).toContain("10 minutes");
    expect(i18n.servingPreferenceLabels.en.together.short).toBe("All together");
    expect(i18n.servingPreferenceLabels.en.as_ready.long).toContain("as soon as it is ready");
  });

  it("keeps customer order-screen copy available in English", () => {
    const copy = i18n.t.en;
    expect(copy.ordered_dishes).toBe("Ordered dishes");
    expect(copy.serving).toBe("Serving");
    expect(copy.payment_success_tracking).toContain("Payment successful");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP — staff activity stamps (who did what today)
// ══════════════════════════════════════════════════════════════════════════════

describe("staff stamps on order items", () => {
  it("stamps preparedBy/preparedAt only when moving to READY, not PREPARING", () => {
    reset();
    const o = makeOrder(10);
    const cook = { id: "acc_1", username: "Karolis" };
    orders.updateItemStatus(o.id, "p1", "PREPARING", cook);
    let item = orders.getOrder(o.id)!.items[0];
    expect(item.preparedBy).toBeFalsy();

    orders.updateItemStatus(o.id, "p1", "READY", cook);
    item = orders.getOrder(o.id)!.items[0];
    expect(item.preparedBy?.username).toBe("Karolis");
    expect(typeof item.preparedAt).toBe("string");
  });

  it("stamps deliveredBy/deliveredAt when a waiter completes delivery", () => {
    reset();
    const o = makeOrder(10);
    const waiter = { id: "acc_2", username: "Rytis" };
    orders.updateItemStatus(o.id, "p1", "READY");
    orders.startItemsDelivery(o.id, ["p1"]);
    orders.completeItemsDelivery(o.id, ["p1"], waiter);
    const item = orders.getOrder(o.id)!.items[0];
    expect(item.deliveredBy?.username).toBe("Rytis");
    expect(typeof item.deliveredAt).toBe("string");
  });

  it("stays unstamped when no staff is passed (e.g. unauthenticated dev use)", () => {
    reset();
    const o = makeOrder(10);
    orders.updateItemStatus(o.id, "p1", "READY");
    expect(orders.getOrder(o.id)!.items[0].preparedBy).toBeFalsy();
  });
});

describe("staff stamps on waiter tasks", () => {
  it("stamps completedBy on updateTaskStatus('completed')", () => {
    reset();
    const o = makeOrder(10);
    const waiter = { id: "acc_2", username: "Rytis" };
    const task = tasks.createUniqueTask(`order:${o.id}:waiter_called`, {
      type: "waiter_called", orderId: o.id, tableNumber: "5",
    })!;
    tasks.updateTaskStatus(task.id, "completed", waiter);
    expect(tasks.listTasks().find((t) => t.id === task.id)?.completedBy?.username).toBe("Rytis");
  });

  it("stamps completedBy on completeTasksForOrders", () => {
    reset();
    const o = makeOrder(10);
    const waiter = { id: "acc_2", username: "Rytis" };
    tasks.createUniqueTask(`session:test:bill2`, {
      type: "bill_requested", orderId: o.id, tableNumber: "5",
    });
    tasks.completeTasksForOrders([o.id], waiter);
    const bill = tasks.listTasks().find((t) => t.type === "bill_requested")!;
    expect(bill.completedBy?.username).toBe("Rytis");
  });
});

describe("getStaffActivityToday", () => {
  it("tallies prepared, delivered and completed-task counts per staff id", () => {
    reset();
    const cook = { id: "acc_1", username: "Karolis" };
    const waiter = { id: "acc_2", username: "Rytis" };

    const o1 = makeOrder(10);
    orders.updateItemStatus(o1.id, "p1", "PREPARING", cook);
    orders.updateItemStatus(o1.id, "p1", "READY", cook);
    orders.startItemsDelivery(o1.id, ["p1"]);
    orders.completeItemsDelivery(o1.id, ["p1"], waiter);

    const o2 = makeOrder(8);
    orders.updateItemStatus(o2.id, "p1", "PREPARING", cook);
    orders.updateItemStatus(o2.id, "p1", "READY", cook);

    const task = tasks.createUniqueTask(`order:${o2.id}:waiter_called`, {
      type: "waiter_called", orderId: o2.id, tableNumber: "5",
    })!;
    tasks.updateTaskStatus(task.id, "completed", waiter);

    const activity = analytics.getStaffActivityToday(orders.listOrders(), tasks.listTasks());
    expect(activity.get("acc_1")?.preparedCount).toBe(2);
    expect(activity.get("acc_2")?.deliveredCount).toBe(1);
    expect(activity.get("acc_2")?.tasksCompletedCount).toBe(1);
  });

  it("returns an empty map when nothing is stamped", () => {
    reset();
    makeOrder(10);
    const activity = analytics.getStaffActivityToday(orders.listOrders(), tasks.listTasks());
    expect(activity.size).toBe(0);
  });
});

printResults();
