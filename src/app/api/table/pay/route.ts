import { z } from "zod";
import { requireTableAccess } from "../../../../lib/server/auth/requireTableAccess";
import { payOrdersByCustomer } from "../../../../lib/server/orderService";

export const runtime = "nodejs";

const BodySchema = z.object({ orderIds: z.array(z.string().trim().min(1)).min(1) }).strict();

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
    const result = await payOrdersByCustomer(access.tableNumber, parsed.data.orderIds);
    return Response.json({ ok: true, ...result });
  } catch {
    return Response.json({ ok: false, error: "store_not_configured" }, { status: 503 });
  }
}
