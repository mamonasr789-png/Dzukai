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

const { SqliteSyncStore, pullAllRecords, PULL_PAGE_SIZE } = await import("../server/syncStore.ts");

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

describe("purgeAll", () => {
  it("wipes every collection, not just the one most recently touched", async () => {
    const s = store();
    await s.push("orders", [record("o1", "2026-01-01T00:00:00Z")]);
    await s.push("sessions", [record("s1", "2026-01-01T00:00:00Z")]);
    await s.push("tasks", [record("t1", "2026-01-01T00:00:00Z")]);

    await s.purgeAll();

    expect((await s.pull("orders", 0)).records).toEqual([]);
    expect((await s.pull("sessions", 0)).records).toEqual([]);
    expect((await s.pull("tasks", 0)).records).toEqual([]);
  });

  it("lets a record with the same id be pushed again after a purge", async () => {
    const s = store();
    await s.push("orders", [record("o1", "2026-01-01T00:00:00Z")]);
    await s.purgeAll();
    await s.push("orders", [record("o1", "2026-01-02T00:00:00Z")]);
    const { records } = await s.pull("orders", 0);
    expect(records.map((r) => r.id)).toEqual(["o1"]);
  });

  it("keeps handing new records to a device whose watermark predates the purge", async () => {
    // Regression: seq must never be derived from MAX(seq) over the table.
    // A device that already pulled up to watermark N must still see a
    // post-purge record even though the table was empty (and MAX(seq) would
    // have been 0) right before that record was pushed.
    const s = store();
    await s.push("orders", [record("o1", "2026-01-01T00:00:00Z")]);
    const before = await s.pull("orders", 0);
    const staleWatermark = before.watermark;

    await s.purgeAll();
    await s.push("orders", [record("o2", "2026-01-02T00:00:00Z")]);

    const after = await s.pull("orders", staleWatermark);
    expect(after.records.map((r) => r.id)).toEqual(["o2"]);
  });
});

describe("pullAllRecords", () => {
  it("walks every page instead of truncating at PULL_PAGE_SIZE", async () => {
    // Regression: orderService/taskService used to call store.pull(collection, 0)
    // directly and only ever look at the first page — once a collection passed
    // PULL_PAGE_SIZE records, every screen (kitchen/waiter/admin/customer) lost
    // visibility into anything created after the 500th, with no error surfaced
    // anywhere except "not_found" on individual item/order lookups. Found via a
    // 1000-order production load test.
    const s = store();
    const total = PULL_PAGE_SIZE + 137;
    for (let i = 0; i < total; i++) {
      await s.push("orders", [record(`o${i}`, "2026-01-01T00:00:00Z")]);
    }

    const singlePull = await s.pull("orders", 0);
    expect(singlePull.records.length).toBe(PULL_PAGE_SIZE); // the bug, still true of the raw primitive

    const all = await pullAllRecords(s, "orders");
    expect(all.length).toBe(total);
    expect(new Set(all.map((r) => r.id)).size).toBe(total); // no duplicates across pages
  });

  it("returns everything in one page when the collection is small", async () => {
    const s = store();
    await s.push("orders", [record("o1", "2026-01-01T00:00:00Z")]);
    await s.push("orders", [record("o2", "2026-01-01T00:00:00Z")]);
    const all = await pullAllRecords(s, "orders");
    expect(all.map((r) => r.id).sort()).toEqual(["o1", "o2"]);
  });
});

printResults();
