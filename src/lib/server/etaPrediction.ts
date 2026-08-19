import "server-only";

import { listOrders } from "./orderService";
import { getStaffAccountStore } from "./staffAccountStore";
import { ACTIVE_ORDER_STATUSES, type Order } from "../orderTypes";

/**
 * Preliminary "how long until this reaches the table" estimate for the
 * customer-facing order-tracking page, replacing the old fixed "apie 15
 * min." copy. Two ingredients:
 *  - a historical per-dish average prep time (createdAt → preparedAt) plus
 *    an overall average delivery time (preparedAt → deliveredAt), and
 *  - the CURRENT kitchen queue depth relative to how many kitchen accounts
 *    are online right now, which stretches the estimate when the kitchen is
 *    busier than the historical average assumes.
 *
 * Both ingredients come from a full pull of the orders collection, which is
 * too expensive to redo on every ~2s customer poll — everything here is
 * cached for a couple of minutes. That staleness is fine for a number this
 * page always labels as a preliminary estimate, not a guarantee.
 */

const CACHE_TTL_MS = 2 * 60_000;
const HISTORY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // recent performance predicts near-term better than all-time
const DEFAULT_PREP_MINUTES = 15;
const DEFAULT_DELIVERY_MINUTES = 5;
const MINIMUM_ETA_MINUTES = 2;

/** 90s heartbeat window — same convention as StaffAccountsPanel's online dot. */
const ONLINE_WINDOW_MS = 90_000;

interface EtaModel {
  avgPrepMinutesByProduct: Map<string, number>;
  overallAvgPrepMinutes: number;
  avgDeliveryMinutes: number;
  activeOrderCount: number;
  onlineKitchenCount: number;
}

let cache: { model: EtaModel; computedAt: number } | null = null;

function minutesBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 60_000;
}

async function computeModel(): Promise<EtaModel> {
  const [allOrders, staffStore] = await Promise.all([listOrders(), getStaffAccountStore()]);
  const cutoff = Date.now() - HISTORY_WINDOW_MS;
  const recent = allOrders.filter((o) => new Date(o.createdAt).getTime() >= cutoff);

  const prepByProduct = new Map<string, number[]>();
  const allPrepTimes: number[] = [];
  const deliveryTimes: number[] = [];
  for (const o of recent) {
    for (const item of o.items) {
      if (item.preparedAt) {
        const minutes = minutesBetween(o.createdAt, item.preparedAt);
        if (minutes >= 0 && minutes < 180) {
          allPrepTimes.push(minutes);
          const list = prepByProduct.get(item.productId) ?? [];
          list.push(minutes);
          prepByProduct.set(item.productId, list);
        }
      }
      if (item.preparedAt && item.deliveredAt) {
        const minutes = minutesBetween(item.preparedAt, item.deliveredAt);
        if (minutes >= 0 && minutes < 120) deliveryTimes.push(minutes);
      }
    }
  }
  const avg = (arr: number[], fallback: number) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : fallback);

  const avgPrepMinutesByProduct = new Map<string, number>();
  for (const [productId, times] of prepByProduct) avgPrepMinutesByProduct.set(productId, avg(times, DEFAULT_PREP_MINUTES));

  const activeOrderCount = allOrders.filter((o) => ACTIVE_ORDER_STATUSES.includes(o.status)).length;

  let onlineKitchenCount = 1;
  if (staffStore) {
    const accounts = await staffStore.list();
    const now = Date.now();
    onlineKitchenCount = accounts.filter(
      (a) => a.role === "kitchen" && a.lastSeenAt && now - new Date(a.lastSeenAt).getTime() < ONLINE_WINDOW_MS
    ).length;
    if (onlineKitchenCount === 0) onlineKitchenCount = 1; // avoid dividing by zero when no one's clocked in
  }

  return {
    avgPrepMinutesByProduct,
    overallAvgPrepMinutes: avg(allPrepTimes, DEFAULT_PREP_MINUTES),
    avgDeliveryMinutes: avg(deliveryTimes, DEFAULT_DELIVERY_MINUTES),
    activeOrderCount,
    onlineKitchenCount,
  };
}

async function getModel(): Promise<EtaModel> {
  if (cache && Date.now() - cache.computedAt < CACHE_TTL_MS) return cache.model;
  const model = await computeModel();
  cache = { model, computedAt: Date.now() };
  return model;
}

/**
 * Minutes remaining until `order` is expected to reach the table, or null
 * once delivery has already started (a live countdown stops being useful
 * the moment food is on its way).
 */
export async function estimateEtaMinutes(order: Order): Promise<number | null> {
  if (order.status === "DELIVERING" || order.status === "COMPLETED" || order.status === "CANCELLED") return null;

  const model = await getModel();
  const perItemMinutes = order.items.map(
    (item) => model.avgPrepMinutesByProduct.get(item.productId) ?? model.overallAvgPrepMinutes
  );
  // "together" waits for the slowest dish; "as_ready" still needs the whole
  // order eventually plated for delivery, so the slowest dish still gates it.
  const basePrep = perItemMinutes.length ? Math.max(...perItemMinutes) : model.overallAvgPrepMinutes;

  // Queue-depth load factor: kitchen busier than "one order per online cook"
  // stretches the estimate proportionally, capped so a big rush doesn't
  // produce an absurd number.
  const loadRatio = model.activeOrderCount / model.onlineKitchenCount;
  const loadMultiplier = Math.min(2.5, Math.max(1, loadRatio / 3));

  const totalMinutes = basePrep * loadMultiplier + model.avgDeliveryMinutes;
  const elapsedMinutes = minutesBetween(order.createdAt, new Date().toISOString());
  const remaining = totalMinutes - elapsedMinutes;
  return Math.max(MINIMUM_ETA_MINUTES, Math.round(remaining));
}
