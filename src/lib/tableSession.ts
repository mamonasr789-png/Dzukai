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

// ── Types ─────────────────────────────────────────────────────────────────────

export type SessionStatus = "ACTIVE" | "BILL_REQUESTED" | "PAID" | "CLOSED";

export interface TableSession {
  id: string;
  tableNumber: string | null;
  orderIds: string[];
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
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

/** Return the one open (ACTIVE or BILL_REQUESTED) session, if any. */
export function getActiveSession(): TableSession | null {
  return readAll().find((s) => OPEN_STATUSES.includes(s.status)) ?? null;
}

export function listSessions(): TableSession[] {
  return readAll().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createSession(tableNumber: string | null): TableSession {
  // Close any stale open sessions before creating a new one
  const sessions = readAll().map((s) =>
    OPEN_STATUSES.includes(s.status) ? { ...s, status: "CLOSED" as SessionStatus, updatedAt: now() } : s
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
  const openIdx = sessions.findIndex((s) => OPEN_STATUSES.includes(s.status));

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

export function updateSessionStatus(status: SessionStatus): TableSession | null {
  const sessions = readAll();
  const idx = sessions.findIndex((s) => OPEN_STATUSES.includes(s.status));
  if (idx === -1) return null;
  sessions[idx] = { ...sessions[idx], status, updatedAt: now() };
  writeAll(sessions);
  return sessions[idx];
}

export function closeSession(): void {
  updateSessionStatus("CLOSED");
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
