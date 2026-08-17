import { z } from "zod";
import { getSyncStore } from "../../../../lib/server/syncStore";

export const runtime = "nodejs";

const ScannedRequestSchema = z
  .object({
    tableNumber: z.string().trim().min(1).max(20),
  })
  .strict();

/**
 * Fired once per browser per dining visit, right after proxy.ts's table gate
 * passes — gives /waiter an immediate heads-up so staff can glance over and
 * confirm someone is actually sitting there, well before any order exists.
 * No real order yet, so this uses a synthetic orderId (same trick as
 * src/lib/ai-waiter/server/staffTaskPort.ts's `ai:${sessionId}`) so each scan
 * gets its own card in /waiter instead of colliding into one group.
 */
export async function POST(request: Request): Promise<Response> {
  const store = await getSyncStore();
  if (!store) {
    return Response.json({ ok: false, error: "sync_not_configured" }, { status: 503 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const parsed = ScannedRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }

  const { tableNumber } = parsed.data;
  const now = new Date().toISOString();
  const orderId = `scan:${tableNumber}:${Date.now()}`;
  const task = {
    id: orderId,
    type: "table_scanned" as const,
    status: "waiting" as const,
    orderId,
    tableNumber,
    createdAt: now,
    updatedAt: now,
    triggeredBy: orderId,
    items: [] as { productId: string; name: string; quantity: number }[],
  };
  await store.push("tasks", [{ id: task.id, data: JSON.stringify(task), updatedAt: task.updatedAt }]);
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
