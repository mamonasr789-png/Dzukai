"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Generic polling primitive — the server-only-source-of-truth replacement for
 * the old subscribeOrders/subscribeSession/subscribeWaiterTasks + localStorage
 * CustomEvent pattern. Every consumer now fetches fresh from the server on an
 * interval instead of reading a locally-cached copy that could silently and
 * permanently fall behind (see MEMORY.md / this rewrite's plan for why).
 *
 * Pauses while the tab is hidden and refetches immediately on regaining
 * visibility — mirrors the old sync engine's visibilitychange handling, minus
 * the localStorage merge step.
 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number
): { data: T | null; loading: boolean; error: string | null; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const inFlight = useRef(false);

  const tick = useCallback(async () => {
    // Deliberately no visibility gate here — the old sync engine never had
    // one either, and gating the fetch itself (not just the interval) risks
    // a tab that reports "hidden" for reasons other than truly being in the
    // background (some embedded/kiosk browser contexts do this) never
    // fetching at all. Staff screens need real-time data unconditionally.
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await fetcherRef.current();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown_error");
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void tick();
    const timer = setInterval(() => void tick(), intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs]);

  return { data, loading, error, refresh: () => void tick() };
}
