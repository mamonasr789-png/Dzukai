import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Signed table-access tokens — gate /menu, /cart, /ai behind a QR code
 * printed and stuck to a physical table, instead of trusting a bare
 * ?table=N URL param anyone could type.
 *
 * Deliberately NOT the AI-waiter's tableToken.ts: that module's payload has
 * a mandatory expiresAt capped at 30 days (fine for a chat session, wrong
 * for a sticker meant to stay on a table for months). This token has no
 * expiry field at all — the only way to invalidate every table's QR at once
 * is rotating TABLE_ACCESS_TOKEN_SECRET. Same HMAC-SHA256 + base64url +
 * timingSafeEqual pattern as src/lib/server/auth/session.ts.
 */

const DEVELOPMENT_ONLY_SECRET =
  "vaise-development-only-table-access-secret-not-for-production";

const TableAccessPayloadSchema = z
  .object({
    version: z.literal(1),
    tableNumber: z.string().trim().min(1).max(20),
  })
  .strict();

export type TableAccessPayload = z.infer<typeof TableAccessPayloadSchema>;

export type TableAccessVerification =
  | { ok: true; payload: TableAccessPayload }
  | { ok: false };

function signatureFor(encodedPayload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(encodedPayload).digest();
}

/** No secret configured in production ⇒ the gate refuses rather than falling
 *  back to a guessable default — same policy as the staff-session secret. */
export function getTableAccessTokenSecret(
  nodeEnvironment = process.env.NODE_ENV
): string | null {
  const configured = process.env.TABLE_ACCESS_TOKEN_SECRET?.trim();
  if (configured) return configured;
  if (nodeEnvironment === "production") return null;
  return DEVELOPMENT_ONLY_SECRET;
}

export function signTableAccessToken(
  tableNumber: string,
  secret: string
): string {
  if (secret.length < 32) {
    throw new Error("Table access signing secrets must contain at least 32 characters.");
  }
  const payload = TableAccessPayloadSchema.parse({ version: 1, tableNumber });
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url"
  );
  const signature = signatureFor(encodedPayload, secret).toString("base64url");
  return `${encodedPayload}.${signature}`;
}

export function verifyTableAccessToken(
  rawToken: string | undefined,
  secret: string
): TableAccessVerification {
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
  const parsed = TableAccessPayloadSchema.safeParse(payload);
  if (!parsed.success) return { ok: false };

  return { ok: true, payload: parsed.data };
}
