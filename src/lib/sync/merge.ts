/**
 * Pure merge logic for cross-device sync — no browser APIs, fully testable.
 *
 * Collections are JSON arrays of records with an `id`. A record's freshness
 * stamp is `updatedAt`, falling back to `createdAt` for legacy orders written
 * before stamping existed.
 */

export interface SyncedRecord {
  id: string;
  updatedAt?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface PushRecord {
  id: string;
  data: string;
  updatedAt: string;
}

export function recordStamp(record: SyncedRecord): string {
  return record.updatedAt ?? record.createdAt ?? "";
}

export function parseCollection(json: string | null): SyncedRecord[] {
  if (!json) return [];
  try {
    const value = JSON.parse(json);
    return Array.isArray(value)
      ? value.filter(
          (r): r is SyncedRecord =>
            !!r && typeof r === "object" && typeof (r as SyncedRecord).id === "string"
        )
      : [];
  } catch {
    return [];
  }
}

/** Records present now whose serialized form differs from the last-synced shadow. */
export function diffLocal(
  shadowJson: string | null,
  currentJson: string | null
): PushRecord[] {
  const shadowById = new Map(
    parseCollection(shadowJson).map((r) => [r.id, JSON.stringify(r)])
  );
  const changed: PushRecord[] = [];
  for (const record of parseCollection(currentJson)) {
    const serialized = JSON.stringify(record);
    if (shadowById.get(record.id) === serialized) continue;
    changed.push({ id: record.id, data: serialized, updatedAt: recordStamp(record) });
  }
  return changed;
}

/**
 * Applies remote records onto the current collection.
 *
 * A remote record wins only when it is new locally or strictly fresher, so a
 * change this device just made is never clobbered by an older echo. Records
 * the device pushed this tick are deliberately NOT excluded: the server has
 * already arbitrated, and skipping them while the watermark moved past meant a
 * device could keep showing its own rejected version forever.
 */
export function applyRemote(
  currentJson: string | null,
  remote: { id: string; data: string }[]
): { next: SyncedRecord[]; changed: boolean } {
  const records = parseCollection(currentJson);
  const indexById = new Map(records.map((r, i) => [r.id, i]));
  let changed = false;

  for (const incoming of remote) {
    let parsed: SyncedRecord;
    try {
      parsed = JSON.parse(incoming.data) as SyncedRecord;
    } catch {
      continue;
    }
    if (!parsed || typeof parsed.id !== "string") continue;

    const index = indexById.get(incoming.id);
    if (index === undefined) {
      indexById.set(parsed.id, records.length);
      records.push(parsed);
      changed = true;
      continue;
    }
    const local = records[index];
    if (recordStamp(parsed) <= recordStamp(local)) continue;
    if (JSON.stringify(parsed) === JSON.stringify(local)) continue;
    records[index] = parsed;
    changed = true;
  }
  return { next: records, changed };
}
