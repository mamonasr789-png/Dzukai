import { requireTableAccess } from "../../../../lib/server/auth/requireTableAccess";
import { getTrackableSessionWithOrders } from "../../../../lib/server/orderService";
import { estimateEtaMinutes } from "../../../../lib/server/etaPrediction";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const access = await requireTableAccess();
  if (!access) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const { session, orders } = await getTrackableSessionWithOrders(access.tableNumber);
    const estimatedMinutesByOrderId: Record<string, number | null> = {};
    for (const order of orders) {
      estimatedMinutesByOrderId[order.id] = await estimateEtaMinutes(order);
    }
    return Response.json({ ok: true, session, orders, estimatedMinutesByOrderId });
  } catch {
    return Response.json({ ok: false, error: "store_not_configured" }, { status: 503 });
  }
}
