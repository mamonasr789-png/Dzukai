/**
 * Shared order/session/waiter-task types, pure derivation logic, and display
 * label lookup tables — importable from both server code (src/lib/server/**)
 * and client display code, with zero persistence of its own.
 *
 * This module used to be split across src/lib/orders.ts, tableSession.ts and
 * waiterTasks.ts, each mixing localStorage read/write with these pure/type
 * pieces. Now that the server is the only place that persists this data
 * (src/lib/server/orderService.ts, taskService.ts), the pure pieces live here
 * so nothing has to import a "storage" module just to get a type or a label.
 */

// ── Order types ─────────────────────────────────────────────────────────────

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
  /** How the customer wants dishes served. Optional for backward compat. */
  servingPreference?: ServingPreference;
  /** Last modification time. */
  updatedAt?: string;
  /** Set to true when customer/waiter pays for this specific order. */
  isPaid?: boolean;
  /** ISO timestamp of when the order was paid — powers the receipt confirmation. */
  paidAt?: string;
}

export const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  "PENDING_CONFIRMATION",
  "NEW",
  "PREPARING",
  "READY",
  "DELIVERING",
];

export const STATUS_ORDER: OrderStatus[] = ["NEW", "PREPARING", "READY", "DELIVERING", "COMPLETED"];

/**
 * Collapse staff-only PENDING_CONFIRMATION onto the first guest-visible stage
 * (submitted / pateikta). CANCELLED stays CANCELLED — it is not a timeline step.
 */
export function guestVisibleStatus(status: OrderStatus): OrderStatus {
  return status === "PENDING_CONFIRMATION" ? "NEW" : status;
}

/** Index into STATUS_ORDER for the guest timeline; -1 for cancelled. */
export function guestTimelineIndex(status: OrderStatus): number {
  if (status === "CANCELLED") return -1;
  return STATUS_ORDER.indexOf(guestVisibleStatus(status));
}

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

/** Normalize a legacy order so UI code always has itemStatus and servingPreference. Pure. */
export function normalizeOrder(order: Order): Order {
  const needsItems = order.items.some((i) => i.itemStatus === undefined);
  return {
    servingPreference: "together", // default for legacy orders
    ...order,
    items: needsItems
      ? order.items.map((i) => ({ ...i, itemStatus: i.itemStatus ?? order.status }))
      : order.items,
  };
}

/**
 * Who prepared/delivered this order, for display to the customer and in
 * admin. Items are stamped individually (a busy kitchen/waiter shift can
 * split one order across staff), so this picks the first stamp found as the
 * representative name rather than trying to show every contributor.
 */
export function orderPreparedBy(order: Order): StaffStamp | null {
  return order.items.find((i) => i.preparedBy)?.preparedBy ?? null;
}

export function orderDeliveredBy(order: Order): StaffStamp | null {
  return order.items.find((i) => i.deliveredBy)?.deliveredBy ?? null;
}

// ── Table session types ──────────────────────────────────────────────────────

export type SessionStatus = "ACTIVE" | "BILL_REQUESTED" | "PAID" | "CLOSED";
export type PaymentMethod = "APP" | "WAITER";
export type PaymentStatus = "UNPAID" | "PAID";

export interface TableSession {
  id: string;
  tableNumber: string | null;
  orderIds: string[];
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  paymentMethod?: PaymentMethod;
  paymentStatus?: PaymentStatus;
}

export const OPEN_SESSION_STATUSES: SessionStatus[] = ["ACTIVE", "BILL_REQUESTED"];

export function getSessionStats(sessions: TableSession[]): { active: number; billRequested: number; total: number } {
  return {
    active: sessions.filter((s) => s.status === "ACTIVE").length,
    billRequested: sessions.filter((s) => s.status === "BILL_REQUESTED").length,
    total: sessions.length,
  };
}

export function getPaymentStats(
  sessions: TableSession[],
  todayOnly = true
): { paidInApp: number; paidByWaiter: number; total: number } {
  let settled = sessions.filter((s) => s.status === "PAID" || s.status === "CLOSED");
  if (todayOnly) {
    const today = new Date().toDateString();
    settled = settled.filter((s) => new Date(s.createdAt).toDateString() === today);
  }
  const paidInApp = settled.filter((s) => s.paymentMethod === "APP").length;
  // Legacy CLOSED sessions (before paymentMethod was added) count as waiter-paid.
  const paidByWaiter = settled.filter(
    (s) => s.paymentMethod === "WAITER" || (!s.paymentMethod && s.status === "CLOSED")
  ).length;
  return { paidInApp, paidByWaiter, total: settled.length };
}

// ── Waiter task types ─────────────────────────────────────────────────────────

export type WaiterTaskType =
  | "ready_to_serve" // kitchen ready → bring food
  | "bill_requested" // customer wants the bill
  | "waiter_called" // customer pressed Call Waiter
  | "additional_order" // customer ordered more after initial order
  | "order_confirmation" // first order of a visit — needs waiter confirm/reject
  | "table_scanned"; // customer's browser passed the QR gate for this table

export type WaiterTaskStatus = "waiting" | "accepted" | "completed";
export type WaiterTaskPriority = "high" | "normal";

export const TASK_PRIORITY: Record<WaiterTaskType, WaiterTaskPriority> = {
  ready_to_serve: "high",
  waiter_called: "high",
  bill_requested: "normal",
  additional_order: "normal",
  order_confirmation: "high",
  table_scanned: "normal",
};

export const TASK_LABEL: Record<WaiterTaskType, string> = {
  ready_to_serve: "Nešti maistą",
  bill_requested: "Sąskaita",
  waiter_called: "Padavėjas kviestas",
  additional_order: "Papildomas užsakymas",
  order_confirmation: "Naujas stalas — patvirtinti",
  table_scanned: "Stalas aktyvavo QR",
};

export const TASK_ACTION_LABEL: Record<WaiterTaskType, string> = {
  ready_to_serve: "Atnešta",
  bill_requested: "Sąskaita įteikta",
  waiter_called: "Atlikta",
  additional_order: "Peržiūrėti",
  order_confirmation: "Patvirtinti",
  table_scanned: "Peržiūrėta",
};

export const TASK_STATUS_LABEL: Record<WaiterTaskStatus, string> = {
  waiting: "Laukia",
  accepted: "Priimta",
  completed: "Atlikta",
};

export interface WaiterTaskItem {
  productId: string;
  name: string;
  quantity: number;
}

export interface WaiterTask {
  id: string;
  type: WaiterTaskType;
  status: WaiterTaskStatus;
  orderId: string;
  tableNumber: string | null;
  createdAt: string;
  updatedAt: string;
  /** Deduplication key — prevents creating the same task twice. */
  triggeredBy: string;
  items: WaiterTaskItem[];
  notes?: string;
  /** Who resolved this task — powers "today's activity" per waiter account. */
  completedBy?: StaffStamp;
}

/** Count distinct active table numbers from orders. */
export function countActiveTables(orders: Order[]): number {
  const tables = new Set(
    orders
      .filter((o) => ["NEW", "PREPARING", "READY"].includes(o.status) && o.tableNumber)
      .map((o) => o.tableNumber!)
  );
  return tables.size;
}

export function getActiveTasks(tasks: WaiterTask[]): WaiterTask[] {
  return tasks.filter((t) => t.status !== "completed");
}

export function getTasksByTable(tasks: WaiterTask[]): Map<string, WaiterTask[]> {
  const map = new Map<string, WaiterTask[]>();
  for (const task of tasks) {
    const key = task.tableNumber ?? "—";
    const existing = map.get(key) ?? [];
    existing.push(task);
    map.set(key, existing);
  }
  return map;
}
