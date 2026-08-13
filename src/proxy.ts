import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  STAFF_SESSION_COOKIE,
  getStaffSessionSecret,
  roleAllows,
  verifyStaffSession,
  type StaffRole,
} from "./lib/server/auth/session";

/**
 * Optimistic gate for the staff areas: reads and verifies the signed cookie
 * only (no DB call — Proxy runs on every request, including prefetches, so it
 * must stay cheap). The API routes under /api/staff re-verify against the
 * session for the actual authorization decision; this is the first line, not
 * the only one.
 */

const ROLE_HOME: Record<StaffRole, string> = {
  admin: "/admin",
  waiter: "/waiter",
  kitchen: "/kitchen",
};

function roleForPath(pathname: string): StaffRole | null {
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/waiter")) return "waiter";
  if (pathname.startsWith("/kitchen")) return "kitchen";
  return null;
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  const secret = getStaffSessionSecret();
  const token = request.cookies.get(STAFF_SESSION_COOKIE)?.value;
  const verification = secret ? verifyStaffSession(token, secret) : { ok: false as const };
  const session = verification.ok ? verification.payload : null;

  if (pathname === "/staff-login") {
    if (session) {
      return NextResponse.redirect(new URL(ROLE_HOME[session.role], request.url));
    }
    return NextResponse.next();
  }

  // /app (the role hub) stays public by design: staff open it without a
  // session and only hit a login wall once they tap into a specific role.
  const requiredRole = roleForPath(pathname);
  if (!requiredRole) {
    return NextResponse.next();
  }

  if (!session) {
    const loginUrl = new URL("/staff-login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (!roleAllows(session.role, requiredRole)) {
    return NextResponse.redirect(new URL(ROLE_HOME[session.role], request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/waiter/:path*", "/kitchen/:path*", "/staff-login"],
};
