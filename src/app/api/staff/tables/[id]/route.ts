import { z } from "zod";
import { requireStaffRole } from "../../../../../lib/server/auth/requireSession";
import { getRestaurantTableStore } from "../../../../../lib/server/restaurantTableStore";
import { getStaffAccountStore } from "../../../../../lib/server/staffAccountStore";

export const runtime = "nodejs";

const AssignWaiterRequestSchema = z
  .object({
    waiterId: z.string().trim().min(1).max(80).nullable(),
  })
  .strict();

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const session = await requireStaffRole("admin");
  if (!session) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const store = await getRestaurantTableStore();
  if (!store) {
    return Response.json({ ok: false, error: "store_not_configured" }, { status: 503 });
  }

  const { id } = await params;
  await store.remove(id);
  return Response.json({ ok: true });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
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
  const parsed = AssignWaiterRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }

  if (parsed.data.waiterId !== null) {
    const accountStore = await getStaffAccountStore();
    const account = accountStore ? await accountStore.findById(parsed.data.waiterId) : null;
    if (!account || account.role !== "waiter") {
      return Response.json({ ok: false, error: "invalid_waiter" }, { status: 400 });
    }
  }

  const { id } = await params;
  await store.assignWaiter(id, parsed.data.waiterId);
  return Response.json({ ok: true });
}
