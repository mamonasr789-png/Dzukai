import { requireTableAccess } from "../../../../lib/server/auth/requireTableAccess";
import { getTrackableSessionWithOrders } from "../../../../lib/server/orderService";
import { estimateOrderEta } from "../../../../lib/server/etaPrediction";
import type { GroupWaitEstimate } from "../../../../lib/foodGroups";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const access = await requireTableAccess();
  if (!access) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const { session, orders } = await getTrackableSessionWithOrders(access.tableNumber, access.visitId);
    const estimatedMinutesByOrderId: Record<string, number | null> = {};
    const estimatedMinutesByGroupByOrderId: Record<string, GroupWaitEstimate[]> = {};
    for (const order of orders) {
      const eta = await estimateOrderEta(order);
      estimatedMinutesByOrderId[order.id] = eta.estimatedMinutes;
      estimatedMinutesByGroupByOrderId[order.id] = eta.estimatedMinutesByGroup;
    }
    return Response.json({
      ok: true,
      session,
      orders,
      estimatedMinutesByOrderId,
      estimatedMinutesByGroupByOrderId,
    });
  } catch {
    return Response.json({ ok: false, error: "store_not_configured" }, { status: 503 });
  }
}
