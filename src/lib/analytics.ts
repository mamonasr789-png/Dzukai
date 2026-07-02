/**
 * Analytics helpers — pure functions over Order[].
 * No side effects, no localStorage reads. Always pass orders in from the caller.
 * Designed so every function can be swapped for a backend call later.
 */

import type { Order, OrderStatus } from "./orders";

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

// ── Revenue ───────────────────────────────────────────────────────────────────

/** Orders that count toward money metrics — cancelled orders bring no revenue. */
function revenueOrders(orders: Order[]): Order[] {
  return orders.filter((o) => o.status !== "CANCELLED");
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
