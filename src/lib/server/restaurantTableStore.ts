import "server-only";

import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";

/**
 * Registry of table numbers the admin has configured a QR code for — just
 * the list, not the signed link itself (signing is deterministic given
 * tableNumber + TABLE_ACCESS_TOKEN_SECRET, so the admin panel re-derives and
 * redisplays it on demand rather than storing it).
 *
 * Same two-backend shape as staffAccountStore.ts: Postgres in production,
 * SQLite locally, chosen by the same DATABASE_URL / POSTGRES_URL env vars.
 */

export interface RestaurantTable {
  id: string;
  tableNumber: string;
  createdAt: string;
}

export interface RestaurantTableStore {
  create(tableNumber: string): Promise<RestaurantTable>;
  list(): Promise<RestaurantTable[]>;
  remove(id: string): Promise<void>;
}

export class DuplicateTableNumberError extends Error {
  constructor(tableNumber: string) {
    super(`Table "${tableNumber}" already exists.`);
    this.name = "DuplicateTableNumberError";
  }
}

// ── Postgres (production) ───────────────────────────────────────────────────

class PostgresRestaurantTableStore implements RestaurantTableStore {
  private readonly sql: ReturnType<typeof neon>;
  private ready: Promise<void> | undefined;

  constructor(connectionString: string) {
    this.sql = neon(connectionString);
  }

  private ensureSchema(): Promise<void> {
    this.ready ??= (async () => {
      await this.sql`
        CREATE TABLE IF NOT EXISTS restaurant_tables (
          id TEXT PRIMARY KEY,
          table_number TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL
        )`;
    })();
    return this.ready;
  }

  async create(tableNumber: string): Promise<RestaurantTable> {
    await this.ensureSchema();
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    try {
      await this.sql`
        INSERT INTO restaurant_tables (id, table_number, created_at)
        VALUES (${id}, ${tableNumber}, ${createdAt})`;
    } catch (error) {
      if (error instanceof Error && /unique/i.test(error.message)) {
        throw new DuplicateTableNumberError(tableNumber);
      }
      throw error;
    }
    return { id, tableNumber, createdAt };
  }

  async list(): Promise<RestaurantTable[]> {
    await this.ensureSchema();
    const rows = (await this.sql`
      SELECT id, table_number, created_at FROM restaurant_tables ORDER BY created_at`) as Array<{
      id: string;
      table_number: string;
      created_at: string;
    }>;
    return rows.map((row) => ({ id: row.id, tableNumber: row.table_number, createdAt: row.created_at }));
  }

  async remove(id: string): Promise<void> {
    await this.ensureSchema();
    await this.sql`DELETE FROM restaurant_tables WHERE id = ${id}`;
  }
}

// ── SQLite (local development) ──────────────────────────────────────────────

type SqliteDatabase = import("node:sqlite").DatabaseSync;

export class SqliteRestaurantTableStore implements RestaurantTableStore {
  private readonly db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS restaurant_tables (
        id TEXT PRIMARY KEY,
        table_number TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
    `);
  }

  async create(tableNumber: string): Promise<RestaurantTable> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    try {
      this.db
        .prepare(`INSERT INTO restaurant_tables (id, table_number, created_at) VALUES (?, ?, ?)`)
        .run(id, tableNumber, createdAt);
    } catch (error) {
      if (error instanceof Error && /UNIQUE/i.test(error.message)) {
        throw new DuplicateTableNumberError(tableNumber);
      }
      throw error;
    }
    return { id, tableNumber, createdAt };
  }

  async list(): Promise<RestaurantTable[]> {
    const rows = this.db
      .prepare("SELECT id, table_number, created_at FROM restaurant_tables ORDER BY created_at")
      .all() as Array<{ id: string; table_number: string; created_at: string }>;
    return rows.map((row) => ({ id: row.id, tableNumber: row.table_number, createdAt: row.created_at }));
  }

  async remove(id: string): Promise<void> {
    this.db.prepare("DELETE FROM restaurant_tables WHERE id = ?").run(id);
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

let storePromise: Promise<RestaurantTableStore | null> | undefined;

async function createStore(): Promise<RestaurantTableStore | null> {
  const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (connectionString) {
    return new PostgresRestaurantTableStore(connectionString);
  }
  try {
    // Another connection to the same local file as staffAccountStore.ts /
    // syncStore.ts — SQLite is built for multiple connections against one
    // file, so this is safe.
    const { DatabaseSync } = await import("node:sqlite");
    const { mkdirSync } = await import("node:fs");
    const path = await import("node:path");
    const dir = path.join(process.cwd(), "data");
    mkdirSync(dir, { recursive: true });
    return new SqliteRestaurantTableStore(new DatabaseSync(path.join(dir, "vaise.db")));
  } catch {
    return null;
  }
}

export function getRestaurantTableStore(): Promise<RestaurantTableStore | null> {
  storePromise ??= createStore();
  return storePromise;
}
