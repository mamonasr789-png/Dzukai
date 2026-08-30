import "server-only";

import { neon } from "@neondatabase/serverless";
import type { MenuOverride } from "../menuOverrides.ts";

/**
 * Live menu overrides (86 / price / name) — same two-backend shape as
 * restaurantTableStore: Postgres in production, SQLite locally. Survives
 * "clear test data" (that only wipes orders/sessions/tasks).
 */
export interface MenuOverrideStore {
  list(): Promise<MenuOverride[]>;
  get(productId: string): Promise<MenuOverride | null>;
  upsert(patch: MenuOverride): Promise<MenuOverride>;
}

class PostgresMenuOverrideStore implements MenuOverrideStore {
  private readonly sql: ReturnType<typeof neon>;
  private ready: Promise<void> | undefined;

  constructor(connectionString: string) {
    this.sql = neon(connectionString);
  }

  private ensureSchema(): Promise<void> {
    this.ready ??= (async () => {
      await this.sql`
        CREATE TABLE IF NOT EXISTS menu_overrides (
          product_id TEXT PRIMARY KEY,
          sold_out BOOLEAN,
          price DOUBLE PRECISION,
          name TEXT,
          updated_at TEXT NOT NULL
        )`;
    })();
    return this.ready;
  }

  async list(): Promise<MenuOverride[]> {
    await this.ensureSchema();
    const rows = (await this.sql`
      SELECT product_id, sold_out, price, name, updated_at FROM menu_overrides`) as Array<{
      product_id: string;
      sold_out: boolean | null;
      price: number | null;
      name: string | null;
      updated_at: string;
    }>;
    return rows.map(rowFromPostgres);
  }

  async get(productId: string): Promise<MenuOverride | null> {
    await this.ensureSchema();
    const rows = (await this.sql`
      SELECT product_id, sold_out, price, name, updated_at
      FROM menu_overrides WHERE product_id = ${productId}`) as Array<{
      product_id: string;
      sold_out: boolean | null;
      price: number | null;
      name: string | null;
      updated_at: string;
    }>;
    return rows[0] ? rowFromPostgres(rows[0]) : null;
  }

  async upsert(patch: MenuOverride): Promise<MenuOverride> {
    await this.ensureSchema();
    const updatedAt = new Date().toISOString();
    const existing = await this.get(patch.productId);
    const next: MenuOverride = {
      productId: patch.productId,
      soldOut: patch.soldOut ?? existing?.soldOut,
      price: patch.price !== undefined ? patch.price : existing?.price,
      name: patch.name !== undefined ? patch.name : existing?.name,
    };
    await this.sql`
      INSERT INTO menu_overrides (product_id, sold_out, price, name, updated_at)
      VALUES (${next.productId}, ${next.soldOut ?? false}, ${next.price ?? null}, ${next.name ?? null}, ${updatedAt})
      ON CONFLICT (product_id) DO UPDATE
      SET sold_out = EXCLUDED.sold_out, price = EXCLUDED.price,
          name = EXCLUDED.name, updated_at = EXCLUDED.updated_at`;
    return next;
  }
}

type SqliteDatabase = import("node:sqlite").DatabaseSync;

export class SqliteMenuOverrideStore implements MenuOverrideStore {
  private readonly db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS menu_overrides (
        product_id TEXT PRIMARY KEY,
        sold_out INTEGER,
        price REAL,
        name TEXT,
        updated_at TEXT NOT NULL
      );
    `);
  }

  async list(): Promise<MenuOverride[]> {
    const rows = this.db
      .prepare("SELECT product_id, sold_out, price, name, updated_at FROM menu_overrides")
      .all() as Array<{
      product_id: string;
      sold_out: number | null;
      price: number | null;
      name: string | null;
      updated_at: string;
    }>;
    return rows.map(rowFromSqlite);
  }

  async get(productId: string): Promise<MenuOverride | null> {
    const row = this.db
      .prepare(
        "SELECT product_id, sold_out, price, name, updated_at FROM menu_overrides WHERE product_id = ?"
      )
      .get(productId) as
      | {
          product_id: string;
          sold_out: number | null;
          price: number | null;
          name: string | null;
          updated_at: string;
        }
      | undefined;
    return row ? rowFromSqlite(row) : null;
  }

  async upsert(patch: MenuOverride): Promise<MenuOverride> {
    const updatedAt = new Date().toISOString();
    const existing = await this.get(patch.productId);
    const next: MenuOverride = {
      productId: patch.productId,
      soldOut: patch.soldOut ?? existing?.soldOut,
      price: patch.price !== undefined ? patch.price : existing?.price,
      name: patch.name !== undefined ? patch.name : existing?.name,
    };
    this.db
      .prepare(
        `INSERT INTO menu_overrides (product_id, sold_out, price, name, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (product_id) DO UPDATE SET
           sold_out = excluded.sold_out, price = excluded.price,
           name = excluded.name, updated_at = excluded.updated_at`
      )
      .run(
        next.productId,
        next.soldOut ? 1 : 0,
        next.price ?? null,
        next.name ?? null,
        updatedAt
      );
    return next;
  }
}

function rowFromPostgres(row: {
  product_id: string;
  sold_out: boolean | null;
  price: number | null;
  name: string | null;
  updated_at: string;
}): MenuOverride {
  return {
    productId: row.product_id,
    soldOut: row.sold_out === true,
    price: row.price ?? undefined,
    name: row.name ?? undefined,
  };
}

function rowFromSqlite(row: {
  product_id: string;
  sold_out: number | null;
  price: number | null;
  name: string | null;
  updated_at: string;
}): MenuOverride {
  return {
    productId: row.product_id,
    soldOut: row.sold_out === 1,
    price: row.price ?? undefined,
    name: row.name ?? undefined,
  };
}

let storePromise: Promise<MenuOverrideStore | null> | undefined;

async function createStore(): Promise<MenuOverrideStore | null> {
  const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (connectionString) {
    return new PostgresMenuOverrideStore(connectionString);
  }
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const { mkdirSync } = await import("node:fs");
    const path = await import("node:path");
    const dir = path.join(process.cwd(), "data");
    mkdirSync(dir, { recursive: true });
    return new SqliteMenuOverrideStore(new DatabaseSync(path.join(dir, "vaise.db")));
  } catch {
    return null;
  }
}

export function getMenuOverrideStore(): Promise<MenuOverrideStore | null> {
  storePromise ??= createStore();
  return storePromise;
}

export function __setMenuOverrideStoreForTests(store: MenuOverrideStore | null): void {
  storePromise = Promise.resolve(store);
}
