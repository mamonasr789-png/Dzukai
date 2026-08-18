/**
 * Development/testing reset utility — the admin panel's "Clear test data".
 * Wipes orders/sessions/tasks server-side (the sole source of truth).
 */

export async function resetDemoData(): Promise<void> {
  await fetch("/api/store/sync", { method: "DELETE" });
}
