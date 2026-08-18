import { getStaffSession } from "../../../../lib/server/auth/requireSession";
import { listOrders } from "../../../../lib/server/orderService";

export const runtime = "nodejs";

// Kitchen, waiter and admin boards all read the full order list — any staff
// role may read here (writes are still gated per-role on the mutation routes).
export async function GET(): Promise<Response> {
  const session = await getStaffSession();
  if (!session) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const orders = await listOrders();
    return Response.json({ ok: true, orders });
  } catch {
    return Response.json({ ok: false, error: "store_not_configured" }, { status: 503 });
  }
}
