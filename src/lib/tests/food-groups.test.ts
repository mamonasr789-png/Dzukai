/**
 * Pure food-group mapping + per-group wait math (no DB).
 * Run: node --experimental-strip-types src/lib/tests/food-groups.test.ts
 */

const { describe, it, expect, printResults } = await import("../assistant/tests/runner.ts");
const {
  foodGroupForCategory,
  estimateMinutesByGroup,
  finalizeOrderEta,
  DEFAULT_PREP_MINUTES_BY_GROUP,
} = await import("../foodGroups.ts");
const i18n = await import("../i18n.ts");

describe("foodGroupForCategory", () => {
  it("maps starters categories", () => {
    expect(foodGroupForCategory("uzkandziai")).toBe("starters");
    expect(foodGroupForCategory("salotos")).toBe("starters");
    expect(foodGroupForCategory("sriubos")).toBe("starters");
    expect(foodGroupForCategory("prie-alaus")).toBe("starters");
  });

  it("maps mains categories", () => {
    expect(foodGroupForCategory("lietiniai")).toBe("mains");
    expect(foodGroupForCategory("koldumai")).toBe("mains");
    expect(foodGroupForCategory("wok")).toBe("mains");
    expect(foodGroupForCategory("bulviniai")).toBe("mains");
    expect(foodGroupForCategory("picos")).toBe("mains");
    expect(foodGroupForCategory("grilinis")).toBe("mains");
    expect(foodGroupForCategory("vistiena")).toBe("mains");
    expect(foodGroupForCategory("kiauliena")).toBe("mains");
    expect(foodGroupForCategory("jautiena")).toBe("mains");
    expect(foodGroupForCategory("zuvis")).toBe("mains");
  });

  it("maps kids category to kids", () => {
    expect(foodGroupForCategory("vaikiskas")).toBe("kids");
  });

  it("maps drink categories", () => {
    expect(foodGroupForCategory("limonadai")).toBe("drinks");
    expect(foodGroupForCategory("nealko-alus")).toBe("drinks");
    expect(foodGroupForCategory("kava")).toBe("drinks");
    expect(foodGroupForCategory("gerimai")).toBe("drinks");
    expect(foodGroupForCategory("alus")).toBe("drinks");
    expect(foodGroupForCategory("sidras")).toBe("drinks");
    expect(foodGroupForCategory("alus-kokteiliai")).toBe("drinks");
    expect(foodGroupForCategory("kokteiliai")).toBe("drinks");
    expect(foodGroupForCategory("stiprieji")).toBe("drinks");
    expect(foodGroupForCategory("sampanas")).toBe("drinks");
    expect(foodGroupForCategory("vynas")).toBe("drinks");
  });

  it("maps desserts", () => {
    expect(foodGroupForCategory("desertai")).toBe("desserts");
  });

  it("unknown or missing category falls back to mains (item is not dropped)", () => {
    expect(foodGroupForCategory("mystery")).toBe("mains");
    expect(foodGroupForCategory("visi")).toBe("mains");
    expect(foodGroupForCategory(undefined)).toBe("mains");
    expect(foodGroupForCategory(null)).toBe("mains");
  });
});

describe("estimateMinutesByGroup defaults", () => {
  it("beer-only order is drinks, not the old 15-minute whole-order default", () => {
    const groups = estimateMinutesByGroup({
      items: [{ productId: "al1", category: "alus" }],
    });
    expect(groups).toEqual([{ group: "drinks", minutes: DEFAULT_PREP_MINUTES_BY_GROUP.drinks }]);
    expect(groups[0].minutes).toBe(5);
    expect(groups[0].minutes).not.toBe(15);
    expect(finalizeOrderEta("NEW", groups).estimatedMinutes).toBe(5);
  });

  it("mixed starter + main returns two groups", () => {
    const groups = estimateMinutesByGroup({
      items: [
        { productId: "u1", category: "uzkandziai" },
        { productId: "p1", category: "picos" },
      ],
    });
    expect(groups.map((g) => g.group)).toEqual(["starters", "mains"]);
    expect(groups).toEqual([
      { group: "starters", minutes: 12 },
      { group: "mains", minutes: 20 },
    ]);
    expect(finalizeOrderEta("PREPARING", groups).estimatedMinutes).toBe(20);
  });

  it("kids category maps to kids group with kids default minutes", () => {
    const groups = estimateMinutesByGroup({
      items: [{ productId: "vm1", category: "vaikiskas" }],
    });
    expect(groups).toEqual([{ group: "kids", minutes: 12 }]);
  });

  it("omits groups that are not on the order", () => {
    const groups = estimateMinutesByGroup({
      items: [{ productId: "d1", category: "desertai" }],
    });
    expect(groups).toEqual([{ group: "desserts", minutes: 10 }]);
  });

  it("looks category up from categoryByProductId when the item has none", () => {
    const groups = estimateMinutesByGroup({
      items: [{ productId: "al1" }],
      categoryByProductId: { al1: "alus" },
    });
    expect(groups).toEqual([{ group: "drinks", minutes: 5 }]);
  });

  it("skips cancelled items so they do not create a group", () => {
    const groups = estimateMinutesByGroup({
      items: [
        { productId: "al1", category: "alus", itemStatus: "CANCELLED" },
        { productId: "p1", category: "picos" },
      ],
    });
    expect(groups).toEqual([{ group: "mains", minutes: 20 }]);
  });
});

describe("historical prep, load, delivery, elapsed", () => {
  it("uses historical per-product prep when available instead of the group default", () => {
    const groups = estimateMinutesByGroup({
      items: [{ productId: "al1", category: "alus" }],
      historicalPrepByProductId: { al1: 8 },
    });
    expect(groups).toEqual([{ group: "drinks", minutes: 8 }]);
  });

  it("group ETA is the max remaining among items in that group", () => {
    const groups = estimateMinutesByGroup({
      items: [
        { productId: "p1", category: "picos" },
        { productId: "p2", category: "picos" },
      ],
      historicalPrepByProductId: { p1: 10, p2: 25 },
    });
    expect(groups).toEqual([{ group: "mains", minutes: 25 }]);
  });

  it("applies shared kitchen load multiplier and delivery add", () => {
    // drinks 5 * 2 + 5 delivery = 15
    const groups = estimateMinutesByGroup({
      items: [{ productId: "al1", category: "alus" }],
      loadMultiplier: 2,
      deliveryMinutes: 5,
    });
    expect(groups).toEqual([{ group: "drinks", minutes: 15 }]);
  });

  it("remaining minutes subtract elapsed time and never go below 2", () => {
    const groups = estimateMinutesByGroup({
      items: [{ productId: "p1", category: "picos" }],
      elapsedMinutes: 10,
    });
    expect(groups).toEqual([{ group: "mains", minutes: 10 }]);
    const floor = estimateMinutesByGroup({
      items: [{ productId: "al1", category: "alus" }],
      elapsedMinutes: 90,
    });
    expect(floor).toEqual([{ group: "drinks", minutes: 2 }]);
  });
});

describe("finalizeOrderEta status gating", () => {
  it("completed / delivering / cancelled → null minutes and empty groups", () => {
    const live = [{ group: "drinks" as const, minutes: 5 }];
    expect(finalizeOrderEta("COMPLETED", live)).toEqual({
      estimatedMinutes: null,
      estimatedMinutesByGroup: [],
    });
    expect(finalizeOrderEta("DELIVERING", live)).toEqual({
      estimatedMinutes: null,
      estimatedMinutesByGroup: [],
    });
    expect(finalizeOrderEta("CANCELLED", live)).toEqual({
      estimatedMinutes: null,
      estimatedMinutesByGroup: [],
    });
  });

  it("NEW / PREPARING / PENDING_CONFIRMATION keep per-group estimates", () => {
    const live = [
      { group: "starters" as const, minutes: 12 },
      { group: "mains" as const, minutes: 20 },
    ];
    expect(finalizeOrderEta("NEW", live).estimatedMinutesByGroup).toEqual(live);
    expect(finalizeOrderEta("PREPARING", live).estimatedMinutes).toBe(20);
    expect(finalizeOrderEta("PENDING_CONFIRMATION", live).estimatedMinutesByGroup).toHaveLength(2);
  });
});

describe("guest wait copy", () => {
  it("labels all five groups in lt, en and ru", () => {
    expect(i18n.foodGroupLabels.lt).toEqual({
      starters: "Užkandžiai",
      mains: "Pagrindiniai patiekalai",
      kids: "Vaikų meniu",
      drinks: "Gėrimai",
      desserts: "Desertai",
    });
    expect(i18n.foodGroupLabels.en.drinks).toBe("Drinks");
    expect(i18n.foodGroupLabels.ru.kids).toBe("Детское меню");
  });

  it("wait intro has no baked-in 15-minute number", () => {
    expect(i18n.guestWaitIntro("lt", "NEW")).toBe("Užsakymas priimtas.");
    expect(i18n.guestWaitIntro("en", "PREPARING")).notToContain("15");
    expect(i18n.guestWaitIntro("lt", "PENDING_CONFIRMATION")).toContain("padavėjo");
    expect(i18n.groupWaitMinutesLabel("lt", 5)).toBe("~5 min.");
    expect(i18n.groupWaitMinutesLabel("en", 12)).toBe("~12 min");
    expect(i18n.groupWaitMinutesLabel("ru", 10)).toBe("~10 мин.");
  });
});

printResults();
