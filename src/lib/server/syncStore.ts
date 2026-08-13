import "server-only";

import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Shared order/session/task store — the "one notebook on the bar".
 *
 * Every device pushes its local writes here and pulls everyone else's, so the
 * guest's phone, the kitchen tablet and the waiter screen finally see the same
 * data. SQLite via node:sqlite: real SQL, zero npm dependencies, one file on
 * disk. When multi-restaurant/auth arrive, this module is the swap point for
 * Postgres — the API route and the client engine never touch SQL directly.
 *
 * Conflict rule: last-write-wins per record by the client's updatedAt stamp.
 * Fine for MVP volume; revisit alongside real accounts.
 */

export const SYNC_COLLECTIONS = ["orders", "sessions", "tasks"] as const;
export type SyncCollection = (typeof SYNC_COLLECTIONS)[number];

export interface SyncRecord {
  id: string;
  /** Full record JSON as the client stores it in localStorage. */
  data: string;
  /** Client-side ISO stamp used for last-write-wins. */
  updatedAt: string;
}

export interface PulledRecord extends SyncRecord {
  seq: number;
}

/** Initial pulls only receive rows younger than this — old history stays out. */
const INITIAL_PULL_WINDOW_MS = 48 * 60 * 60 * 1_000;

export class SqliteSyncStore {
  private readonly db: DatabaseSync;

  constructor(filePath: string) {
    this.db = new DatabaseSync(filePath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS records (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        seq INTEGER NOT NULL,
        server_time INTEGER NOT NULL,
        PRIMARY KEY (collection, id)
      );
      CREATE INDEX IF NOT EXISTS records_by_seq ON records (collection, seq);
    `);
  }

  private nextSeq(): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(seq), 0) AS m FROM records")
      .get() as { m: number };
    return row.m + 1;
  }

  /** Upserts a record unless the stored copy is already newer. */
  push(collection: SyncCollection, records: SyncRecord[]): number {
    let accepted = 0;
    const read = this.db.prepare(
      "SELECT updated_at FROM records WHERE collection = ? AND id = ?"
    );
    const write = this.db.prepare(
      `INSERT INTO records (collection, id, data, updated_at, seq, server_time)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (collection, id)
       DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at,
                     seq = excluded.seq, server_time = excluded.server_time`
    );
    for (const record of records) {
      const existing = read.get(collection, record.id) as
        | { updated_at: string }
        | undefined;
      if (existing && existing.updated_at > record.updatedAt) continue;
      write.run(
        collection,
        record.id,
        record.data,
        record.updatedAt,
        this.nextSeq(),
        Date.now()
      );
      accepted += 1;
    }
    return accepted;
  }

  /** Returns records changed after `since`, plus the new watermark. */
  pull(
    collection: SyncCollection,
    since: number
  ): { records: PulledRecord[]; watermark: number } {
    const floor = since === 0 ? Date.now() - INITIAL_PULL_WINDOW_MS : 0;
    const rows = this.db
      .prepare(
        `SELECT id, data, updated_at, seq FROM records
         WHERE collection = ? AND seq > ? AND server_time >= ?
         ORDER BY seq`
      )
      .all(collection, since, floor) as Array<{
      id: string;
      data: string;
      updated_at: string;
      seq: number;
    }>;
    const top = this.db
      .prepare("SELECT COALESCE(MAX(seq), 0) AS m FROM records")
      .get() as { m: number };
    return {
      records: rows.map((row) => ({
        id: row.id,
        data: row.data,
        updatedAt: row.updated_at,
        seq: row.seq,
      })),
      watermark: Math.max(since, top.m),
    };
  }
}

let store: SqliteSyncStore | null | undefined;

/**
 * Opens the store once per process. Returns null where the filesystem is
 * read-only (e.g. Vercel) — the API answers 503 and clients fall back to
 * device-local behaviour, exactly as before this backend existed.
 */
export function getSyncStore(): SqliteSyncStore | null {
  if (store !== undefined) return store;
  try {
    const dir = path.join(process.cwd(), "data");
    mkdirSync(dir, { recursive: true });
    store = new SqliteSyncStore(path.join(dir, "vaise.db"));
  } catch {
    store = null;
  }
  return store;
}
