import "server-only";

import { cookies } from "next/headers";
import { verifyTableAccessToken, getTableAccessTokenSecret } from "../tableAccessToken.ts";
import { TABLE_ACCESS_COOKIE } from "../../tableAccessCookie.ts";

export interface TableAccess {
  tableNumber: string;
}

/**
 * Customer-facing counterpart to requireStaffRole() — reads and verifies the
 * signed vaise_table_access cookie server-side. Every customer-facing API
 * route calls this first and scopes all reads/writes to the returned
 * tableNumber; a tableNumber the client tries to pass in a request body is
 * never trusted for identity, only this cookie is. Returns null on any
 * failure (missing cookie, bad signature, secret not configured) — callers
 * respond 401.
 */
export async function requireTableAccess(): Promise<TableAccess | null> {
  const secret = getTableAccessTokenSecret();
  if (!secret) return null;
  const token = (await cookies()).get(TABLE_ACCESS_COOKIE)?.value;
  const result = verifyTableAccessToken(token, secret);
  return result.ok ? { tableNumber: result.payload.tableNumber } : null;
}
