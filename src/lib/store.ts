"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Product } from "./data";

export interface CartItem {
  product: Product;
  quantity: number;
}

export type Lang = "lt" | "en" | "ru";

interface CartStore {
  items: CartItem[];
  tableNumber: string | null;
  lang: Lang;
  addItem: (product: Product, quantity?: number) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  setTableNumber: (n: string) => void;
  setLang: (l: Lang) => void;
  totalItems: () => number;
  totalPrice: () => number;
}

const CART_STORAGE_KEY = "dzukai-cart";
const LANGUAGE_SYNC_EVENT = "dzukai:language";

/**
 * Clear the cart from non-React contexts (e.g. waiter closing a session).
 * Writes directly to the Zustand persist key so the change survives page reload
 * and is visible cross-tab via the storage event.
 */
export function clearCartStorage(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) ?? "{}");
    raw.state = { ...(raw.state ?? {}), items: [] };
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(raw));
  } catch {
    localStorage.removeItem(CART_STORAGE_KEY);
  }
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],
      tableNumber: null,
      lang: "lt",

      addItem: (product, quantity = 1) => {
        set((state) => {
          const existing = state.items.find((i) => i.product.id === product.id);
          if (existing) {
            return {
              items: state.items.map((i) =>
                i.product.id === product.id
                  ? { ...i, quantity: i.quantity + quantity }
                  : i
              ),
            };
          }
          return { items: [...state.items, { product, quantity }] };
        });
      },

      removeItem: (productId) => {
        set((state) => ({
          items: state.items.filter((i) => i.product.id !== productId),
        }));
      },

      updateQuantity: (productId, quantity) => {
        if (quantity <= 0) {
          get().removeItem(productId);
          return;
        }
        set((state) => ({
          items: state.items.map((i) =>
            i.product.id === productId ? { ...i, quantity } : i
          ),
        }));
      },

      clearCart: () => set({ items: [] }),

      setTableNumber: (n) => set({ tableNumber: n }),
      setLang: (l) => {
        set({ lang: l });
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent(LANGUAGE_SYNC_EVENT));
        }
      },

      totalItems: () => get().items.reduce((sum, i) => sum + i.quantity, 0),

      totalPrice: () =>
        get().items.reduce((sum, i) => sum + i.product.price * i.quantity, 0),
    }),
    { name: "dzukai-cart" }
  )
);

/** Shared reactive language source for customer and staff applications. */
export function useLanguage(): [Lang, (lang: Lang) => void] {
  const lang = useCartStore((state) => state.lang);
  const setLang = useCartStore((state) => state.setLang);

  useEffect(() => {
    const syncFromStorage = () => {
      try {
        const persisted = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) ?? "{}");
        const storedLang = persisted.state?.lang;
        if (storedLang === "lt" || storedLang === "en" || storedLang === "ru") {
          if (useCartStore.getState().lang !== storedLang) {
            useCartStore.setState({ lang: storedLang });
          }
        }
      } catch {
        // Keep the current in-memory language if persisted state is malformed.
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === CART_STORAGE_KEY || event.key === null) syncFromStorage();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(LANGUAGE_SYNC_EVENT, syncFromStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(LANGUAGE_SYNC_EVENT, syncFromStorage);
    };
  }, []);

  return [lang, setLang];
}
