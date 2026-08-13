import { z } from "zod";
import {
  SYNC_COLLECTIONS,
  getSyncStore,
  type SyncCollection,
} from "../../../../lib/server/syncStore";

export const runtime = "nodejs";

const MAXIMUM_BODY_BYTES = 512 * 1024;

const RecordSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    data: z.string().min(2).max(64 * 1024),
    updatedAt: z.string().trim().min(1).max(40),
  })
  .strict();

const CollectionRequestSchema = z
  .object({
    since: z.number().int().min(0),
    push: z.array(RecordSchema).max(200).default([]),
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

function unauthorized(request: Request): boolean {
  // Optional shared secret until real staff accounts exist. Unset = open,
  // which is acceptable for local demos only — set SYNC_TOKEN on any server
  // that faces the internet.
  const token = process.env.SYNC_TOKEN;
  if (!token) return false;
  return request.headers.get("x-sync-token") !== token;
}

export async function POST(request: Request): Promise<Response> {
  const store = getSyncStore();
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
    if (req.push.length > 0) store.push(collection, req.push);
    const { records, watermark } = store.pull(collection, req.since);
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
