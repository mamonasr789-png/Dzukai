import { z } from "zod";
import { hashPassword } from "../../../../../lib/server/auth/password";
import { requireStaffRole } from "../../../../../lib/server/auth/requireSession";
import { getStaffAccountStore } from "../../../../../lib/server/staffAccountStore";

export const runtime = "nodejs";

const ResetPasswordRequestSchema = z
  .object({
    password: z.string().min(8).max(200),
  })
  .strict();

/** Admin sets a new password for a waiter/kitchen account — the "forgot my
 *  password" recovery path. Passwords are hashed one-way, so there is no way
 *  to recover the old one; this replaces it instead. */
export async function PATCH(
  request: Request,
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
  if (account.role === "admin") {
    return Response.json({ ok: false, error: "cannot_modify_admin" }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const parsed = ResetPasswordRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }

  await store.updatePassword(id, await hashPassword(parsed.data.password));
  return Response.json({ ok: true });
}

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
