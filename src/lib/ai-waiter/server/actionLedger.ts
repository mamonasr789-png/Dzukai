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
