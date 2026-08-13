/**
 * Split-the-bill calculator tests — cent-exact rounding is the whole point.
 * Run: node --experimental-strip-types src/lib/tests/split-bill.test.ts
 */

const { describe, it, expect, printResults } = await import("../assistant/tests/runner.ts");
const { splitEqually, splitByItems } = await import("../splitBill.ts");

describe("splitEqually", () => {
  it("splits a total with no remainder evenly", () => {
    const shares = splitEqually(30, 3);
    expect(shares.map((s) => s.amount)).toEqual([10, 10, 10]);
  });

  it("distributes leftover cents to the first guests, summing back to the total", () => {
    const shares = splitEqually(10, 3);
    const amounts = shares.map((s) => s.amount);
    expect(amounts).toEqual([3.34, 3.33, 3.33]);
    const sum = amounts.reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 100)).toBe(1000);
  });

  it("returns one full share for one guest", () => {
    expect(splitEqually(14.9, 1)).toEqual([{ guestIndex: 0, amount: 14.9 }]);
  });

  it("returns nothing for zero guests", () => {
    expect(splitEqually(20, 0)).toEqual([]);
  });
});

describe("splitByItems", () => {
  it("assigns a solo item fully to its one guest", () => {
    const { shares, unassigned } = splitByItems(
      [{ id: "l1", name: "Cepelinai", lineTotal: 8.5 }],
      [{ id: "g1", name: "Svečias 1" }],
      { l1: ["g1"] }
    );
    expect(shares).toEqual([{ guestId: "g1", guestName: "Svečias 1", amount: 8.5 }]);
    expect(unassigned).toBe(0);
  });

  it("splits a shared item evenly with remainder cents distributed", () => {
    const { shares } = splitByItems(
      [{ id: "l1", name: "Užkandžių lėkštė", lineTotal: 10 }],
      [
        { id: "g1", name: "Svečias 1" },
        { id: "g2", name: "Svečias 2" },
        { id: "g3", name: "Svečias 3" },
      ],
      { l1: ["g1", "g2", "g3"] }
    );
    const amounts = shares.map((s) => s.amount);
    expect(amounts).toEqual([3.34, 3.33, 3.33]);
  });

  it("puts an unassigned line into the unassigned bucket, not into any guest", () => {
    const { shares, unassigned } = splitByItems(
      [
        { id: "l1", name: "Sriuba", lineTotal: 5 },
        { id: "l2", name: "Duona", lineTotal: 2 },
      ],
      [{ id: "g1", name: "Svečias 1" }],
      { l1: ["g1"] }
    );
    expect(shares).toEqual([{ guestId: "g1", guestName: "Svečias 1", amount: 5 }]);
    expect(unassigned).toBe(2);
  });

  it("ignores assignments pointing at a guest that no longer exists", () => {
    const { shares, unassigned } = splitByItems(
      [{ id: "l1", name: "Alus", lineTotal: 4 }],
      [{ id: "g1", name: "Svečias 1" }],
      { l1: ["g1", "ghost"] }
    );
    expect(shares).toEqual([{ guestId: "g1", guestName: "Svečias 1", amount: 4 }]);
    expect(unassigned).toBe(0);
  });

  it("every euro is accounted for across shares plus unassigned", () => {
    const lines = [
      { id: "l1", name: "A", lineTotal: 7.7 },
      { id: "l2", name: "B", lineTotal: 12.35 },
      { id: "l3", name: "C", lineTotal: 3.0 },
    ];
    const guests = [
      { id: "g1", name: "1" },
      { id: "g2", name: "2" },
    ];
    const { shares, unassigned } = splitByItems(lines, guests, {
      l1: ["g1"],
      l2: ["g1", "g2"],
      l3: [],
    });
    const total = lines.reduce((s, l) => s + l.lineTotal, 0);
    const accounted =
      shares.reduce((s, share) => s + share.amount, 0) + unassigned;
    expect(Math.round(accounted * 100)).toBe(Math.round(total * 100));
  });
});

printResults();
