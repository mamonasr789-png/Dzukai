"use client";

import { usePolling } from "./usePolling";
import type { StaffStamp, WaiterTask, WaiterTaskStatus } from "../orderTypes";

async function fetchTasks(): Promise<WaiterTask[]> {
  const res = await fetch("/api/staff/tasks");
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error ?? "fetch_failed");
  return data.tasks as WaiterTask[];
}

async function postJson(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error ?? "request_failed");
}

/** Server-polled waiter task list — replaces listTasks()/subscribeWaiterTasks(). */
export function useStaffTasks() {
  const { data, loading, error, refresh } = usePolling(fetchTasks, 2000);
  const tasks = data ?? [];

  async function updateTaskStatus(id: string, status: WaiterTaskStatus, staff?: StaffStamp): Promise<void> {
    void staff; // derived server-side from the session
    await postJson(`/api/staff/tasks/${id}/status`, { status });
    refresh();
  }

  return { tasks, loading, error, refresh, updateTaskStatus };
}
