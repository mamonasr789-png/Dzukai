import { getStaffSession } from "../../../../lib/server/auth/requireSession";
import { listSessions } from "../../../../lib/server/orderService";
import { visibleTableNumbersForWaiter } from "../../../../lib/server/waiterTableAccess";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const session = await getStaffSession();
  if (!session) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    let sessions = await listSessions();
    if (session.role === "waiter") {
      const visible = await visibleTableNumbersForWaiter(session.accountId);
      sessions = sessions.filter((s) => s.tableNumber === null || visible.has(s.tableNumber));
    }
    return Response.json({ ok: true, sessions });
  } catch {
    return Response.json({ ok: false, error: "store_not_configured" }, { status: 503 });
  }
}
