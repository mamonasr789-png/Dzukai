import { cookies } from "next/headers";
import { STAFF_SESSION_COOKIE } from "../../../../lib/server/auth/session";

export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  const cookieStore = await cookies();
  cookieStore.delete(STAFF_SESSION_COOKIE);
  return Response.json({ ok: true });
}
