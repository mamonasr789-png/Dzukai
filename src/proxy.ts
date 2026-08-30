import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  STAFF_SESSION_COOKIE,
  getStaffSessionSecret,
  roleAllows,
  verifyStaffSession,
  type StaffRole,
} from "./lib/server/auth/session";
import {
  getTableAccessTokenSecret,
  newTableVisitId,
  signTableVisitToken,
  verifyTableAccessToken,
} from "./lib/server/tableAccessToken";
import { TABLE_ACCESS_COOKIE } from "./lib/tableAccessCookie";

// 12h covers a long beer-restaurant sitting plus buffer; QR token itself does not expire.
const TABLE_ACCESS_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;
const TABLE_GATED_PREFIXES = ["/menu", "/cart", "/ai"];

function isTableGatedPath(pathname: string): boolean {
  return TABLE_GATED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

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

/**
 * Only a printed table QR (or a browser that already scanned one this visit)
 * may reach /menu, /cart, /ai — a bare ?table=N URL no longer works. The
 * signed token is transported once, as a query param on the QR link itself;
 * on success it's exchanged for a same-site cookie so it doesn't need to
 * stay in the URL for every subsequent page. No secret configured in
 * production ⇒ refuse (same policy as the staff-session gate), which here
 * means every gated path redirects to /table-required.
 */
function tableGate(request: NextRequest): NextResponse | null {
  const { pathname } = request.nextUrl;
  if (!isTableGatedPath(pathname)) return null;

  const secret = getTableAccessTokenSecret();

  // A tableToken in the URL is a fresh, explicit scan — it must win over
  // whatever table cookie the device already carries, otherwise a phone that
  // scanned table 1 earlier today silently keeps ordering under table 1 even
  // after scanning table 2's code (the cookie check below would short-circuit
  // first and the new token would never be looked at).
  const queryToken = request.nextUrl.searchParams.get("tableToken") ?? undefined;
  if (queryToken) {
    const queryVerification = secret ? verifyTableAccessToken(queryToken, secret) : { ok: false as const };
    if (queryVerification.ok && secret) {
      const cleanUrl = new URL(pathname, request.url);
      const response = NextResponse.redirect(cleanUrl);
      // Sticker token stays version 1 (printed QR never expires). The cookie
      // is a fresh version-2 visit so a later settle can refuse this visit
      // without invalidating the sticker for the next party.
      const visitToken = signTableVisitToken(
        queryVerification.payload.tableNumber,
        newTableVisitId(),
        secret
      );
      response.cookies.set(TABLE_ACCESS_COOKIE, visitToken, {
        httpOnly: false, // menu/page.tsx reads the table number out of this client-side
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: TABLE_ACCESS_COOKIE_MAX_AGE_SECONDS,
        path: "/",
      });
      return response;
    }
    // An invalid token in the URL must not fall through to an old cookie —
    // a tampered/expired link should fail visibly, not silently keep working
    // under whatever table the device happened to be on before.
    return NextResponse.redirect(new URL("/table-required", request.url));
  }

  const cookieToken = request.cookies.get(TABLE_ACCESS_COOKIE)?.value;
  if (secret && verifyTableAccessToken(cookieToken, secret).ok) {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL("/table-required", request.url));
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  const tableGateResponse = tableGate(request);
  if (tableGateResponse) return tableGateResponse;

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
  matcher: [
    "/admin/:path*",
    "/waiter/:path*",
    "/kitchen/:path*",
    "/staff-login",
    "/menu/:path*",
    "/cart/:path*",
    "/ai/:path*",
  ],
};
