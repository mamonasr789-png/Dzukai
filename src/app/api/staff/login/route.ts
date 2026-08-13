import { cookies } from "next/headers";
import { z } from "zod";
import { verifyPassword } from "../../../../lib/server/auth/password";
import {
  STAFF_SESSION_COOKIE,
  getStaffSessionSecret,
  signStaffSession,
} from "../../../../lib/server/auth/session";
import { getStaffAccountStore } from "../../../../lib/server/staffAccountStore";

export const runtime = "nodejs";

const LoginRequestSchema = z
  .object({
    username: z.string().trim().min(1).max(60),
    password: z.string().min(1).max(200),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  const secret = getStaffSessionSecret();
  if (!secret) {
    return Response.json({ ok: false, error: "auth_not_configured" }, { status: 503 });
  }
  const store = await getStaffAccountStore();
  if (!store) {
    return Response.json({ ok: false, error: "auth_not_configured" }, { status: 503 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const parsed = LoginRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }

  const account = await store.findByUsername(parsed.data.username);
  // Constant-shape failure: hash even a nonexistent user's password so the
  // response time doesn't reveal whether the username exists.
  const passwordHash = account?.passwordHash ?? "0".repeat(32) + ":" + "0".repeat(128);
  const passwordOk = await verifyPassword(parsed.data.password, passwordHash);
  if (!account || !passwordOk) {
    return Response.json({ ok: false, error: "invalid_credentials" }, { status: 401 });
  }

  const token = signStaffSession(
    { accountId: account.id, username: account.username, role: account.role },
    secret
  );
  const cookieStore = await cookies();
  cookieStore.set(STAFF_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });

  return Response.json({ ok: true, role: account.role, username: account.username });
}
