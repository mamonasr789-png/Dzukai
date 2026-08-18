import "server-only";

import { neon } from "@neondatabase/serverless";
import { getAiWaiterBackend } from "../ai-waiter/server/aiWaiterDb.ts";

/**
 * Shared order/session/task store — the "one notebook on the bar".
 *
 * Every device pushes its local writes here and pulls everyone else's, so the
 * guest's phone, the kitchen tablet and the waiter screen finally see the same
 * data.
 *
 * Two backends behind one interface:
 * - Postgres (Neon) whenever DATABASE_URL / POSTGRES_URL is set — this is what
 *   Vercel production uses.
 * - SQLite via node:sqlite as the local-dev fallback (zero setup, one file on
 *   disk). Loaded lazily so runtimes without node:sqlite never touch it.
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

export interface SyncStore {
  push(collection: SyncCollection, records: SyncRecord[]): Promise<number>;
  pull(
    collection: SyncCollection,
    since: number
  ): Promise<{ records: PulledRecord[]; watermark: number }>;
  /** Wipes every order/session/task for every device — the admin "clear test data" reset. */
  purgeAll(): Promise<void>;
}

/** Initial pulls only receive rows younger than this — old history stays out. */
const INITIAL_PULL_WINDOW_MS = 48 * 60 * 60 * 1_000;

/** Caps one pull; the watermark advances per page, so the rest follows next tick. */
const PULL_PAGE_SIZE = 500;

/**
 * The watermark must come from the rows actually handed to the client, never
 * from a separate MAX(seq) query: a row committed between the two queries
 * would push the watermark past a record the client never received, and that
 * record would be skipped forever.
 */
function watermarkFrom(records: PulledRecord[], since: number): number {
  return records.reduce((max, record) => Math.max(max, record.seq), since);
}

// ── Postgres (production) ─────────────────────────────────────────────────────

class PostgresSyncStore implements SyncStore {
  private readonly sql: ReturnType<typeof neon>;
  private ready: Promise<void> | undefined;

  constructor(connectionString: string) {
    this.sql = neon(connectionString);
  }

  private ensureSchema(): Promise<void> {
    this.ready ??= (async () => {
      await this.sql`
        CREATE TABLE IF NOT EXISTS sync_records (
          collection TEXT NOT NULL,
          id TEXT NOT NULL,
          data TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          seq BIGINT NOT NULL,
          server_time BIGINT NOT NULL,
          PRIMARY KEY (collection, id)
        )`;
      await this.sql`CREATE SEQUENCE IF NOT EXISTS sync_records_seq`;
      await this.sql`
        CREATE INDEX IF NOT EXISTS sync_records_by_seq
        ON sync_records (collection, seq)`;
    })();
    return this.ready;
  }

  async push(collection: SyncCollection, records: SyncRecord[]): Promise<number> {
    await this.ensureSchema();
    let accepted = 0;
    for (const record of records) {
      // The WHERE clause makes last-write-wins atomic under concurrency.
      const rows = (await this.sql`
        INSERT INTO sync_records (collection, id, data, updated_at, seq, server_time)
        VALUES (${collection}, ${record.id}, ${record.data}, ${record.updatedAt},
                nextval('sync_records_seq'), ${Date.now()})
        ON CONFLICT (collection, id) DO UPDATE
        SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at,
            seq = EXCLUDED.seq, server_time = EXCLUDED.server_time
        WHERE sync_records.updated_at <= EXCLUDED.updated_at
        RETURNING id`) as Array<{ id: string }>;
      accepted += rows.length;
    }
    return accepted;
  }

  async pull(
    collection: SyncCollection,
    since: number
  ): Promise<{ records: PulledRecord[]; watermark: number }> {
    await this.ensureSchema();
    const floor = since === 0 ? Date.now() - INITIAL_PULL_WINDOW_MS : 0;
    const rows = (await this.sql`
      SELECT id, data, updated_at, seq FROM sync_records
      WHERE collection = ${collection} AND seq > ${since} AND server_time >= ${floor}
      ORDER BY seq
      LIMIT ${PULL_PAGE_SIZE}`) as Array<{
      id: string;
      data: string;
      updated_at: string;
      seq: string | number;
    }>;
    const records = rows.map((row) => ({
      id: row.id,
      data: row.data,
      updatedAt: row.updated_at,
      seq: Number(row.seq),
    }));
    return { records, watermark: watermarkFrom(records, since) };
  }

  async purgeAll(): Promise<void> {
    await this.ensureSchema();
    await this.sql`DELETE FROM sync_records`;
  }
}

// ── SQLite (local development) ────────────────────────────────────────────────

type SqliteDatabase = import("node:sqlite").DatabaseSync;

export class SqliteSyncStore implements SyncStore {
  private readonly db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.db = db;
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
      -- A standalone counter, not MAX(seq) over records: a client's watermark
      -- is a seq number it has already seen. If records are ever deleted
      -- (purgeAll, or hand-editing the dev DB) and nextSeq() falls back to
      -- deriving from what's left, a reused seq becomes invisible forever to
      -- any client whose watermark already passed it. This mirrors Postgres's
      -- SEQUENCE, which keeps counting regardless of DELETEs.
      CREATE TABLE IF NOT EXISTS records_seq_counter (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        value INTEGER NOT NULL
      );
    `);
    // INSERT OR IGNORE, not "WHERE NOT EXISTS": when records is empty, an
    // aggregate SELECT with no GROUP BY still produces exactly one output
    // row (COALESCE(MAX(seq),0) over zero rows is a row, not nothing), so
    // the NOT EXISTS guard failed to suppress it and this threw a UNIQUE
    // constraint violation on every process restart once records was ever
    // emptied (e.g. by purgeAll). Conflict resolution on the primary key is
    // the actual guard here, not a row-count check on an unrelated table.
    this.db.exec(
      `INSERT OR IGNORE INTO records_seq_counter (id, value)
       VALUES (1, (SELECT COALESCE(MAX(seq), 0) FROM records))`
    );
  }

  private nextSeq(): number {
    this.db.exec("UPDATE records_seq_counter SET value = value + 1 WHERE id = 1");
    const row = this.db
      .prepare("SELECT value FROM records_seq_counter WHERE id = 1")
      .get() as { value: number };
    return row.value;
  }

  async push(collection: SyncCollection, records: SyncRecord[]): Promise<number> {
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

  async pull(
    collection: SyncCollection,
    since: number
  ): Promise<{ records: PulledRecord[]; watermark: number }> {
    const floor = since === 0 ? Date.now() - INITIAL_PULL_WINDOW_MS : 0;
    const rows = this.db
      .prepare(
        `SELECT id, data, updated_at, seq FROM records
         WHERE collection = ? AND seq > ? AND server_time >= ?
         ORDER BY seq
         LIMIT ?`
      )
      .all(collection, since, floor, PULL_PAGE_SIZE) as Array<{
      id: string;
      data: string;
      updated_at: string;
      seq: number;
    }>;
    const records = rows.map((row) => ({
      id: row.id,
      data: row.data,
      updatedAt: row.updated_at,
      seq: row.seq,
    }));
    return { records, watermark: watermarkFrom(records, since) };
  }

  async purgeAll(): Promise<void> {
    this.db.exec("DELETE FROM records");
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

let storePromise: Promise<SyncStore | null> | undefined;

async function createStore(): Promise<SyncStore | null> {
  const connectionString =
    process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (connectionString) {
    return new PostgresSyncStore(connectionString);
  }
  try {
    // Reuses the AI-waiter module's connection to data/vaise.db instead of
    // opening a second one — two independent node:sqlite connections to the
    // same file both work fine, but there's no reason to hold both when one
    // module already opens and owns it.
    const backend = await getAiWaiterBackend();
    if (backend.kind !== "sqlite") return null;
    return new SqliteSyncStore(backend.db);
  } catch {
    return null;
  }
}

/**
 * Opens the store once per process. Null only where neither Postgres is
 * configured nor a writable disk exists — the API then answers 503 and
 * clients fall back to device-local behaviour.
 */
export function getSyncStore(): Promise<SyncStore | null> {
  storePromise ??= createStore();
  return storePromise;
}

/** Test-only seam: inject an in-memory store instead of the real Postgres/SQLite one. */
export function __setSyncStoreForTests(store: SyncStore | null): void {
  storePromise = Promise.resolve(store);
}
