/**
 * Analytics helpers — pure functions over Order[].
 * No side effects, no localStorage reads. Always pass orders in from the caller.
 * Designed so every function can be swapped for a backend call later.
 */

import type { Order, OrderStatus, WaiterTask } from "./orderTypes";

// ── Time helpers ──────────────────────────────────────────────────────────────

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function getTodayOrders(orders: Order[]): Order[] {
  const midnight = startOfToday().getTime();
  return orders.filter((o) => new Date(o.createdAt).getTime() >= midnight);
}

/** Local YYYY-MM-DD for a date — the calendar filter's day key. */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Orders created on one specific local calendar day (admin's date-picker filter). */
export function getOrdersForDate(orders: Order[], day: string): Order[] {
  return orders.filter((o) => dateKey(new Date(o.createdAt)) === day);
}

function isToday(iso: string | undefined): boolean {
  if (!iso) return false;
  return new Date(iso).getTime() >= startOfToday().getTime();
}

// ── Staff activity ────────────────────────────────────────────────────────────

export interface StaffActivity {
  username: string;
  /** Kitchen: items marked READY today. */
  preparedCount: number;
  /** Waiter: items marked delivered (COMPLETED) today. */
  deliveredCount: number;
  /** Waiter: bill/call/etc. tasks resolved today. */
  tasksCompletedCount: number;
}

/**
 * Per-account "what did I do today" tally, keyed by staff account id.
 * Reads the staff stamps written by updateItemStatus / completeItemsDelivery /
 * updateTaskStatus / completeTasksForOrders — nothing here is stored
 * separately, it's derived fresh from orders and tasks each time.
 */
export function getStaffActivityToday(orders: Order[], tasks: WaiterTask[]): Map<string, StaffActivity> {
  const activity = new Map<string, StaffActivity>();

  const bump = (id: string, username: string, field: keyof Omit<StaffActivity, "username">) => {
    const entry = activity.get(id) ?? { username, preparedCount: 0, deliveredCount: 0, tasksCompletedCount: 0 };
    entry[field] += 1;
    activity.set(id, entry);
  };

  for (const order of orders) {
    for (const item of order.items) {
      if (item.preparedBy && isToday(item.preparedAt)) {
        bump(item.preparedBy.id, item.preparedBy.username, "preparedCount");
      }
      if (item.deliveredBy && isToday(item.deliveredAt)) {
        bump(item.deliveredBy.id, item.deliveredBy.username, "deliveredCount");
      }
    }
  }

  for (const task of tasks) {
    if (task.completedBy && task.status === "completed" && isToday(task.updatedAt)) {
      bump(task.completedBy.id, task.completedBy.username, "tasksCompletedCount");
    }
  }

  return activity;
}

// ── Revenue ───────────────────────────────────────────────────────────────────

/**
 * Orders that count toward money metrics — cancelled orders bring no revenue,
 * and an order still awaiting waiter confirmation isn't real yet either.
 */
function revenueOrders(orders: Order[]): Order[] {
  return orders.filter(
    (o) => o.status !== "CANCELLED" && o.status !== "PENDING_CONFIRMATION"
  );
}

export function calculateRevenue(orders: Order[]): number {
  return revenueOrders(orders).reduce((sum, o) => sum + o.total, 0);
}

export function averageOrderValue(orders: Order[]): number {
  const counted = revenueOrders(orders);
  if (counted.length === 0) return 0;
  return calculateRevenue(counted) / counted.length;
}

// ── Status counts ─────────────────────────────────────────────────────────────

export interface KitchenStats {
  newCount: number;
  preparingCount: number;
  readyCount: number;
  deliveringCount: number;
  completedCount: number;
  cancelledCount: number;
  activeCount: number;
}

export function getKitchenStats(orders: Order[]): KitchenStats {
  const byStatus = (s: OrderStatus) => orders.filter((o) => o.status === s).length;
  const newCount = byStatus("NEW");
  const preparingCount = byStatus("PREPARING");
  const readyCount = byStatus("READY");
  const deliveringCount = byStatus("DELIVERING");
  const completedCount = byStatus("COMPLETED");
  const cancelledCount = byStatus("CANCELLED");
  return {
    newCount,
    preparingCount,
    readyCount,
    deliveringCount,
    completedCount,
    cancelledCount,
    activeCount: newCount + preparingCount + readyCount + deliveringCount,
  };
}

// ── Popular items ─────────────────────────────────────────────────────────────

export interface PopularItem {
  productId: string;
  name: string;
  quantitySold: number;
  revenue: number;
}

export function getPopularItems(orders: Order[], topN = 5): PopularItem[] {
  const map = new Map<string, PopularItem>();

  for (const order of revenueOrders(orders)) {
    for (const item of order.items) {
      if (item.itemStatus === "CANCELLED") continue; // cancelled dish ≠ sold dish
      const existing = map.get(item.productId);
      if (existing) {
        existing.quantitySold += item.quantity;
        existing.revenue += item.price * item.quantity;
      } else {
        map.set(item.productId, {
          productId: item.productId,
          name: item.name,
          quantitySold: item.quantity,
          revenue: item.price * item.quantity,
        });
      }
    }
  }

  return Array.from(map.values())
    .sort((a, b) => b.quantitySold - a.quantitySold)
    .slice(0, topN);
}

// ── Recent orders ─────────────────────────────────────────────────────────────

export function getRecentOrders(orders: Order[], n = 10): Order[] {
  return [...orders]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, n);
}
