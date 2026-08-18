"use client";

import { usePolling } from "./usePolling";
import type { TableSession } from "../orderTypes";

async function fetchSessions(): Promise<TableSession[]> {
  const res = await fetch("/api/staff/sessions");
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error ?? "fetch_failed");
  return data.sessions as TableSession[];
}

/** Server-polled table session list — replaces listSessions()/subscribeSession(). */
export function useStaffSessions() {
  const { data, loading, error, refresh } = usePolling(fetchSessions, 2000);
  const sessions = data ?? [];

  async function settleSession(tableNumber: string): Promise<void> {
    const res = await fetch(`/api/staff/sessions/${encodeURIComponent(tableNumber)}/settle`, { method: "POST" });
    const body = await res.json();
    if (!res.ok || !body.ok) throw new Error(body.error ?? "request_failed");
    refresh();
  }

  return { sessions, loading, error, refresh, settleSession };
}
