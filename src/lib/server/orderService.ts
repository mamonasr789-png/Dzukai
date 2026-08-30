import "server-only";

import { getSyncStore, pullAllRecords } from "./syncStore.ts";
import {
  deriveOrderStatus,
  normalizeOrder,
  OPEN_SESSION_STATUSES,
  ACTIVE_ORDER_STATUSES,
  type Order,
  type OrderItem,
  type OrderStatus,
  type ServingPreference,
  type StaffStamp,
  type TableSession,
  type SessionStatus,
} from "../orderTypes.ts";
import { createUniqueTask, completeTasksForOrders } from "./taskService.ts";
import { OrderPricingError, priceGuestOrderItems } from "./menuCatalog.ts";

export { OrderPricingError };

/**
 * Server-side twin of the old src/lib/orders.ts + src/lib/tableSession.ts —
 * the ONLY place that reads/writes order and session data now. Every request
 * does a full read-modify-write against the shared Postgres/SQLite store
 * (src/lib/server/syncStore.ts) so every device sees the same thing on its
 * next poll, instead of each device keeping its own localStorage copy that
 * could silently and permanently fall behind (the bug this rewrite replaces).
 *
 * Concurrency note: each function here does its read + write as two separate
 * store calls, not one DB transaction — a genuine race between two concurrent
 * requests for the SAME table (e.g. a double-tap) has a narrow window to both
 * observe the pre-write state. Given real request latency and realistic
 * restaurant concurrency (one phone per table), this is a low-probability,
 * low-severity edge case (a duplicate task, not lost data) and a large
 * improvement over the old per-device races. A Postgres advisory lock or a
 * move to relational tables with a unique partial index is the fast-follow if
 * it ever matters in practice — not done here.
 */

function generateOrderId(): string {
  return Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
}

function generateSessionId(): string {
  return "S" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 4).toUpperCase();
}

async function pullOrders(): Promise<Order[]> {
  const store = await getSyncStore();
  if (!store) throw new Error("store_not_configured");
  const records = await pullAllRecords(store, "orders");
  return records.map((r) => normalizeOrder(JSON.parse(r.data) as Order));
}

/**
 * Point lookup by id — skips walking the whole orders collection. Every
 * single-order mutation below used to pull the entire collection just to
 * find one row by id; as the collection grew, that turned routine writes
 * into a real production cost incident (see SyncStore.getRecord's doc).
 */
async function getOrderRecord(id: string): Promise<Order | undefined> {
  const store = await getSyncStore();
  if (!store) throw new Error("store_not_configured");
  const record = await store.getRecord("orders", id);
  if (!record) return undefined;
  return normalizeOrder(JSON.parse(record.data) as Order);
}

async function pullSessions(): Promise<TableSession[]> {
  const store = await getSyncStore();
  if (!store) throw new Error("store_not_configured");
  const records = await pullAllRecords(store, "sessions");
  return records.map((r) => JSON.parse(r.data) as TableSession);
}

async function pushOrder(order: Order): Promise<void> {
  const store = await getSyncStore();
  if (!store) throw new Error("store_not_configured");
  await store.push("orders", [{ id: order.id, data: JSON.stringify(order), updatedAt: order.updatedAt ?? order.createdAt }]);
}

async function pushSession(session: TableSession): Promise<void> {
  const store = await getSyncStore();
  if (!store) throw new Error("store_not_configured");
  await store.push("sessions", [{ id: session.id, data: JSON.stringify(session), updatedAt: session.updatedAt }]);
}

export async function getOrder(id: string): Promise<Order | undefined> {
  return getOrderRecord(id);
}

export async function listOrders(): Promise<Order[]> {
  return pullOrders();
}

export async function listSessions(): Promise<TableSession[]> {
  return pullSessions();
}

function findOpenSessionForTable(sessions: TableSession[], tableNumber: string | null): TableSession | null {
  return sessions.find((s) => OPEN_SESSION_STATUSES.includes(s.status) && s.tableNumber === tableNumber) ?? null;
}

/**
 * The session a customer at this table can still see/track on /order and /cart.
 * Mirrors the old tableSession.ts getTrackableSession() resolution order exactly:
 *   1. the open session (ACTIVE/BILL_REQUESTED) for this table, if any
 *   2. else the session owning the most recent still-active order for this table
 *   3. else null
 */
export async function getTrackableSessionWithOrders(
  tableNumber: string | null
): Promise<{ session: TableSession | null; orders: Order[] }> {
  const sessions = await pullSessions();

  // Common/steady-state case (customer polls every 2s while a session is
  // open) — the session already names its exact order ids, so point lookups
  // replace what used to be a full orders-collection pull on every poll.
  const open = findOpenSessionForTable(sessions, tableNumber);
  if (open) {
    const orders = (await Promise.all(open.orderIds.map((id) => getOrderRecord(id)))).filter(
      (o): o is Order => o !== undefined
    );
    return { session: open, orders };
  }

  // Rare fallback (session just closed/paid) — genuinely needs to search all
  // orders by table + status, which has no id to look up by yet.
  const orders = await pullOrders();
  const activeOrders = orders
    .filter((o) => ACTIVE_ORDER_STATUSES.includes(o.status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const order of activeOrders) {
    const owner = sessions.find((s) => s.orderIds.includes(order.id) && s.tableNumber === tableNumber);
    if (owner) {
      return { session: owner, orders: orders.filter((o) => owner.orderIds.includes(o.id)) };
    }
  }

  return { session: null, orders: [] };
}

/**
 * Create a new order for a table and attach it to that table's open session
 * (creating one if none is open) — the atomic twin of the old cart/page.tsx
 * handleSubmit(), which used to do this as four separate local writes.
 * First order of a visit → PENDING_CONFIRMATION + order_confirmation task.
 * Subsequent orders → additional_order task.
 */
export async function submitOrder(params: {
  tableNumber: string;
  items: Array<{ productId: string; quantity: number; name?: string; price?: number }>;
  total?: number;
  notes?: string;
  language?: string;
  servingPreference?: ServingPreference;
}): Promise<{ order: Order; session: TableSession }> {
  const priced = await priceGuestOrderItems(params.items);
  const createdAt = new Date().toISOString();
  const isFirstOrder = !findOpenSessionForTable(await pullSessions(), params.tableNumber);

  const order: Order = {
    id: generateOrderId(),
    tableNumber: params.tableNumber,
    createdAt,
    updatedAt: createdAt,
    status: isFirstOrder ? "PENDING_CONFIRMATION" : "NEW",
    items: priced.items.map((i) => ({ ...i, itemStatus: isFirstOrder ? "PENDING_CONFIRMATION" : "NEW" })),
    total: priced.total,
    notes: params.notes ?? "",
    language: params.language ?? "lt",
    servingPreference: params.servingPreference ?? "together",
  };
  await pushOrder(order);

  // Re-pull sessions after the order write to attach to the freshest state.
  const sessions = await pullSessions();
  const openIdx = sessions.findIndex(
    (s) => OPEN_SESSION_STATUSES.includes(s.status) && s.tableNumber === params.tableNumber
  );
  let session: TableSession;
  if (openIdx !== -1) {
    session = {
      ...sessions[openIdx],
      orderIds: sessions[openIdx].orderIds.includes(order.id)
        ? sessions[openIdx].orderIds
        : [...sessions[openIdx].orderIds, order.id],
      updatedAt: new Date().toISOString(),
    };
  } else {
    session = {
      id: generateSessionId(),
      tableNumber: params.tableNumber,
      orderIds: [order.id],
      status: "ACTIVE",
      createdAt,
      updatedAt: createdAt,
    };
  }
  await pushSession(session);

  const items = order.items.map((i) => ({ productId: i.productId, name: i.name, quantity: i.quantity }));
  if (isFirstOrder) {
    await createUniqueTask(`order:${order.id}:order_confirmation`, {
      type: "order_confirmation",
      orderId: order.id,
      tableNumber: params.tableNumber,
      items,
    });
  } else {
    await createUniqueTask(`order:${order.id}:additional_order`, {
      type: "additional_order",
      orderId: order.id,
      tableNumber: params.tableNumber,
      items,
    });
  }

  return { order, session };
}

async function saveOrderAndMaybeGenerateTask(order: Order): Promise<Order> {
  await pushOrder(order);
  if (order.status === "READY") await generateReadyToServeTask(order);
  return order;
}

/** Update a single item's status and re-derive the order status. */
export async function updateItemStatus(
  orderId: string,
  productId: string,
  status: OrderStatus,
  staff?: StaffStamp
): Promise<Order | undefined> {
  const order = await getOrderRecord(orderId);
  if (!order) return undefined;

  const now = new Date().toISOString();
  const updatedItems = order.items.map((i) =>
    i.productId === productId
      ? {
          ...i,
          itemStatus: status,
          ...(status === "READY" && staff ? { preparedBy: staff, preparedAt: now } : null),
        }
      : i
  );
  const updated: Order = {
    ...order,
    items: updatedItems,
    status: deriveOrderStatus(updatedItems, order.servingPreference),
    updatedAt: now,
  };
  return saveOrderAndMaybeGenerateTask(updated);
}

/** Update the whole order status at once (also sets all items). */
export async function updateOrderStatus(id: string, status: OrderStatus): Promise<Order | undefined> {
  const order = await getOrderRecord(id);
  if (!order) return undefined;
  const updated: Order = {
    ...order,
    status,
    items: order.items.map((i) => ({ ...i, itemStatus: status })),
    updatedAt: new Date().toISOString(),
  };
  return saveOrderAndMaybeGenerateTask(updated);
}

export async function confirmFirstOrder(orderId: string): Promise<Order | undefined> {
  return updateOrderStatus(orderId, "NEW");
}

export async function rejectFirstOrder(orderId: string): Promise<Order | undefined> {
  return updateOrderStatus(orderId, "CANCELLED");
}

/** Waiter accepts delivery — READY → DELIVERING for the given items (all READY items if empty). */
export async function startItemsDelivery(orderId: string, productIds: string[]): Promise<Order | undefined> {
  const order = await getOrderRecord(orderId);
  if (!order) return undefined;

  const targets = new Set(productIds.length ? productIds : order.items.map((i) => i.productId));
  const updatedItems = order.items.map((i) =>
    targets.has(i.productId) && (i.itemStatus ?? "NEW") === "READY"
      ? { ...i, itemStatus: "DELIVERING" as OrderStatus }
      : i
  );
  const updated: Order = {
    ...order,
    items: updatedItems,
    status: deriveOrderStatus(updatedItems, order.servingPreference),
    updatedAt: new Date().toISOString(),
  };
  await pushOrder(updated);
  return updated;
}

/** Waiter delivered — DELIVERING → COMPLETED for the given items (all DELIVERING items if empty). */
export async function completeItemsDelivery(
  orderId: string,
  productIds: string[],
  staff?: StaffStamp
): Promise<Order | undefined> {
  const order = await getOrderRecord(orderId);
  if (!order) return undefined;

  const now = new Date().toISOString();
  const targets = new Set(productIds.length ? productIds : order.items.map((i) => i.productId));
  const updatedItems = order.items.map((i) =>
    targets.has(i.productId) && (i.itemStatus ?? "NEW") === "DELIVERING"
      ? { ...i, itemStatus: "COMPLETED" as OrderStatus, ...(staff ? { deliveredBy: staff, deliveredAt: now } : null) }
      : i
  );
  const updated: Order = {
    ...order,
    items: updatedItems,
    status: deriveOrderStatus(updatedItems, order.servingPreference),
    updatedAt: now,
  };
  await pushOrder(updated);
  return updated;
}

/**
 * Replaces the old client-side syncReadyToServeTasks() — that used to re-scan
 * EVERY order on every waiter-page poll. Now called exactly once, here, at
 * the moment an order's derived status actually becomes READY.
 */
export async function generateReadyToServeTask(order: Order): Promise<void> {
  const pref = order.servingPreference ?? "together";
  if (pref === "together") {
    const readyItems = order.items
      .filter((i) => (i.itemStatus ?? order.status) === "READY" || (i.itemStatus ?? order.status) === "COMPLETED")
      .map((i) => ({ productId: i.productId, name: i.name, quantity: i.quantity }));
    await createUniqueTask(`${order.id}:order:READY`, {
      type: "ready_to_serve",
      orderId: order.id,
      tableNumber: order.tableNumber,
      items: readyItems,
    });
  } else {
    for (const item of order.items) {
      const itemStatus = item.itemStatus ?? order.status;
      if (itemStatus !== "READY" && itemStatus !== "COMPLETED") continue;
      await createUniqueTask(`${order.id}:item:${item.productId}:READY`, {
        type: "ready_to_serve",
        orderId: order.id,
        tableNumber: order.tableNumber,
        items: [{ productId: item.productId, name: item.name, quantity: item.quantity }],
      });
    }
  }
}

async function markOrderPaid(order: Order): Promise<Order> {
  if (order.isPaid) return order;
  const updated: Order = { ...order, isPaid: true, paidAt: order.paidAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() };
  await pushOrder(updated);
  return updated;
}

/** Session-scoped payment triggered by the waiter accepting a bill_requested task. */
export async function settleSessionByWaiter(
  tableNumber: string,
  staff?: StaffStamp
): Promise<{ session: TableSession } | null> {
  const sessions = await pullSessions();
  const session = findOpenSessionForTable(sessions, tableNumber);
  if (!session) return null;

  for (const id of session.orderIds) {
    const order = await getOrderRecord(id);
    if (order) await markOrderPaid(order);
  }
  await completeTasksForOrders(session.orderIds, staff);

  const updatedSession: TableSession = {
    ...session,
    status: "PAID",
    paymentMethod: "WAITER",
    paymentStatus: "PAID",
    updatedAt: new Date().toISOString(),
  };
  await pushSession(updatedSession);
  return { session: updatedSession };
}

/** In-app payment triggered by the customer — pays only the given orders, all of which
 *  must belong to the table's trackable session (never trust a client-supplied tableNumber). */
export async function payOrdersByCustomer(
  tableNumber: string,
  orderIds: string[]
): Promise<{ allPaid: boolean }> {
  const { session, orders: sessionOrders } = await getTrackableSessionWithOrders(tableNumber);
  const allowedIds = new Set(sessionOrders.map((o) => o.id));
  const targetIds = orderIds.filter((id) => allowedIds.has(id));

  for (const id of targetIds) {
    const order = sessionOrders.find((o) => o.id === id);
    if (order) await markOrderPaid(order);
  }

  if (!session) return { allPaid: false };
  const freshOrders = await Promise.all(session.orderIds.map((id) => getOrderRecord(id)));
  const allPaid = freshOrders.every((o) => o?.isPaid === true);
  if (allPaid) {
    await completeTasksForOrders(session.orderIds);
    const updatedSession: TableSession = {
      ...session,
      status: "PAID",
      paymentMethod: "APP",
      paymentStatus: "PAID",
      updatedAt: new Date().toISOString(),
    };
    await pushSession(updatedSession);
  }
  return { allPaid };
}

export async function requestBill(tableNumber: string): Promise<{ session: TableSession } | null> {
  const sessions = await pullSessions();
  const session = findOpenSessionForTable(sessions, tableNumber);
  if (!session) return null;
  const updated: TableSession = { ...session, status: "BILL_REQUESTED", updatedAt: new Date().toISOString() };
  await pushSession(updated);

  const anchorOrderId = session.orderIds[session.orderIds.length - 1] ?? "unknown";
  await createUniqueTask(`session:${session.id}:bill_requested`, {
    type: "bill_requested",
    orderId: anchorOrderId,
    tableNumber,
  });
  return { session: updated };
}

export async function callWaiter(tableNumber: string): Promise<void> {
  const sessions = await pullSessions();
  const session = findOpenSessionForTable(sessions, tableNumber);
  const anchorOrderId = session?.orderIds[session.orderIds.length - 1] ?? "unknown";
  await createUniqueTask(`session:${session?.id ?? tableNumber}:waiter_called`, {
    type: "waiter_called",
    orderId: anchorOrderId,
    tableNumber,
  });
}

export type { SessionStatus };
