/**
 * Waiter task storage — localStorage MVP.
 * Future: replace read/write with API calls without touching UI code.
 *
 * Tasks are generated from order state changes (kitchen marks items READY)
 * and from future customer-side actions (Call Waiter, Request Bill, etc.).
 *
 * Sync: same pattern as orders.ts — "storage" event (cross-tab) +
 * "dzukai:waiter" CustomEvent (same-tab).
 */

import type { Order } from "./orders";

const STORAGE_KEY = "dzukai-waiter-tasks";
const SYNC_EVENT = "dzukai:waiter";

// ── Types ─────────────────────────────────────────────────────────────────────

export type WaiterTaskType =
  | "ready_to_serve"   // kitchen ready → bring food
  | "bill_requested"   // customer wants the bill
  | "waiter_called"    // customer pressed Call Waiter
  | "additional_order"; // customer ordered more after initial order

export type WaiterTaskStatus = "waiting" | "accepted" | "completed";

export type WaiterTaskPriority = "high" | "normal";

export const TASK_PRIORITY: Record<WaiterTaskType, WaiterTaskPriority> = {
  ready_to_serve: "high",
  waiter_called: "high",
  bill_requested: "normal",
  additional_order: "normal",
};

export const TASK_LABEL: Record<WaiterTaskType, string> = {
  ready_to_serve: "Nešti maistą",
  bill_requested: "Sąskaita",
  waiter_called: "Padavėjas kviestas",
  additional_order: "Papildomas užsakymas",
};

export const TASK_ACTION_LABEL: Record<WaiterTaskType, string> = {
  ready_to_serve: "Atnešta",
  bill_requested: "Sąskaita įteikta",
  waiter_called: "Atlikta",
  additional_order: "Peržiūrėti",
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
  /**
   * Deduplication key — prevents creating the same task twice.
   * Format: "{orderId}:order:READY" or "{orderId}:item:{productId}:READY"
   * Future: extend with waiter ID for assignment.
   */
  triggeredBy: string;
  items: WaiterTaskItem[];
  notes?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId(): string {
  return "W" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 4).toUpperCase();
}

function now(): string {
  return new Date().toISOString();
}

function broadcast(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SYNC_EVENT));
}

// ── Storage ───────────────────────────────────────────────────────────────────

function readAll(): WaiterTask[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as WaiterTask[];
  } catch {
    return [];
  }
}

function writeAll(tasks: WaiterTask[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  broadcast();
}

// ── Public API ────────────────────────────────────────────────────────────────

export function listTasks(): WaiterTask[] {
  return readAll().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getTask(id: string): WaiterTask | undefined {
  return readAll().find((t) => t.id === id);
}

/** Create a task only if no task with the same triggeredBy key exists. */
function createTaskIfNew(params: {
  type: WaiterTaskType;
  orderId: string;
  tableNumber: string | null;
  triggeredBy: string;
  items: WaiterTaskItem[];
  notes?: string;
}): WaiterTask | null {
  const existing = readAll().find((t) => t.triggeredBy === params.triggeredBy);
  if (existing) return null;

  const task: WaiterTask = {
    id: generateId(),
    type: params.type,
    status: "waiting",
    orderId: params.orderId,
    tableNumber: params.tableNumber,
    createdAt: now(),
    updatedAt: now(),
    triggeredBy: params.triggeredBy,
    items: params.items,
    notes: params.notes,
  };

  writeAll([...readAll(), task]);
  return task;
}

/**
 * Create a task with a caller-supplied dedup key.
 * Use this for customer-triggered tasks (waiter call, bill) so multiple
 * taps on the same button don't create duplicate tasks.
 * Returns null if a task with that key already exists.
 */
export function createUniqueTask(
  triggeredBy: string,
  params: {
    type: WaiterTaskType;
    orderId: string;
    tableNumber: string | null;
    items?: WaiterTaskItem[];
    notes?: string;
  }
): WaiterTask | null {
  return createTaskIfNew({ ...params, items: params.items ?? [], triggeredBy });
}

/** Manually create a task (for future customer-triggered events). */
export function createTask(params: {
  type: WaiterTaskType;
  orderId: string;
  tableNumber: string | null;
  items?: WaiterTaskItem[];
  notes?: string;
}): WaiterTask {
  const triggeredBy = `${params.orderId}:manual:${params.type}:${Date.now()}`;
  const task = createTaskIfNew({ ...params, items: params.items ?? [], triggeredBy });
  if (task) return task;
  // If dedup hit (shouldn't happen with timestamp), return a fresh one with unique key
  return createTask({ ...params, notes: params.notes });
}

export function updateTaskStatus(id: string, status: WaiterTaskStatus): WaiterTask | undefined {
  const tasks = readAll();
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) return undefined;
  tasks[idx] = { ...tasks[idx], status, updatedAt: now() };
  writeAll(tasks);
  return tasks[idx];
}

export function deleteTask(id: string): void {
  writeAll(readAll().filter((t) => t.id !== id));
}

/**
 * Mark non-completed tasks for the given order IDs as completed.
 * Called when a session is closed (payment received) to clean up the task list.
 *
 * IMPORTANT: active "ready_to_serve" tasks are NOT auto-completed — payment
 * does not mean the food reached the table. If the customer pays early, the
 * waiter must still see "Nešti maistą" until they actually deliver it.
 */
export function completeTasksForOrders(orderIds: string[]): void {
  const idSet = new Set(orderIds);
  const tasks = readAll();
  let changed = false;
  const updated = tasks.map((t) => {
    if (idSet.has(t.orderId) && t.status !== "completed" && t.type !== "ready_to_serve") {
      changed = true;
      return { ...t, status: "completed" as WaiterTaskStatus, updatedAt: now() };
    }
    return t;
  });
  if (changed) writeAll(updated);
}

/** Subscribe to waiter task changes. Returns unsubscribe fn. */
export function subscribeWaiterTasks(callback: () => void): () => void {
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

// ── Auto-generation from order state ─────────────────────────────────────────

/**
 * Scan orders and generate "ready_to_serve" waiter tasks where needed.
 * Called on every order storage event so the waiter sees tasks immediately.
 *
 * Rules:
 *   servingPreference "together" (default): one task when order.status === READY
 *   servingPreference "as_ready": one task per item when itemStatus === READY
 *
 * Dedup via triggeredBy key ensures no duplicates on repeated calls.
 */
export function syncReadyToServeTasks(orders: Order[]): void {
  for (const order of orders) {
    const pref = order.servingPreference ?? "together";

    if (pref === "together") {
      if (order.status !== "READY") continue;
      const readyItems = order.items
        .filter((i) => (i.itemStatus ?? order.status) === "READY" || (i.itemStatus ?? order.status) === "COMPLETED")
        .map((i) => ({ productId: i.productId, name: i.name, quantity: i.quantity }));

      createTaskIfNew({
        type: "ready_to_serve",
        orderId: order.id,
        tableNumber: order.tableNumber,
        triggeredBy: `${order.id}:order:READY`,
        items: readyItems,
      });
    } else {
      // as_ready: task per ready item
      for (const item of order.items) {
        const itemStatus = item.itemStatus ?? order.status;
        if (itemStatus !== "READY" && itemStatus !== "COMPLETED") continue;

        createTaskIfNew({
          type: "ready_to_serve",
          orderId: order.id,
          tableNumber: order.tableNumber,
          triggeredBy: `${order.id}:item:${item.productId}:READY`,
          items: [{ productId: item.productId, name: item.name, quantity: item.quantity }],
        });
      }
    }
  }
}

// ── Derived queries ───────────────────────────────────────────────────────────

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

/** Count distinct active table numbers from orders. */
export function countActiveTables(orders: Order[]): number {
  const tables = new Set(
    orders
      .filter((o) => ["NEW", "PREPARING", "READY"].includes(o.status) && o.tableNumber)
      .map((o) => o.tableNumber!)
  );
  return tables.size;
}
