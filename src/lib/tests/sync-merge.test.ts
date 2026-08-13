/**
 * Cross-device sync merge tests — the rules that keep two devices from
 * clobbering each other's orders.
 * Run: node --experimental-strip-types src/lib/tests/sync-merge.test.ts
 */

const { describe, it, expect, printResults } = await import("../assistant/tests/runner.ts");
const { diffLocal, applyRemote, recordStamp, parseCollection } = await import("../sync/merge.ts");

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
    );
    expect(changed).toBe(true);
    expect(next.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("replaces a local record only when the remote one is strictly fresher", () => {
    const local = JSON.stringify([{ id: "a", status: "NEW", updatedAt: "2026-01-02" }]);
    const stale = applyRemote(
      local,
      [{ id: "a", data: JSON.stringify({ id: "a", status: "OLD", updatedAt: "2026-01-01" }) }],
    );
    expect(stale.changed).toBe(false);
    const fresh = applyRemote(
      local,
      [{ id: "a", data: JSON.stringify({ id: "a", status: "READY", updatedAt: "2026-01-03" }) }],
    );
    expect(fresh.changed).toBe(true);
    expect(fresh.next[0].status).toBe("READY");
  });

  it("keeps a local edit that is newer than the echoed remote copy", () => {
    const local = JSON.stringify([{ id: "a", status: "MINE", updatedAt: "9" }]);
    const { changed, next } = applyRemote(local, [
      { id: "a", data: JSON.stringify({ id: "a", status: "THEIRS", updatedAt: "1" }) },
    ]);
    expect(changed).toBe(false);
    expect(next[0].status).toBe("MINE");
  });

  it("accepts a fresher remote copy of a record this device also pushed", () => {
    // Regression: the device used to skip ids it had just pushed while the
    // watermark moved past them, so a push the server rejected as older left
    // that device showing its stale version forever.
    const local = JSON.stringify([{ id: "a", status: "MINE", updatedAt: "1" }]);
    const { changed, next } = applyRemote(local, [
      { id: "a", data: JSON.stringify({ id: "a", status: "THEIRS", updatedAt: "9" }) },
    ]);
    expect(changed).toBe(true);
    expect(next[0].status).toBe("THEIRS");
  });

  it("ignores corrupt remote payloads", () => {
    const local = JSON.stringify([{ id: "a", updatedAt: "1" }]);
    const { changed } = applyRemote(local, [{ id: "x", data: "{broken" }]);
    expect(changed).toBe(false);
  });
});

printResults();
