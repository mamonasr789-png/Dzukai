import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const STAFF_SESSION_COOKIE = "vaise_staff_session";
export const STAFF_ROLES = ["admin", "waiter", "kitchen"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
const DEVELOPMENT_ONLY_SECRET =
  "vaise-development-only-staff-session-secret-not-for-production";

const StaffSessionPayloadSchema = z
  .object({
    version: z.literal(1),
    accountId: z.string().trim().min(1).max(80),
    username: z.string().trim().min(1).max(60),
    role: z.enum(STAFF_ROLES),
    expiresAt: z.number().int().positive(),
  })
  .strict();

export type StaffSessionPayload = z.infer<typeof StaffSessionPayloadSchema>;

export type StaffSessionVerification =
  | { ok: true; payload: StaffSessionPayload }
  | { ok: false };

function signatureFor(encodedPayload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(encodedPayload).digest();
}

/** Same pattern as the AI-waiter table token: no secret configured in
 *  production means the feature refuses to run rather than falling back to a
 *  guessable default. */
export function getStaffSessionSecret(
  nodeEnvironment = process.env.NODE_ENV
): string | null {
  const configured = process.env.STAFF_AUTH_SECRET?.trim();
  if (configured) return configured;
  if (nodeEnvironment === "production") return null;
  return DEVELOPMENT_ONLY_SECRET;
}

export function signStaffSession(
  input: { accountId: string; username: string; role: StaffRole },
  secret: string,
  now: () => number = Date.now
): string {
  if (secret.length < 32) {
    throw new Error("Staff session signing secrets must contain at least 32 characters.");
  }
  const payload = StaffSessionPayloadSchema.parse({
    version: 1,
    accountId: input.accountId,
    username: input.username,
    role: input.role,
    expiresAt: Math.floor(now() / 1_000) + SESSION_LIFETIME_SECONDS,
  });
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url"
  );
  const signature = signatureFor(encodedPayload, secret).toString("base64url");
  return `${encodedPayload}.${signature}`;
}

export function verifyStaffSession(
  rawToken: string | undefined,
  secret: string,
  now: () => number = Date.now
): StaffSessionVerification {
  if (!rawToken || secret.length < 32) return { ok: false };
  const parts = rawToken.split(".");
  if (parts.length !== 2) return { ok: false };
  const [encodedPayload, encodedSignature] = parts;

  let providedSignature: Buffer;
  try {
    providedSignature = Buffer.from(encodedSignature, "base64url");
  } catch {
    return { ok: false };
  }
  const expectedSignature = signatureFor(encodedPayload, secret);
  if (
    providedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    return { ok: false };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return { ok: false };
  }
  const parsed = StaffSessionPayloadSchema.safeParse(payload);
  if (!parsed.success) return { ok: false };

  const nowSeconds = Math.floor(now() / 1_000);
  if (parsed.data.expiresAt <= nowSeconds) return { ok: false };

  return { ok: true, payload: parsed.data };
}

/** A role may access its own area; an admin session may access every area. */
export function roleAllows(sessionRole: StaffRole, requiredRole: StaffRole): boolean {
  return sessionRole === "admin" || sessionRole === requiredRole;
}
