import { getStaffSession } from "../../../../lib/server/auth/requireSession";
import { listOrders } from "../../../../lib/server/orderService";
import { visibleTableNumbersForWaiter } from "../../../../lib/server/waiterTableAccess";

export const runtime = "nodejs";

// Kitchen and admin boards read the full order list. A waiter only sees
// orders for tables assigned to them (plus any still-unassigned table) —
// see waiterTableAccess.ts.
export async function GET(): Promise<Response> {
  const session = await getStaffSession();
  if (!session) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    let orders = await listOrders();
    if (session.role === "waiter") {
      const visible = await visibleTableNumbersForWaiter(session.accountId);
      orders = orders.filter((o) => o.tableNumber === null || visible.has(o.tableNumber));
    }
    return Response.json({ ok: true, orders });
  } catch {
    return Response.json({ ok: false, error: "store_not_configured" }, { status: 503 });
  }
}
