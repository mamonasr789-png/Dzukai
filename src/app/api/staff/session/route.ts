import { getStaffSession } from "../../../../lib/server/auth/requireSession";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const session = await getStaffSession();
  if (!session) {
    return Response.json({ ok: false }, { status: 401 });
  }
  return Response.json({
    ok: true,
    accountId: session.accountId,
    username: session.username,
    role: session.role,
  });
}
