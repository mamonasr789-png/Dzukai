/**
 * Menu override merge + SQLite store.
 * Run: node --experimental-strip-types src/lib/tests/menu-overrides.test.ts
 */

const { describe, it, expect, printResults } = await import("../assistant/tests/runner.ts");
const { DatabaseSync } = await import("node:sqlite");

const require0 = (await import("node:module")).createRequire(import.meta.url);
const serverOnly = require0.resolve("server-only");
require0.cache[serverOnly] = { id: serverOnly, filename: serverOnly, loaded: true, exports: {} } as never;

const { applyMenuOverride, applyMenuOverrides } = await import("../menuOverrides.ts");
const { SqliteMenuOverrideStore } = await import("../server/menuOverrideStore.ts");

const base = {
  id: "p1",
  name: "Margarita",
  description: "",
  price: 9,
  image: "/x.jpg",
  category: "picos" as const,
  ingredients: [],
  allergens: [],
};

describe("applyMenuOverrides", () => {
  it("applies soldOut, price and name; leaves untouched items unchanged", () => {
    const merged = applyMenuOverrides(
      [base, { ...base, id: "p2", name: "Other", price: 11.5 }],
      [{ productId: "p1", soldOut: true, price: 10, name: "Margarita special" }]
    );
    expect(merged[0].soldOut).toBe(true);
    expect(merged[0].price).toBe(10);
    expect(merged[0].name).toBe("Margarita special");
    expect(merged[1].soldOut).toBeFalsy();
    expect(merged[1].price).toBe(11.5);
    expect(merged[1].name).toBe("Other");
  });

  it("ignores a missing override", () => {
    const product = applyMenuOverride(base, null);
    expect(product.price).toBe(9);
    expect(product.soldOut).toBeFalsy();
  });
});

describe("SqliteMenuOverrideStore", () => {});
{
  const store = new SqliteMenuOverrideStore(new DatabaseSync(":memory:"));
  await store.upsert({ productId: "p1", price: 8 });
  const after86 = await store.upsert({ productId: "p1", soldOut: true });
  it("upserts merge onto the existing row", () => {
    expect(after86.price).toBe(8);
    expect(after86.soldOut).toBe(true);
  });
  const listed = await store.list();
  it("lists and gets the 86 flag", () => {
    expect(listed.length).toBe(1);
    expect(listed[0].soldOut).toBe(true);
  });
}

printResults();
