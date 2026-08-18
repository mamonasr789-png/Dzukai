"use client";

import { usePolling } from "./usePolling";
import type { Order, OrderItem, ServingPreference, TableSession } from "../orderTypes";

interface SessionResponse {
  session: TableSession | null;
  orders: Order[];
}

async function fetchSession(): Promise<SessionResponse> {
  const res = await fetch("/api/table/session");
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error ?? "fetch_failed");
  return { session: data.session, orders: data.orders };
}

async function postJson<T = unknown>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error ?? "request_failed");
  return data;
}

/**
 * Server-polled table session for the customer-facing /cart and /order pages.
 * Replaces getTrackableSession()/subscribeSession()/subscribeOrders() — the
 * server derives the trackable session from the vaise_table_access cookie
 * (src/lib/server/auth/requireTableAccess.ts), so there's no client-side
 * table-scoping logic left to get wrong.
 */
export function useTableSession() {
  const { data, loading, error, refresh } = usePolling(fetchSession, 2000);
  const session = data?.session ?? null;
  const orders = data?.orders ?? [];

  async function createOrder(params: {
    items: OrderItem[];
    total: number;
    notes?: string;
    language?: string;
    servingPreference?: ServingPreference;
  }): Promise<Order> {
    const result = await postJson<{ order: Order; session: TableSession }>("/api/table/orders", params);
    refresh();
    return result.order;
  }

  async function requestBill(): Promise<void> {
    await postJson("/api/table/bill-request");
    refresh();
  }

  async function callWaiter(): Promise<void> {
    await postJson("/api/table/waiter-call");
    refresh();
  }

  async function payOrders(orderIds: string[]): Promise<{ allPaid: boolean }> {
    const result = await postJson<{ allPaid: boolean }>("/api/table/pay", { orderIds });
    refresh();
    return result;
  }

  return { session, orders, loading, error, refresh, createOrder, requestBill, callWaiter, payOrders };
}

/** Single order lookup for /order?id=... — independent of the session poll above. */
export function useTableOrder(id: string | null) {
  const fetcher = async (): Promise<Order | null> => {
    if (!id) return null;
    const res = await fetch(`/api/table/orders/${id}`);
    const data = await res.json();
    if (res.status === 404) return null;
    if (!res.ok || !data.ok) throw new Error(data.error ?? "fetch_failed");
    return data.order as Order;
  };
  const { data, loading, error, refresh } = usePolling(fetcher, 2000);
  return { order: data, loading, error, refresh };
}
