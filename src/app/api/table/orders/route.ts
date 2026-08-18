import { z } from "zod";
import { requireTableAccess } from "../../../../lib/server/auth/requireTableAccess";
import { submitOrder } from "../../../../lib/server/orderService";

export const runtime = "nodejs";

const ItemSchema = z
  .object({
    productId: z.string().trim().min(1),
    name: z.string().trim().min(1),
    price: z.number().nonnegative(),
    quantity: z.number().int().positive(),
  })
  .strict();

const BodySchema = z
  .object({
    items: z.array(ItemSchema).min(1),
    total: z.number().nonnegative(),
    notes: z.string().max(500).optional(),
    language: z.string().max(10).optional(),
    servingPreference: z.enum(["together", "as_ready"]).optional(),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  const access = await requireTableAccess();
  if (!access) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }
  try {
    const { order, session } = await submitOrder({
      tableNumber: access.tableNumber,
      items: parsed.data.items,
      total: parsed.data.total,
      notes: parsed.data.notes,
      language: parsed.data.language,
      servingPreference: parsed.data.servingPreference,
    });
    return Response.json({ ok: true, order, session }, { status: 201 });
  } catch {
    return Response.json({ ok: false, error: "store_not_configured" }, { status: 503 });
  }
}
