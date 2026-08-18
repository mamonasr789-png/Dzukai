import { z } from "zod";
import { requireStaffRole } from "../../../../../../lib/server/auth/requireSession";
import { updateTaskStatus } from "../../../../../../lib/server/taskService";

export const runtime = "nodejs";

const BodySchema = z.object({ status: z.enum(["accepted", "completed"]) }).strict();

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
  const staff = { id: session.accountId, username: session.username };
  try {
    const task = await updateTaskStatus(id, parsed.data.status, staff);
    if (!task) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    return Response.json({ ok: true, task });
  } catch {
    return Response.json({ ok: false, error: "store_not_configured" }, { status: 503 });
  }
}
