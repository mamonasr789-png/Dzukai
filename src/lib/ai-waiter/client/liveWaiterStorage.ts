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

function pendingKey(sessionId: DiningSessionId): string {
  return `${PENDING_TURN_PREFIX}:${sessionId}`;
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
    storage.removeItem(DISPLAY_TRANSCRIPT_INDEX_KEY);
    return [];
  }
}

function writeTranscriptIndex(
  storage: SessionStoragePort,
  keys: string[]
): void {
  storage.setItem(
    DISPLAY_TRANSCRIPT_INDEX_KEY,
    JSON.stringify([...new Set(keys)].slice(-50))
  );
}

function readPendingIndex(storage: SessionStoragePort): DiningSessionId[] {
  try {
    return z
      .array(DiningSessionIdSchema)
      .max(50)
      .parse(JSON.parse(storage.getItem(PENDING_TURN_INDEX_KEY) ?? "[]"));
  } catch {
    storage.removeItem(PENDING_TURN_INDEX_KEY);
    return [];
  }
}

function writePendingIndex(
  storage: SessionStoragePort,
  sessionIds: DiningSessionId[]
): void {
  storage.setItem(
    PENDING_TURN_INDEX_KEY,
    JSON.stringify([...new Set(sessionIds)].slice(-50))
  );
}

export function storePendingTurn(
  storage: SessionStoragePort,
  pending: PendingTurn,
  now = Date.now()
): PendingTurn {
  cleanupExpiredPendingTurns(storage, now);
  const parsed = PendingTurnSchema.parse(pending);
  storage.setItem(pendingKey(parsed.sessionId), JSON.stringify(parsed));
  writePendingIndex(storage, [
    ...readPendingIndex(storage),
    parsed.sessionId,
  ]);
  return parsed;
}

export function readPendingTurn(
  storage: SessionStoragePort,
  sessionId: DiningSessionId,
  now = Date.now()
): PendingTurn | null {
  try {
    const parsed = PendingTurnSchema.safeParse(
      JSON.parse(storage.getItem(pendingKey(sessionId)) ?? "null")
    );
    if (
      !parsed.success ||
      now - parsed.data.createdAt > PENDING_TURN_TTL_MS
    ) {
      clearPendingTurn(storage, sessionId);
      return null;
    }
    return parsed.data;
  } catch {
    clearPendingTurn(storage, sessionId);
    return null;
  }
}

export function clearPendingTurn(
  storage: SessionStoragePort,
  sessionId: DiningSessionId
): void {
  storage.removeItem(pendingKey(sessionId));
  writePendingIndex(
    storage,
    readPendingIndex(storage).filter((candidate) => candidate !== sessionId)
  );
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
        storage.removeItem(pendingKey(sessionId));
      }
    } catch {
      storage.removeItem(pendingKey(sessionId));
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
      if (raw) storage.removeItem(key);
      return null;
    }
    const parsed = DisplayTranscriptSchema.safeParse(JSON.parse(raw));
    if (
      !parsed.success ||
      now - parsed.data.savedAt > TRANSCRIPT_TTL_MS
    ) {
      storage.removeItem(key);
      return null;
    }
    return parsed.data.messages;
  } catch {
    storage.removeItem(key);
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
    storage.setItem(key, serialized);
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
  storage.removeItem(key);
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
      storage.removeItem(key);
    } else {
      retained.push(key);
    }
  }
  writeTranscriptIndex(storage, retained);
}
