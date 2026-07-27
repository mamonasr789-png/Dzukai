import "server-only";

import {
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import {
  RestaurantIdSchema,
  SignedTableTokenSchema,
  TableNumberSchema,
  TableTokenIdSchema,
} from "../schemas.ts";

const DEVELOPMENT_ONLY_SECRET =
  "vaise-development-only-table-token-secret-not-for-production";
const MAXIMUM_TOKEN_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

const TableTokenPayloadSchema = z
  .object({
    version: z.literal(1),
    restaurantId: RestaurantIdSchema,
    tableNumber: TableNumberSchema,
    expiresAt: z.number().int().positive(),
    tokenId: TableTokenIdSchema,
  })
  .strict();

export type TableTokenPayload = z.infer<typeof TableTokenPayloadSchema>;

export type TableTokenVerificationResult =
  | { ok: true; payload: TableTokenPayload }
  | {
      ok: false;
      code: "invalid_table_token";
      message: string;
    };

function signatureFor(encodedPayload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(encodedPayload).digest();
}

function invalidToken(message: string): TableTokenVerificationResult {
  return { ok: false, code: "invalid_table_token", message };
}

export function getTableTokenSecret(
  nodeEnvironment = process.env.NODE_ENV
): string | null {
  const configured = process.env.AI_WAITER_TABLE_TOKEN_SECRET?.trim();
  if (configured) return configured;
  if (nodeEnvironment === "production") return null;
  return DEVELOPMENT_ONLY_SECRET;
}

export function signTableToken(
  payload: TableTokenPayload,
  secret: string
): string {
  const parsed = TableTokenPayloadSchema.parse(payload);
  if (secret.length < 32) {
    throw new Error("Table-token signing secrets must contain at least 32 characters.");
  }
  const encodedPayload = Buffer.from(JSON.stringify(parsed), "utf8").toString(
    "base64url"
  );
  const signature = signatureFor(encodedPayload, secret).toString("base64url");
  return `${encodedPayload}.${signature}`;
}

export function verifyTableToken(
  rawToken: string,
  secret: string,
  now: () => number = Date.now
): TableTokenVerificationResult {
  const token = SignedTableTokenSchema.safeParse(rawToken);
  if (!token.success || secret.length < 32) {
    return invalidToken("The table token is invalid.");
  }

  const [encodedPayload, encodedSignature] = token.data.split(".");
  let providedSignature: Buffer;
  try {
    providedSignature = Buffer.from(encodedSignature, "base64url");
  } catch {
    return invalidToken("The table token is invalid.");
  }
  const expectedSignature = signatureFor(encodedPayload, secret);
  if (
    providedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    return invalidToken("The table token signature is invalid.");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return invalidToken("The table token payload is invalid.");
  }
  const parsed = TableTokenPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return invalidToken("The table token payload is invalid.");
  }

  const nowSeconds = Math.floor(now() / 1_000);
  if (parsed.data.expiresAt <= nowSeconds) {
    return invalidToken("The table token has expired.");
  }
  if (parsed.data.expiresAt - nowSeconds > MAXIMUM_TOKEN_LIFETIME_SECONDS) {
    return invalidToken("The table token lifetime is not allowed.");
  }
  return { ok: true, payload: parsed.data };
}

export function createDevelopmentTableToken(
  input: {
    restaurantId: string;
    tableNumber: string;
    lifetimeSeconds?: number;
    tokenId?: string;
  },
  now: () => number = Date.now
): string {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Development table-token generation is disabled in production.");
  }
  const secret = getTableTokenSecret("development");
  if (!secret) {
    throw new Error("Development table-token signing is not configured.");
  }
  const lifetimeSeconds = input.lifetimeSeconds ?? 60 * 60;
  if (
    !Number.isSafeInteger(lifetimeSeconds) ||
    lifetimeSeconds <= 0 ||
    lifetimeSeconds > MAXIMUM_TOKEN_LIFETIME_SECONDS
  ) {
    throw new Error("Development table-token lifetime is invalid.");
  }
  return signTableToken(
    {
      version: 1,
      restaurantId: RestaurantIdSchema.parse(input.restaurantId),
      tableNumber: TableNumberSchema.parse(input.tableNumber),
      expiresAt: Math.floor(now() / 1_000) + lifetimeSeconds,
      tokenId: TableTokenIdSchema.parse(
        input.tokenId ?? `qr_${randomUUID().replaceAll("-", "")}`
      ),
    },
    secret
  );
}
