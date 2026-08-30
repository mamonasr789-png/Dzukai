import { requireStaffRole } from "../../../../lib/server/auth/requireSession";
import { getSyncStore } from "../../../../lib/server/syncStore";
import { purgeAllAiWaiterData } from "../../../../lib/ai-waiter/server/aiWaiterDb";

export const runtime = "nodejs";

/**
 * Admin "clear test data" — wipes orders/sessions/tasks for every device,
 * plus every AI-waiter dining session, cart and staff request. Not the menu,
 * not staff accounts.
 */
export async function DELETE(): Promise<Response> {
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ ok: false, error: "not_available" }, { status: 403 });
  }
  const session = await requireStaffRole("admin");
  if (!session) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const store = await getSyncStore();
  if (!store) {
    return Response.json({ ok: false, error: "sync_not_configured" }, { status: 503 });
  }
  await store.purgeAll();
  await purgeAllAiWaiterData();
  return Response.json({ ok: true });
}
