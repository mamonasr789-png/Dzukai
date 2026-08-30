import "server-only";

import { getSyncStore, pullAllRecords } from "./syncStore.ts";
import type { StaffStamp, WaiterTask, WaiterTaskItem, WaiterTaskStatus, WaiterTaskType } from "../orderTypes.ts";

/**
 * Server-side twin of the old src/lib/waiterTasks.ts. The dedup-by-key logic
 * (createUniqueTask) MUST live server-side now: with multiple devices/customers
 * hitting the API directly instead of each computing its own local state, only
 * the server can reliably say "a task for this key already exists."
 */

function generateTaskId(): string {
  return "W" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 4).toUpperCase();
}

async function pullTasks(): Promise<WaiterTask[]> {
  const store = await getSyncStore();
  if (!store) throw new Error("store_not_configured");
  const records = await pullAllRecords(store, "tasks");
  return records
    .map((r) => JSON.parse(r.data) as WaiterTask)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function pushTask(task: WaiterTask): Promise<void> {
  const store = await getSyncStore();
  if (!store) throw new Error("store_not_configured");
  await store.push("tasks", [{ id: task.id, data: JSON.stringify(task), updatedAt: task.updatedAt }]);
}

/** Point lookup by id — see SyncStore.getRecord's doc for why this matters. */
async function getTaskRecord(id: string): Promise<WaiterTask | undefined> {
  const store = await getSyncStore();
  if (!store) throw new Error("store_not_configured");
  const record = await store.getRecord("tasks", id);
  return record ? (JSON.parse(record.data) as WaiterTask) : undefined;
}

export async function listTasks(): Promise<WaiterTask[]> {
  return pullTasks();
}

export async function getTask(id: string): Promise<WaiterTask | undefined> {
  return getTaskRecord(id);
}

/**
 * Create a task only if no task with the same triggeredBy key exists yet.
 * Returns null (no-op) on a dedup hit — matches the old client-side contract.
 */
export async function createUniqueTask(
  triggeredBy: string,
  params: {
    type: WaiterTaskType;
    orderId: string;
    tableNumber: string | null;
    items?: WaiterTaskItem[];
    notes?: string;
  }
): Promise<WaiterTask | null> {
  const existing = (await pullTasks()).find((t) => t.triggeredBy === triggeredBy);
  if (existing) return null;

  const now = new Date().toISOString();
  const task: WaiterTask = {
    id: generateTaskId(),
    type: params.type,
    status: "waiting",
    orderId: params.orderId,
    tableNumber: params.tableNumber,
    createdAt: now,
    updatedAt: now,
    triggeredBy,
    items: params.items ?? [],
    notes: params.notes,
  };
  await pushTask(task);
  return task;
}

export async function updateTaskStatus(
  id: string,
  status: WaiterTaskStatus,
  staff?: StaffStamp
): Promise<WaiterTask | undefined> {
  const task = await getTaskRecord(id);
  if (!task) return undefined;
  const updated: WaiterTask = {
    ...task,
    status,
    updatedAt: new Date().toISOString(),
    ...(status === "completed" && staff ? { completedBy: staff } : null),
  };
  await pushTask(updated);
  return updated;
}

/**
 * Mark non-completed tasks for the given order IDs as completed — called when
 * a session is settled (paid). IMPORTANT: active "ready_to_serve" tasks are
 * NOT auto-completed — payment does not mean the food reached the table.
 */
export async function completeTasksForOrders(orderIds: string[], staff?: StaffStamp): Promise<void> {
  const idSet = new Set(orderIds);
  const tasks = await pullTasks();
  const now = new Date().toISOString();
  const toUpdate = tasks.filter(
    (t) => idSet.has(t.orderId) && t.status !== "completed" && t.type !== "ready_to_serve"
  );
  for (const t of toUpdate) {
    await pushTask({ ...t, status: "completed", updatedAt: now, ...(staff ? { completedBy: staff } : null) });
  }
}

/**
 * Waiter heads-up that a guest just passed the QR gate for this table.
 * Each call is a distinct card (synthetic scan:table:timestamp id) — not
 * deduped — so two phones at the same table both show up. Identity must
 * already have been taken from the signed table cookie; never from a body.
 */
export async function recordTableScanned(tableNumber: string): Promise<void> {
  const now = new Date().toISOString();
  const orderId = `scan:${tableNumber}:${Date.now()}`;
  const task: WaiterTask = {
    id: orderId,
    type: "table_scanned",
    status: "waiting",
    orderId,
    tableNumber,
    createdAt: now,
    updatedAt: now,
    triggeredBy: orderId,
    items: [],
  };
  await pushTask(task);
}
