import { requireStaffRole } from "../../../../../../lib/server/auth/requireSession";
import { settleSessionByWaiter } from "../../../../../../lib/server/orderService";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ tableNumber: string }> }
): Promise<Response> {
  const session = await requireStaffRole("waiter");
  if (!session) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { tableNumber } = await params;
  const staff = { id: session.accountId, username: session.username };
  try {
    const result = await settleSessionByWaiter(decodeURIComponent(tableNumber), staff);
    if (!result) return Response.json({ ok: false, error: "no_open_session" }, { status: 404 });
    return Response.json({ ok: true, session: result.session });
  } catch {
    return Response.json({ ok: false, error: "store_not_configured" }, { status: 503 });
  }
}
