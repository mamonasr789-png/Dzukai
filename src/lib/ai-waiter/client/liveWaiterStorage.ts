import { z } from "zod";
import {
  ClientSelectionHintSchema,
  ClientTurnIdSchema,
  DiningSessionIdSchema,
  RestaurantIdSchema,
  WaiterReferenceSchema,
  type DiningSessionId,
} from "../schemas.ts";
import type { SessionStoragePort } from "./liveWaiterClient.ts";

const DISPLAY_TRANSCRIPT_PREFIX = "vaise-ai-waiter-transcript-v3";
const DISPLAY_TRANSCRIPT_INDEX_KEY = "vaise-ai-waiter-transcript-index-v3";
const PENDING_TURN_PREFIX = "vaise-ai-waiter-pending-turn-v1";
const PENDING_TURN_INDEX_KEY = "vaise-ai-waiter-pending-turn-index-v1";
const TRANSCRIPT_TTL_MS = 24 * 60 * 60 * 1_000;
const PENDING_TURN_TTL_MS = 20 * 60 * 1_000;
const MAXIMUM_TRANSCRIPT_BYTES = 64 * 1_024;
const MAXIMUM_TRANSCRIPT_MESSAGES = 80;

const StoredDisplayMessageSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(1_500),
    time: z.string().trim().min(1).max(40),
    references: z.array(WaiterReferenceSchema).max(10).optional(),
    notice: z.string().trim().min(1).max(500).nullable().optional(),
    noticeTone: z.enum(["success", "info", "warning", "error"]).optional(),
  })
  .strict();
export type StoredDisplayMessage = z.infer<typeof StoredDisplayMessageSchema>;

const DisplayTranscriptSchema = z
  .object({
    version: z.literal(3),
    savedAt: z.number().int().nonnegative(),
    messages: z
      .array(StoredDisplayMessageSchema)
      .max(MAXIMUM_TRANSCRIPT_MESSAGES),
  })
  .strict();

export const PendingTurnSchema = z
  .object({
    version: z.literal(1),
    sessionId: DiningSessionIdSchema,
    clientTurnId: ClientTurnIdSchema,
    message: z.string().trim().min(1).max(1_000),
    selectionHint: ClientSelectionHintSchema.optional(),
    createdAt: z.number().int().nonnegative(),
    transportState: z.enum(["sending", "outcome_unknown"]),
    lastAttemptAt: z.number().int().nonnegative().optional(),
  })
  .strict();
export type PendingTurn = z.infer<typeof PendingTurnSchema>;

export type PendingTurnStorageFailureReason =
  | "storage_unavailable"
  | "invalid_record"
  | "pending_turn_conflict";

export type StorePendingTurnResult =
  | {
      persisted: true;
      status: "success";
      pending: PendingTurn;
    }
  | {
      persisted: false;
      status: "storage_unavailable" | "invalid_record" | "conflict";
      reason: PendingTurnStorageFailureReason;
    };

export type ReadPendingTurnResult =
  | {
      found: true;
      status: "success";
      pending: PendingTurn;
    }
  | {
      found: false;
      status: "not_found" | "storage_unavailable" | "invalid_record";
      reason?: Exclude<
        PendingTurnStorageFailureReason,
        "pending_turn_conflict"
      >;
    };

export type ClearPendingTurnResult =
  | {
      cleared: true;
      status: "success" | "not_found";
    }
  | {
      cleared: false;
      status: "storage_unavailable";
      reason: "storage_unavailable";
    };

function pendingKey(sessionId: DiningSessionId): string {
  return `${PENDING_TURN_PREFIX}:${sessionId}`;
}

function safeRemoveItem(storage: SessionStoragePort, key: string): boolean {
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function sameSelectionHint(
  first: PendingTurn["selectionHint"],
  second: PendingTurn["selectionHint"]
): boolean {
  return JSON.stringify(first ?? null) === JSON.stringify(second ?? null);
}

function samePendingIdentity(
  first: PendingTurn,
  second: PendingTurn
): boolean {
  return (
    first.sessionId === second.sessionId &&
    first.clientTurnId === second.clientTurnId &&
    first.message === second.message &&
    sameSelectionHint(first.selectionHint, second.selectionHint)
  );
}

function verifiedPendingReadBack(
  expected: PendingTurn,
  value: unknown
): PendingTurn | null {
  const parsed = PendingTurnSchema.safeParse(value);
  if (
    !parsed.success ||
    !samePendingIdentity(parsed.data, expected) ||
    parsed.data.transportState !== expected.transportState ||
    parsed.data.createdAt !== expected.createdAt ||
    parsed.data.lastAttemptAt !== expected.lastAttemptAt
  ) {
    return null;
  }
  return parsed.data;
}

function transcriptKey(identity: {
  sessionId: DiningSessionId;
  restaurantId: string | null;
}): string {
  const restaurant = identity.restaurantId
    ? RestaurantIdSchema.parse(identity.restaurantId)
    : "demo";
  return `${DISPLAY_TRANSCRIPT_PREFIX}:${restaurant}:${identity.sessionId}`;
}

function readTranscriptIndex(storage: SessionStoragePort): string[] {
  try {
    return z
      .array(z.string().min(1).max(240))
      .max(50)
      .parse(
        JSON.parse(storage.getItem(DISPLAY_TRANSCRIPT_INDEX_KEY) ?? "[]")
      );
  } catch {
    safeRemoveItem(storage, DISPLAY_TRANSCRIPT_INDEX_KEY);
    return [];
  }
}

function writeTranscriptIndex(
  storage: SessionStoragePort,
  keys: string[]
): void {
  try {
    storage.setItem(
      DISPLAY_TRANSCRIPT_INDEX_KEY,
      JSON.stringify([...new Set(keys)].slice(-50))
    );
  } catch {
    // Display-only transcript indexing is best effort.
  }
}

function readPendingIndex(storage: SessionStoragePort): DiningSessionId[] {
  try {
    return z
      .array(DiningSessionIdSchema)
      .max(50)
      .parse(JSON.parse(storage.getItem(PENDING_TURN_INDEX_KEY) ?? "[]"));
  } catch {
    safeRemoveItem(storage, PENDING_TURN_INDEX_KEY);
    return [];
  }
}

function writePendingIndex(
  storage: SessionStoragePort,
  sessionIds: DiningSessionId[]
): void {
  try {
    storage.setItem(
      PENDING_TURN_INDEX_KEY,
      JSON.stringify([...new Set(sessionIds)].slice(-50))
    );
  } catch {
    // The session-scoped pending record remains authoritative.
  }
}

export function storePendingTurn(
  storage: SessionStoragePort,
  pending: PendingTurn,
  now = Date.now()
): StorePendingTurnResult {
  cleanupExpiredPendingTurns(storage, now);
  const parsed = PendingTurnSchema.safeParse(pending);
  if (!parsed.success) {
    return {
      persisted: false,
      status: "invalid_record",
      reason: "invalid_record",
    };
  }

  const existing = readPendingTurn(storage, parsed.data.sessionId, now);
  if (existing.status === "storage_unavailable") {
    return {
      persisted: false,
      status: "storage_unavailable",
      reason: "storage_unavailable",
    };
  }
  if (existing.status === "invalid_record") {
    return {
      persisted: false,
      status: "invalid_record",
      reason: "invalid_record",
    };
  }
  if (
    existing.found &&
    existing.pending.transportState === "outcome_unknown" &&
    !samePendingIdentity(existing.pending, parsed.data)
  ) {
    return {
      persisted: false,
      status: "conflict",
      reason: "pending_turn_conflict",
    };
  }
  if (
    existing.found &&
    existing.pending.transportState === "outcome_unknown" &&
    samePendingIdentity(existing.pending, parsed.data)
  ) {
    return {
      persisted: true,
      status: "success",
      pending: existing.pending,
    };
  }

  const record =
    existing.found && samePendingIdentity(existing.pending, parsed.data)
      ? { ...parsed.data, createdAt: existing.pending.createdAt }
      : parsed.data;
  const key = pendingKey(record.sessionId);
  try {
    storage.setItem(key, JSON.stringify(record));
  } catch {
    return {
      persisted: false,
      status: "storage_unavailable",
      reason: "storage_unavailable",
    };
  }

  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return {
      persisted: false,
      status: "storage_unavailable",
      reason: "storage_unavailable",
    };
  }
  if (raw === null) {
    return {
      persisted: false,
      status: "storage_unavailable",
      reason: "storage_unavailable",
    };
  }

  let readBack: unknown;
  try {
    readBack = JSON.parse(raw);
  } catch {
    safeRemoveItem(storage, key);
    return {
      persisted: false,
      status: "invalid_record",
      reason: "invalid_record",
    };
  }
  const verified = verifiedPendingReadBack(record, readBack);
  if (!verified) {
    safeRemoveItem(storage, key);
    return {
      persisted: false,
      status: "invalid_record",
      reason: "invalid_record",
    };
  }

  writePendingIndex(storage, [
    ...readPendingIndex(storage),
    verified.sessionId,
  ]);
  return {
    persisted: true,
    status: "success",
    pending: verified,
  };
}

export function readPendingTurn(
  storage: SessionStoragePort,
  sessionId: DiningSessionId,
  now = Date.now()
): ReadPendingTurnResult {
  let raw: string | null;
  try {
    raw = storage.getItem(pendingKey(sessionId));
  } catch {
    return {
      found: false,
      status: "storage_unavailable",
      reason: "storage_unavailable",
    };
  }
  if (raw === null) {
    return { found: false, status: "not_found" };
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    safeRemoveItem(storage, pendingKey(sessionId));
    return {
      found: false,
      status: "invalid_record",
      reason: "invalid_record",
    };
  }
  const parsed = PendingTurnSchema.safeParse(value);
  if (!parsed.success) {
    safeRemoveItem(storage, pendingKey(sessionId));
    return {
      found: false,
      status: "invalid_record",
      reason: "invalid_record",
    };
  }
  if (now - parsed.data.createdAt > PENDING_TURN_TTL_MS) {
    const cleared = clearPendingTurn(storage, sessionId);
    return cleared.cleared
      ? { found: false, status: "not_found" }
      : {
          found: false,
          status: "storage_unavailable",
          reason: "storage_unavailable",
        };
  }
  return { found: true, status: "success", pending: parsed.data };
}

export function clearPendingTurn(
  storage: SessionStoragePort,
  sessionId: DiningSessionId
): ClearPendingTurnResult {
  const key = pendingKey(sessionId);
  let existing: string | null;
  try {
    existing = storage.getItem(key);
    storage.removeItem(key);
    if (storage.getItem(key) !== null) {
      return {
        cleared: false,
        status: "storage_unavailable",
        reason: "storage_unavailable",
      };
    }
  } catch {
    return {
      cleared: false,
      status: "storage_unavailable",
      reason: "storage_unavailable",
    };
  }
  writePendingIndex(
    storage,
    readPendingIndex(storage).filter((candidate) => candidate !== sessionId)
  );
  return {
    cleared: true,
    status: existing === null ? "not_found" : "success",
  };
}

export function cleanupExpiredPendingTurns(
  storage: SessionStoragePort,
  now = Date.now()
): void {
  const retained: DiningSessionId[] = [];
  for (const sessionId of readPendingIndex(storage)) {
    try {
      const parsed = PendingTurnSchema.safeParse(
        JSON.parse(storage.getItem(pendingKey(sessionId)) ?? "null")
      );
      if (
        parsed.success &&
        now - parsed.data.createdAt <= PENDING_TURN_TTL_MS
      ) {
        retained.push(sessionId);
      } else {
        safeRemoveItem(storage, pendingKey(sessionId));
      }
    } catch {
      safeRemoveItem(storage, pendingKey(sessionId));
    }
  }
  writePendingIndex(storage, retained);
}

export function loadDisplayTranscript(
  storage: SessionStoragePort,
  identity: {
    sessionId: DiningSessionId;
    restaurantId: string | null;
  },
  now = Date.now()
): StoredDisplayMessage[] | null {
  const key = transcriptKey(identity);
  try {
    const raw = storage.getItem(key);
    if (!raw || raw.length > MAXIMUM_TRANSCRIPT_BYTES) {
      if (raw) safeRemoveItem(storage, key);
      return null;
    }
    const parsed = DisplayTranscriptSchema.safeParse(JSON.parse(raw));
    if (
      !parsed.success ||
      now - parsed.data.savedAt > TRANSCRIPT_TTL_MS
    ) {
      safeRemoveItem(storage, key);
      return null;
    }
    return parsed.data.messages;
  } catch {
    safeRemoveItem(storage, key);
    return null;
  }
}

export function saveDisplayTranscript(
  storage: SessionStoragePort,
  identity: {
    sessionId: DiningSessionId;
    restaurantId: string | null;
  },
  messages: StoredDisplayMessage[],
  now = Date.now()
): void {
  const parsed = DisplayTranscriptSchema.parse({
    version: 3,
    savedAt: now,
    messages: messages.slice(-MAXIMUM_TRANSCRIPT_MESSAGES),
  });
  const serialized = JSON.stringify(parsed);
  if (serialized.length <= MAXIMUM_TRANSCRIPT_BYTES) {
    const key = transcriptKey(identity);
    try {
      storage.setItem(key, serialized);
    } catch {
      return;
    }
    writeTranscriptIndex(storage, [...readTranscriptIndex(storage), key]);
  }
}

export function clearDisplayTranscript(
  storage: SessionStoragePort,
  identity: {
    sessionId: DiningSessionId;
    restaurantId: string | null;
  }
): void {
  const key = transcriptKey(identity);
  safeRemoveItem(storage, key);
  writeTranscriptIndex(
    storage,
    readTranscriptIndex(storage).filter((candidate) => candidate !== key)
  );
}

export function clearDisplayTranscriptsForSession(
  storage: SessionStoragePort,
  sessionId: DiningSessionId
): void {
  const suffix = `:${sessionId}`;
  const retained: string[] = [];
  for (const key of readTranscriptIndex(storage)) {
    if (key.endsWith(suffix)) {
      safeRemoveItem(storage, key);
    } else {
      retained.push(key);
    }
  }
  writeTranscriptIndex(storage, retained);
}
