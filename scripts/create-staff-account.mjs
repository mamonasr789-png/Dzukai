#!/usr/bin/env node
/**
 * Bootstraps a staff account directly against the configured database —
 * mainly for the Admin account, which the app deliberately has no
 * self-service way to create (the admin panel only creates waiter/kitchen
 * accounts). Run this yourself, once, per environment.
 *
 * Usage:
 *   node --experimental-strip-types scripts/create-staff-account.mjs <username> <password> [admin|waiter|kitchen]
 *
 * Targets local SQLite (./data/vaise.db) unless DATABASE_URL or POSTGRES_URL
 * is set, in which case it targets that Postgres database instead — e.g. run
 * with the production DATABASE_URL to create the Admin account on Vercel.
 */

const [, , username, password, role = "admin"] = process.argv;

if (!username || !password) {
  console.error(
    "Usage: node --experimental-strip-types scripts/create-staff-account.mjs <username> <password> [admin|waiter|kitchen]"
  );
  process.exit(1);
}
if (!["admin", "waiter", "kitchen"].includes(role)) {
  console.error(`Invalid role "${role}". Use admin, waiter or kitchen.`);
  process.exit(1);
}
if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

// server-only throws outside a React Server Component build; stub it before
// the store module is imported (same trick src/lib/tests/sync-store.test.ts uses).
const require0 = (await import("node:module")).createRequire(import.meta.url);
const serverOnlyPath = require0.resolve("server-only");
require0.cache[serverOnlyPath] = {
  id: serverOnlyPath,
  filename: serverOnlyPath,
  loaded: true,
  exports: {},
};

const { hashPassword } = await import("../src/lib/server/auth/password.ts");
const { getStaffAccountStore, DuplicateUsernameError } = await import(
  "../src/lib/server/staffAccountStore.ts"
);

const store = await getStaffAccountStore();
if (!store) {
  console.error(
    "No database configured — set DATABASE_URL/POSTGRES_URL, or run locally where SQLite can write to ./data."
  );
  process.exit(1);
}

const passwordHash = await hashPassword(password);
try {
  const account = await store.create({ username, passwordHash, role });
  console.log(`Created ${account.role} account "${account.username}" (id ${account.id}).`);
} catch (error) {
  if (error instanceof DuplicateUsernameError) {
    console.error(`Username "${username}" is already taken.`);
    process.exit(1);
  }
  throw error;
}
process.exit(0);
