import { requireTableAccess } from "../../../../lib/server/auth/requireTableAccess";

export const runtime = "nodejs";

/**
 * Guest in-app pay is disabled for the paid on-site pilot: the only PSP
 * implementation is a fake always-succeeds delay. Waiter cash/card settle
 * (POST /api/staff/sessions/[tableNumber]/settle) remains the real path.
 */
export async function POST(): Promise<Response> {
  const access = await requireTableAccess();
  if (!access) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return Response.json({ ok: false, error: "guest_pay_disabled" }, { status: 403 });
}
