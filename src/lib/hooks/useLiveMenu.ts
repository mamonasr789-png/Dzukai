"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { products, type Product } from "../data";
import { applyMenuOverrides, type MenuOverride } from "../menuOverrides";

const POLL_MS = 15_000;

export function useLiveMenu(): {
  products: Product[];
  overrides: MenuOverride[];
  refresh: () => Promise<void>;
} {
  const [overrides, setOverrides] = useState<MenuOverride[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/menu", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { overrides?: MenuOverride[] };
      if (Array.isArray(data.overrides)) setOverrides(data.overrides);
    } catch {
      // Keep the last known merge if the poll fails mid-service.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const liveProducts = useMemo(
    () => applyMenuOverrides(products, overrides),
    [overrides]
  );

  return { products: liveProducts, overrides, refresh };
}
