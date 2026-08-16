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
 * Never permanently gives up: a deploy hiccup, a Neon blip, or a phone
 * backgrounding the tab mid-request must not silently stop that one device
 * from syncing until someone thinks to reload the page — the whole point is
 * that every staff device shows the same thing. Every tick is bounded by a
 * timeout so a stuck request can never wedge the engine, and failures just
 * mean "try again next tick" rather than "stop trying".
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
const FETCH_TIMEOUT_MS = 8_000;

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

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  // Bounds every tick, including a fetch a suspended mobile tab never got to
  // finish — without this, `ticking` could stay true forever and silently
  // stop this one device from syncing again until the page is reloaded.
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const state = readState();
    const request: Record<string, { since: number; push: unknown[] }> = {};

    for (const [name, binding] of Object.entries(COLLECTIONS)) {
      const current = localStorage.getItem(binding.storageKey);
      const push = diffLocal(state.shadows[name] ?? null, current);
      request[name] = { since: state.watermarks[name] ?? 0, push };
    }

    const response = await fetch("/api/store/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ collections: request }),
      signal: controller.signal,
    });
    if (!response.ok) {
      // Whatever this was — a deploy cutting over, a Neon blip, sync not
      // configured locally — the next tick tries again on its own. No
      // permanent give-up: every device should end up showing the same data.
      return;
    }
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
      const { next, changed } = applyRemote(current, result.records);
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
    // Network error, aborted timeout, or a malformed response — next tick retries.
  } finally {
    clearTimeout(abortTimer);
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
