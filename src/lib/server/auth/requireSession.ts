import "server-only";

import { cookies } from "next/headers";
import {
  STAFF_SESSION_COOKIE,
  getStaffSessionSecret,
  roleAllows,
  verifyStaffSession,
  type StaffRole,
  type StaffSessionPayload,
} from "./session";

export async function getStaffSession(): Promise<StaffSessionPayload | null> {
  const secret = getStaffSessionSecret();
  if (!secret) return null;
  const token = (await cookies()).get(STAFF_SESSION_COOKIE)?.value;
  const result = verifyStaffSession(token, secret);
  return result.ok ? result.payload : null;
}

/** Returns the session only if it is allowed into `role`'s area (admin passes for any role). */
export async function requireStaffRole(
  role: StaffRole
): Promise<StaffSessionPayload | null> {
  const session = await getStaffSession();
  if (!session || !roleAllows(session.role, role)) return null;
  return session;
}
