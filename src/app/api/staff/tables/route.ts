import { z } from "zod";
import { requireStaffRole } from "../../../../lib/server/auth/requireSession";
import {
  DuplicateTableNumberError,
  getRestaurantTableStore,
} from "../../../../lib/server/restaurantTableStore";
import {
  getTableAccessTokenSecret,
  signTableAccessToken,
} from "../../../../lib/server/tableAccessToken";

export const runtime = "nodejs";

const CreateTableRequestSchema = z
  .object({
    tableNumber: z.string().trim().min(1).max(20),
  })
  .strict();

/**
 * Table numbers only ever need re-signing, never storing — the link is
 * deterministic from tableNumber + secret. Deliberately never throws: this
 * runs after the table row is already written, so a signing hiccup must
 * degrade to a missing link, not fail a creation/list request that already
 * succeeded at the database level (that used to report "try again" to the
 * admin while silently leaving the row in place, so a retry then hit 409
 * "already exists" for a table the panel had never actually shown).
 */
function linkFor(tableNumber: string): string | null {
  try {
    const secret = getTableAccessTokenSecret();
    if (!secret) return null;
    const token = signTableAccessToken(tableNumber, secret);
    return `/menu?tableToken=${token}`;
  } catch {
    return null;
  }
}

export async function GET(): Promise<Response> {
  const session = await requireStaffRole("admin");
  if (!session) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const store = await getRestaurantTableStore();
  if (!store) {
    return Response.json({ ok: false, error: "store_not_configured" }, { status: 503 });
  }
  const tables = await store.list();
  return Response.json({
    ok: true,
    tables: tables.map((table) => ({ ...table, link: linkFor(table.tableNumber) })),
  });
}

export async function POST(request: Request): Promise<Response> {
  const session = await requireStaffRole("admin");
  if (!session) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const store = await getRestaurantTableStore();
  if (!store) {
    return Response.json({ ok: false, error: "store_not_configured" }, { status: 503 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const parsed = CreateTableRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }

  try {
    const table = await store.create(parsed.data.tableNumber);
    return Response.json(
      { ok: true, table: { ...table, link: linkFor(table.tableNumber) } },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof DuplicateTableNumberError) {
      return Response.json({ ok: false, error: "table_exists" }, { status: 409 });
    }
    throw error;
  }
}
