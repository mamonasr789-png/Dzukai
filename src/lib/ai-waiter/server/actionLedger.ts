import "server-only";

import { createHash } from "node:crypto";
import {
  ActionLedgerEntrySchema,
  type ActionIntent,
  type ActionLedgerEntry,
  type ActionType,
  type DiningSessionId,
} from "../schemas.ts";
import { canonicalFingerprint, canonicalJson } from "./canonicalJson.ts";
import { logStorageCapacityReached } from "./safeLogger.ts";
import type { ToolExecutionResponse } from "./toolRegistry.ts";
import {
  getAiWaiterBackend,
  type PostgresSql,
  type SqliteDatabase,
} from "./aiWaiterDb.ts";

export interface AuthorizedActionDescriptor {
  sessionId: DiningSessionId;
  turnId: string;
  ordinal: number;
  intent: ActionIntent;
  toolName: ActionType;
  canonicalInput: unknown;
  cartRevision: number;
}

export interface StoredActionLedgerEntry {
  entry: ActionLedgerEntry;
  toolResult: ToolExecutionResponse | null;
  idempotencyKey: string;
  canonicalInput: unknown;
  cartRevision: number;
}

export interface ActionLedgerPort {
  beginAuthorizedAction(
    descriptor: AuthorizedActionDescriptor
  ): Promise<StoredActionLedgerEntry | null>;
  markExecuting(actionId: string): Promise<StoredActionLedgerEntry | null>;
  markCompleted(
    actionId: string,
    result: ToolExecutionResponse
  ): Promise<StoredActionLedgerEntry | null>;
  getByTurn(
    sessionId: DiningSessionId,
    turnId: string
  ): Promise<StoredActionLedgerEntry[]>;
  cleanupSession(sessionId: DiningSessionId): Promise<void>;
  reset(): Promise<void>;
}

interface InternalEntry extends StoredActionLedgerEntry {
  sessionId: DiningSessionId;
}

function stableDigest(descriptor: AuthorizedActionDescriptor): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        sessionId: descriptor.sessionId,
        turnId: descriptor.turnId,
        ordinal: descriptor.ordinal,
        action: descriptor.toolName,
        intent: descriptor.intent,
        input: descriptor.canonicalInput,
      })
    )
    .digest("hex");
}

function affectedId(result: ToolExecutionResponse): string | null {
  if (!result.ok) return null;
  if (
    result.toolName === "add_to_cart" ||
    result.toolName === "update_cart_item" ||
    result.toolName === "remove_from_cart" ||
    result.toolName === "clear_cart"
  ) {
    return result.data.affectedLineId;
  }
  if (
    result.toolName === "request_waiter" ||
    result.toolName === "request_bill"
  ) {
    return result.data.requestId;
  }
  return null;
}

function replayed(result: ToolExecutionResponse): boolean {
  return result.ok && "replayed" in result.data
    ? Boolean(result.data.replayed)
    : false;
}

export class InMemoryActionLedger implements ActionLedgerPort {
  private readonly entries = new Map<string, InternalEntry>();
  private readonly maximumEntries: number;
  private readonly now: () => number;

  constructor(options: { maximumEntries?: number; now?: () => number } = {}) {
    this.maximumEntries = options.maximumEntries ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  async beginAuthorizedAction(
    descriptor: AuthorizedActionDescriptor
  ): Promise<StoredActionLedgerEntry | null> {
    const digest = stableDigest(descriptor);
    const actionId = `action_${digest.slice(0, 32)}`;
    const existing = this.entries.get(actionId);
    if (existing) return structuredClone(existing);
    if (this.entries.size >= this.maximumEntries) {
      logStorageCapacityReached("action_ledger", this.maximumEntries);
      return null;
    }
    const idempotencyKey = `action_${digest.slice(0, 40)}`;
    const entry: InternalEntry = {
      sessionId: descriptor.sessionId,
      idempotencyKey,
      toolResult: null,
      canonicalInput: structuredClone(descriptor.canonicalInput),
      cartRevision: descriptor.cartRevision,
      entry: ActionLedgerEntrySchema.parse({
        actionId,
        turnId: descriptor.turnId,
        intent: descriptor.intent,
        toolName: descriptor.toolName,
        canonicalInputFingerprint: canonicalFingerprint(
          descriptor.canonicalInput
        ),
        status: "authorized",
        result: null,
        affectedId: null,
        timestamp: new Date(this.now()).toISOString(),
      }),
    };
    this.entries.set(actionId, structuredClone(entry));
    return structuredClone(entry);
  }

  async markExecuting(
    actionId: string
  ): Promise<StoredActionLedgerEntry | null> {
    const stored = this.entries.get(actionId);
    if (!stored) return null;
    stored.entry.status = "executing";
    stored.entry.timestamp = new Date(this.now()).toISOString();
    return structuredClone(stored);
  }

  async markCompleted(
    actionId: string,
    result: ToolExecutionResponse
  ): Promise<StoredActionLedgerEntry | null> {
    const stored = this.entries.get(actionId);
    if (!stored) return null;
    stored.toolResult = structuredClone(result);
    stored.entry.status = result.ok ? "succeeded" : "failed";
    stored.entry.result = {
      ok: result.ok,
      code: result.ok ? null : result.error.code,
      replayed: replayed(result),
    };
    stored.entry.affectedId = affectedId(result);
    stored.entry.timestamp = new Date(this.now()).toISOString();
    return structuredClone(stored);
  }

  async getByTurn(
    sessionId: DiningSessionId,
    turnId: string
  ): Promise<StoredActionLedgerEntry[]> {
    return [...this.entries.values()]
      .filter(
        (stored) =>
          stored.sessionId === sessionId && stored.entry.turnId === turnId
      )
      .map((stored) => structuredClone(stored));
  }

  async cleanupSession(sessionId: DiningSessionId): Promise<void> {
    for (const [actionId, stored] of this.entries) {
      if (stored.sessionId === sessionId) this.entries.delete(actionId);
    }
  }

  async reset(): Promise<void> {
    this.entries.clear();
  }
}

// ── Durable (Postgres / SQLite) ─────────────────────────────────────────────

interface StoredRow {
  sessionId: DiningSessionId;
  entry: ActionLedgerEntry;
  toolResult: ToolExecutionResponse | null;
  idempotencyKey: string;
  canonicalInput: unknown;
  cartRevision: number;
}

abstract class DurableActionLedger implements ActionLedgerPort {
  private readonly maximumEntries: number;
  private readonly now: () => number;

  constructor(options: { maximumEntries?: number; now?: () => number } = {}) {
    this.maximumEntries = options.maximumEntries ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  protected abstract ensureSchema(): Promise<void>;
  protected abstract countEntries(): Promise<number>;
  protected abstract getEntry(actionId: string): Promise<StoredRow | null>;
  protected abstract insertEntry(actionId: string, row: StoredRow): Promise<void>;
  protected abstract updateEntry(actionId: string, row: StoredRow): Promise<void>;
  protected abstract entriesByTurn(
    sessionId: DiningSessionId,
    turnId: string
  ): Promise<StoredRow[]>;
  protected abstract deleteForSession(sessionId: DiningSessionId): Promise<void>;
  protected abstract clearAll(): Promise<void>;

  async beginAuthorizedAction(
    descriptor: AuthorizedActionDescriptor
  ): Promise<StoredActionLedgerEntry | null> {
    await this.ensureSchema();
    const digest = stableDigest(descriptor);
    const actionId = `action_${digest.slice(0, 32)}`;
    const existing = await this.getEntry(actionId);
    if (existing) return this.publicEntry(existing);
    if ((await this.countEntries()) >= this.maximumEntries) {
      logStorageCapacityReached("action_ledger", this.maximumEntries);
      return null;
    }
    const idempotencyKey = `action_${digest.slice(0, 40)}`;
    const row: StoredRow = {
      sessionId: descriptor.sessionId,
      idempotencyKey,
      toolResult: null,
      canonicalInput: structuredClone(descriptor.canonicalInput),
      cartRevision: descriptor.cartRevision,
      entry: ActionLedgerEntrySchema.parse({
        actionId,
        turnId: descriptor.turnId,
        intent: descriptor.intent,
        toolName: descriptor.toolName,
        canonicalInputFingerprint: canonicalFingerprint(descriptor.canonicalInput),
        status: "authorized",
        result: null,
        affectedId: null,
        timestamp: new Date(this.now()).toISOString(),
      }),
    };
    await this.insertEntry(actionId, row);
    return this.publicEntry(row);
  }

  async markExecuting(actionId: string): Promise<StoredActionLedgerEntry | null> {
    await this.ensureSchema();
    const stored = await this.getEntry(actionId);
    if (!stored) return null;
    stored.entry.status = "executing";
    stored.entry.timestamp = new Date(this.now()).toISOString();
    await this.updateEntry(actionId, stored);
    return this.publicEntry(stored);
  }

  async markCompleted(
    actionId: string,
    result: ToolExecutionResponse
  ): Promise<StoredActionLedgerEntry | null> {
    await this.ensureSchema();
    const stored = await this.getEntry(actionId);
    if (!stored) return null;
    stored.toolResult = structuredClone(result);
    stored.entry.status = result.ok ? "succeeded" : "failed";
    stored.entry.result = {
      ok: result.ok,
      code: result.ok ? null : result.error.code,
      replayed: replayed(result),
    };
    stored.entry.affectedId = affectedId(result);
    stored.entry.timestamp = new Date(this.now()).toISOString();
    await this.updateEntry(actionId, stored);
    return this.publicEntry(stored);
  }

  async getByTurn(
    sessionId: DiningSessionId,
    turnId: string
  ): Promise<StoredActionLedgerEntry[]> {
    await this.ensureSchema();
    const rows = await this.entriesByTurn(sessionId, turnId);
    return rows.map((row) => this.publicEntry(row));
  }

  async cleanupSession(sessionId: DiningSessionId): Promise<void> {
    await this.ensureSchema();
    await this.deleteForSession(sessionId);
  }

  async reset(): Promise<void> {
    await this.ensureSchema();
    await this.clearAll();
  }

  private publicEntry(row: StoredRow): StoredActionLedgerEntry {
    return structuredClone({
      entry: row.entry,
      toolResult: row.toolResult,
      idempotencyKey: row.idempotencyKey,
      canonicalInput: row.canonicalInput,
      cartRevision: row.cartRevision,
    });
  }
}

function serializeRow(row: StoredRow): string {
  return JSON.stringify(row);
}

function deserializeRow(json: string): StoredRow {
  return JSON.parse(json) as StoredRow;
}

class PostgresActionLedger extends DurableActionLedger {
  private readonly sql: PostgresSql;
  private ready: Promise<void> | undefined;

  constructor(sql: PostgresSql, options: { maximumEntries?: number; now?: () => number } = {}) {
    super(options);
    this.sql = sql;
  }

  protected ensureSchema(): Promise<void> {
    this.ready ??= (async () => {
      await this.sql`
        CREATE TABLE IF NOT EXISTS ai_waiter_action_ledger (
          action_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          turn_id TEXT NOT NULL,
          row_data TEXT NOT NULL
        )`;
      await this.sql`
        CREATE INDEX IF NOT EXISTS ai_waiter_action_ledger_session_turn
        ON ai_waiter_action_ledger (session_id, turn_id)`;
    })();
    return this.ready;
  }

  protected async countEntries(): Promise<number> {
    const rows = (await this
      .sql`SELECT COUNT(*)::int AS count FROM ai_waiter_action_ledger`) as Array<{
      count: number;
    }>;
    return rows[0]?.count ?? 0;
  }

  protected async getEntry(actionId: string): Promise<StoredRow | null> {
    const rows = (await this.sql`
      SELECT row_data FROM ai_waiter_action_ledger WHERE action_id = ${actionId}`) as Array<{
      row_data: string;
    }>;
    const row = rows[0];
    return row ? deserializeRow(row.row_data) : null;
  }

  protected async insertEntry(actionId: string, row: StoredRow): Promise<void> {
    await this.sql`
      INSERT INTO ai_waiter_action_ledger (action_id, session_id, turn_id, row_data)
      VALUES (${actionId}, ${row.sessionId}, ${row.entry.turnId}, ${serializeRow(row)})
      ON CONFLICT (action_id) DO NOTHING`;
  }

  protected async updateEntry(actionId: string, row: StoredRow): Promise<void> {
    await this.sql`
      UPDATE ai_waiter_action_ledger SET row_data = ${serializeRow(row)} WHERE action_id = ${actionId}`;
  }

  protected async entriesByTurn(
    sessionId: DiningSessionId,
    turnId: string
  ): Promise<StoredRow[]> {
    const rows = (await this.sql`
      SELECT row_data FROM ai_waiter_action_ledger
      WHERE session_id = ${sessionId} AND turn_id = ${turnId}`) as Array<{ row_data: string }>;
    return rows.map((row) => deserializeRow(row.row_data));
  }

  protected async deleteForSession(sessionId: DiningSessionId): Promise<void> {
    await this.sql`DELETE FROM ai_waiter_action_ledger WHERE session_id = ${sessionId}`;
  }

  protected async clearAll(): Promise<void> {
    await this.sql`DELETE FROM ai_waiter_action_ledger`;
  }
}

class SqliteActionLedger extends DurableActionLedger {
  private readonly db: SqliteDatabase;
  private schemaReady = false;

  constructor(db: SqliteDatabase, options: { maximumEntries?: number; now?: () => number } = {}) {
    super(options);
    this.db = db;
  }

  protected async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ai_waiter_action_ledger (
        action_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        row_data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ai_waiter_action_ledger_session_turn
      ON ai_waiter_action_ledger (session_id, turn_id);
    `);
    this.schemaReady = true;
  }

  protected async countEntries(): Promise<number> {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM ai_waiter_action_ledger")
      .get() as { count: number };
    return row.count;
  }

  protected async getEntry(actionId: string): Promise<StoredRow | null> {
    const row = this.db
      .prepare("SELECT row_data FROM ai_waiter_action_ledger WHERE action_id = ?")
      .get(actionId) as { row_data: string } | undefined;
    return row ? deserializeRow(row.row_data) : null;
  }

  protected async insertEntry(actionId: string, row: StoredRow): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO ai_waiter_action_ledger (action_id, session_id, turn_id, row_data)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (action_id) DO NOTHING`
      )
      .run(actionId, row.sessionId, row.entry.turnId, serializeRow(row));
  }

  protected async updateEntry(actionId: string, row: StoredRow): Promise<void> {
    this.db
      .prepare("UPDATE ai_waiter_action_ledger SET row_data = ? WHERE action_id = ?")
      .run(serializeRow(row), actionId);
  }

  protected async entriesByTurn(
    sessionId: DiningSessionId,
    turnId: string
  ): Promise<StoredRow[]> {
    const rows = this.db
      .prepare(
        "SELECT row_data FROM ai_waiter_action_ledger WHERE session_id = ? AND turn_id = ?"
      )
      .all(sessionId, turnId) as Array<{ row_data: string }>;
    return rows.map((row) => deserializeRow(row.row_data));
  }

  protected async deleteForSession(sessionId: DiningSessionId): Promise<void> {
    this.db.prepare("DELETE FROM ai_waiter_action_ledger WHERE session_id = ?").run(sessionId);
  }

  protected async clearAll(): Promise<void> {
    this.db.exec("DELETE FROM ai_waiter_action_ledger");
  }
}

export async function createDurableActionLedger(
  options: { maximumEntries?: number; now?: () => number } = {}
): Promise<ActionLedgerPort> {
  const backend = await getAiWaiterBackend();
  return backend.kind === "postgres"
    ? new PostgresActionLedger(backend.sql, options)
    : new SqliteActionLedger(backend.db, options);
}
