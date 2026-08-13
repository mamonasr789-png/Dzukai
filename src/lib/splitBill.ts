/**
 * Split-the-bill calculator — informational only.
 *
 * No payment or order data is mutated: this computes who owes what so the
 * table can settle among themselves or pay as one. All math happens in
 * integer cents so shares always sum back to the exact total (floats don't).
 */

export interface SplitLine {
  id: string;
  name: string;
  /** price × quantity, in euros. */
  lineTotal: number;
}

export interface EqualShare {
  guestIndex: number;
  amount: number;
}

export interface ItemGuest {
  id: string;
  name: string;
}

export interface ItemShare {
  guestId: string;
  guestName: string;
  amount: number;
}

function toCents(euros: number): number {
  return Math.round(euros * 100);
}

function fromCents(cents: number): number {
  return cents / 100;
}

/** Distributes `totalCents` into `count` integer shares that sum exactly. */
function distributeCents(totalCents: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

/** Equal split of the total among `guestCount` people. */
export function splitEqually(total: number, guestCount: number): EqualShare[] {
  return distributeCents(toCents(total), guestCount).map((cents, guestIndex) => ({
    guestIndex,
    amount: fromCents(cents),
  }));
}

/**
 * Item-based split. Each line's total is divided evenly among the guests it
 * is assigned to (a line assigned to nobody contributes to `unassigned`).
 * A line assigned to multiple guests is treated as shared.
 */
export function splitByItems(
  lines: SplitLine[],
  guests: ItemGuest[],
  assignments: Record<string, string[]>
): { shares: ItemShare[]; unassigned: number } {
  const totalsCents = new Map<string, number>(guests.map((g) => [g.id, 0]));
  let unassignedCents = 0;

  for (const line of lines) {
    const assignedGuestIds = (assignments[line.id] ?? []).filter((id) =>
      totalsCents.has(id)
    );
    const lineCents = toCents(line.lineTotal);
    if (assignedGuestIds.length === 0) {
      unassignedCents += lineCents;
      continue;
    }
    const parts = distributeCents(lineCents, assignedGuestIds.length);
    assignedGuestIds.forEach((guestId, i) => {
      totalsCents.set(guestId, (totalsCents.get(guestId) ?? 0) + parts[i]);
    });
  }

  return {
    shares: guests.map((g) => ({
      guestId: g.id,
      guestName: g.name,
      amount: fromCents(totalsCents.get(g.id) ?? 0),
    })),
    unassigned: fromCents(unassignedCents),
  };
}
