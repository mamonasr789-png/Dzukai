/**
 * Development/testing reset utility — the admin panel's "Clear test data".
 *
 * Clears: orders, table sessions, waiter tasks — locally AND on the shared
 * server, so a reset actually starts everyone fresh instead of having sync
 * quietly bring the old data back a few seconds later.
 * Preserves: cart, kitchen theme, language pref, guest welcome flag, product/menu data.
 */

const KEYS_TO_CLEAR = [
  "dzukai-orders",
  "dzukai-table-sessions",
  "dzukai-waiter-tasks",
  // Also drop the sync engine's watermarks/shadows so it doesn't compare
  // against pre-reset state on its next tick.
  "dzukai-sync-state",
] as const;

const BROADCAST_EVENTS = [
  "dzukai:order",
  "dzukai:session",
  "dzukai:waiter",
] as const;

export async function resetDemoData(): Promise<void> {
  if (typeof window === "undefined") return;

  for (const key of KEYS_TO_CLEAR) {
    localStorage.removeItem(key);
  }

  // Best-effort: if the shared store isn't configured (local dev without a
  // DB) or the request fails, the local clear above still went through.
  try {
    await fetch("/api/store/sync", { method: "DELETE" });
  } catch {
    // ignore — local reset already happened
  }

  // Notify all open tabs/components that storage has changed
  for (const event of BROADCAST_EVENTS) {
    window.dispatchEvent(new CustomEvent(event));
  }
}
