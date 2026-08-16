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
