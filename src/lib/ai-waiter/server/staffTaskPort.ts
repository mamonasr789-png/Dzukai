import "server-only";

import { randomUUID } from "node:crypto";
import {
  type DiningSessionId,
  type StaffRequestInput,
} from "../schemas.ts";
import type { ConversationStateStore } from "./conversationStateStore.ts";
import {
  operationError,
  type SafeOperationResult,
} from "./operationResult.ts";
import { logStorageCapacityReached } from "./safeLogger.ts";
import {
  getAiWaiterBackend,
  type PostgresSql,
  type SqliteDatabase,
} from "./aiWaiterDb.ts";
import { getSyncStore } from "../../server/syncStore.ts";

export type StaffRequestType = "waiter_called" | "bill_requested";

export interface StaffRequestData {
  requestId: string;
  type: StaffRequestType;
  restaurantId: string;
  tableNumber: string;
  status: "waiting";
  replayed: boolean;
}

export interface StaffTaskPort {
  requestWaiter(
    sessionId: DiningSessionId,
    command: StaffRequestInput
  ): Promise<SafeOperationResult<StaffRequestData>>;
  requestBill(
    sessionId: DiningSessionId,
    command: StaffRequestInput
  ): Promise<SafeOperationResult<StaffRequestData>>;
  cleanupSession(sessionId: DiningSessionId): Promise<void>;
  sweepExpired(): Promise<number>;
  reset(): Promise<void>;
}

interface StoredStaffRequest extends Omit<StaffRequestData, "replayed"> {
  sessionId: DiningSessionId;
  note?: string;
  createdAt: string;
  expiresAt: number;
}

interface StaffIdempotencyRecord {
  fingerprint: string;
  requestKey: string;
  expiresAt: number;
}

export interface InMemoryStaffTaskAdapterOptions {
  now?: () => number;
  createRequestId?: () => string;
  maximumRequests?: number;
  maximumIdempotencyRecords?: number;
  staffTaskTtlMs?: number;
}

const DEFAULT_MAXIMUM_REQUESTS = 20_000;
const DEFAULT_MAXIMUM_IDEMPOTENCY_RECORDS = 40_000;
const DEFAULT_STAFF_TASK_TTL_MS = 4 * 60 * 60 * 1_000;

/**
 * Bridges an AI-waiter staff request into the real cross-device task feed
 * (src/lib/waiterTasks.ts's shape) so it actually reaches /waiter, /kitchen
 * and /admin over the existing sync engine, instead of staying invisible
 * inside the AI waiter's own internal bookkeeping.
 */
async function publishWaiterTaskRecord(
  request: StoredStaffRequest
): Promise<void> {
  try {
    const store = await getSyncStore();
    if (!store) return;
    const task = {
      id: request.requestId,
      type: request.type,
      status: "waiting" as const,
      orderId: `ai:${request.sessionId}`,
      tableNumber: request.tableNumber,
      createdAt: request.createdAt,
      updatedAt: request.createdAt,
      triggeredBy: `ai:${request.sessionId}:${request.type}`,
      items: [] as { productId: string; name: string; quantity: number }[],
      ...(request.note ? { notes: request.note } : {}),
    };
    await store.push("tasks", [
      {
        id: task.id,
        data: JSON.stringify(task),
        updatedAt: task.updatedAt,
      },
    ]);
  } catch {
    // Best-effort: the AI conversation must not fail because the staff
    // notification side channel is unavailable.
  }
}

/** Development-only task adapter, used directly in tests. */
export class InMemoryStaffTaskAdapter implements StaffTaskPort {
  private readonly requests = new Map<string, StoredStaffRequest>();
  private readonly idempotency = new Map<string, StaffIdempotencyRecord>();
  private readonly now: () => number;
  private readonly createRequestId: () => string;
  private readonly maximumRequests: number;
  private readonly maximumIdempotencyRecords: number;
  private readonly staffTaskTtlMs: number;
  private readonly conversationStore: ConversationStateStore;

  constructor(
    conversationStore: ConversationStateStore,
    options: InMemoryStaffTaskAdapterOptions = {}
  ) {
    this.conversationStore = conversationStore;
    this.now = options.now ?? Date.now;
    this.createRequestId =
      options.createRequestId ??
      (() => `staff_${randomUUID().replaceAll("-", "")}`);
    this.maximumRequests =
      options.maximumRequests ?? DEFAULT_MAXIMUM_REQUESTS;
    this.maximumIdempotencyRecords =
      options.maximumIdempotencyRecords ??
      DEFAULT_MAXIMUM_IDEMPOTENCY_RECORDS;
    this.staffTaskTtlMs =
      options.staffTaskTtlMs ?? DEFAULT_STAFF_TASK_TTL_MS;
  }

  async requestWaiter(
    sessionId: DiningSessionId,
    command: StaffRequestInput
  ): Promise<SafeOperationResult<StaffRequestData>> {
    return this.createRequest(sessionId, "waiter_called", command);
  }

  async requestBill(
    sessionId: DiningSessionId,
    command: StaffRequestInput
  ): Promise<SafeOperationResult<StaffRequestData>> {
    return this.createRequest(sessionId, "bill_requested", command);
  }

  async cleanupSession(sessionId: DiningSessionId): Promise<void> {
    for (const [key, request] of this.requests) {
      if (request.sessionId === sessionId) this.requests.delete(key);
    }
    for (const key of this.idempotency.keys()) {
      if (key.startsWith(`${sessionId}:`)) this.idempotency.delete(key);
    }
  }

  async sweepExpired(): Promise<number> {
    const now = this.now();
    let removed = 0;
    for (const [key, request] of this.requests) {
      if (request.expiresAt <= now) {
        this.requests.delete(key);
        removed += 1;
      }
    }
    for (const [key, record] of this.idempotency) {
      if (record.expiresAt <= now) {
        this.idempotency.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  async reset(): Promise<void> {
    this.requests.clear();
    this.idempotency.clear();
  }

  private async createRequest(
    sessionId: DiningSessionId,
    type: StaffRequestType,
    command: StaffRequestInput
  ): Promise<SafeOperationResult<StaffRequestData>> {
    await this.sweepExpired();
    const state = await this.conversationStore.getSession(sessionId);
    if (!state) {
      return operationError(
        "session_not_found",
        "Dining session was not found or expired."
      );
    }
    // Either a fully verified table, or a fully anonymous demo session that
    // dispatches to no real table. A partial table context is never trusted.
    const verifiedTable = Boolean(
      state.restaurantId && state.tableNumber && state.tableTokenId
    );
    const anonymousDemo =
      !state.restaurantId && !state.tableNumber && !state.tableTokenId;
    if (!verifiedTable && !anonymousDemo) {
      return operationError(
        "table_context_required",
        "A verified table session is required for this request."
      );
    }

    const requestKey = `${sessionId}:${type}`;
    const idempotencyKey = `${requestKey}:${command.idempotencyKey}`;
    const fingerprint = JSON.stringify(command);
    const priorIdempotency = this.idempotency.get(idempotencyKey);
    if (priorIdempotency) {
      if (priorIdempotency.fingerprint !== fingerprint) {
        return operationError(
          "idempotency_conflict",
          "The idempotency key was already used for different staff-request data."
        );
      }
      const existing = this.requests.get(priorIdempotency.requestKey);
      if (existing) return { ok: true, data: this.publicRequest(existing, true) };
      this.idempotency.delete(idempotencyKey);
    }

    const active = this.requests.get(requestKey);
    const expiresAt = Math.min(
      Date.parse(state.expiresAt),
      this.now() + this.staffTaskTtlMs
    );
    if (active) {
      if (this.idempotency.size >= this.maximumIdempotencyRecords) {
        logStorageCapacityReached(
          "staff_idempotency",
          this.maximumIdempotencyRecords
        );
        return operationError(
          "storage_capacity_exceeded",
          "Staff-request idempotency capacity has been reached."
        );
      }
      this.idempotency.set(idempotencyKey, {
        fingerprint,
        requestKey,
        expiresAt,
      });
      return { ok: true, data: this.publicRequest(active, true) };
    }

    if (this.requests.size >= this.maximumRequests) {
      logStorageCapacityReached("staff_requests", this.maximumRequests);
      return operationError(
        "storage_capacity_exceeded",
        "Staff-request capacity has been reached."
      );
    }
    if (this.idempotency.size >= this.maximumIdempotencyRecords) {
      logStorageCapacityReached(
        "staff_idempotency",
        this.maximumIdempotencyRecords
      );
      return operationError(
        "storage_capacity_exceeded",
        "Staff-request idempotency capacity has been reached."
      );
    }

    const request: StoredStaffRequest = {
      requestId: this.createRequestId(),
      type,
      restaurantId: state.restaurantId ?? "demo",
      tableNumber: state.tableNumber ?? "demo",
      status: "waiting",
      sessionId,
      note: command.note,
      createdAt: new Date(this.now()).toISOString(),
      expiresAt,
    };
    this.requests.set(requestKey, request);
    this.idempotency.set(idempotencyKey, {
      fingerprint,
      requestKey,
      expiresAt,
    });
    return { ok: true, data: this.publicRequest(request, false) };
  }

  private publicRequest(
    request: StoredStaffRequest,
    replayed: boolean
  ): StaffRequestData {
    return {
      requestId: request.requestId,
      type: request.type,
      restaurantId: request.restaurantId,
      tableNumber: request.tableNumber,
      status: request.status,
      replayed,
    };
  }
}

// ── Durable (Postgres / SQLite) ─────────────────────────────────────────────

const SWEEP_BATCH_LIMIT = 500;

abstract class DurableStaffTaskAdapter implements StaffTaskPort {
  private readonly now: () => number;
  private readonly createRequestId: () => string;
  private readonly maximumRequests: number;
  private readonly maximumIdempotencyRecords: number;
  private readonly staffTaskTtlMs: number;
  private readonly conversationStore: ConversationStateStore;

  constructor(
    conversationStore: ConversationStateStore,
    options: InMemoryStaffTaskAdapterOptions = {}
  ) {
    this.conversationStore = conversationStore;
    this.now = options.now ?? Date.now;
    this.createRequestId =
      options.createRequestId ?? (() => `staff_${randomUUID().replaceAll("-", "")}`);
    this.maximumRequests = options.maximumRequests ?? DEFAULT_MAXIMUM_REQUESTS;
    this.maximumIdempotencyRecords =
      options.maximumIdempotencyRecords ?? DEFAULT_MAXIMUM_IDEMPOTENCY_RECORDS;
    this.staffTaskTtlMs = options.staffTaskTtlMs ?? DEFAULT_STAFF_TASK_TTL_MS;
  }

  protected abstract ensureSchema(): Promise<void>;
  protected abstract countRequests(): Promise<number>;
  protected abstract countIdempotency(): Promise<number>;
  protected abstract getRequest(requestKey: string): Promise<StoredStaffRequest | null>;
  protected abstract insertRequest(requestKey: string, request: StoredStaffRequest): Promise<void>;
  protected abstract getIdempotency(
    idempotencyKey: string
  ): Promise<StaffIdempotencyRecord | null>;
  protected abstract deleteIdempotency(idempotencyKey: string): Promise<void>;
  protected abstract upsertIdempotency(
    idempotencyKey: string,
    sessionId: DiningSessionId,
    record: StaffIdempotencyRecord
  ): Promise<void>;
  protected abstract deleteRequestsForSession(sessionId: DiningSessionId): Promise<void>;
  protected abstract deleteIdempotencyForSession(sessionId: DiningSessionId): Promise<void>;
  protected abstract expiredRequestKeys(nowMs: number, limit: number): Promise<string[]>;
  protected abstract expiredIdempotencyKeys(nowMs: number, limit: number): Promise<string[]>;
  protected abstract deleteRequestKeys(keys: string[]): Promise<void>;
  protected abstract deleteIdempotencyKeys(keys: string[]): Promise<void>;
  protected abstract clearAll(): Promise<void>;

  async requestWaiter(
    sessionId: DiningSessionId,
    command: StaffRequestInput
  ): Promise<SafeOperationResult<StaffRequestData>> {
    return this.createRequest(sessionId, "waiter_called", command);
  }

  async requestBill(
    sessionId: DiningSessionId,
    command: StaffRequestInput
  ): Promise<SafeOperationResult<StaffRequestData>> {
    return this.createRequest(sessionId, "bill_requested", command);
  }

  async cleanupSession(sessionId: DiningSessionId): Promise<void> {
    await this.ensureSchema();
    await this.deleteRequestsForSession(sessionId);
    await this.deleteIdempotencyForSession(sessionId);
  }

  async sweepExpired(): Promise<number> {
    await this.ensureSchema();
    const now = this.now();
    let removed = 0;
    const requestKeys = await this.expiredRequestKeys(now, SWEEP_BATCH_LIMIT);
    if (requestKeys.length > 0) {
      await this.deleteRequestKeys(requestKeys);
      removed += requestKeys.length;
    }
    const idempotencyKeys = await this.expiredIdempotencyKeys(now, SWEEP_BATCH_LIMIT);
    if (idempotencyKeys.length > 0) {
      await this.deleteIdempotencyKeys(idempotencyKeys);
      removed += idempotencyKeys.length;
    }
    return removed;
  }

  async reset(): Promise<void> {
    await this.ensureSchema();
    await this.clearAll();
  }

  private async createRequest(
    sessionId: DiningSessionId,
    type: StaffRequestType,
    command: StaffRequestInput
  ): Promise<SafeOperationResult<StaffRequestData>> {
    await this.ensureSchema();
    const state = await this.conversationStore.getSession(sessionId);
    if (!state) {
      return operationError("session_not_found", "Dining session was not found or expired.");
    }
    const verifiedTable = Boolean(state.restaurantId && state.tableNumber && state.tableTokenId);
    const anonymousDemo = !state.restaurantId && !state.tableNumber && !state.tableTokenId;
    if (!verifiedTable && !anonymousDemo) {
      return operationError(
        "table_context_required",
        "A verified table session is required for this request."
      );
    }

    const requestKey = `${sessionId}:${type}`;
    const idempotencyKey = `${requestKey}:${command.idempotencyKey}`;
    const fingerprint = JSON.stringify(command);
    const priorIdempotency = await this.getIdempotency(idempotencyKey);
    if (priorIdempotency) {
      if (priorIdempotency.fingerprint !== fingerprint) {
        return operationError(
          "idempotency_conflict",
          "The idempotency key was already used for different staff-request data."
        );
      }
      const existing = await this.getRequest(priorIdempotency.requestKey);
      if (existing) return { ok: true, data: this.publicRequest(existing, true) };
      await this.deleteIdempotency(idempotencyKey);
    }

    const active = await this.getRequest(requestKey);
    const expiresAt = Math.min(
      Date.parse(state.expiresAt),
      this.now() + this.staffTaskTtlMs
    );
    if (active) {
      if ((await this.countIdempotency()) >= this.maximumIdempotencyRecords) {
        logStorageCapacityReached("staff_idempotency", this.maximumIdempotencyRecords);
        return operationError(
          "storage_capacity_exceeded",
          "Staff-request idempotency capacity has been reached."
        );
      }
      await this.upsertIdempotency(idempotencyKey, sessionId, {
        fingerprint,
        requestKey,
        expiresAt,
      });
      return { ok: true, data: this.publicRequest(active, true) };
    }

    if ((await this.countRequests()) >= this.maximumRequests) {
      logStorageCapacityReached("staff_requests", this.maximumRequests);
      return operationError(
        "storage_capacity_exceeded",
        "Staff-request capacity has been reached."
      );
    }
    if ((await this.countIdempotency()) >= this.maximumIdempotencyRecords) {
      logStorageCapacityReached("staff_idempotency", this.maximumIdempotencyRecords);
      return operationError(
        "storage_capacity_exceeded",
        "Staff-request idempotency capacity has been reached."
      );
    }

    const request: StoredStaffRequest = {
      requestId: this.createRequestId(),
      type,
      restaurantId: state.restaurantId ?? "demo",
      tableNumber: state.tableNumber ?? "demo",
      status: "waiting",
      sessionId,
      note: command.note,
      createdAt: new Date(this.now()).toISOString(),
      expiresAt,
    };
    await this.insertRequest(requestKey, request);
    await publishWaiterTaskRecord(request);
    await this.upsertIdempotency(idempotencyKey, sessionId, {
      fingerprint,
      requestKey,
      expiresAt,
    });
    return { ok: true, data: this.publicRequest(request, false) };
  }

  private publicRequest(
    request: StoredStaffRequest,
    replayed: boolean
  ): StaffRequestData {
    return {
      requestId: request.requestId,
      type: request.type,
      restaurantId: request.restaurantId,
      tableNumber: request.tableNumber,
      status: request.status,
      replayed,
    };
  }
}

class PostgresStaffTaskAdapter extends DurableStaffTaskAdapter {
  private readonly sql: PostgresSql;
  private ready: Promise<void> | undefined;

  constructor(
    sql: PostgresSql,
    conversationStore: ConversationStateStore,
    options: InMemoryStaffTaskAdapterOptions = {}
  ) {
    super(conversationStore, options);
    this.sql = sql;
  }

  protected ensureSchema(): Promise<void> {
    this.ready ??= (async () => {
      await this.sql`
        CREATE TABLE IF NOT EXISTS ai_waiter_staff_requests (
          request_key TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          request_id TEXT NOT NULL,
          type TEXT NOT NULL,
          restaurant_id TEXT NOT NULL,
          table_number TEXT NOT NULL,
          status TEXT NOT NULL,
          note TEXT,
          created_at TEXT NOT NULL,
          expires_at BIGINT NOT NULL
        )`;
      await this.sql`
        CREATE INDEX IF NOT EXISTS ai_waiter_staff_requests_session
        ON ai_waiter_staff_requests (session_id)`;
      await this.sql`
        CREATE INDEX IF NOT EXISTS ai_waiter_staff_requests_expires
        ON ai_waiter_staff_requests (expires_at)`;
      await this.sql`
        CREATE TABLE IF NOT EXISTS ai_waiter_staff_idempotency (
          idempotency_key TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          fingerprint TEXT NOT NULL,
          request_key TEXT NOT NULL,
          expires_at BIGINT NOT NULL
        )`;
      await this.sql`
        CREATE INDEX IF NOT EXISTS ai_waiter_staff_idempotency_session
        ON ai_waiter_staff_idempotency (session_id)`;
      await this.sql`
        CREATE INDEX IF NOT EXISTS ai_waiter_staff_idempotency_expires
        ON ai_waiter_staff_idempotency (expires_at)`;
    })();
    return this.ready;
  }

  protected async countRequests(): Promise<number> {
    const rows = (await this
      .sql`SELECT COUNT(*)::int AS count FROM ai_waiter_staff_requests`) as Array<{
      count: number;
    }>;
    return rows[0]?.count ?? 0;
  }

  protected async countIdempotency(): Promise<number> {
    const rows = (await this
      .sql`SELECT COUNT(*)::int AS count FROM ai_waiter_staff_idempotency`) as Array<{
      count: number;
    }>;
    return rows[0]?.count ?? 0;
  }

  protected async getRequest(requestKey: string): Promise<StoredStaffRequest | null> {
    const rows = (await this.sql`
      SELECT session_id, request_id, type, restaurant_id, table_number, status, note,
             created_at, expires_at
      FROM ai_waiter_staff_requests WHERE request_key = ${requestKey}`) as Array<{
      session_id: DiningSessionId;
      request_id: string;
      type: StaffRequestType;
      restaurant_id: string;
      table_number: string;
      status: "waiting";
      note: string | null;
      created_at: string;
      expires_at: string | number;
    }>;
    const row = rows[0];
    if (!row) return null;
    return {
      sessionId: row.session_id,
      requestId: row.request_id,
      type: row.type,
      restaurantId: row.restaurant_id,
      tableNumber: row.table_number,
      status: row.status,
      note: row.note ?? undefined,
      createdAt: row.created_at,
      expiresAt: Number(row.expires_at),
    };
  }

  protected async insertRequest(requestKey: string, request: StoredStaffRequest): Promise<void> {
    await this.sql`
      INSERT INTO ai_waiter_staff_requests
        (request_key, session_id, request_id, type, restaurant_id, table_number, status,
         note, created_at, expires_at)
      VALUES (${requestKey}, ${request.sessionId}, ${request.requestId}, ${request.type},
              ${request.restaurantId}, ${request.tableNumber}, ${request.status},
              ${request.note ?? null}, ${request.createdAt}, ${request.expiresAt})
      ON CONFLICT (request_key) DO NOTHING`;
  }

  protected async getIdempotency(idempotencyKey: string): Promise<StaffIdempotencyRecord | null> {
    const rows = (await this.sql`
      SELECT fingerprint, request_key, expires_at
      FROM ai_waiter_staff_idempotency WHERE idempotency_key = ${idempotencyKey}`) as Array<{
      fingerprint: string;
      request_key: string;
      expires_at: string | number;
    }>;
    const row = rows[0];
    if (!row) return null;
    return { fingerprint: row.fingerprint, requestKey: row.request_key, expiresAt: Number(row.expires_at) };
  }

  protected async deleteIdempotency(idempotencyKey: string): Promise<void> {
    await this.sql`DELETE FROM ai_waiter_staff_idempotency WHERE idempotency_key = ${idempotencyKey}`;
  }

  protected async upsertIdempotency(
    idempotencyKey: string,
    sessionId: DiningSessionId,
    record: StaffIdempotencyRecord
  ): Promise<void> {
    await this.sql`
      INSERT INTO ai_waiter_staff_idempotency (idempotency_key, session_id, fingerprint, request_key, expires_at)
      VALUES (${idempotencyKey}, ${sessionId}, ${record.fingerprint}, ${record.requestKey}, ${record.expiresAt})
      ON CONFLICT (idempotency_key) DO UPDATE SET
        fingerprint = EXCLUDED.fingerprint, request_key = EXCLUDED.request_key,
        expires_at = EXCLUDED.expires_at`;
  }

  protected async deleteRequestsForSession(sessionId: DiningSessionId): Promise<void> {
    await this.sql`DELETE FROM ai_waiter_staff_requests WHERE session_id = ${sessionId}`;
  }

  protected async deleteIdempotencyForSession(sessionId: DiningSessionId): Promise<void> {
    await this.sql`DELETE FROM ai_waiter_staff_idempotency WHERE session_id = ${sessionId}`;
  }

  protected async expiredRequestKeys(nowMs: number, limit: number): Promise<string[]> {
    const rows = (await this.sql`
      SELECT request_key FROM ai_waiter_staff_requests
      WHERE expires_at <= ${nowMs} LIMIT ${limit}`) as Array<{ request_key: string }>;
    return rows.map((row) => row.request_key);
  }

  protected async expiredIdempotencyKeys(nowMs: number, limit: number): Promise<string[]> {
    const rows = (await this.sql`
      SELECT idempotency_key FROM ai_waiter_staff_idempotency
      WHERE expires_at <= ${nowMs} LIMIT ${limit}`) as Array<{ idempotency_key: string }>;
    return rows.map((row) => row.idempotency_key);
  }

  protected async deleteRequestKeys(keys: string[]): Promise<void> {
    await this.sql`DELETE FROM ai_waiter_staff_requests WHERE request_key = ANY(${keys})`;
  }

  protected async deleteIdempotencyKeys(keys: string[]): Promise<void> {
    await this.sql`DELETE FROM ai_waiter_staff_idempotency WHERE idempotency_key = ANY(${keys})`;
  }

  protected async clearAll(): Promise<void> {
    await this.sql`DELETE FROM ai_waiter_staff_requests`;
    await this.sql`DELETE FROM ai_waiter_staff_idempotency`;
  }
}

class SqliteStaffTaskAdapter extends DurableStaffTaskAdapter {
  private readonly db: SqliteDatabase;
  private schemaReady = false;

  constructor(
    db: SqliteDatabase,
    conversationStore: ConversationStateStore,
    options: InMemoryStaffTaskAdapterOptions = {}
  ) {
    super(conversationStore, options);
    this.db = db;
  }

  protected async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ai_waiter_staff_requests (
        request_key TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        type TEXT NOT NULL,
        restaurant_id TEXT NOT NULL,
        table_number TEXT NOT NULL,
        status TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ai_waiter_staff_requests_session
      ON ai_waiter_staff_requests (session_id);
      CREATE INDEX IF NOT EXISTS ai_waiter_staff_requests_expires
      ON ai_waiter_staff_requests (expires_at);
      CREATE TABLE IF NOT EXISTS ai_waiter_staff_idempotency (
        idempotency_key TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        request_key TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ai_waiter_staff_idempotency_session
      ON ai_waiter_staff_idempotency (session_id);
      CREATE INDEX IF NOT EXISTS ai_waiter_staff_idempotency_expires
      ON ai_waiter_staff_idempotency (expires_at);
    `);
    this.schemaReady = true;
  }

  protected async countRequests(): Promise<number> {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM ai_waiter_staff_requests")
      .get() as { count: number };
    return row.count;
  }

  protected async countIdempotency(): Promise<number> {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM ai_waiter_staff_idempotency")
      .get() as { count: number };
    return row.count;
  }

  protected async getRequest(requestKey: string): Promise<StoredStaffRequest | null> {
    const row = this.db
      .prepare(
        `SELECT session_id, request_id, type, restaurant_id, table_number, status, note,
                created_at, expires_at
         FROM ai_waiter_staff_requests WHERE request_key = ?`
      )
      .get(requestKey) as
      | {
          session_id: DiningSessionId;
          request_id: string;
          type: StaffRequestType;
          restaurant_id: string;
          table_number: string;
          status: "waiting";
          note: string | null;
          created_at: string;
          expires_at: number;
        }
      | undefined;
    if (!row) return null;
    return {
      sessionId: row.session_id,
      requestId: row.request_id,
      type: row.type,
      restaurantId: row.restaurant_id,
      tableNumber: row.table_number,
      status: row.status,
      note: row.note ?? undefined,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  protected async insertRequest(requestKey: string, request: StoredStaffRequest): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO ai_waiter_staff_requests
           (request_key, session_id, request_id, type, restaurant_id, table_number, status,
            note, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (request_key) DO NOTHING`
      )
      .run(
        requestKey,
        request.sessionId,
        request.requestId,
        request.type,
        request.restaurantId,
        request.tableNumber,
        request.status,
        request.note ?? null,
        request.createdAt,
        request.expiresAt
      );
  }

  protected async getIdempotency(idempotencyKey: string): Promise<StaffIdempotencyRecord | null> {
    const row = this.db
      .prepare(
        "SELECT fingerprint, request_key, expires_at FROM ai_waiter_staff_idempotency WHERE idempotency_key = ?"
      )
      .get(idempotencyKey) as
      | { fingerprint: string; request_key: string; expires_at: number }
      | undefined;
    if (!row) return null;
    return { fingerprint: row.fingerprint, requestKey: row.request_key, expiresAt: row.expires_at };
  }

  protected async deleteIdempotency(idempotencyKey: string): Promise<void> {
    this.db
      .prepare("DELETE FROM ai_waiter_staff_idempotency WHERE idempotency_key = ?")
      .run(idempotencyKey);
  }

  protected async upsertIdempotency(
    idempotencyKey: string,
    sessionId: DiningSessionId,
    record: StaffIdempotencyRecord
  ): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO ai_waiter_staff_idempotency
           (idempotency_key, session_id, fingerprint, request_key, expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (idempotency_key) DO UPDATE SET
           fingerprint = excluded.fingerprint, request_key = excluded.request_key,
           expires_at = excluded.expires_at`
      )
      .run(idempotencyKey, sessionId, record.fingerprint, record.requestKey, record.expiresAt);
  }

  protected async deleteRequestsForSession(sessionId: DiningSessionId): Promise<void> {
    this.db.prepare("DELETE FROM ai_waiter_staff_requests WHERE session_id = ?").run(sessionId);
  }

  protected async deleteIdempotencyForSession(sessionId: DiningSessionId): Promise<void> {
    this.db
      .prepare("DELETE FROM ai_waiter_staff_idempotency WHERE session_id = ?")
      .run(sessionId);
  }

  protected async expiredRequestKeys(nowMs: number, limit: number): Promise<string[]> {
    const rows = this.db
      .prepare("SELECT request_key FROM ai_waiter_staff_requests WHERE expires_at <= ? LIMIT ?")
      .all(nowMs, limit) as Array<{ request_key: string }>;
    return rows.map((row) => row.request_key);
  }

  protected async expiredIdempotencyKeys(nowMs: number, limit: number): Promise<string[]> {
    const rows = this.db
      .prepare(
        "SELECT idempotency_key FROM ai_waiter_staff_idempotency WHERE expires_at <= ? LIMIT ?"
      )
      .all(nowMs, limit) as Array<{ idempotency_key: string }>;
    return rows.map((row) => row.idempotency_key);
  }

  protected async deleteRequestKeys(keys: string[]): Promise<void> {
    const stmt = this.db.prepare("DELETE FROM ai_waiter_staff_requests WHERE request_key = ?");
    for (const key of keys) stmt.run(key);
  }

  protected async deleteIdempotencyKeys(keys: string[]): Promise<void> {
    const stmt = this.db.prepare(
      "DELETE FROM ai_waiter_staff_idempotency WHERE idempotency_key = ?"
    );
    for (const key of keys) stmt.run(key);
  }

  protected async clearAll(): Promise<void> {
    this.db.exec(
      "DELETE FROM ai_waiter_staff_requests; DELETE FROM ai_waiter_staff_idempotency;"
    );
  }
}

export async function createDurableStaffTaskAdapter(
  conversationStore: ConversationStateStore,
  options: InMemoryStaffTaskAdapterOptions = {}
): Promise<StaffTaskPort> {
  const backend = await getAiWaiterBackend();
  return backend.kind === "postgres"
    ? new PostgresStaffTaskAdapter(backend.sql, conversationStore, options)
    : new SqliteStaffTaskAdapter(backend.db, conversationStore, options);
}
