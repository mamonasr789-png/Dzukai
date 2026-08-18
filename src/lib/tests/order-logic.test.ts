/**
 * Pure-function regression tests for order/task logic that has no server or
 * localStorage dependency — deriveOrderStatus, analytics helpers, i18n copy.
 * Server-side read-modify-write flows (submitOrder, settleSessionByWaiter,
 * task dedup, staff stamping, etc.) are covered by order-service.test.ts.
 *
 * Run: node --experimental-strip-types src/lib/tests/order-logic.test.ts
 */

const { describe, it, expect, printResults } = await import("../assistant/tests/runner.ts");
const { deriveOrderStatus } = await import("../orderTypes.ts");
const analytics = await import("../analytics.ts");
const i18n = await import("../i18n.ts");

import type { Order, OrderItem, WaiterTask } from "../orderTypes.ts";

let seq = 0;
function makeOrder(overrides: Partial<Order> & { items: OrderItem[] }): Order {
  seq += 1;
  return {
    id: `o${seq}`,
    tableNumber: "5",
    items: overrides.items,
    total: overrides.total ?? overrides.items.reduce((s, i) => s + i.price * i.quantity, 0),
    status: overrides.status ?? "NEW",
    servingPreference: overrides.servingPreference ?? "together",
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
    isPaid: overrides.isPaid ?? false,
    notes: overrides.notes ?? "",
    language: overrides.language ?? "lt",
  };
}

function item(status: OrderItem["itemStatus"], over: Partial<OrderItem> = {}): OrderItem {
  return { productId: over.productId ?? "p1", name: "Pica", price: 10, quantity: 1, itemStatus: status, ...over };
}

describe("order status derivation", () => {
  it("together: READY only when all items READY", () => {
    const items = [item("READY"), item("PREPARING", { productId: "b" })];
    expect(deriveOrderStatus(items, "together")).toBe("PREPARING");
    items[1] = item("READY", { productId: "b" });
    expect(deriveOrderStatus(items, "together")).toBe("READY");
  });

  it("as_ready: READY as soon as one item is READY", () => {
    const items = [item("READY"), item("NEW", { productId: "b" })];
    expect(deriveOrderStatus(items, "as_ready")).toBe("READY");
  });

  it("all items cancelled → order CANCELLED", () => {
    expect(deriveOrderStatus([item("CANCELLED")])).toBe("CANCELLED");
  });
});

describe("analytics vs cancelled/pending orders", () => {
  it("revenue excludes cancelled orders", () => {
    const good = makeOrder({ items: [item("NEW")], total: 20 });
    const bad = makeOrder({ items: [item("CANCELLED")], total: 99, status: "CANCELLED" });
    expect(analytics.calculateRevenue([good, bad])).toBe(20);
  });

  it("average order value excludes cancelled orders", () => {
    const a = makeOrder({ items: [item("NEW")], total: 20 });
    const b = makeOrder({ items: [item("NEW")], total: 40 });
    const bad = makeOrder({ items: [item("CANCELLED")], total: 999, status: "CANCELLED" });
    expect(analytics.averageOrderValue([a, b, bad])).toBe(30);
  });

  it("popular items exclude cancelled orders' dishes", () => {
    const good = makeOrder({ items: [item("NEW")], total: 20 });
    const bad = makeOrder({
      items: [item("CANCELLED", { productId: "ghost", name: "Atšaukta pica", price: 99, quantity: 5 })],
      total: 495,
      status: "CANCELLED",
    });
    const popular = analytics.getPopularItems([good, bad]);
    expect(popular.some((p) => p.productId === "ghost")).toBeFalsy();
  });

  it("revenue excludes orders still awaiting waiter confirmation", () => {
    const good = makeOrder({ items: [item("NEW")], total: 20 });
    const pending = makeOrder({ items: [item("NEW")], total: 50, status: "PENDING_CONFIRMATION" });
    expect(analytics.calculateRevenue([good, pending])).toBe(20);
  });
});

describe("getStaffActivityToday", () => {
  it("tallies prepared, delivered and completed-task counts per staff id", () => {
    const cook = { id: "acc_1", username: "Karolis" };
    const waiter = { id: "acc_2", username: "Rytis" };
    const now = new Date().toISOString();

    const o1 = makeOrder({
      items: [item("COMPLETED", { preparedBy: cook, preparedAt: now, deliveredBy: waiter, deliveredAt: now })],
    });
    const o2 = makeOrder({ items: [item("READY", { preparedBy: cook, preparedAt: now })] });

    const task: WaiterTask = {
      id: "t1",
      type: "waiter_called",
      orderId: o2.id,
      tableNumber: "5",
      status: "completed",
      triggeredBy: `order:${o2.id}:waiter_called`,
      items: [],
      createdAt: now,
      updatedAt: now,
      completedBy: waiter,
    };

    const activity = analytics.getStaffActivityToday([o1, o2], [task]);
    expect(activity.get("acc_1")?.preparedCount).toBe(2);
    expect(activity.get("acc_2")?.deliveredCount).toBe(1);
    expect(activity.get("acc_2")?.tasksCompletedCount).toBe(1);
  });

  it("returns an empty map when nothing is stamped", () => {
    const o = makeOrder({ items: [item("NEW")] });
    expect(analytics.getStaffActivityToday([o], []).size).toBe(0);
  });
});

describe("admin calendar filter", () => {
  it("dateKey formats a local date as YYYY-MM-DD", () => {
    expect(analytics.dateKey(new Date(2026, 2, 5))).toBe("2026-03-05");
  });

  it("getOrdersForDate returns only orders created on that local day", () => {
    const yesterday = makeOrder({
      items: [item("NEW")],
      createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    });
    const today = makeOrder({ items: [item("NEW")] });

    const todayKey = analytics.dateKey(new Date());
    const forToday = analytics.getOrdersForDate([yesterday, today], todayKey);
    expect(forToday.map((o) => o.id)).toEqual([today.id]);
  });

  it("returns nothing for a day with no orders", () => {
    const o = makeOrder({ items: [item("NEW")] });
    expect(analytics.getOrdersForDate([o], "1999-01-01")).toEqual([]);
  });
});

describe("customer order tracking translations", () => {
  it("provides English labels for every order status", () => {
    expect(i18n.orderStatusLabels.en).toEqual({
      PENDING_CONFIRMATION: "Awaiting confirmation",
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

printResults();
