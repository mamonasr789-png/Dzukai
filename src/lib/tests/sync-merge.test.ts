/**
 * Cross-device sync merge tests — the rules that keep two devices from
 * clobbering each other's orders.
 * Run: node --experimental-strip-types src/lib/tests/sync-merge.test.ts
 */

const { describe, it, expect, printResults } = await import("../assistant/tests/runner.ts");
const { diffLocal, applyRemote, recordStamp, parseCollection } = await import("../sync/merge.ts");

const NONE = new Set<string>();

describe("recordStamp", () => {
  it("prefers updatedAt over createdAt", () => {
    expect(recordStamp({ id: "a", createdAt: "2026-01-01", updatedAt: "2026-02-01" })).toBe("2026-02-01");
  });
  it("falls back to createdAt for legacy records", () => {
    expect(recordStamp({ id: "a", createdAt: "2026-01-01" })).toBe("2026-01-01");
  });
});

describe("parseCollection", () => {
  it("survives corrupt JSON and non-arrays", () => {
    expect(parseCollection("{broken")).toEqual([]);
    expect(parseCollection('{"id":"x"}')).toEqual([]);
    expect(parseCollection(null)).toEqual([]);
  });
  it("drops entries without a string id", () => {
    expect(parseCollection('[{"id":"a"},{"noid":1},null]')).toEqual([{ id: "a" }]);
  });
});

describe("diffLocal", () => {
  it("finds new and modified records, skips unchanged ones", () => {
    const shadow = JSON.stringify([
      { id: "a", status: "NEW", updatedAt: "1" },
      { id: "b", status: "NEW", updatedAt: "1" },
    ]);
    const current = JSON.stringify([
      { id: "a", status: "NEW", updatedAt: "1" },
      { id: "b", status: "READY", updatedAt: "2" },
      { id: "c", status: "NEW", updatedAt: "3" },
    ]);
    const push = diffLocal(shadow, current);
    expect(push.map((r) => r.id)).toEqual(["b", "c"]);
    expect(push[0].updatedAt).toBe("2");
  });

  it("treats a missing shadow as everything-is-new", () => {
    const current = JSON.stringify([{ id: "a", updatedAt: "1" }]);
    expect(diffLocal(null, current).map((r) => r.id)).toEqual(["a"]);
  });
});

describe("applyRemote", () => {
  it("adds records the device has never seen", () => {
    const { next, changed } = applyRemote(
      JSON.stringify([{ id: "a", updatedAt: "1" }]),
      [{ id: "b", data: JSON.stringify({ id: "b", updatedAt: "2" }) }],
      NONE
    );
    expect(changed).toBe(true);
    expect(next.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("replaces a local record only when the remote one is strictly fresher", () => {
    const local = JSON.stringify([{ id: "a", status: "NEW", updatedAt: "2026-01-02" }]);
    const stale = applyRemote(
      local,
      [{ id: "a", data: JSON.stringify({ id: "a", status: "OLD", updatedAt: "2026-01-01" }) }],
      NONE
    );
    expect(stale.changed).toBe(false);
    const fresh = applyRemote(
      local,
      [{ id: "a", data: JSON.stringify({ id: "a", status: "READY", updatedAt: "2026-01-03" }) }],
      NONE
    );
    expect(fresh.changed).toBe(true);
    expect(fresh.next[0].status).toBe("READY");
  });

  it("never touches records the device changed this tick", () => {
    const local = JSON.stringify([{ id: "a", status: "MINE", updatedAt: "1" }]);
    const { changed, next } = applyRemote(
      local,
      [{ id: "a", data: JSON.stringify({ id: "a", status: "THEIRS", updatedAt: "9" }) }],
      new Set(["a"])
    );
    expect(changed).toBe(false);
    expect(next[0].status).toBe("MINE");
  });

  it("ignores corrupt remote payloads", () => {
    const local = JSON.stringify([{ id: "a", updatedAt: "1" }]);
    const { changed } = applyRemote(local, [{ id: "x", data: "{broken" }], NONE);
    expect(changed).toBe(false);
  });
});

printResults();
