/**
 * Guest wait-time food groups (Karolis): starters, mains, kids, drinks, desserts.
 * Pure mapping + remaining-minutes math — no DB, safe for unit tests.
 */

export const FOOD_GROUPS = ["starters", "mains", "kids", "drinks", "desserts"] as const;
export type FoodGroup = (typeof FOOD_GROUPS)[number];

export interface GroupWaitEstimate {
  group: FoodGroup;
  minutes: number;
}

export interface OrderEta {
  estimatedMinutes: number | null;
  estimatedMinutesByGroup: GroupWaitEstimate[];
}

/** Defaults when a product has no historical prep time. */
export const DEFAULT_PREP_MINUTES_BY_GROUP: Record<FoodGroup, number> = {
  drinks: 5,
  starters: 12,
  kids: 12,
  desserts: 10,
  mains: 20,
};

export const MINIMUM_ETA_MINUTES = 2;

/** Statuses where a live ETA is still useful (matches estimateEtaMinutes). */
export const ETA_HIDDEN_STATUSES = ["DELIVERING", "COMPLETED", "CANCELLED"] as const;

/** Guest order page shows per-group times only while waiting / cooking. */
export const GUEST_GROUP_WAIT_STATUSES = ["PENDING_CONFIRMATION", "NEW", "PREPARING"] as const;

const CATEGORY_TO_GROUP: Record<string, FoodGroup> = {
  uzkandziai: "starters",
  salotos: "starters",
  sriubos: "starters",
  "prie-alaus": "starters",
  lietiniai: "mains",
  koldumai: "mains",
  wok: "mains",
  bulviniai: "mains",
  picos: "mains",
  grilinis: "mains",
  vistiena: "mains",
  kiauliena: "mains",
  jautiena: "mains",
  zuvis: "mains",
  vaikiskas: "kids",
  limonadai: "drinks",
  "nealko-alus": "drinks",
  kava: "drinks",
  gerimai: "drinks",
  alus: "drinks",
  sidras: "drinks",
  "alus-kokteiliai": "drinks",
  kokteiliai: "drinks",
  stiprieji: "drinks",
  sampanas: "drinks",
  vynas: "drinks",
  desertai: "desserts",
};

/** Unknown / missing category → mains so the item is never dropped. */
export function foodGroupForCategory(category: string | null | undefined): FoodGroup {
  if (!category) return "mains";
  return CATEGORY_TO_GROUP[category] ?? "mains";
}

export function isEtaHiddenStatus(status: string): boolean {
  return (ETA_HIDDEN_STATUSES as readonly string[]).includes(status);
}

export function isGuestGroupWaitStatus(status: string): boolean {
  return (GUEST_GROUP_WAIT_STATUSES as readonly string[]).includes(status);
}

export interface GroupEtaItem {
  productId: string;
  category?: string | null;
  itemStatus?: string;
}

function historicalPrep(
  historical: Map<string, number> | Record<string, number> | undefined,
  productId: string
): number | undefined {
  if (!historical) return undefined;
  if (historical instanceof Map) return historical.get(productId);
  const value = historical[productId];
  return typeof value === "number" ? value : undefined;
}

/** Remaining minutes for one dish: predicted total − elapsed, floored at MINIMUM_ETA_MINUTES. */
export function remainingMinutesForPrep(
  basePrepMinutes: number,
  loadMultiplier: number,
  deliveryMinutes: number,
  elapsedMinutes: number
): number {
  const totalMinutes = basePrepMinutes * loadMultiplier + deliveryMinutes;
  return Math.max(MINIMUM_ETA_MINUTES, Math.round(totalMinutes - elapsedMinutes));
}

/**
 * Per-group wait: max remaining minutes among items in that group.
 * Empty groups are omitted. Cancelled items are skipped.
 */
export function estimateMinutesByGroup(opts: {
  items: GroupEtaItem[];
  categoryByProductId?: Record<string, string | undefined>;
  historicalPrepByProductId?: Map<string, number> | Record<string, number>;
  loadMultiplier?: number;
  deliveryMinutes?: number;
  elapsedMinutes?: number;
}): GroupWaitEstimate[] {
  const {
    items,
    categoryByProductId = {},
    historicalPrepByProductId,
    loadMultiplier = 1,
    deliveryMinutes = 0,
    elapsedMinutes = 0,
  } = opts;

  const bestByGroup = new Map<FoodGroup, number>();
  for (const item of items) {
    if (item.itemStatus === "CANCELLED") continue;
    const category = item.category ?? categoryByProductId[item.productId];
    const group = foodGroupForCategory(category);
    const basePrep = historicalPrep(historicalPrepByProductId, item.productId) ?? DEFAULT_PREP_MINUTES_BY_GROUP[group];
    const remaining = remainingMinutesForPrep(basePrep, loadMultiplier, deliveryMinutes, elapsedMinutes);
    const prev = bestByGroup.get(group);
    if (prev === undefined || remaining > prev) bestByGroup.set(group, remaining);
  }

  return FOOD_GROUPS.filter((group) => bestByGroup.has(group)).map((group) => ({
    group,
    minutes: bestByGroup.get(group)!,
  }));
}

/** Hide ETAs once food is on the way / done / cancelled; otherwise overall = max group. */
export function finalizeOrderEta(status: string, groups: GroupWaitEstimate[]): OrderEta {
  if (isEtaHiddenStatus(status)) {
    return { estimatedMinutes: null, estimatedMinutesByGroup: [] };
  }
  const estimatedMinutes = groups.length > 0 ? Math.max(...groups.map((g) => g.minutes)) : null;
  return { estimatedMinutes, estimatedMinutesByGroup: groups };
}
