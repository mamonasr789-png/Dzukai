/**
 * Staff account store: username case-insensitivity (login must accept
 * "rytis" for an account created as "Rytis") and duplicate detection.
 * Run: node --experimental-strip-types src/lib/tests/staff-account-store.test.ts
 */

const { describe, it, expect, printResults } = await import("../assistant/tests/runner.ts");
const { DatabaseSync } = await import("node:sqlite");

const require0 = (await import("node:module")).createRequire(import.meta.url);
const serverOnlyPath = require0.resolve("server-only");
require0.cache[serverOnlyPath] = {
  id: serverOnlyPath,
  filename: serverOnlyPath,
  loaded: true,
  exports: {},
};

const { SqliteStaffAccountStore, DuplicateUsernameError } = await import(
  "../server/staffAccountStore.ts"
);

function store() {
  return new SqliteStaffAccountStore(new DatabaseSync(":memory:"));
}

describe("staff account store", () => {
  it("finds an account by username regardless of case", async () => {
    const s = store();
    await s.create({ username: "Rytis", passwordHash: "hash", role: "admin" });
    const found = await s.findByUsername("rytis");
    expect(found?.username).toBe("Rytis");
  });

  it("rejects creating a second account that only differs by case", async () => {
    const s = store();
    await s.create({ username: "Karolis", passwordHash: "hash", role: "admin" });
    let threw = false;
    try {
      await s.create({ username: "karolis", passwordHash: "hash2", role: "waiter" });
    } catch (error) {
      threw = error instanceof DuplicateUsernameError;
    }
    expect(threw).toBe(true);
  });

  it("returns null for an unknown username", async () => {
    const s = store();
    expect(await s.findByUsername("nobody")).toBe(null);
  });

  it("removes an account so it can no longer be found", async () => {
    const s = store();
    const account = await s.create({ username: "Arnas", passwordHash: "hash", role: "admin" });
    await s.remove(account.id);
    expect(await s.findByUsername("Arnas")).toBe(null);
  });

  it("starts with no last-seen timestamp", async () => {
    const s = store();
    const account = await s.create({ username: "Ona", passwordHash: "hash", role: "waiter" });
    expect(account.lastSeenAt).toBe(null);
  });

  it("touchLastSeen sets a timestamp visible on list() and findById()", async () => {
    const s = store();
    const account = await s.create({ username: "Petras", passwordHash: "hash", role: "kitchen" });
    await s.touchLastSeen(account.id);
    const found = await s.findById(account.id);
    expect(typeof found?.lastSeenAt).toBe("string");
    const listed = (await s.list()).find((a) => a.id === account.id);
    expect(typeof listed?.lastSeenAt).toBe("string");
  });

  it("updatePassword replaces the stored hash — old hash no longer matches", async () => {
    const s = store();
    const account = await s.create({ username: "Jonas", passwordHash: "old-hash", role: "waiter" });
    await s.updatePassword(account.id, "new-hash");
    const found = await s.findByUsername("Jonas");
    expect(found?.passwordHash).toBe("new-hash");
  });
});

printResults();
