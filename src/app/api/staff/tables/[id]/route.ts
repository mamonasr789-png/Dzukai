import { requireStaffRole } from "../../../../../lib/server/auth/requireSession";
import { getRestaurantTableStore } from "../../../../../lib/server/restaurantTableStore";

export const runtime = "nodejs";

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
