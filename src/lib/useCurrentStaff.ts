"use client";

import { useEffect, useState } from "react";
import type { StaffStamp } from "./orders";

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * The logged-in staff account for the current /waiter, /kitchen or /admin
 * session — stamped onto order items and tasks as they're completed, so the
 * admin panel can show each person's activity for the day. Also pings a
 * heartbeat every 30s so the admin panel can show who's online right now.
 */
export function useCurrentStaff(): StaffStamp | null {
  const [staff, setStaff] = useState<StaffStamp | null>(null);

  useEffect(() => {
    fetch("/api/staff/session")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { accountId: string; username: string } | null) => {
        if (data) setStaff({ id: data.accountId, username: data.username });
      })
      .catch(() => setStaff(null));
  }, []);

  useEffect(() => {
    const ping = () => {
      fetch("/api/staff/heartbeat", { method: "POST" }).catch(() => {});
    };
    ping();
    const interval = setInterval(ping, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return staff;
}
