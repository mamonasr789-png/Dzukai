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
 * Development-only task adapter. It deliberately does not claim delivery to
 * the existing browser-local waiter UI.
 */
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
