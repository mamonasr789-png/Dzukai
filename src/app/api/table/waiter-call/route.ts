import { requireTableAccess } from "../../../../lib/server/auth/requireTableAccess";
import { callWaiter } from "../../../../lib/server/orderService";

export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  const access = await requireTableAccess();
  if (!access) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    await callWaiter(access.tableNumber);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, error: "store_not_configured" }, { status: 503 });
  }
}
