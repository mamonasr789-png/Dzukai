import { getStaffSession } from "../../../../../lib/server/auth/requireSession";
import { getOrder } from "../../../../../lib/server/orderService";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const session = await getStaffSession();
  if (!session) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  try {
    const order = await getOrder(id);
    if (!order) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    return Response.json({ ok: true, order });
  } catch {
    return Response.json({ ok: false, error: "store_not_configured" }, { status: 503 });
  }
}
