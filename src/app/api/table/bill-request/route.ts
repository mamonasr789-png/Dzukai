import { requireTableAccess } from "../../../../lib/server/auth/requireTableAccess";
import { requestBill } from "../../../../lib/server/orderService";

export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  const access = await requireTableAccess();
  if (!access) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await requestBill(access.tableNumber);
    if (!result) return Response.json({ ok: false, error: "no_open_session" }, { status: 404 });
    return Response.json({ ok: true, session: result.session });
  } catch {
    return Response.json({ ok: false, error: "store_not_configured" }, { status: 503 });
  }
}
