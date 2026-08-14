import { getStaffSession } from "../../../../lib/server/auth/requireSession";
import { getStaffAccountStore } from "../../../../lib/server/staffAccountStore";

export const runtime = "nodejs";

/** Pinged periodically by authenticated /waiter, /kitchen and /admin tabs so
 *  the admin panel can show who's currently working (green dot = recent ping). */
export async function POST(): Promise<Response> {
  const session = await getStaffSession();
  if (!session) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const store = await getStaffAccountStore();
  if (!store) {
    return Response.json({ ok: false, error: "store_not_configured" }, { status: 503 });
  }
  await store.touchLastSeen(session.accountId);
  return Response.json({ ok: true });
}
