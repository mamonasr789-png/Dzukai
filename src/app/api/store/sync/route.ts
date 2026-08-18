import { z } from "zod";
import { requireStaffRole } from "../../../../lib/server/auth/requireSession";
import {
  SYNC_COLLECTIONS,
  getSyncStore,
  type SyncCollection,
} from "../../../../lib/server/syncStore";
import { purgeAllAiWaiterData } from "../../../../lib/ai-waiter/server/aiWaiterDb";

export const runtime = "nodejs";

const MAXIMUM_BODY_BYTES = 512 * 1024;

const RecordSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    data: z.string().min(2).max(64 * 1024),
    updatedAt: z.string().trim().min(1).max(40),
  })
  .strict();

// No cap here deliberately — see MAX_PUSH_RECORDS below. A hard schema-level
// cap made an oversized push fail validation for the WHOLE request, which
// silently killed the pull half too (same request, same response) — a device
// that ever accumulated more unsynced local records than the cap (weeks of
// pre-sync local testing, a missed deploy, whatever) would then never receive
// updates again, from that point on, even across reloads, since localStorage
// persists and the same oversized diff gets recomputed every tick.
const CollectionRequestSchema = z
  .object({
    since: z.number().int().min(0),
    push: z.array(RecordSchema).default([]),
  })
  .strict();

const SyncRequestSchema = z
  .object({
    collections: z
      .object({
        orders: CollectionRequestSchema.optional(),
        sessions: CollectionRequestSchema.optional(),
        tasks: CollectionRequestSchema.optional(),
      })
      .strict(),
  })
  .strict();

/** Applied per-collection, after parsing — an oversized push is trimmed
 * (oldest-first, keeping the most recent local changes) rather than
 * rejecting the whole request, so the pull half always still goes through. */
const MAX_PUSH_RECORDS = 500;

function unauthorized(request: Request): boolean {
  // Optional shared secret until real staff accounts exist. Unset = open,
  // which is acceptable for local demos only — set SYNC_TOKEN on any server
  // that faces the internet.
  const token = process.env.SYNC_TOKEN;
  if (!token) return false;
  return request.headers.get("x-sync-token") !== token;
}

export async function POST(request: Request): Promise<Response> {
  const store = await getSyncStore();
  if (!store) {
    return Response.json(
      { ok: false, error: "sync_not_configured" },
      { status: 503 }
    );
  }
  if (unauthorized(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const raw = await request.text();
  if (raw.length > MAXIMUM_BODY_BYTES) {
    return Response.json({ ok: false, error: "payload_too_large" }, { status: 413 });
  }
  let parsed;
  try {
    parsed = SyncRequestSchema.safeParse(JSON.parse(raw));
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (!parsed.success) {
    return Response.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }

  const result: Record<
    string,
    { records: { id: string; data: string; updatedAt: string }[]; watermark: number }
  > = {};
  for (const collection of SYNC_COLLECTIONS) {
    const req = parsed.data.collections[collection as SyncCollection];
    if (!req) continue;
    if (req.push.length > 0) {
      // A push problem (one bad record, a DB hiccup) must never block the
      // pull below — a device that can only ever push a broken diff would
      // otherwise never receive anyone else's updates again either, since
      // both directions used to live or die together in one response.
      try {
        await store.push(collection, req.push.slice(0, MAX_PUSH_RECORDS));
      } catch {
        // next tick retries the push; the pull still goes through this tick.
      }
    }
    const { records, watermark } = await store.pull(collection, req.since);
    result[collection] = {
      records: records.map(({ id, data, updatedAt }) => ({ id, data, updatedAt })),
      watermark,
    };
  }

  return Response.json(
    { ok: true, collections: result },
    { headers: { "cache-control": "no-store" } }
  );
}

/**
 * Admin "clear test data" — wipes orders/sessions/tasks for every device,
 * plus every AI-waiter dining session, cart and staff request. Not the menu,
 * not staff accounts.
 */
export async function DELETE(): Promise<Response> {
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
