/**
 * Sync store watermark rules — the guarantee that no record is ever skipped.
 * Runs against the SQLite backend; the Postgres one shares the same helper.
 * Run: node --experimental-strip-types src/lib/tests/sync-store.test.ts
 */

const { describe, it, expect, printResults } = await import("../assistant/tests/runner.ts");
const { DatabaseSync } = await import("node:sqlite");

// server-only throws outside a React Server Component build, so stub it before
// the store is imported.
const require0 = (await import("node:module")).createRequire(import.meta.url);
const serverOnly = require0.resolve("server-only");
require0.cache[serverOnly] = { id: serverOnly, filename: serverOnly, loaded: true, exports: {} } as never;

const { SqliteSyncStore } = await import("../server/syncStore.ts");

function store() {
  return new SqliteSyncStore(new DatabaseSync(":memory:"));
}

function record(id: string, updatedAt: string) {
  return { id, data: JSON.stringify({ id, updatedAt }), updatedAt };
}

describe("watermark", () => {
  it("advances only as far as the records actually returned", async () => {
    // Regression: the watermark used to come from a separate MAX(seq) query.
    // A row written between the two queries pushed the watermark past a record
    // the client never received, skipping it forever.
    const s = store();
    await s.push("orders", [record("o1", "2026-01-01T00:00:00Z")]);
    await s.push("sessions", [record("s1", "2026-01-01T00:00:00Z")]);
    await s.push("sessions", [record("s2", "2026-01-01T00:00:00Z")]);

    const first = await s.pull("orders", 0);
    expect(first.records.map((r) => r.id)).toEqual(["o1"]);
    // Sessions hold the highest seq; the orders watermark must not jump to it.
    expect(first.watermark).toBe(first.records[0].seq);
  });

  it("delivers a record written after a pull that returned nothing", async () => {
    const s = store();
    await s.push("sessions", [record("s1", "2026-01-01T00:00:00Z")]);
    const empty = await s.pull("orders", 0);
    expect(empty.records).toEqual([]);

    await s.push("orders", [record("o1", "2026-01-01T00:00:00Z")]);
    const after = await s.pull("orders", empty.watermark);
    expect(after.records.map((r) => r.id)).toEqual(["o1"]);
  });

  it("never returns the same record twice once acknowledged", async () => {
    const s = store();
    await s.push("orders", [record("o1", "2026-01-01T00:00:00Z")]);
    const first = await s.pull("orders", 0);
    const second = await s.pull("orders", first.watermark);
    expect(second.records).toEqual([]);
    expect(second.watermark).toBe(first.watermark);
  });
});

describe("last-write-wins", () => {
  it("keeps the newer copy and ignores an older one", async () => {
    const s = store();
    await s.push("orders", [record("o1", "2026-01-02T00:00:00Z")]);
    await s.push("orders", [record("o1", "2026-01-01T00:00:00Z")]);
    const { records } = await s.pull("orders", 0);
    expect(records.length).toBe(1);
    expect(records[0].updatedAt).toBe("2026-01-02T00:00:00Z");
  });

  it("accepts a newer copy and re-delivers it", async () => {
    const s = store();
    await s.push("orders", [record("o1", "2026-01-01T00:00:00Z")]);
    const first = await s.pull("orders", 0);
    await s.push("orders", [record("o1", "2026-01-03T00:00:00Z")]);
    const second = await s.pull("orders", first.watermark);
    expect(second.records.map((r) => r.id)).toEqual(["o1"]);
    expect(second.records[0].updatedAt).toBe("2026-01-03T00:00:00Z");
  });
});

printResults();
