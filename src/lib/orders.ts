/**
 * Order storage — localStorage MVP.
 * All data access goes through this module so the implementation
 * can be swapped for a backend later without touching UI code.
 *
 * Sync strategy:
 *   - Cross-tab: native "storage" event (fires automatically)
 *   - Same-tab:  custom "dzukai:order" CustomEvent dispatched after every write
 *
 * Consumers call subscribeOrders() and get notified on every change.
 */

const STORAGE_KEY = "dzukai-orders";
const SYNC_EVENT = "dzukai:order";

// ── Types ─────────────────────────────────────────────────────────────────────

export type OrderStatus =
  | "PENDING_CONFIRMATION"
  | "NEW"
  | "PREPARING"
  | "READY"
  | "DELIVERING"
  | "COMPLETED"
  | "CANCELLED";

/**
 * "together"  — Bring all dishes at once. Order becomes READY only when
 *               every non-cancelled item is individually READY.
 *               Waiter then accepts → all items DELIVERING → COMPLETED.
 * "as_ready"  — Bring each dish the moment it's ready. Order becomes READY
 *               as soon as any item reaches READY status.
 */
export type ServingPreference = "together" | "as_ready";

/** Identifies which logged-in staff account performed an action, for the daily activity view. */
export interface StaffStamp {
  id: string;
  username: string;
}

export interface OrderItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  /** Per-item kitchen status. Optional for backward compat with legacy orders. */
  itemStatus?: OrderStatus;
  /** Who marked this item READY, and when — powers "today's activity" per kitchen account. */
  preparedBy?: StaffStamp;
  preparedAt?: string;
  /** Who marked this item COMPLETED (delivered), and when — same, for waiter accounts. */
  deliveredBy?: StaffStamp;
  deliveredAt?: string;
}

export interface Order {
  id: string;
  tableNumber: string | null;
  createdAt: string;
  /** Derived from item statuses. Updated automatically on every item status change. */
  status: OrderStatus;
  items: OrderItem[];
  total: number;
  notes: string;
  language: string;
  /**
   * How the customer wants dishes served.
   * Optional for backward compat — old orders default to "together".
   */
  servingPreference?: ServingPreference;
  /** Last modification time — powers cross-device last-write-wins sync. */
  updatedAt?: string;
  /** Set to true when customer pays for this specific order (single-order scope). */
  isPaid?: boolean;
  /** ISO timestamp of when the order was paid — powers the receipt confirmation. */
  paidAt?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId(): string {
  return Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
}

function broadcast(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SYNC_EVENT));
}

// ── Status derivation ─────────────────────────────────────────────────────────

/**
 * Derive the customer-visible order status from its items.
 *
 * Lifecycle per item: NEW → PREPARING → READY → DELIVERING → COMPLETED
 * Kitchen stops at READY. Waiter drives DELIVERING → COMPLETED.
 *
 * Shared rules (run before preference split):
 *   all CANCELLED            → CANCELLED
 *   all active COMPLETED     → COMPLETED
 *   all active DELIVERING/COMPLETED → DELIVERING
 *
 * "together" rules:
 *   all active READY/DELIVERING/COMPLETED → READY (kitchen done, waiter on the way)
 *   any PREPARING/READY/DELIVERING active → PREPARING
 *   else → NEW
 *
 * "as_ready" rules:
 *   any DELIVERING (and no READY left) → DELIVERING
 *   any READY → READY
 *   any PREPARING → PREPARING
 *   else → NEW
 */
export function deriveOrderStatus(
  items: OrderItem[],
  preference: ServingPreference = "together"
): OrderStatus {
  const statuses = items.map((i) => i.itemStatus ?? "NEW");
  if (statuses.every((s) => s === "CANCELLED")) return "CANCELLED";

  const active = statuses.filter((s) => s !== "CANCELLED");
  if (active.length === 0) return "CANCELLED";
  if (active.every((s) => s === "COMPLETED")) return "COMPLETED";
  if (active.every((s) => s === "DELIVERING" || s === "COMPLETED")) return "DELIVERING";

  if (preference === "together") {
    if (active.every((s) => s === "READY" || s === "DELIVERING" || s === "COMPLETED")) return "READY";
    if (active.some((s) => s === "PREPARING" || s === "READY" || s === "DELIVERING")) return "PREPARING";
    return "NEW";
  } else {
    if (active.some((s) => s === "DELIVERING") && !active.some((s) => s === "READY")) return "DELIVERING";
    if (active.some((s) => s === "READY")) return "READY";
    if (active.some((s) => s === "PREPARING")) return "PREPARING";
    return "NEW";
  }
}

/**
 * Normalize a legacy order so UI code always has itemStatus and
 * servingPreference available. Pure function — does not write.
 */
export function normalizeOrder(order: Order): Order {
  const needsItems = order.items.some((i) => i.itemStatus === undefined);
  const normalized: Order = {
    servingPreference: "together", // default for legacy orders
    ...order,
    items: needsItems
      ? order.items.map((i) => ({ ...i, itemStatus: i.itemStatus ?? order.status }))
      : order.items,
  };
  return normalized;
}

// ── Storage adapter ───────────────────────────────────────────────────────────

function readAll(): Order[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as Order[];
  } catch {
    return [];
  }
}

function writeAll(orders: Order[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
  broadcast();
}

// ── Public API ────────────────────────────────────────────────────────────────

export function createOrder(params: {
  tableNumber: string | null;
  items: OrderItem[];
  total: number;
  notes?: string;
  language?: string;
  servingPreference?: ServingPreference;
}): Order {
  const createdAt = new Date().toISOString();
  const order: Order = {
    id: generateId(),
    tableNumber: params.tableNumber,
    createdAt,
    updatedAt: createdAt,
    status: "NEW",
    items: params.items.map((i) => ({ ...i, itemStatus: "NEW" })),
    total: params.total,
    notes: params.notes ?? "",
    language: params.language ?? "lt",
    servingPreference: params.servingPreference ?? "together",
  };
  writeAll([...readAll(), order]);
  return order;
}

export function getOrder(id: string): Order | undefined {
  const raw = readAll().find((o) => o.id === id);
  return raw ? normalizeOrder(raw) : undefined;
}

export function listOrders(): Order[] {
  return readAll().map(normalizeOrder);
}

/** Update a single item's status and re-derive the order status. */
export function updateItemStatus(
  orderId: string,
  productId: string,
  status: OrderStatus,
  staff?: StaffStamp
): Order | undefined {
  const orders = readAll();
  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx === -1) return undefined;

  const order = normalizeOrder(orders[idx]);
  const now = new Date().toISOString();
  const updatedItems = order.items.map((i) =>
    i.productId === productId
      ? {
          ...i,
          itemStatus: status,
          ...(status === "READY" && staff ? { preparedBy: staff, preparedAt: now } : null),
        }
      : i
  );
  const updatedOrder: Order = {
    ...order,
    items: updatedItems,
    status: deriveOrderStatus(updatedItems, order.servingPreference),
    updatedAt: new Date().toISOString(),
  };
  orders[idx] = updatedOrder;
  writeAll(orders);
  return updatedOrder;
}

/** Update the whole order status at once (also sets all items). */
export function updateOrderStatus(id: string, status: OrderStatus): Order | undefined {
  const orders = readAll();
  const idx = orders.findIndex((o) => o.id === id);
  if (idx === -1) return undefined;
  const order = normalizeOrder(orders[idx]);
  orders[idx] = {
    ...order,
    status,
    items: order.items.map((i) => ({ ...i, itemStatus: status })),
    updatedAt: new Date().toISOString(),
  };
  writeAll(orders);
  return orders[idx];
}

/**
 * Waiter accepts delivery — move specified items from READY → DELIVERING.
 * If productIds is empty, transitions all READY items in the order.
 */
export function startItemsDelivery(orderId: string, productIds: string[]): Order | undefined {
  const orders = readAll();
  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx === -1) return undefined;

  const order = normalizeOrder(orders[idx]);
  const targets = new Set(productIds.length ? productIds : order.items.map((i) => i.productId));
  const updatedItems = order.items.map((i) =>
    targets.has(i.productId) && (i.itemStatus ?? "NEW") === "READY"
      ? { ...i, itemStatus: "DELIVERING" as OrderStatus }
      : i
  );
  orders[idx] = {
    ...order,
    items: updatedItems,
    status: deriveOrderStatus(updatedItems, order.servingPreference),
    updatedAt: new Date().toISOString(),
  };
  writeAll(orders);
  return orders[idx];
}

/**
 * Waiter delivered — move specified items from DELIVERING → COMPLETED.
 * If productIds is empty, transitions all DELIVERING items in the order.
 */
export function completeItemsDelivery(
  orderId: string,
  productIds: string[],
  staff?: StaffStamp
): Order | undefined {
  const orders = readAll();
  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx === -1) return undefined;

  const order = normalizeOrder(orders[idx]);
  const now = new Date().toISOString();
  const targets = new Set(productIds.length ? productIds : order.items.map((i) => i.productId));
  const updatedItems = order.items.map((i) =>
    targets.has(i.productId) && (i.itemStatus ?? "NEW") === "DELIVERING"
      ? {
          ...i,
          itemStatus: "COMPLETED" as OrderStatus,
          ...(staff ? { deliveredBy: staff, deliveredAt: now } : null),
        }
      : i
  );
  orders[idx] = {
    ...order,
    items: updatedItems,
    status: deriveOrderStatus(updatedItems, order.servingPreference),
    updatedAt: new Date().toISOString(),
  };
  writeAll(orders);
  return orders[idx];
}

const ACTIVE_STATUSES: OrderStatus[] = ["PENDING_CONFIRMATION", "NEW", "PREPARING", "READY", "DELIVERING"];

export function getLatestActiveOrder(): Order | undefined {
  const active = readAll()
    .map(normalizeOrder)
    .filter((o) => ACTIVE_STATUSES.includes(o.status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return active[0];
}

/**
 * True while the customer has at least one order that has not been delivered
 * (COMPLETED) or CANCELLED. This is the definitive "is there anything to track"
 * signal — independent of payment status and of the cart. The UI uses it so an
 * empty cart or a paid bill can never hide undelivered food.
 */
export function hasActiveOrders(): boolean {
  return readAll().some((o) => ACTIVE_STATUSES.includes(o.status));
}

export function deleteOrder(id: string): void {
  writeAll(readAll().filter((o) => o.id !== id));
}

/** Mark a single order as paid (single-order payment scope). */
export function markOrderPaid(id: string): Order | undefined {
  const orders = readAll();
  const idx = orders.findIndex((o) => o.id === id);
  if (idx === -1) return undefined;
  // Keep the first paid timestamp if already set (idempotent re-pay is a no-op).
  orders[idx] = { ...orders[idx], isPaid: true, paidAt: orders[idx].paidAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() };
  writeAll(orders);
  return orders[idx];
}

/** Returns true when every order in the list has been paid. */
export function allOrdersPaid(orderIds: string[]): boolean {
  const orders = readAll();
  return orderIds.every((id) => orders.find((o) => o.id === id)?.isPaid === true);
}

/**
 * Remove COMPLETED and CANCELLED orders older than `maxAgeMs` milliseconds.
 * Active orders (NEW / PREPARING / READY) are never deleted.
 * Safe to call on every page load — no-ops when nothing qualifies.
 */
export const HISTORY_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes — change here to reconfigure

export function purgeOldHistory(maxAgeMs = HISTORY_MAX_AGE_MS): number {
  const cutoff = Date.now() - maxAgeMs;
  const all = readAll();

  // Orders still being tracked by the customer must never be purged — deleting
  // them would erase part of the visit while it's still on screen.
  const protectedIds = getProtectedOrderIds(all);

  const kept = all.filter((o) => {
    const done = o.status === "COMPLETED" || o.status === "CANCELLED";
    if (!done) return true; // always keep active orders
    if (protectedIds.has(o.id)) return true; // bill not settled yet
    return new Date(o.createdAt).getTime() > cutoff;
  });
  if (kept.length !== all.length) writeAll(kept);
  return all.length - kept.length; // number of orders removed
}

/**
 * Order IDs the customer can still be tracking, so purge must leave them alone:
 *   - every order in an OPEN (ACTIVE / BILL_REQUESTED) session, and
 *   - orders in a settled (PAID / CLOSED) session whose food is not all
 *     delivered yet — payment doesn't end tracking, delivery does.
 *
 * Reads the session storage key directly to avoid a circular import with
 * tableSession.ts.
 */
function getProtectedOrderIds(all: Order[]): Set<string> {
  const ids = new Set<string>();
  if (typeof window === "undefined") return ids;
  try {
    const sessions = JSON.parse(localStorage.getItem("dzukai-table-sessions") ?? "[]") as {
      status: string;
      orderIds: string[];
    }[];
    const statusById = new Map(all.map((o) => [o.id, o.status]));
    const finished = (id: string) => {
      const st = statusById.get(id);
      return st === undefined || st === "COMPLETED" || st === "CANCELLED";
    };
    for (const s of sessions) {
      const open = s.status === "ACTIVE" || s.status === "BILL_REQUESTED";
      const settledButTracking =
        (s.status === "PAID" || s.status === "CLOSED") && !s.orderIds.every(finished);
      if (open || settledButTracking) {
        for (const id of s.orderIds) ids.add(id);
      }
    }
    return ids;
  } catch {
    return ids;
  }
}

/**
 * Subscribe to order changes (cross-tab and same-tab).
 * Returns an unsubscribe function.
 */
export function subscribeOrders(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) callback();
  };
  const onCustom = () => callback();

  window.addEventListener("storage", onStorage);
  window.addEventListener(SYNC_EVENT, onCustom);

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(SYNC_EVENT, onCustom);
  };
}

// ── Status helpers ────────────────────────────────────────────────────────────

export const STATUS_ORDER: OrderStatus[] = ["NEW", "PREPARING", "READY", "DELIVERING", "COMPLETED"];
