"use client";

import { usePolling } from "./usePolling";
import type { Order, OrderStatus, StaffStamp } from "../orderTypes";

async function fetchOrders(): Promise<Order[]> {
  const res = await fetch("/api/staff/orders");
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error ?? "fetch_failed");
  return data.orders as Order[];
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

/**
 * Server-polled order list for kitchen/waiter/admin boards — replaces the old
 * listOrders()/subscribeOrders() localStorage pair. See src/lib/hooks/usePolling.ts.
 */
export function useStaffOrders() {
  const { data, loading, error, refresh } = usePolling(fetchOrders, 2000);
  const orders = data ?? [];

  async function updateItemStatus(
    orderId: string,
    productId: string,
    status: OrderStatus,
    staff?: StaffStamp
  ): Promise<void> {
    await postJson(`/api/staff/orders/${orderId}/item-status`, { productId, status });
    void staff; // staff is derived server-side from the session, kept in the signature for call-site parity
    refresh();
  }

  async function updateOrderStatus(orderId: string, status: "NEW" | "CANCELLED"): Promise<void> {
    await postJson(`/api/staff/orders/${orderId}/status`, { status });
    refresh();
  }

  async function startItemsDelivery(orderId: string, productIds: string[]): Promise<void> {
    await postJson(`/api/staff/orders/${orderId}/start-delivery`, { productIds });
    refresh();
  }

  async function completeItemsDelivery(orderId: string, productIds: string[]): Promise<void> {
    await postJson(`/api/staff/orders/${orderId}/complete-delivery`, { productIds });
    refresh();
  }

  return { orders, loading, error, refresh, updateItemStatus, updateOrderStatus, startItemsDelivery, completeItemsDelivery };
}
