import { z } from "zod";
import { requireStaffRole } from "../../../../../../lib/server/auth/requireSession";
import { updateOrderStatus } from "../../../../../../lib/server/orderService";

export const runtime = "nodejs";

const BodySchema = z
  .object({
    status: z.enum(["NEW", "CANCELLED"]),
  })
  .strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const session = await requireStaffRole("waiter");
  if (!session) {
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
  const { id } = await params;
  try {
    const order = await updateOrderStatus(id, parsed.data.status);
    if (!order) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    return Response.json({ ok: true, order });
  } catch {
    return Response.json({ ok: false, error: "store_not_configured" }, { status: 503 });
  }
}
