import "server-only";

import { neon } from "@neondatabase/serverless";

/**
 * Shared connection for the six AI-waiter session stores. Same dual-backend
 * pattern as src/lib/server/syncStore.ts: Postgres (Neon) when DATABASE_URL /
 * POSTGRES_URL is set (Vercel production), SQLite (data/vaise.db) otherwise.
 * Deliberately reuses the same env vars and the same on-disk file as the
 * order/session/task sync store — new tables only, sync_records/records are
 * untouched.
 */

export type PostgresSql = ReturnType<typeof neon>;
export type SqliteDatabase = import("node:sqlite").DatabaseSync;

export type AiWaiterBackend =
  | { kind: "postgres"; sql: PostgresSql }
  | { kind: "sqlite"; db: SqliteDatabase };

export type AiWaiterBackendKind = AiWaiterBackend["kind"];

let backendPromise: Promise<AiWaiterBackend> | undefined;

async function createBackend(): Promise<AiWaiterBackend> {
  const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (connectionString) {
    return { kind: "postgres", sql: neon(connectionString) };
  }
  const { DatabaseSync } = await import("node:sqlite");
  const { mkdirSync } = await import("node:fs");
  const path = await import("node:path");
  const dir = path.join(process.cwd(), "data");
  mkdirSync(dir, { recursive: true });
  return { kind: "sqlite", db: new DatabaseSync(path.join(dir, "vaise.db")) };
}

/** Opened once per process; every store shares this connection. */
export function getAiWaiterBackend(): Promise<AiWaiterBackend> {
  backendPromise ??= createBackend();
  return backendPromise;
}

/** Synchronous read of which backend *would* be selected, for availability reporting. */
export function configuredAiWaiterBackendKind(): AiWaiterBackendKind {
  return process.env.DATABASE_URL ?? process.env.POSTGRES_URL ? "postgres" : "sqlite";
}

export function resetAiWaiterBackendForTests(db?: SqliteDatabase): void {
  backendPromise = db ? Promise.resolve({ kind: "sqlite", db }) : undefined;
}

const AI_WAITER_TABLES = [
  "ai_waiter_sessions",
  "ai_waiter_carts",
  "ai_waiter_cart_idempotency",
  "ai_waiter_staff_requests",
  "ai_waiter_staff_idempotency",
  "ai_waiter_turn_locks",
  "ai_waiter_turn_idempotency",
  "ai_waiter_action_ledger",
] as const;

/**
 * Admin "clear test data" for the AI waiter: wipes every dining session,
 * cart, staff request, idempotency record and lock — not the menu, not
 * staff accounts. A table that was never created yet (fresh deploy, nobody
 * has chatted with the AI waiter) is not an error, just nothing to purge.
 */
export async function purgeAllAiWaiterData(): Promise<void> {
  const backend = await getAiWaiterBackend();
  for (const table of AI_WAITER_TABLES) {
    try {
      if (backend.kind === "postgres") {
        await backend.sql.query(`DELETE FROM ${table}`);
      } else {
        backend.db.exec(`DELETE FROM ${table}`);
      }
    } catch {
      // Table doesn't exist yet — nothing to purge.
    }
  }
}
