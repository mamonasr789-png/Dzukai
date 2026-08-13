"use client";

/**
 * Cross-device sync engine.
 *
 * Every ~2.5 s each device pushes its local localStorage changes to
 * /api/store/sync and pulls everyone else's, then re-emits the exact same
 * CustomEvents the storage modules already dispatch — so every screen
 * (kitchen, waiter, admin, customer tracking) updates without a single UI
 * change. localStorage stays the local cache; the server is the shared truth.
 *
 * Self-disabling: where the API answers 503 (no writable disk, e.g. the
 * current Vercel demo), the engine shuts down after a few attempts and the
 * app behaves exactly as it did before the backend existed.
 */

import { applyRemote, diffLocal } from "./merge";

interface CollectionBinding {
  storageKey: string;
  eventName: string;
}

const COLLECTIONS: Record<string, CollectionBinding> = {
  orders: { storageKey: "dzukai-orders", eventName: "dzukai:order" },
  sessions: { storageKey: "dzukai-table-sessions", eventName: "dzukai:session" },
  tasks: { storageKey: "dzukai-waiter-tasks", eventName: "dzukai:waiter" },
};

const STATE_KEY = "dzukai-sync-state";
const TICK_MS = 2_500;
const MAX_CONSECUTIVE_FAILURES = 3;

interface SyncState {
  watermarks: Record<string, number>;
  shadows: Record<string, string>;
}

function readState(): SyncState {
  try {
    const raw = JSON.parse(localStorage.getItem(STATE_KEY) ?? "{}");
    return {
      watermarks: raw.watermarks ?? {},
      shadows: raw.shadows ?? {},
    };
  } catch {
    return { watermarks: {}, shadows: {} };
  }
}

function writeState(state: SyncState): void {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let failures = 0;
let disabled = false;

async function tick(): Promise<void> {
  if (ticking || disabled) return;
  ticking = true;
  try {
    const state = readState();
    const request: Record<string, { since: number; push: unknown[] }> = {};
    const dirtyIds: Record<string, Set<string>> = {};

    for (const [name, binding] of Object.entries(COLLECTIONS)) {
      const current = localStorage.getItem(binding.storageKey);
      const push = diffLocal(state.shadows[name] ?? null, current);
      dirtyIds[name] = new Set(push.map((r) => r.id));
      request[name] = { since: state.watermarks[name] ?? 0, push };
    }

    const response = await fetch("/api/store/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ collections: request }),
    });
    if (!response.ok) {
      failures += 1;
      if (response.status === 503 || response.status === 404) {
        if (failures >= MAX_CONSECUTIVE_FAILURES) {
          disabled = true;
          stopSync();
        }
      }
      return;
    }
    failures = 0;
    const body = (await response.json()) as {
      ok: boolean;
      collections?: Record<
        string,
        { records: { id: string; data: string }[]; watermark: number }
      >;
    };
    if (!body.ok || !body.collections) return;

    const nextState = readState();
    for (const [name, binding] of Object.entries(COLLECTIONS)) {
      const result = body.collections[name];
      if (!result) continue;
      const current = localStorage.getItem(binding.storageKey);
      const { next, changed } = applyRemote(
        current,
        result.records,
        dirtyIds[name]
      );
      const finalJson = changed ? JSON.stringify(next) : (current ?? "[]");
      if (changed) {
        localStorage.setItem(binding.storageKey, finalJson);
        window.dispatchEvent(new CustomEvent(binding.eventName));
      }
      nextState.watermarks[name] = result.watermark;
      nextState.shadows[name] = finalJson;
    }
    writeState(nextState);
  } catch {
    failures += 1;
  } finally {
    ticking = false;
  }
}

export function startSync(): () => void {
  if (typeof window === "undefined") return () => {};
  if (process.env.NEXT_PUBLIC_ORDER_SYNC === "off") return () => {};
  if (timer) return stopSync;

  void tick();
  timer = setInterval(() => void tick(), TICK_MS);
  const onVisible = () => {
    if (document.visibilityState === "visible") void tick();
  };
  document.addEventListener("visibilitychange", onVisible);
  const cleanup = () => {
    document.removeEventListener("visibilitychange", onVisible);
    stopSync();
  };
  return cleanup;
}

export function stopSync(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
