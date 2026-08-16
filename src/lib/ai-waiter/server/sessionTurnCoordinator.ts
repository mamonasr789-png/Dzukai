import "server-only";

import { randomUUID } from "node:crypto";
import type { DiningSessionId } from "../schemas.ts";
import { logStorageCapacityReached } from "./safeLogger.ts";
import {
  getAiWaiterBackend,
  type PostgresSql,
  type SqliteDatabase,
} from "./aiWaiterDb.ts";

export interface SessionTurnCoordinatorPort {
  runExclusive<T>(
    sessionId: DiningSessionId,
    operation: () => Promise<T>
  ): Promise<T>;
  cleanupSession(sessionId: DiningSessionId): Promise<void>;
  reset(): Promise<void>;
}

interface SessionQueue {
  tail: Promise<void>;
  queued: number;
  cleanupRequested: boolean;
}

export class SessionTurnCapacityError extends Error {
  constructor() {
    super("session_turn_capacity_exceeded");
  }
}

/**
 * Development-only per-session serialization. The port is intentionally small
 * so a distributed lock or transactional coordinator can replace it later.
 */
export class InMemorySessionTurnCoordinator
  implements SessionTurnCoordinatorPort
{
  private readonly queues = new Map<DiningSessionId, SessionQueue>();
  private readonly maximumSessions: number;

  constructor(options: { maximumSessions?: number } = {}) {
    this.maximumSessions = options.maximumSessions ?? 10_000;
  }

  async runExclusive<T>(
    sessionId: DiningSessionId,
    operation: () => Promise<T>
  ): Promise<T> {
    let queue = this.queues.get(sessionId);
    if (!queue) {
      if (this.queues.size >= this.maximumSessions) {
        logStorageCapacityReached(
          "session_turn_coordinator",
          this.maximumSessions
        );
        throw new SessionTurnCapacityError();
      }
      queue = {
        tail: Promise.resolve(),
        queued: 0,
        cleanupRequested: false,
      };
      this.queues.set(sessionId, queue);
    }

    const predecessor = queue.tail.catch(() => undefined);
    let release = (): void => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    queue.queued += 1;
    queue.tail = predecessor.then(() => current);

    await predecessor;
    try {
      return await operation();
    } finally {
      release();
      queue.queued -= 1;
      if (queue.queued === 0) {
        this.queues.delete(sessionId);
      }
    }
  }

  async cleanupSession(sessionId: DiningSessionId): Promise<void> {
    const queue = this.queues.get(sessionId);
    if (!queue) return;
    queue.cleanupRequested = true;
    if (queue.queued === 0) this.queues.delete(sessionId);
  }

  async reset(): Promise<void> {
    for (const [sessionId, queue] of this.queues) {
      queue.cleanupRequested = true;
      if (queue.queued === 0) this.queues.delete(sessionId);
    }
  }
}

// ── Durable (Postgres / SQLite) ─────────────────────────────────────────────

const LEASE_MS = 30_000;
const LEASE_RENEW_MS = 10_000;
const ACQUIRE_TIMEOUT_MS = 20_000;
const POLL_MIN_MS = 40;
const POLL_MAX_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `runExclusive`'s operation is an arbitrary in-process closure, so it always
 * runs on the instance that called it — this coordinator's job is only to
 * make sure no *other* instance (or another concurrent request on this one)
 * runs a turn for the same session at the same time. That's a distributed
 * lease lock: acquire a row (INSERT, or steal one whose lease already
 * expired), renew it periodically while the operation runs, release on
 * completion. A bounded poll-with-backoff replaces the in-memory version's
 * promise queue, since there is no shared promise across instances to await.
 * Note: the previous in-memory coordinator only ever serialized turns within
 * a single process anyway (Vercel gives concurrent requests no such
 * guarantee across instances), so this is a strict improvement, not a
 * behavior downgrade.
 */
abstract class DurableSessionTurnCoordinator implements SessionTurnCoordinatorPort {
  private readonly maximumSessions: number;
  private readonly holderId = `holder_${randomUUID()}`;

  constructor(options: { maximumSessions?: number } = {}) {
    this.maximumSessions = options.maximumSessions ?? 10_000;
  }

  protected abstract ensureSchema(): Promise<void>;
  protected abstract countLocks(): Promise<number>;
  protected abstract tryAcquire(
    sessionId: DiningSessionId,
    holder: string,
    expiresAtMs: number,
    nowMs: number
  ): Promise<boolean>;
  protected abstract renew(
    sessionId: DiningSessionId,
    holder: string,
    expiresAtMs: number
  ): Promise<void>;
  protected abstract release(sessionId: DiningSessionId, holder: string): Promise<void>;
  protected abstract deleteForSession(sessionId: DiningSessionId): Promise<void>;
  protected abstract clearAll(): Promise<void>;

  async runExclusive<T>(
    sessionId: DiningSessionId,
    operation: () => Promise<T>
  ): Promise<T> {
    await this.ensureSchema();
    const holder = `${this.holderId}:${randomUUID()}`;
    const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;
    let acquired = false;
    let pollDelay = POLL_MIN_MS;
    while (!acquired) {
      const now = Date.now();
      if ((await this.countLocks()) >= this.maximumSessions) {
        logStorageCapacityReached("session_turn_coordinator", this.maximumSessions);
        throw new SessionTurnCapacityError();
      }
      acquired = await this.tryAcquire(sessionId, holder, now + LEASE_MS, now);
      if (acquired) break;
      if (Date.now() >= deadline) {
        throw new SessionTurnCapacityError();
      }
      await sleep(pollDelay);
      pollDelay = Math.min(pollDelay * 1.5, POLL_MAX_MS);
    }

    const renewInterval = setInterval(() => {
      void this.renew(sessionId, holder, Date.now() + LEASE_MS);
    }, LEASE_RENEW_MS);
    try {
      return await operation();
    } finally {
      clearInterval(renewInterval);
      await this.release(sessionId, holder);
    }
  }

  async cleanupSession(sessionId: DiningSessionId): Promise<void> {
    await this.ensureSchema();
    await this.deleteForSession(sessionId);
  }

  async reset(): Promise<void> {
    await this.ensureSchema();
    await this.clearAll();
  }
}

class PostgresSessionTurnCoordinator extends DurableSessionTurnCoordinator {
  private readonly sql: PostgresSql;
  private ready: Promise<void> | undefined;

  constructor(sql: PostgresSql, options: { maximumSessions?: number } = {}) {
    super(options);
    this.sql = sql;
  }

  protected ensureSchema(): Promise<void> {
    this.ready ??= (async () => {
      await this.sql`
        CREATE TABLE IF NOT EXISTS ai_waiter_turn_locks (
          session_id TEXT PRIMARY KEY,
          holder TEXT NOT NULL,
          expires_at BIGINT NOT NULL
        )`;
    })();
    return this.ready;
  }

  protected async countLocks(): Promise<number> {
    const rows = (await this
      .sql`SELECT COUNT(*)::int AS count FROM ai_waiter_turn_locks`) as Array<{ count: number }>;
    return rows[0]?.count ?? 0;
  }

  protected async tryAcquire(
    sessionId: DiningSessionId,
    holder: string,
    expiresAtMs: number,
    nowMs: number
  ): Promise<boolean> {
    const rows = (await this.sql`
      INSERT INTO ai_waiter_turn_locks (session_id, holder, expires_at)
      VALUES (${sessionId}, ${holder}, ${expiresAtMs})
      ON CONFLICT (session_id) DO UPDATE SET holder = EXCLUDED.holder, expires_at = EXCLUDED.expires_at
      WHERE ai_waiter_turn_locks.expires_at <= ${nowMs}
      RETURNING session_id`) as unknown[];
    return rows.length > 0;
  }

  protected async renew(
    sessionId: DiningSessionId,
    holder: string,
    expiresAtMs: number
  ): Promise<void> {
    await this.sql`
      UPDATE ai_waiter_turn_locks SET expires_at = ${expiresAtMs}
      WHERE session_id = ${sessionId} AND holder = ${holder}`;
  }

  protected async release(sessionId: DiningSessionId, holder: string): Promise<void> {
    await this.sql`
      DELETE FROM ai_waiter_turn_locks WHERE session_id = ${sessionId} AND holder = ${holder}`;
  }

  protected async deleteForSession(sessionId: DiningSessionId): Promise<void> {
    await this.sql`DELETE FROM ai_waiter_turn_locks WHERE session_id = ${sessionId}`;
  }

  protected async clearAll(): Promise<void> {
    await this.sql`DELETE FROM ai_waiter_turn_locks`;
  }
}

class SqliteSessionTurnCoordinator extends DurableSessionTurnCoordinator {
  private readonly db: SqliteDatabase;
  private schemaReady = false;

  constructor(db: SqliteDatabase, options: { maximumSessions?: number } = {}) {
    super(options);
    this.db = db;
  }

  protected async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ai_waiter_turn_locks (
        session_id TEXT PRIMARY KEY,
        holder TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
    this.schemaReady = true;
  }

  protected async countLocks(): Promise<number> {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM ai_waiter_turn_locks").get() as {
      count: number;
    };
    return row.count;
  }

  protected async tryAcquire(
    sessionId: DiningSessionId,
    holder: string,
    expiresAtMs: number,
    nowMs: number
  ): Promise<boolean> {
    const deleted = this.db
      .prepare("DELETE FROM ai_waiter_turn_locks WHERE session_id = ? AND expires_at <= ?")
      .run(sessionId, nowMs);
    if (deleted.changes === 0) {
      const existing = this.db
        .prepare("SELECT 1 FROM ai_waiter_turn_locks WHERE session_id = ?")
        .get(sessionId);
      if (existing !== undefined) return false;
    }
    try {
      this.db
        .prepare(
          "INSERT INTO ai_waiter_turn_locks (session_id, holder, expires_at) VALUES (?, ?, ?)"
        )
        .run(sessionId, holder, expiresAtMs);
      return true;
    } catch {
      return false;
    }
  }

  protected async renew(
    sessionId: DiningSessionId,
    holder: string,
    expiresAtMs: number
  ): Promise<void> {
    this.db
      .prepare(
        "UPDATE ai_waiter_turn_locks SET expires_at = ? WHERE session_id = ? AND holder = ?"
      )
      .run(expiresAtMs, sessionId, holder);
  }

  protected async release(sessionId: DiningSessionId, holder: string): Promise<void> {
    this.db
      .prepare("DELETE FROM ai_waiter_turn_locks WHERE session_id = ? AND holder = ?")
      .run(sessionId, holder);
  }

  protected async deleteForSession(sessionId: DiningSessionId): Promise<void> {
    this.db.prepare("DELETE FROM ai_waiter_turn_locks WHERE session_id = ?").run(sessionId);
  }

  protected async clearAll(): Promise<void> {
    this.db.exec("DELETE FROM ai_waiter_turn_locks");
  }
}

export async function createDurableSessionTurnCoordinator(
  options: { maximumSessions?: number } = {}
): Promise<SessionTurnCoordinatorPort> {
  const backend = await getAiWaiterBackend();
  return backend.kind === "postgres"
    ? new PostgresSessionTurnCoordinator(backend.sql, options)
    : new SqliteSessionTurnCoordinator(backend.db, options);
}
