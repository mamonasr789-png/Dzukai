import "server-only";

import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import type { StaffRole } from "./auth/session";

/**
 * Staff accounts — separate from syncStore's order/session/task records.
 * Server owns the truth here (no client-side localStorage cache, no
 * last-write-wins): only the admin panel writes, only login reads by
 * username.
 *
 * Same two-backend shape as syncStore.ts: Postgres in production, SQLite
 * locally, chosen by the same DATABASE_URL / POSTGRES_URL env vars.
 */

export interface StaffAccount {
  id: string;
  username: string;
  role: StaffRole;
  createdAt: string;
  /** Last heartbeat from an authenticated /waiter, /kitchen or /admin tab. Null until first ping. */
  lastSeenAt: string | null;
}

export interface StaffAccountWithHash extends StaffAccount {
  passwordHash: string;
}

export interface StaffAccountStore {
  create(input: {
    username: string;
    passwordHash: string;
    role: StaffRole;
  }): Promise<StaffAccount>;
  findByUsername(username: string): Promise<StaffAccountWithHash | null>;
  findById(id: string): Promise<StaffAccount | null>;
  list(): Promise<StaffAccount[]>;
  remove(id: string): Promise<void>;
  touchLastSeen(id: string): Promise<void>;
  updatePassword(id: string, passwordHash: string): Promise<void>;
}

export class DuplicateUsernameError extends Error {
  constructor(username: string) {
    super(`Username "${username}" is already taken.`);
    this.name = "DuplicateUsernameError";
  }
}

// ── Postgres (production) ───────────────────────────────────────────────────

class PostgresStaffAccountStore implements StaffAccountStore {
  private readonly sql: ReturnType<typeof neon>;
  private ready: Promise<void> | undefined;

  constructor(connectionString: string) {
    this.sql = neon(connectionString);
  }

  private ensureSchema(): Promise<void> {
    this.ready ??= (async () => {
      await this.sql`
        CREATE TABLE IF NOT EXISTS staff_accounts (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL,
          created_at TEXT NOT NULL
        )`;
      // Added after the table already existed in some environments.
      await this.sql`ALTER TABLE staff_accounts ADD COLUMN IF NOT EXISTS last_seen_at TEXT`;
    })();
    return this.ready;
  }

  async create(input: {
    username: string;
    passwordHash: string;
    role: StaffRole;
  }): Promise<StaffAccount> {
    await this.ensureSchema();
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const existing = await this.findByUsername(input.username);
    if (existing) throw new DuplicateUsernameError(input.username);
    try {
      await this.sql`
        INSERT INTO staff_accounts (id, username, password_hash, role, created_at)
        VALUES (${id}, ${input.username}, ${input.passwordHash}, ${input.role}, ${createdAt})`;
    } catch (error) {
      if (error instanceof Error && /unique/i.test(error.message)) {
        throw new DuplicateUsernameError(input.username);
      }
      throw error;
    }
    return { id, username: input.username, role: input.role, createdAt, lastSeenAt: null };
  }

  async findByUsername(username: string): Promise<StaffAccountWithHash | null> {
    await this.ensureSchema();
    // Case-insensitive: staff type their own name casually (phone
    // autocapitalize, etc.) and expect "rytis" to match "Rytis".
    const rows = (await this.sql`
      SELECT id, username, password_hash, role, created_at, last_seen_at
      FROM staff_accounts WHERE LOWER(username) = LOWER(${username})`) as Array<{
      id: string;
      username: string;
      password_hash: string;
      role: string;
      created_at: string;
      last_seen_at: string | null;
    }>;
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      username: row.username,
      passwordHash: row.password_hash,
      role: row.role as StaffRole,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
    };
  }

  async findById(id: string): Promise<StaffAccount | null> {
    await this.ensureSchema();
    const rows = (await this.sql`
      SELECT id, username, role, created_at, last_seen_at FROM staff_accounts WHERE id = ${id}`) as Array<{
      id: string;
      username: string;
      role: string;
      created_at: string;
      last_seen_at: string | null;
    }>;
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      username: row.username,
      role: row.role as StaffRole,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
    };
  }

  async list(): Promise<StaffAccount[]> {
    await this.ensureSchema();
    const rows = (await this.sql`
      SELECT id, username, role, created_at, last_seen_at FROM staff_accounts ORDER BY created_at`) as Array<{
      id: string;
      username: string;
      role: string;
      created_at: string;
      last_seen_at: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      username: row.username,
      role: row.role as StaffRole,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
    }));
  }

  async remove(id: string): Promise<void> {
    await this.ensureSchema();
    await this.sql`DELETE FROM staff_accounts WHERE id = ${id}`;
  }

  async touchLastSeen(id: string): Promise<void> {
    await this.ensureSchema();
    await this.sql`UPDATE staff_accounts SET last_seen_at = ${new Date().toISOString()} WHERE id = ${id}`;
  }

  async updatePassword(id: string, passwordHash: string): Promise<void> {
    await this.ensureSchema();
    await this.sql`UPDATE staff_accounts SET password_hash = ${passwordHash} WHERE id = ${id}`;
  }
}

// ── SQLite (local development) ──────────────────────────────────────────────

type SqliteDatabase = import("node:sqlite").DatabaseSync;

export class SqliteStaffAccountStore implements StaffAccountStore {
  private readonly db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS staff_accounts (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    try {
      // SQLite has no "ADD COLUMN IF NOT EXISTS" — ignore the duplicate-column
      // error on every startup after the first one.
      this.db.exec(`ALTER TABLE staff_accounts ADD COLUMN last_seen_at TEXT`);
    } catch {
      // already applied
    }
  }

  async create(input: {
    username: string;
    passwordHash: string;
    role: StaffRole;
  }): Promise<StaffAccount> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const existing = await this.findByUsername(input.username);
    if (existing) throw new DuplicateUsernameError(input.username);
    try {
      this.db
        .prepare(
          `INSERT INTO staff_accounts (id, username, password_hash, role, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(id, input.username, input.passwordHash, input.role, createdAt);
    } catch (error) {
      if (error instanceof Error && /UNIQUE/i.test(error.message)) {
        throw new DuplicateUsernameError(input.username);
      }
      throw error;
    }
    return { id, username: input.username, role: input.role, createdAt, lastSeenAt: null };
  }

  async findByUsername(username: string): Promise<StaffAccountWithHash | null> {
    // Case-insensitive, matching the Postgres backend.
    const row = this.db
      .prepare(
        "SELECT id, username, password_hash, role, created_at, last_seen_at FROM staff_accounts WHERE username = ? COLLATE NOCASE"
      )
      .get(username) as
      | {
          id: string;
          username: string;
          password_hash: string;
          role: string;
          created_at: string;
          last_seen_at: string | null;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      username: row.username,
      passwordHash: row.password_hash,
      role: row.role as StaffRole,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
    };
  }

  async findById(id: string): Promise<StaffAccount | null> {
    const row = this.db
      .prepare("SELECT id, username, role, created_at, last_seen_at FROM staff_accounts WHERE id = ?")
      .get(id) as
      | { id: string; username: string; role: string; created_at: string; last_seen_at: string | null }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      username: row.username,
      role: row.role as StaffRole,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
    };
  }

  async list(): Promise<StaffAccount[]> {
    const rows = this.db
      .prepare("SELECT id, username, role, created_at, last_seen_at FROM staff_accounts ORDER BY created_at")
      .all() as Array<{ id: string; username: string; role: string; created_at: string; last_seen_at: string | null }>;
    return rows.map((row) => ({
      id: row.id,
      username: row.username,
      role: row.role as StaffRole,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
    }));
  }

  async remove(id: string): Promise<void> {
    this.db.prepare("DELETE FROM staff_accounts WHERE id = ?").run(id);
  }

  async touchLastSeen(id: string): Promise<void> {
    this.db
      .prepare("UPDATE staff_accounts SET last_seen_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
  }

  async updatePassword(id: string, passwordHash: string): Promise<void> {
    this.db.prepare("UPDATE staff_accounts SET password_hash = ? WHERE id = ?").run(passwordHash, id);
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

let storePromise: Promise<StaffAccountStore | null> | undefined;

async function createStore(): Promise<StaffAccountStore | null> {
  const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (connectionString) {
    return new PostgresStaffAccountStore(connectionString);
  }
  try {
    // Second connection to the same local file as syncStore.ts — SQLite is
    // built for multiple connections against one file, so this is safe.
    const { DatabaseSync } = await import("node:sqlite");
    const { mkdirSync } = await import("node:fs");
    const path = await import("node:path");
    const dir = path.join(process.cwd(), "data");
    mkdirSync(dir, { recursive: true });
    return new SqliteStaffAccountStore(new DatabaseSync(path.join(dir, "vaise.db")));
  } catch {
    return null;
  }
}

export function getStaffAccountStore(): Promise<StaffAccountStore | null> {
  storePromise ??= createStore();
  return storePromise;
}
