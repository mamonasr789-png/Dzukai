import "server-only";

import { randomUUID } from "node:crypto";
import {
  ConversationStateSchema,
  type ConversationState,
  type ConversationStateUpdate,
  type DiningSessionId,
  type SupportedLanguage,
} from "../schemas.ts";
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

export interface VerifiedTableContext {
  restaurantId: string;
  tableNumber: string;
  tableTokenId: string;
}

export interface CreateSessionCommand {
  language: SupportedLanguage;
  tableContext: VerifiedTableContext | null;
}

export interface ConversationPreferencesUpdate {
  language?: ConversationState["language"];
  preferences?: ConversationState["preferences"];
  temporaryPreferences?: ConversationState["temporaryPreferences"];
  dislikedIngredients?: ConversationState["dislikedIngredients"];
  dietaryRequirements?: ConversationState["dietaryRequirements"];
  allergies?: ConversationState["allergies"];
  budget?: ConversationState["budget"];
  budgetScope?: ConversationState["budgetScope"];
  hungerLevel?: ConversationState["hungerLevel"];
}

export interface ConversationTurnMetadataUpdate {
  lastIntent: string | null;
  lastToolNames: string[];
  lastInteractionAt: string;
}

type SessionCleanupHandler = (sessionId: DiningSessionId) => void | Promise<void>;

export interface ConversationStateStore {
  createSession(
    command: CreateSessionCommand
  ): Promise<SafeOperationResult<ConversationState>>;
  getSession(sessionId: DiningSessionId): Promise<ConversationState | null>;
  updatePreferences(
    sessionId: DiningSessionId,
    update: ConversationPreferencesUpdate
  ): Promise<SafeOperationResult<ConversationState>>;
  applyTurnUpdate(
    sessionId: DiningSessionId,
    update: ConversationStateUpdate,
    metadata: ConversationTurnMetadataUpdate
  ): Promise<SafeOperationResult<ConversationState>>;
  updateConversationStage(
    sessionId: DiningSessionId,
    stage: ConversationState["stage"]
  ): Promise<SafeOperationResult<ConversationState>>;
  setLatestReferences(
    sessionId: DiningSessionId,
    productIds: string[]
  ): Promise<SafeOperationResult<ConversationState>>;
  setUnresolvedQuestion(
    sessionId: DiningSessionId,
    question: ConversationState["unresolvedQuestion"]
  ): Promise<SafeOperationResult<ConversationState>>;
  updateCartRevision(
    sessionId: DiningSessionId,
    revision: number
  ): Promise<SafeOperationResult<ConversationState>>;
  touchSession(
    sessionId: DiningSessionId
  ): Promise<SafeOperationResult<ConversationState>>;
  deleteSession(sessionId: DiningSessionId): Promise<boolean>;
  sweepExpired(): Promise<DiningSessionId[]>;
  registerSessionCleanup(handler: SessionCleanupHandler): () => void;
  reset(): Promise<void>;
}

export interface InMemoryConversationStateStoreOptions {
  ttlMs?: number;
  now?: () => number;
  createId?: () => DiningSessionId;
  maximumSessions?: number;
}

const DEFAULT_SESSION_TTL_MS = 4 * 60 * 60 * 1_000;
const DEFAULT_MAXIMUM_SESSIONS = 10_000;

function defaultSessionId(): DiningSessionId {
  return `ds_${randomUUID().replaceAll("-", "")}`;
}

function cloneState(state: ConversationState): ConversationState {
  return structuredClone(state);
}

/**
 * Development-only state store. Every public operation performs a global lazy
 * expiry sweep. Cleanup listeners let dependent adapters remove session-owned
 * records when a session expires, is deleted, or the store is reset.
 */
export class InMemoryConversationStateStore implements ConversationStateStore {
  private readonly states = new Map<DiningSessionId, ConversationState>();
  private readonly cleanupHandlers = new Set<SessionCleanupHandler>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly createId: () => DiningSessionId;
  private readonly maximumSessions: number;

  constructor(options: InMemoryConversationStateStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_SESSION_TTL_MS;
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? defaultSessionId;
    this.maximumSessions =
      options.maximumSessions ?? DEFAULT_MAXIMUM_SESSIONS;
  }

  async createSession(
    command: CreateSessionCommand
  ): Promise<SafeOperationResult<ConversationState>> {
    await this.sweepExpired();
    if (this.states.size >= this.maximumSessions) {
      logStorageCapacityReached("conversation_sessions", this.maximumSessions);
      return operationError(
        "storage_capacity_exceeded",
        "Dining-session capacity has been reached."
      );
    }

    const now = this.now();
    const timestamp = new Date(now).toISOString();
    const state = ConversationStateSchema.parse({
      schemaVersion: 1,
      sessionId: this.createUniqueId(),
      restaurantId: command.tableContext?.restaurantId ?? null,
      tableNumber: command.tableContext?.tableNumber ?? null,
      tableTokenId: command.tableContext?.tableTokenId ?? null,
      language: command.language,
      stage: "greeting",
      preferences: {
        preferredProductIds: [],
        preferredCategories: [],
        preferredProteins: [],
        preferredDrinks: [],
      },
      temporaryPreferences: {
        preferredProductIds: [],
        preferredCategories: [],
        preferredProteins: [],
        preferredDrinks: [],
      },
      dislikedIngredients: [],
      dietaryRequirements: [],
      allergies: [],
      budget: null,
      budgetScope: null,
      hungerLevel: null,
      latestReferencedProductIds: [],
      unresolvedQuestion: null,
      ambiguity: null,
      cartRevision: 0,
      lastIntent: null,
      lastToolNames: [],
      lastInteractionAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: new Date(now + this.ttlMs).toISOString(),
    });
    this.states.set(state.sessionId, cloneState(state));
    return { ok: true, data: cloneState(state) };
  }

  async getSession(sessionId: DiningSessionId): Promise<ConversationState | null> {
    await this.sweepExpired();
    const state = this.states.get(sessionId);
    return state ? cloneState(state) : null;
  }

  async updatePreferences(
    sessionId: DiningSessionId,
    update: ConversationPreferencesUpdate
  ): Promise<SafeOperationResult<ConversationState>> {
    return this.mutateSession(sessionId, (state) => ({
      ...state,
      language: update.language ?? state.language,
      preferences: update.preferences ?? state.preferences,
      temporaryPreferences:
        update.temporaryPreferences ?? state.temporaryPreferences,
      dislikedIngredients:
        update.dislikedIngredients ?? state.dislikedIngredients,
      dietaryRequirements:
        update.dietaryRequirements ?? state.dietaryRequirements,
      allergies: update.allergies ?? state.allergies,
      budget: update.budget === undefined ? state.budget : update.budget,
      budgetScope:
        update.budgetScope === undefined
          ? state.budgetScope
          : update.budgetScope,
      hungerLevel:
        update.hungerLevel === undefined
          ? state.hungerLevel
          : update.hungerLevel,
    }));
  }

  async applyTurnUpdate(
    sessionId: DiningSessionId,
    update: ConversationStateUpdate,
    metadata: ConversationTurnMetadataUpdate
  ): Promise<SafeOperationResult<ConversationState>> {
    return this.mutateSession(
      sessionId,
      (state) => ({
        ...state,
        language: update.language ?? state.language,
        stage: update.stage ?? state.stage,
        preferences: update.preferences ?? state.preferences,
        temporaryPreferences:
          update.temporaryPreferences ?? state.temporaryPreferences,
        dislikedIngredients:
          update.dislikedIngredients ?? state.dislikedIngredients,
        dietaryRequirements:
          update.dietaryRequirements ?? state.dietaryRequirements,
        allergies: update.allergies ?? state.allergies,
        budget: update.budget === undefined ? state.budget : update.budget,
        budgetScope:
          update.budgetScope === undefined
            ? state.budgetScope
            : update.budgetScope,
        hungerLevel:
          update.hungerLevel === undefined
            ? state.hungerLevel
            : update.hungerLevel,
        latestReferencedProductIds:
          update.latestReferencedProductIds ??
          state.latestReferencedProductIds,
        unresolvedQuestion:
          update.unresolvedQuestion === undefined
            ? state.unresolvedQuestion
            : update.unresolvedQuestion,
        ambiguity:
          update.ambiguity === undefined ? state.ambiguity : update.ambiguity,
        lastIntent: metadata.lastIntent,
        lastToolNames: metadata.lastToolNames.slice(0, 8),
        lastInteractionAt: metadata.lastInteractionAt,
      }),
      true
    );
  }

  async updateConversationStage(
    sessionId: DiningSessionId,
    stage: ConversationState["stage"]
  ): Promise<SafeOperationResult<ConversationState>> {
    return this.mutateSession(sessionId, (state) => ({ ...state, stage }));
  }

  async setLatestReferences(
    sessionId: DiningSessionId,
    productIds: string[]
  ): Promise<SafeOperationResult<ConversationState>> {
    return this.mutateSession(sessionId, (state) => ({
      ...state,
      stage: "recommending",
      latestReferencedProductIds: productIds.slice(0, 10),
      ambiguity:
        productIds.length > 1
          ? {
              kind: "product" as const,
              candidateIds: productIds.slice(0, 10),
            }
          : null,
    }));
  }

  async setUnresolvedQuestion(
    sessionId: DiningSessionId,
    question: ConversationState["unresolvedQuestion"]
  ): Promise<SafeOperationResult<ConversationState>> {
    return this.mutateSession(sessionId, (state) => ({
      ...state,
      unresolvedQuestion: question,
    }));
  }

  async updateCartRevision(
    sessionId: DiningSessionId,
    revision: number
  ): Promise<SafeOperationResult<ConversationState>> {
    if (!Number.isSafeInteger(revision) || revision < 0) {
      return operationError(
        "invalid_request",
        "Cart revision must be a non-negative safe integer."
      );
    }
    return this.mutateSession(sessionId, (state) => ({
      ...state,
      cartRevision: revision,
    }));
  }

  async touchSession(
    sessionId: DiningSessionId
  ): Promise<SafeOperationResult<ConversationState>> {
    return this.mutateSession(sessionId, (state) => state, true);
  }

  async deleteSession(sessionId: DiningSessionId): Promise<boolean> {
    await this.sweepExpired();
    const deleted = this.states.delete(sessionId);
    if (deleted) await this.notifyCleanup(sessionId);
    return deleted;
  }

  async sweepExpired(): Promise<DiningSessionId[]> {
    const now = this.now();
    const expired: DiningSessionId[] = [];
    for (const [sessionId, state] of this.states) {
      if (Date.parse(state.expiresAt) <= now) {
        this.states.delete(sessionId);
        expired.push(sessionId);
      }
    }
    for (const sessionId of expired) {
      await this.notifyCleanup(sessionId);
    }
    return expired;
  }

  registerSessionCleanup(handler: SessionCleanupHandler): () => void {
    this.cleanupHandlers.add(handler);
    return () => this.cleanupHandlers.delete(handler);
  }

  async reset(): Promise<void> {
    const sessionIds = [...this.states.keys()];
    this.states.clear();
    for (const sessionId of sessionIds) {
      await this.notifyCleanup(sessionId);
    }
  }

  private async mutateSession(
    sessionId: DiningSessionId,
    mutate: (state: ConversationState) => ConversationState,
    refreshExpiry = false
  ): Promise<SafeOperationResult<ConversationState>> {
    await this.sweepExpired();
    const current = this.states.get(sessionId);
    if (!current) {
      return operationError(
        "session_not_found",
        "Dining session was not found or expired."
      );
    }
    const now = this.now();
    const candidate = ConversationStateSchema.safeParse({
      ...mutate(cloneState(current)),
      // Security and ownership fields are immutable through conversational updates.
      sessionId: current.sessionId,
      restaurantId: current.restaurantId,
      tableNumber: current.tableNumber,
      tableTokenId: current.tableTokenId,
      createdAt: current.createdAt,
      updatedAt: new Date(now).toISOString(),
      expiresAt: refreshExpiry
        ? new Date(now + this.ttlMs).toISOString()
        : current.expiresAt,
    });
    if (!candidate.success) {
      return operationError(
        "invalid_request",
        "Conversation-state mutation failed validation."
      );
    }
    this.states.set(sessionId, cloneState(candidate.data));
    return { ok: true, data: cloneState(candidate.data) };
  }

  private createUniqueId(): DiningSessionId {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const sessionId = this.createId();
      if (!this.states.has(sessionId)) return sessionId;
    }
    throw new Error("Unable to create a unique dining session identifier.");
  }

  private async notifyCleanup(sessionId: DiningSessionId): Promise<void> {
    await Promise.all(
      [...this.cleanupHandlers].map((handler) => Promise.resolve(handler(sessionId)))
    );
  }
}

// ── Durable (Postgres / SQLite) ─────────────────────────────────────────────

const SWEEP_THROTTLE_MS = 5 * 60 * 1_000;
const SWEEP_BATCH_LIMIT = 500;

/**
 * Durable session store: same behaviour as InMemoryConversationStateStore,
 * but every read checks expiry on the single row it fetched (`WHERE
 * expires_at > now` in the query, or a per-row check after the fetch) rather
 * than walking the whole table. sweepExpired() still exists for orphaned rows
 * nobody ever reads again (an abandoned session), but it is only actually run
 * — via an indexed `expires_at` query, batch-limited — at most once every
 * SWEEP_THROTTLE_MS per process, from createSession(). A full-table scan on
 * every request would be wasteful; expired rows are otherwise cleaned lazily
 * the next time (if ever) something touches them.
 */
abstract class DurableConversationStateStore implements ConversationStateStore {
  protected readonly cleanupHandlers = new Set<SessionCleanupHandler>();
  protected readonly ttlMs: number;
  protected readonly now: () => number;
  protected readonly createId: () => DiningSessionId;
  protected readonly maximumSessions: number;
  private lastSweepAt = 0;

  constructor(options: InMemoryConversationStateStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_SESSION_TTL_MS;
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? defaultSessionId;
    this.maximumSessions = options.maximumSessions ?? DEFAULT_MAXIMUM_SESSIONS;
  }

  protected abstract ensureSchema(): Promise<void>;
  protected abstract countSessions(): Promise<number>;
  protected abstract sessionExists(sessionId: DiningSessionId): Promise<boolean>;
  protected abstract insertSession(state: ConversationState): Promise<void>;
  protected abstract readRow(
    sessionId: DiningSessionId
  ): Promise<{ data: ConversationState; expiresAtMs: number } | null>;
  protected abstract writeRow(
    sessionId: DiningSessionId,
    state: ConversationState
  ): Promise<void>;
  protected abstract deleteRow(sessionId: DiningSessionId): Promise<boolean>;
  protected abstract expiredSessionIds(
    nowMs: number,
    limit: number
  ): Promise<DiningSessionId[]>;
  protected abstract deleteRows(sessionIds: DiningSessionId[]): Promise<void>;
  protected abstract allSessionIds(): Promise<DiningSessionId[]>;
  protected abstract deleteAll(): Promise<void>;

  async createSession(
    command: CreateSessionCommand
  ): Promise<SafeOperationResult<ConversationState>> {
    await this.ensureSchema();
    await this.maybeSweep();
    if ((await this.countSessions()) >= this.maximumSessions) {
      logStorageCapacityReached("conversation_sessions", this.maximumSessions);
      return operationError(
        "storage_capacity_exceeded",
        "Dining-session capacity has been reached."
      );
    }

    const now = this.now();
    const timestamp = new Date(now).toISOString();
    const state = ConversationStateSchema.parse({
      schemaVersion: 1,
      sessionId: await this.createUniqueId(),
      restaurantId: command.tableContext?.restaurantId ?? null,
      tableNumber: command.tableContext?.tableNumber ?? null,
      tableTokenId: command.tableContext?.tableTokenId ?? null,
      language: command.language,
      stage: "greeting",
      preferences: {
        preferredProductIds: [],
        preferredCategories: [],
        preferredProteins: [],
        preferredDrinks: [],
      },
      temporaryPreferences: {
        preferredProductIds: [],
        preferredCategories: [],
        preferredProteins: [],
        preferredDrinks: [],
      },
      dislikedIngredients: [],
      dietaryRequirements: [],
      allergies: [],
      budget: null,
      budgetScope: null,
      hungerLevel: null,
      latestReferencedProductIds: [],
      unresolvedQuestion: null,
      ambiguity: null,
      cartRevision: 0,
      lastIntent: null,
      lastToolNames: [],
      lastInteractionAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: new Date(now + this.ttlMs).toISOString(),
    });
    await this.insertSession(state);
    return { ok: true, data: cloneState(state) };
  }

  async getSession(sessionId: DiningSessionId): Promise<ConversationState | null> {
    await this.ensureSchema();
    const row = await this.readRow(sessionId);
    if (!row) return null;
    if (row.expiresAtMs <= this.now()) {
      await this.expireOne(sessionId);
      return null;
    }
    return cloneState(row.data);
  }

  async updatePreferences(
    sessionId: DiningSessionId,
    update: ConversationPreferencesUpdate
  ): Promise<SafeOperationResult<ConversationState>> {
    return this.mutateSession(sessionId, (state) => ({
      ...state,
      language: update.language ?? state.language,
      preferences: update.preferences ?? state.preferences,
      temporaryPreferences:
        update.temporaryPreferences ?? state.temporaryPreferences,
      dislikedIngredients:
        update.dislikedIngredients ?? state.dislikedIngredients,
      dietaryRequirements:
        update.dietaryRequirements ?? state.dietaryRequirements,
      allergies: update.allergies ?? state.allergies,
      budget: update.budget === undefined ? state.budget : update.budget,
      budgetScope:
        update.budgetScope === undefined
          ? state.budgetScope
          : update.budgetScope,
      hungerLevel:
        update.hungerLevel === undefined
          ? state.hungerLevel
          : update.hungerLevel,
    }));
  }

  async applyTurnUpdate(
    sessionId: DiningSessionId,
    update: ConversationStateUpdate,
    metadata: ConversationTurnMetadataUpdate
  ): Promise<SafeOperationResult<ConversationState>> {
    return this.mutateSession(
      sessionId,
      (state) => ({
        ...state,
        language: update.language ?? state.language,
        stage: update.stage ?? state.stage,
        preferences: update.preferences ?? state.preferences,
        temporaryPreferences:
          update.temporaryPreferences ?? state.temporaryPreferences,
        dislikedIngredients:
          update.dislikedIngredients ?? state.dislikedIngredients,
        dietaryRequirements:
          update.dietaryRequirements ?? state.dietaryRequirements,
        allergies: update.allergies ?? state.allergies,
        budget: update.budget === undefined ? state.budget : update.budget,
        budgetScope:
          update.budgetScope === undefined
            ? state.budgetScope
            : update.budgetScope,
        hungerLevel:
          update.hungerLevel === undefined
            ? state.hungerLevel
            : update.hungerLevel,
        latestReferencedProductIds:
          update.latestReferencedProductIds ??
          state.latestReferencedProductIds,
        unresolvedQuestion:
          update.unresolvedQuestion === undefined
            ? state.unresolvedQuestion
            : update.unresolvedQuestion,
        ambiguity:
          update.ambiguity === undefined ? state.ambiguity : update.ambiguity,
        lastIntent: metadata.lastIntent,
        lastToolNames: metadata.lastToolNames.slice(0, 8),
        lastInteractionAt: metadata.lastInteractionAt,
      }),
      true
    );
  }

  async updateConversationStage(
    sessionId: DiningSessionId,
    stage: ConversationState["stage"]
  ): Promise<SafeOperationResult<ConversationState>> {
    return this.mutateSession(sessionId, (state) => ({ ...state, stage }));
  }

  async setLatestReferences(
    sessionId: DiningSessionId,
    productIds: string[]
  ): Promise<SafeOperationResult<ConversationState>> {
    return this.mutateSession(sessionId, (state) => ({
      ...state,
      stage: "recommending",
      latestReferencedProductIds: productIds.slice(0, 10),
      ambiguity:
        productIds.length > 1
          ? {
              kind: "product" as const,
              candidateIds: productIds.slice(0, 10),
            }
          : null,
    }));
  }

  async setUnresolvedQuestion(
    sessionId: DiningSessionId,
    question: ConversationState["unresolvedQuestion"]
  ): Promise<SafeOperationResult<ConversationState>> {
    return this.mutateSession(sessionId, (state) => ({
      ...state,
      unresolvedQuestion: question,
    }));
  }

  async updateCartRevision(
    sessionId: DiningSessionId,
    revision: number
  ): Promise<SafeOperationResult<ConversationState>> {
    if (!Number.isSafeInteger(revision) || revision < 0) {
      return operationError(
        "invalid_request",
        "Cart revision must be a non-negative safe integer."
      );
    }
    return this.mutateSession(sessionId, (state) => ({
      ...state,
      cartRevision: revision,
    }));
  }

  async touchSession(
    sessionId: DiningSessionId
  ): Promise<SafeOperationResult<ConversationState>> {
    return this.mutateSession(sessionId, (state) => state, true);
  }

  async deleteSession(sessionId: DiningSessionId): Promise<boolean> {
    await this.ensureSchema();
    const deleted = await this.deleteRow(sessionId);
    if (deleted) await this.notifyCleanup(sessionId);
    return deleted;
  }

  async sweepExpired(): Promise<DiningSessionId[]> {
    await this.ensureSchema();
    const expired = await this.expiredSessionIds(this.now(), SWEEP_BATCH_LIMIT);
    if (expired.length > 0) await this.deleteRows(expired);
    for (const sessionId of expired) {
      await this.notifyCleanup(sessionId);
    }
    return expired;
  }

  registerSessionCleanup(handler: SessionCleanupHandler): () => void {
    this.cleanupHandlers.add(handler);
    return () => this.cleanupHandlers.delete(handler);
  }

  async reset(): Promise<void> {
    await this.ensureSchema();
    const sessionIds = await this.allSessionIds();
    await this.deleteAll();
    for (const sessionId of sessionIds) {
      await this.notifyCleanup(sessionId);
    }
  }

  private async maybeSweep(): Promise<void> {
    const now = this.now();
    if (now - this.lastSweepAt < SWEEP_THROTTLE_MS) return;
    this.lastSweepAt = now;
    await this.sweepExpired();
  }

  private async expireOne(sessionId: DiningSessionId): Promise<void> {
    const deleted = await this.deleteRow(sessionId);
    if (deleted) await this.notifyCleanup(sessionId);
  }

  private async createUniqueId(): Promise<DiningSessionId> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const sessionId = this.createId();
      if (!(await this.sessionExists(sessionId))) return sessionId;
    }
    throw new Error("Unable to create a unique dining session identifier.");
  }

  private async notifyCleanup(sessionId: DiningSessionId): Promise<void> {
    await Promise.all(
      [...this.cleanupHandlers].map((handler) => Promise.resolve(handler(sessionId)))
    );
  }

  private async mutateSession(
    sessionId: DiningSessionId,
    mutate: (state: ConversationState) => ConversationState,
    refreshExpiry = false
  ): Promise<SafeOperationResult<ConversationState>> {
    await this.ensureSchema();
    const row = await this.readRow(sessionId);
    if (!row || row.expiresAtMs <= this.now()) {
      if (row) await this.expireOne(sessionId);
      return operationError(
        "session_not_found",
        "Dining session was not found or expired."
      );
    }
    const now = this.now();
    const candidate = ConversationStateSchema.safeParse({
      ...mutate(cloneState(row.data)),
      sessionId: row.data.sessionId,
      restaurantId: row.data.restaurantId,
      tableNumber: row.data.tableNumber,
      tableTokenId: row.data.tableTokenId,
      createdAt: row.data.createdAt,
      updatedAt: new Date(now).toISOString(),
      expiresAt: refreshExpiry
        ? new Date(now + this.ttlMs).toISOString()
        : row.data.expiresAt,
    });
    if (!candidate.success) {
      return operationError(
        "invalid_request",
        "Conversation-state mutation failed validation."
      );
    }
    await this.writeRow(sessionId, candidate.data);
    return { ok: true, data: cloneState(candidate.data) };
  }
}

class PostgresConversationStateStore extends DurableConversationStateStore {
  private readonly sql: PostgresSql;
  private ready: Promise<void> | undefined;

  constructor(sql: PostgresSql, options: InMemoryConversationStateStoreOptions = {}) {
    super(options);
    this.sql = sql;
  }

  protected ensureSchema(): Promise<void> {
    this.ready ??= (async () => {
      await this.sql`
        CREATE TABLE IF NOT EXISTS ai_waiter_sessions (
          session_id TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          expires_at BIGINT NOT NULL
        )`;
      await this.sql`
        CREATE INDEX IF NOT EXISTS ai_waiter_sessions_expires
        ON ai_waiter_sessions (expires_at)`;
    })();
    return this.ready;
  }

  protected async countSessions(): Promise<number> {
    const rows = (await this
      .sql`SELECT COUNT(*)::int AS count FROM ai_waiter_sessions`) as Array<{
      count: number;
    }>;
    return rows[0]?.count ?? 0;
  }

  protected async sessionExists(sessionId: DiningSessionId): Promise<boolean> {
    const rows = (await this
      .sql`SELECT 1 FROM ai_waiter_sessions WHERE session_id = ${sessionId}`) as unknown[];
    return rows.length > 0;
  }

  protected async insertSession(state: ConversationState): Promise<void> {
    await this.sql`
      INSERT INTO ai_waiter_sessions (session_id, data, expires_at)
      VALUES (${state.sessionId}, ${JSON.stringify(state)}, ${Date.parse(state.expiresAt)})`;
  }

  protected async readRow(
    sessionId: DiningSessionId
  ): Promise<{ data: ConversationState; expiresAtMs: number } | null> {
    const rows = (await this.sql`
      SELECT data, expires_at FROM ai_waiter_sessions WHERE session_id = ${sessionId}`) as Array<{
      data: string;
      expires_at: string | number;
    }>;
    const row = rows[0];
    if (!row) return null;
    return { data: JSON.parse(row.data), expiresAtMs: Number(row.expires_at) };
  }

  protected async writeRow(
    sessionId: DiningSessionId,
    state: ConversationState
  ): Promise<void> {
    await this.sql`
      UPDATE ai_waiter_sessions
      SET data = ${JSON.stringify(state)}, expires_at = ${Date.parse(state.expiresAt)}
      WHERE session_id = ${sessionId}`;
  }

  protected async deleteRow(sessionId: DiningSessionId): Promise<boolean> {
    const rows = (await this
      .sql`DELETE FROM ai_waiter_sessions WHERE session_id = ${sessionId} RETURNING session_id`) as unknown[];
    return rows.length > 0;
  }

  protected async expiredSessionIds(
    nowMs: number,
    limit: number
  ): Promise<DiningSessionId[]> {
    const rows = (await this.sql`
      SELECT session_id FROM ai_waiter_sessions
      WHERE expires_at <= ${nowMs} LIMIT ${limit}`) as Array<{
      session_id: DiningSessionId;
    }>;
    return rows.map((row) => row.session_id);
  }

  protected async deleteRows(sessionIds: DiningSessionId[]): Promise<void> {
    await this.sql`
      DELETE FROM ai_waiter_sessions WHERE session_id = ANY(${sessionIds})`;
  }

  protected async allSessionIds(): Promise<DiningSessionId[]> {
    const rows = (await this
      .sql`SELECT session_id FROM ai_waiter_sessions`) as Array<{
      session_id: DiningSessionId;
    }>;
    return rows.map((row) => row.session_id);
  }

  protected async deleteAll(): Promise<void> {
    await this.sql`DELETE FROM ai_waiter_sessions`;
  }
}

class SqliteConversationStateStore extends DurableConversationStateStore {
  private readonly db: SqliteDatabase;
  private schemaReady = false;

  constructor(db: SqliteDatabase, options: InMemoryConversationStateStoreOptions = {}) {
    super(options);
    this.db = db;
  }

  protected async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ai_waiter_sessions (
        session_id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ai_waiter_sessions_expires
      ON ai_waiter_sessions (expires_at);
    `);
    this.schemaReady = true;
  }

  protected async countSessions(): Promise<number> {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM ai_waiter_sessions")
      .get() as { count: number };
    return row.count;
  }

  protected async sessionExists(sessionId: DiningSessionId): Promise<boolean> {
    const row = this.db
      .prepare("SELECT 1 FROM ai_waiter_sessions WHERE session_id = ?")
      .get(sessionId);
    return row !== undefined;
  }

  protected async insertSession(state: ConversationState): Promise<void> {
    this.db
      .prepare(
        "INSERT INTO ai_waiter_sessions (session_id, data, expires_at) VALUES (?, ?, ?)"
      )
      .run(state.sessionId, JSON.stringify(state), Date.parse(state.expiresAt));
  }

  protected async readRow(
    sessionId: DiningSessionId
  ): Promise<{ data: ConversationState; expiresAtMs: number } | null> {
    const row = this.db
      .prepare("SELECT data, expires_at FROM ai_waiter_sessions WHERE session_id = ?")
      .get(sessionId) as { data: string; expires_at: number } | undefined;
    if (!row) return null;
    return { data: JSON.parse(row.data), expiresAtMs: row.expires_at };
  }

  protected async writeRow(
    sessionId: DiningSessionId,
    state: ConversationState
  ): Promise<void> {
    this.db
      .prepare(
        "UPDATE ai_waiter_sessions SET data = ?, expires_at = ? WHERE session_id = ?"
      )
      .run(JSON.stringify(state), Date.parse(state.expiresAt), sessionId);
  }

  protected async deleteRow(sessionId: DiningSessionId): Promise<boolean> {
    const result = this.db
      .prepare("DELETE FROM ai_waiter_sessions WHERE session_id = ?")
      .run(sessionId);
    return result.changes > 0;
  }

  protected async expiredSessionIds(
    nowMs: number,
    limit: number
  ): Promise<DiningSessionId[]> {
    const rows = this.db
      .prepare("SELECT session_id FROM ai_waiter_sessions WHERE expires_at <= ? LIMIT ?")
      .all(nowMs, limit) as Array<{ session_id: DiningSessionId }>;
    return rows.map((row) => row.session_id);
  }

  protected async deleteRows(sessionIds: DiningSessionId[]): Promise<void> {
    const stmt = this.db.prepare("DELETE FROM ai_waiter_sessions WHERE session_id = ?");
    for (const sessionId of sessionIds) stmt.run(sessionId);
  }

  protected async allSessionIds(): Promise<DiningSessionId[]> {
    const rows = this.db
      .prepare("SELECT session_id FROM ai_waiter_sessions")
      .all() as Array<{ session_id: DiningSessionId }>;
    return rows.map((row) => row.session_id);
  }

  protected async deleteAll(): Promise<void> {
    this.db.exec("DELETE FROM ai_waiter_sessions");
  }
}

export async function createDurableConversationStateStore(
  options: InMemoryConversationStateStoreOptions = {}
): Promise<ConversationStateStore> {
  const backend = await getAiWaiterBackend();
  return backend.kind === "postgres"
    ? new PostgresConversationStateStore(backend.sql, options)
    : new SqliteConversationStateStore(backend.db, options);
}
