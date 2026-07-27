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
