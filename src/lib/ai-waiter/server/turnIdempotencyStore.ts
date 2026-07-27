import "server-only";

import { createHash } from "node:crypto";
import type {
  ClientTurnId,
  DiningSessionId,
  WaiterTurnResult,
} from "../schemas.ts";
import { WaiterTurnResultSchema } from "../schemas.ts";
import { logStorageCapacityReached } from "./safeLogger.ts";

interface TurnRecord {
  messageFingerprint: string;
  result: Promise<WaiterTurnResult>;
  status: "pending" | "completed";
  expiresAt: number | null;
}

export type IdempotentTurnExecution =
  | { ok: true; replayed: boolean; result: WaiterTurnResult }
  | { ok: false; code: "turn_id_conflict" | "storage_capacity_exceeded" };

export interface TurnIdempotencyPort {
  execute(
    sessionId: DiningSessionId,
    clientTurnId: ClientTurnId | null,
    message: string,
    operation: () => Promise<WaiterTurnResult>,
    recoverExceptionalResult?: () => Promise<WaiterTurnResult>
  ): Promise<IdempotentTurnExecution>;
  cleanupSession(sessionId: DiningSessionId): Promise<void>;
  sweepExpired(): Promise<number>;
  reset(): Promise<void>;
}

interface InMemoryTurnIdempotencyStoreOptions {
  ttlMs?: number;
  maximumRecords?: number;
  now?: () => number;
}

const DEFAULT_TTL_MS = 30 * 60 * 1_000;
const DEFAULT_MAXIMUM_RECORDS = 30_000;

function fingerprint(message: string): string {
  return createHash("sha256")
    .update(message.normalize("NFC"))
    .digest("hex");
}

function terminalInternalFailure(): WaiterTurnResult {
  return WaiterTurnResultSchema.parse({
    ok: false,
    error: {
      code: "internal_error",
      message: "The waiter turn ended before any action could be confirmed.",
    },
  });
}

export class InMemoryTurnIdempotencyStore
  implements TurnIdempotencyPort
{
  private readonly records = new Map<string, TurnRecord>();
  private readonly ttlMs: number;
  private readonly maximumRecords: number;
  private readonly now: () => number;

  constructor(options: InMemoryTurnIdempotencyStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maximumRecords =
      options.maximumRecords ?? DEFAULT_MAXIMUM_RECORDS;
    this.now = options.now ?? Date.now;
  }

  async execute(
    sessionId: DiningSessionId,
    clientTurnId: ClientTurnId | null,
    message: string,
    operation: () => Promise<WaiterTurnResult>,
    recoverExceptionalResult?: () => Promise<WaiterTurnResult>
  ): Promise<IdempotentTurnExecution> {
    if (!clientTurnId) {
      try {
        return { ok: true, replayed: false, result: await operation() };
      } catch {
        return {
          ok: true,
          replayed: false,
          result: recoverExceptionalResult
            ? await recoverExceptionalResult()
            : terminalInternalFailure(),
        };
      }
    }
    await this.sweepExpired();
    const key = `${sessionId}:${clientTurnId}`;
    const messageFingerprint = fingerprint(message);
    const existing = this.records.get(key);
    if (existing) {
      if (existing.messageFingerprint !== messageFingerprint) {
        return { ok: false, code: "turn_id_conflict" };
      }
      return { ok: true, replayed: true, result: await existing.result };
    }
    if (this.records.size >= this.maximumRecords) {
      logStorageCapacityReached(
        "waiter_turn_idempotency",
        this.maximumRecords
      );
      return { ok: false, code: "storage_capacity_exceeded" };
    }

    const pending = (async () => {
      try {
        return await operation();
      } catch {
        if (!recoverExceptionalResult) return terminalInternalFailure();
        try {
          return await recoverExceptionalResult();
        } catch {
          return terminalInternalFailure();
        }
      }
    })();
    this.records.set(key, {
      messageFingerprint,
      result: pending,
      status: "pending",
      expiresAt: null,
    });
    const result = await pending;
    const settled = this.records.get(key);
    if (settled) {
      settled.status = "completed";
      settled.expiresAt = this.now() + this.ttlMs;
    }
    return { ok: true, replayed: false, result };
  }

  async cleanupSession(sessionId: DiningSessionId): Promise<void> {
    const prefix = `${sessionId}:`;
    for (const key of this.records.keys()) {
      if (key.startsWith(prefix)) this.records.delete(key);
    }
  }

  async sweepExpired(): Promise<number> {
    const now = this.now();
    let removed = 0;
    for (const [key, record] of this.records) {
      if (
        record.status === "completed" &&
        record.expiresAt !== null &&
        record.expiresAt <= now
      ) {
        this.records.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  async reset(): Promise<void> {
    this.records.clear();
  }
}
