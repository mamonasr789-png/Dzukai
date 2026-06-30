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

export type OrderStatus = "NEW" | "PREPARING" | "READY" | "COMPLETED" | "CANCELLED";

/**
 * "together"  — Bring all dishes at once. Order becomes READY only when
 *               every non-cancelled item is individually READY.
 * "as_ready"  — Bring each dish the moment it's ready. Order becomes READY
 *               as soon as any item reaches READY status.
 */
export type ServingPreference = "together" | "as_ready";

export interface OrderItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  /** Per-item kitchen status. Optional for backward compat with legacy orders. */
  itemStatus?: OrderStatus;
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
 * "together" rules:
 *   READY only when ALL active items are READY or COMPLETED.
 *   While waiting for remaining items, shows PREPARING (not READY).
 *
 * "as_ready" rules:
 *   READY as soon as any item is READY.
 *
 * Shared rules (both modes):
 *   all CANCELLED → CANCELLED
 *   all COMPLETED (active) → COMPLETED
 *   any PREPARING (and preference "as_ready", no READY) → PREPARING
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

  if (preference === "together") {
    // All active items must be READY (or COMPLETED) before order is READY
    if (active.every((s) => s === "READY" || s === "COMPLETED")) return "READY";
    // Any item started or already ready but waiting for others → PREPARING
    if (active.some((s) => s === "PREPARING" || s === "READY")) return "PREPARING";
    return "NEW";
  } else {
    // as_ready: first READY item surfaces immediately
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
  const order: Order = {
    id: generateId(),
    tableNumber: params.tableNumber,
    createdAt: new Date().toISOString(),
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
  status: OrderStatus
): Order | undefined {
  const orders = readAll();
  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx === -1) return undefined;

  const order = normalizeOrder(orders[idx]);
  const updatedItems = order.items.map((i) =>
    i.productId === productId ? { ...i, itemStatus: status } : i
  );
  const updatedOrder: Order = {
    ...order,
    items: updatedItems,
    status: deriveOrderStatus(updatedItems, order.servingPreference),
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
  };
  writeAll(orders);
  return orders[idx];
}

const ACTIVE_STATUSES: OrderStatus[] = ["NEW", "PREPARING", "READY"];

export function getLatestActiveOrder(): Order | undefined {
  const active = readAll()
    .map(normalizeOrder)
    .filter((o) => ACTIVE_STATUSES.includes(o.status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return active[0];
}

export function deleteOrder(id: string): void {
  writeAll(readAll().filter((o) => o.id !== id));
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
  const kept = all.filter((o) => {
    const done = o.status === "COMPLETED" || o.status === "CANCELLED";
    if (!done) return true; // always keep active orders
    return new Date(o.createdAt).getTime() > cutoff;
  });
  if (kept.length !== all.length) writeAll(kept);
  return all.length - kept.length; // number of orders removed
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

export const STATUS_LABELS: Record<OrderStatus, string> = {
  NEW: "Naujas",
  PREPARING: "Gaminamas",
  READY: "Paruoštas",
  COMPLETED: "Įvykdytas",
  CANCELLED: "Atšauktas",
};

export const STATUS_MESSAGES: Record<OrderStatus, string> = {
  NEW: "Užsakymas priimtas. Laukimo laikas apie 15 min.",
  PREPARING: "Užsakymas gaminamas. Laukimo laikas apie 10 min.",
  READY: "Užsakymas paruoštas.",
  COMPLETED: "Skanaus!",
  CANCELLED: "Užsakymas atšauktas.",
};

export const STATUS_ORDER: OrderStatus[] = ["NEW", "PREPARING", "READY", "COMPLETED"];

export const SERVING_LABELS: Record<ServingPreference, { short: string; long: string }> = {
  together: {
    short: "Visi kartu",
    long: "Visi patiekalai bus atnešti kartu, kai bus paruošti.",
  },
  as_ready: {
    short: "Kai tik paruošta",
    long: "Paruošti patiekalai bus atnešami iš karto.",
  },
};
