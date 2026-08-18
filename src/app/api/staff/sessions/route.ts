import { getStaffSession } from "../../../../lib/server/auth/requireSession";
import { listSessions } from "../../../../lib/server/orderService";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const session = await getStaffSession();
  if (!session) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const sessions = await listSessions();
    return Response.json({ ok: true, sessions });
  } catch {
    return Response.json({ ok: false, error: "store_not_configured" }, { status: 503 });
  }
}
