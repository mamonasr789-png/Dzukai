/**
 * Development/testing reset utility.
 * TEMPORARY — for local MVP demo resets only.
 *
 * Clears: orders, table sessions, waiter tasks.
 * Preserves: cart, kitchen theme, language pref, guest welcome flag, product/menu data.
 */

const KEYS_TO_CLEAR = [
  "dzukai-orders",
  "dzukai-table-sessions",
  "dzukai-waiter-tasks",
] as const;

const BROADCAST_EVENTS = [
  "dzukai:order",
  "dzukai:session",
  "dzukai:waiter",
] as const;

export function resetDemoData(): void {
  if (typeof window === "undefined") return;

  for (const key of KEYS_TO_CLEAR) {
    localStorage.removeItem(key);
  }

  // Notify all open tabs/components that storage has changed
  for (const event of BROADCAST_EVENTS) {
    window.dispatchEvent(new CustomEvent(event));
  }
}
