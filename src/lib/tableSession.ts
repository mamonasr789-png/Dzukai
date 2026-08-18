/**
 * Table session — tracks a customer's full restaurant visit.
 *
 * Invariant: at most one session can be ACTIVE or BILL_REQUESTED at a time
 * (per browser). Multiple PAID/CLOSED sessions accumulate as history.
 *
 * Cart  = temporary basket for the next order (cleared after submit)
 * Order = one submitted round of food
 * Session = the customer's whole table visit (may contain many orders)
 *
 * Sync: same pattern as orders.ts — "storage" event + "dzukai:session" CustomEvent.
 * Future: swap readAll/writeAll for API calls without touching UI.
 */

const STORAGE_KEY = "dzukai-table-sessions";
const SYNC_EVENT = "dzukai:session";

// Order storage is read directly (never imported) to keep the two storage
// modules decoupled — mirrors getProtectedOrderIds() in orders.ts.
const ORDERS_STORAGE_KEY = "dzukai-orders";
const FINISHED_ORDER_STATUSES = new Set(["COMPLETED", "CANCELLED"]);
// An order is "active" for the customer until the waiter has delivered it.
// This — NOT payment status and NOT cart contents — is the source of truth for
// whether the customer still has something to track.
const ACTIVE_ORDER_STATUSES = new Set(["PENDING_CONFIRMATION", "NEW", "PREPARING", "READY", "DELIVERING"]);

// ── Types ─────────────────────────────────────────────────────────────────────

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

const OPEN_STATUSES: SessionStatus[] = ["ACTIVE", "BILL_REQUESTED"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId(): string {
  return "S" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 4).toUpperCase();
}

function now(): string {
  return new Date().toISOString();
}

function broadcast(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SYNC_EVENT));
}

// ── Storage ───────────────────────────────────────────────────────────────────

function readAll(): TableSession[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as TableSession[];
  } catch {
    return [];
  }
}

function writeAll(sessions: TableSession[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  broadcast();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Return the one open (ACTIVE or BILL_REQUESTED) session for a table, if any.
 *
 * Must be scoped by tableNumber: the sync engine pulls every table's orders
 * and sessions into every device's localStorage (kitchen/waiter/admin need
 * that global view), so once two tables are open at once, an unscoped
 * "first open session" lookup can attach a new order — or a payment — to a
 * completely different table.
 */
export function getActiveSession(tableNumber: string | null): TableSession | null {
  return readAll().find((s) => OPEN_STATUSES.includes(s.status) && s.tableNumber === tableNumber) ?? null;
}

/**
 * Read orders (id, status, createdAt) without importing orders.ts (avoids a
 * circular import — same pattern orders.ts uses to read sessions).
 */
function readOrders(): { id: string; status: string; createdAt: string }[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(ORDERS_STORAGE_KEY) ?? "[]") as {
      id: string;
      status: string;
      createdAt: string;
    }[];
  } catch {
    return [];
  }
}

function readOrderStatuses(): Map<string, string> {
  return new Map(readOrders().map((o) => [o.id, o.status]));
}

/**
 * True when every order in the session has been delivered (COMPLETED) or
 * CANCELLED. A missing order id (already purged from history) counts as
 * finished so a session can never get stuck open on an id that no longer exists.
 */
export function allSessionOrdersFinished(session: TableSession): boolean {
  if (session.orderIds.length === 0) return false;
  const statuses = readOrderStatuses();
  return session.orderIds.every((id) => {
    const st = statuses.get(id);
    return st === undefined || FINISHED_ORDER_STATUSES.has(st);
  });
}

/**
 * The session the customer can still see and track on /order and /cart.
 *
 * SOURCE OF TRUTH = ORDER DELIVERY STATUS, not payment status and not the cart.
 * A session is trackable for as long as it owns at least one order that has not
 * yet been delivered (COMPLETED) or CANCELLED. Payment (PAID/CLOSED) and an
 * empty cart are deliberately irrelevant here — that separation is the whole
 * point: paying or clearing the basket must never hide undelivered food.
 *
 * Resolution order:
 *   1. the open session (ACTIVE / BILL_REQUESTED) — the one accepting new orders
 *   2. otherwise the session that owns the most recent still-active order,
 *      whatever that session's lifecycle status is (PAID, CLOSED, …)
 *   3. nothing active anywhere → null (only now does tracking disappear)
 */
export function getTrackableSession(tableNumber: string | null): TableSession | null {
  const all = readAll();

  // 1. An open session (still accepting orders) always wins.
  const open = all.find((s) => OPEN_STATUSES.includes(s.status) && s.tableNumber === tableNumber);
  if (open) return open;

  // 2. Follow the ORDERS: any order still in flight keeps its session trackable,
  //    regardless of whether the bill was paid or the session was closed.
  const activeOrders = readOrders()
    .filter((o) => ACTIVE_ORDER_STATUSES.has(o.status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const o of activeOrders) {
    const owner = all.find((s) => s.orderIds.includes(o.id) && s.tableNumber === tableNumber);
    if (owner) return owner;
  }

  // 3. No active orders → nothing left to track.
  return null;
}

export function listSessions(): TableSession[] {
  return readAll().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createSession(tableNumber: string | null): TableSession {
  // Close any stale open sessions for THIS table before creating a new one —
  // other tables' open sessions must be left untouched (see getActiveSession).
  const sessions = readAll().map((s) =>
    OPEN_STATUSES.includes(s.status) && s.tableNumber === tableNumber
      ? { ...s, status: "CLOSED" as SessionStatus, updatedAt: now() }
      : s
  );
  const session: TableSession = {
    id: generateId(),
    tableNumber,
    orderIds: [],
    status: "ACTIVE",
    createdAt: now(),
    updatedAt: now(),
  };
  writeAll([...sessions, session]);
  return session;
}

/**
 * Core entry point called from the cart after createOrder().
 * Creates a session if none is open; adds the orderId to an existing one.
 * tableNumber from the new order is used if starting a fresh session.
 */
export function addOrderToSession(
  orderId: string,
  tableNumber: string | null = null
): TableSession {
  const sessions = readAll();
  const openIdx = sessions.findIndex((s) => OPEN_STATUSES.includes(s.status) && s.tableNumber === tableNumber);

  if (openIdx !== -1) {
    const updated = { ...sessions[openIdx] };
    if (!updated.orderIds.includes(orderId)) {
      updated.orderIds = [...updated.orderIds, orderId];
      updated.updatedAt = now();
    }
    sessions[openIdx] = updated;
    writeAll(sessions);
    return updated;
  }

  // No open session — create one
  const session: TableSession = {
    id: generateId(),
    tableNumber,
    orderIds: [orderId],
    status: "ACTIVE",
    createdAt: now(),
    updatedAt: now(),
  };
  writeAll([...sessions, session]);
  return session;
}

export function updateSessionStatus(status: SessionStatus, tableNumber: string | null): TableSession | null {
  const sessions = readAll();
  const idx = sessions.findIndex((s) => OPEN_STATUSES.includes(s.status) && s.tableNumber === tableNumber);
  if (idx === -1) return null;
  sessions[idx] = { ...sessions[idx], status, updatedAt: now() };
  writeAll(sessions);
  return sessions[idx];
}

export function closeSession(tableNumber: string | null): void {
  updateSessionStatus("CLOSED", tableNumber);
}

/**
 * Mark the active session as PAID and record how payment was made.
 * Replaces closeSession() for payment flows so analytics can split by method.
 *
 * Note: PAID marks the bill settled, NOT the visit over. The customer keeps
 * tracking the session via getTrackableSession() until all its orders are
 * delivered/cancelled — payment and food progress are separate concerns.
 */
export function markSessionPaid(method: PaymentMethod, tableNumber: string | null): TableSession | null {
  const sessions = readAll();
  const idx = sessions.findIndex((s) => OPEN_STATUSES.includes(s.status) && s.tableNumber === tableNumber);
  if (idx === -1) return null;
  sessions[idx] = {
    ...sessions[idx],
    status: "PAID",
    paymentMethod: method,
    paymentStatus: "PAID",
    updatedAt: now(),
  };
  writeAll(sessions);
  return sessions[idx];
}

/** Subscribe to session storage changes. Returns unsubscribe fn. */
export function subscribeSession(callback: () => void): () => void {
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

// ── Analytics helpers (for admin) ─────────────────────────────────────────────

export function getSessionStats(): { active: number; billRequested: number; total: number } {
  const sessions = readAll();
  return {
    active: sessions.filter((s) => s.status === "ACTIVE").length,
    billRequested: sessions.filter((s) => s.status === "BILL_REQUESTED").length,
    total: sessions.length,
  };
}

export function getPaymentStats(todayOnly = true): {
  paidInApp: number;
  paidByWaiter: number;
  total: number;
} {
  let sessions = readAll().filter(
    (s) => s.status === "PAID" || s.status === "CLOSED"
  );
  if (todayOnly) {
    const today = new Date().toDateString();
    sessions = sessions.filter(
      (s) => new Date(s.createdAt).toDateString() === today
    );
  }
  const paidInApp = sessions.filter((s) => s.paymentMethod === "APP").length;
  // Legacy CLOSED sessions (before paymentMethod was added) count as waiter-paid
  const paidByWaiter = sessions.filter(
    (s) => s.paymentMethod === "WAITER" || (!s.paymentMethod && s.status === "CLOSED")
  ).length;
  return { paidInApp, paidByWaiter, total: sessions.length };
}
