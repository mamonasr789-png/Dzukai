import { requireTableAccess } from "../../../../lib/server/auth/requireTableAccess";
import { recordTableScanned } from "../../../../lib/server/taskService";

export const runtime = "nodejs";

/**
 * Fired once per browser per dining visit, right after proxy.ts's table gate
 * passes — gives /waiter an immediate heads-up so staff can glance over and
 * confirm someone is actually sitting there, well before any order exists.
 * No real order yet, so this uses a synthetic orderId (same trick as
 * src/lib/ai-waiter/server/staffTaskPort.ts's `ai:${sessionId}`) so each scan
 * gets its own card in /waiter instead of colliding into one group.
 *
 * Table identity is the signed vaise_table_access cookie only. A JSON body
 * tableNumber is ignored so this cannot spam waiter cards for arbitrary
 * tables without a real QR scan.
 */
export async function POST(): Promise<Response> {
  const access = await requireTableAccess();
  if (!access) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    await recordTableScanned(access.tableNumber);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ ok: false, error: "sync_not_configured" }, { status: 503 });
  }
}
