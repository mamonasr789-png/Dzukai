import "server-only";

import { createHash } from "node:crypto";
import type {
  ClientTurnId,
  DiningSessionId,
  WaiterTurnResult,
} from "../schemas.ts";
import { WaiterTurnResultSchema } from "../schemas.ts";
import { logStorageCapacityReached } from "./safeLogger.ts";
import {
  getAiWaiterBackend,
  type PostgresSql,
  type SqliteDatabase,
} from "./aiWaiterDb.ts";

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

// ── Durable (Postgres / SQLite) ─────────────────────────────────────────────

/**
 * A `TurnIdempotencyPort.execute()` operation is an arbitrary in-process
 * closure (it calls the AI provider, tool registry, etc.) — it can't be
 * shipped to another instance, so in-flight dedup for two concurrent calls
 * hitting the *same* clientTurnId stays a local Map exactly like
 * InMemoryTurnIdempotencyStore (mirrors it 1:1 while pending). What durability
 * adds: once a turn *completes*, its result is persisted, so a client retry
 * that lands on a fresh instance after a redeploy still replays the same
 * WaiterTurnResult instead of getting "turn not found" and silently starting
 * a new session. If two instances race on the same never-seen key, both run
 * the operation (unavoidable without a distributed lock here) and the DB
 * keeps whichever completes first; this matches the existing tolerance for
 * duplicate execution already implicit in the in-memory version restarting
 * per deploy.
 */
abstract class DurableTurnIdempotencyStore implements TurnIdempotencyPort {
  private readonly records = new Map<string, TurnRecord>();
  private readonly ttlMs: number;
  private readonly maximumRecords: number;
  private readonly now: () => number;

  constructor(options: InMemoryTurnIdempotencyStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maximumRecords = options.maximumRecords ?? DEFAULT_MAXIMUM_RECORDS;
    this.now = options.now ?? Date.now;
  }

  protected abstract ensureSchema(): Promise<void>;
  protected abstract countRecords(): Promise<number>;
  protected abstract getCompleted(
    key: string
  ): Promise<{ messageFingerprint: string; result: WaiterTurnResult } | null>;
  protected abstract insertCompleted(
    key: string,
    sessionId: DiningSessionId,
    messageFingerprint: string,
    result: WaiterTurnResult,
    expiresAtMs: number
  ): Promise<void>;
  protected abstract deleteForSession(sessionId: DiningSessionId): Promise<void>;
  protected abstract deleteExpired(nowMs: number, limit: number): Promise<number>;
  protected abstract clearAll(): Promise<void>;

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
    await this.ensureSchema();
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
    const persisted = await this.getCompleted(key);
    if (persisted) {
      if (persisted.messageFingerprint !== messageFingerprint) {
        return { ok: false, code: "turn_id_conflict" };
      }
      return { ok: true, replayed: true, result: persisted.result };
    }
    if ((await this.countRecords()) >= this.maximumRecords) {
      logStorageCapacityReached("waiter_turn_idempotency", this.maximumRecords);
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
    const expiresAtMs = this.now() + this.ttlMs;
    if (settled) {
      settled.status = "completed";
      settled.expiresAt = expiresAtMs;
    }
    await this.insertCompleted(key, sessionId, messageFingerprint, result, expiresAtMs);
    return { ok: true, replayed: false, result };
  }

  async cleanupSession(sessionId: DiningSessionId): Promise<void> {
    await this.ensureSchema();
    const prefix = `${sessionId}:`;
    for (const key of this.records.keys()) {
      if (key.startsWith(prefix)) this.records.delete(key);
    }
    await this.deleteForSession(sessionId);
  }

  async sweepExpired(): Promise<number> {
    await this.ensureSchema();
    const now = this.now();
    let removed = 0;
    for (const [key, record] of this.records) {
      if (record.status === "completed" && record.expiresAt !== null && record.expiresAt <= now) {
        this.records.delete(key);
        removed += 1;
      }
    }
    removed += await this.deleteExpired(now, 500);
    return removed;
  }

  async reset(): Promise<void> {
    await this.ensureSchema();
    this.records.clear();
    await this.clearAll();
  }
}

class PostgresTurnIdempotencyStore extends DurableTurnIdempotencyStore {
  private readonly sql: PostgresSql;
  private ready: Promise<void> | undefined;

  constructor(sql: PostgresSql, options: InMemoryTurnIdempotencyStoreOptions = {}) {
    super(options);
    this.sql = sql;
  }

  protected ensureSchema(): Promise<void> {
    this.ready ??= (async () => {
      await this.sql`
        CREATE TABLE IF NOT EXISTS ai_waiter_turn_idempotency (
          turn_key TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          message_fingerprint TEXT NOT NULL,
          result_data TEXT NOT NULL,
          expires_at BIGINT NOT NULL
        )`;
      await this.sql`
        CREATE INDEX IF NOT EXISTS ai_waiter_turn_idempotency_session
        ON ai_waiter_turn_idempotency (session_id)`;
      await this.sql`
        CREATE INDEX IF NOT EXISTS ai_waiter_turn_idempotency_expires
        ON ai_waiter_turn_idempotency (expires_at)`;
    })();
    return this.ready;
  }

  protected async countRecords(): Promise<number> {
    const rows = (await this
      .sql`SELECT COUNT(*)::int AS count FROM ai_waiter_turn_idempotency`) as Array<{
      count: number;
    }>;
    return rows[0]?.count ?? 0;
  }

  protected async getCompleted(
    key: string
  ): Promise<{ messageFingerprint: string; result: WaiterTurnResult } | null> {
    const rows = (await this.sql`
      SELECT message_fingerprint, result_data FROM ai_waiter_turn_idempotency
      WHERE turn_key = ${key}`) as Array<{ message_fingerprint: string; result_data: string }>;
    const row = rows[0];
    if (!row) return null;
    return {
      messageFingerprint: row.message_fingerprint,
      result: WaiterTurnResultSchema.parse(JSON.parse(row.result_data)),
    };
  }

  protected async insertCompleted(
    key: string,
    sessionId: DiningSessionId,
    messageFingerprint: string,
    result: WaiterTurnResult,
    expiresAtMs: number
  ): Promise<void> {
    await this.sql`
      INSERT INTO ai_waiter_turn_idempotency (turn_key, session_id, message_fingerprint, result_data, expires_at)
      VALUES (${key}, ${sessionId}, ${messageFingerprint}, ${JSON.stringify(result)}, ${expiresAtMs})
      ON CONFLICT (turn_key) DO NOTHING`;
  }

  protected async deleteForSession(sessionId: DiningSessionId): Promise<void> {
    await this.sql`DELETE FROM ai_waiter_turn_idempotency WHERE session_id = ${sessionId}`;
  }

  protected async deleteExpired(nowMs: number, limit: number): Promise<number> {
    const rows = (await this.sql`
      DELETE FROM ai_waiter_turn_idempotency
      WHERE turn_key IN (
        SELECT turn_key FROM ai_waiter_turn_idempotency WHERE expires_at <= ${nowMs} LIMIT ${limit}
      ) RETURNING turn_key`) as unknown[];
    return rows.length;
  }

  protected async clearAll(): Promise<void> {
    await this.sql`DELETE FROM ai_waiter_turn_idempotency`;
  }
}

class SqliteTurnIdempotencyStore extends DurableTurnIdempotencyStore {
  private readonly db: SqliteDatabase;
  private schemaReady = false;

  constructor(db: SqliteDatabase, options: InMemoryTurnIdempotencyStoreOptions = {}) {
    super(options);
    this.db = db;
  }

  protected async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ai_waiter_turn_idempotency (
        turn_key TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        message_fingerprint TEXT NOT NULL,
        result_data TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ai_waiter_turn_idempotency_session
      ON ai_waiter_turn_idempotency (session_id);
      CREATE INDEX IF NOT EXISTS ai_waiter_turn_idempotency_expires
      ON ai_waiter_turn_idempotency (expires_at);
    `);
    this.schemaReady = true;
  }

  protected async countRecords(): Promise<number> {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM ai_waiter_turn_idempotency")
      .get() as { count: number };
    return row.count;
  }

  protected async getCompleted(
    key: string
  ): Promise<{ messageFingerprint: string; result: WaiterTurnResult } | null> {
    const row = this.db
      .prepare(
        "SELECT message_fingerprint, result_data FROM ai_waiter_turn_idempotency WHERE turn_key = ?"
      )
      .get(key) as { message_fingerprint: string; result_data: string } | undefined;
    if (!row) return null;
    return {
      messageFingerprint: row.message_fingerprint,
      result: WaiterTurnResultSchema.parse(JSON.parse(row.result_data)),
    };
  }

  protected async insertCompleted(
    key: string,
    sessionId: DiningSessionId,
    messageFingerprint: string,
    result: WaiterTurnResult,
    expiresAtMs: number
  ): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO ai_waiter_turn_idempotency
           (turn_key, session_id, message_fingerprint, result_data, expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (turn_key) DO NOTHING`
      )
      .run(key, sessionId, messageFingerprint, JSON.stringify(result), expiresAtMs);
  }

  protected async deleteForSession(sessionId: DiningSessionId): Promise<void> {
    this.db
      .prepare("DELETE FROM ai_waiter_turn_idempotency WHERE session_id = ?")
      .run(sessionId);
  }

  protected async deleteExpired(nowMs: number, limit: number): Promise<number> {
    const rows = this.db
      .prepare("SELECT turn_key FROM ai_waiter_turn_idempotency WHERE expires_at <= ? LIMIT ?")
      .all(nowMs, limit) as Array<{ turn_key: string }>;
    const stmt = this.db.prepare("DELETE FROM ai_waiter_turn_idempotency WHERE turn_key = ?");
    for (const row of rows) stmt.run(row.turn_key);
    return rows.length;
  }

  protected async clearAll(): Promise<void> {
    this.db.exec("DELETE FROM ai_waiter_turn_idempotency");
  }
}

export async function createDurableTurnIdempotencyStore(
  options: InMemoryTurnIdempotencyStoreOptions = {}
): Promise<TurnIdempotencyPort> {
  const backend = await getAiWaiterBackend();
  return backend.kind === "postgres"
    ? new PostgresTurnIdempotencyStore(backend.sql, options)
    : new SqliteTurnIdempotencyStore(backend.db, options);
}
