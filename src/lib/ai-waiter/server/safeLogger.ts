import "server-only";

import { createHash } from "node:crypto";
import type { DiningSessionId, ToolName } from "../schemas.ts";

function safeSessionIdentifier(sessionId: DiningSessionId): string {
  return createHash("sha256").update(sessionId).digest("hex").slice(0, 12);
}

export interface SafeTurnLog {
  turnId: string | null;
  sessionId: DiningSessionId;
  provider: string;
  fallbackUsed: boolean;
  toolNames: ToolName[];
  toolRounds: number;
  validationFailureCategory?: string;
  totalMs: number;
  providerMs: number;
  toolMs: number;
  status: "success" | "error";
}

export function logSafeTurnEvent(log: SafeTurnLog): void {
  if (process.env.NODE_ENV === "test") return;
  const entry = {
    event: "waiter_turn_completed",
    turnId: log.turnId,
    session: safeSessionIdentifier(log.sessionId),
    provider: log.provider,
    fallbackUsed: log.fallbackUsed,
    toolNames: log.toolNames,
    toolRounds: log.toolRounds,
    validationFailureCategory: log.validationFailureCategory,
    totalMs: log.totalMs,
    providerMs: log.providerMs,
    toolMs: log.toolMs,
    status: log.status,
  };
  if (log.status === "error") {
    console.error("[ai-waiter]", entry);
    return;
  }
  if (process.env.NODE_ENV !== "production") {
    console.info("[ai-waiter]", entry);
  }
}

export interface SafeToolLog {
  event:
    | "tool_started"
    | "tool_validation_failed"
    | "tool_completed"
    | "tool_unexpected_error"
    | "storage_capacity_reached";
  toolName?: ToolName;
  sessionId?: DiningSessionId;
  category?: string;
  status?: "success" | "error";
  durationMs?: number;
}

export function logSafeToolEvent(log: SafeToolLog): void {
  if (
    (process.env.NODE_ENV === "production" &&
      log.event !== "tool_unexpected_error") ||
    process.env.NODE_ENV === "test"
  ) {
    return;
  }

  const entry = {
    event: log.event,
    toolName: log.toolName,
    session: log.sessionId ? safeSessionIdentifier(log.sessionId) : undefined,
    category: log.category,
    status: log.status,
    durationMs: log.durationMs,
  };

  if (log.event === "tool_unexpected_error") {
    console.error("[ai-waiter]", entry);
    return;
  }
  console.info("[ai-waiter]", entry);
}

export function logStorageCapacityReached(
  storageName: string,
  maximumEntries: number
): void {
  logSafeToolEvent({
    event: "storage_capacity_reached",
    category: `${storageName}:${maximumEntries}`,
    status: "error",
  });
}
