import { requireTableAccess } from "../../../../../lib/server/auth/requireTableAccess";
import { getOrder } from "../../../../../lib/server/orderService";
import { estimateEtaMinutes } from "../../../../../lib/server/etaPrediction";

export const runtime = "nodejs";

/**
 * Order-tracking lookup by id. Requires a valid table cookie to exist (proves
 * this device passed the QR gate) but — matching today's behavior — does not
 * require the order to belong to THIS device's table: a customer can still be
 * tracking an order after their table cookie's table differs (e.g. moved
 * tables), same as the old client-only /order?id= page allowed.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const access = await requireTableAccess();
  if (!access) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  try {
    const order = await getOrder(id);
    if (!order) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    const estimatedMinutes = await estimateEtaMinutes(order);
    return Response.json({ ok: true, order, estimatedMinutes });
  } catch {
    return Response.json({ ok: false, error: "store_not_configured" }, { status: 503 });
  }
}
