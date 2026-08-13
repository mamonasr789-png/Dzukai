import { requireStaffRole } from "../../../../../lib/server/auth/requireSession";
import { getStaffAccountStore } from "../../../../../lib/server/staffAccountStore";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const session = await requireStaffRole("admin");
  if (!session) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const store = await getStaffAccountStore();
  if (!store) {
    return Response.json({ ok: false, error: "store_not_configured" }, { status: 503 });
  }

  const { id } = await params;
  const account = await store.findById(id);
  if (!account) {
    return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  // Admin accounts are created outside the panel (scripts/create-staff-account.mjs);
  // the panel must not be able to delete them, including by accident.
  if (account.role === "admin") {
    return Response.json({ ok: false, error: "cannot_delete_admin" }, { status: 403 });
  }

  await store.remove(id);
  return Response.json({ ok: true });
}
