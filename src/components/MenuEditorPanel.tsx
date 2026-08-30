"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { products as catalog, type Product } from "@/lib/data";
import { useLiveMenu } from "@/lib/hooks/useLiveMenu";
import type { StaffLang } from "@/lib/staff-i18n";
import CollapsibleSection from "./CollapsibleSection";

const TEXT: Record<StaffLang, Record<string, string>> = {
  lt: {
    title: "Meniu: yra arba nėra, kaina",
    search: "Ieškoti patiekalo…",
    soldOut: "Nėra",
    available: "Yra",
    price: "Kaina €",
    name: "Pavadinimas",
    save: "Išsaugoti",
    saving: "Saugoma…",
    error: "Nepavyko išsaugoti.",
    hint: "Palieskite Nėra, jei patiekalo nėra. Kainą ir pavadinimą galite keisti čia. Pakeitimai matomi svečiams iš karto.",
  },
  en: {
    title: "Menu (available / price)",
    search: "Search dish…",
    soldOut: "Unavailable",
    available: "Available",
    price: "Price €",
    name: "Name",
    save: "Save",
    saving: "Saving…",
    error: "Could not save.",
    hint: "Tap Unavailable to mark a dish as not available. Price and name can be edited here. Changes show for guests immediately.",
  },
};

export default function MenuEditorPanel({ lang }: { lang: StaffLang }) {
  const t = TEXT[lang];
  const { products, refresh } = useLiveMenu();
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? products.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.id.toLowerCase().includes(q) ||
            catalog.find((c) => c.id === p.id)?.name.toLowerCase().includes(q)
        )
      : products;
    return list.slice(0, q ? 80 : 40);
  }, [products, query]);

  async function patch(body: {
    productId: string;
    soldOut?: boolean;
    price?: number;
    name?: string;
  }) {
    setBusyId(body.productId);
    setError(null);
    try {
      const res = await fetch("/api/staff/menu", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(t.error);
        return;
      }
      await refresh();
    } catch {
      setError(t.error);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <CollapsibleSection title={t.title} count={products.filter((p) => p.soldOut).length}>
      <p className="text-[11px] text-white/40 mb-3">{t.hint}</p>
      <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2 mb-3">
        <Search size={13} className="text-white/40 shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.search}
          className="bg-transparent text-sm flex-1 outline-none placeholder:text-white/30"
        />
      </div>
      {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
      <div className="flex flex-col gap-2 max-h-[28rem] overflow-y-auto pr-1">
        {visible.map((product) => (
          <EditorRow
            key={`${product.id}:${product.price}:${product.name}`}
            product={product}
            busy={busyId === product.id}
            t={t}
            on86={(soldOut) => patch({ productId: product.id, soldOut })}
            onSave={(price, name) => patch({ productId: product.id, price, name })}
          />
        ))}
      </div>
    </CollapsibleSection>
  );
}

function EditorRow({
  product,
  busy,
  t,
  on86,
  onSave,
}: {
  product: Product;
  busy: boolean;
  t: Record<string, string>;
  on86: (soldOut: boolean) => void;
  onSave: (price: number, name: string) => void;
}) {
  const [price, setPrice] = useState(product.price.toFixed(2));
  const [name, setName] = useState(product.name);

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-white truncate">{product.name}</p>
        <button
          disabled={busy}
          onClick={() => on86(!product.soldOut)}
          className={`shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-bold ${
            product.soldOut
              ? "bg-red-500/20 text-red-300 border border-red-500/30"
              : "bg-white/10 text-white/70 border border-white/10"
          }`}
        >
          {product.soldOut ? t.available : t.soldOut}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[10px] text-white/40 uppercase tracking-widest">
          {t.name}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 block w-44 bg-black/30 border border-white/10 rounded-lg px-2 py-1 text-xs text-white"
          />
        </label>
        <label className="text-[10px] text-white/40 uppercase tracking-widest">
          {t.price}
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            className="mt-1 block w-20 bg-black/30 border border-white/10 rounded-lg px-2 py-1 text-xs text-white"
          />
        </label>
        <button
          disabled={busy}
          onClick={() => {
            const next = Number(price.replace(",", "."));
            if (!Number.isFinite(next) || next < 0 || !name.trim()) return;
            onSave(next, name.trim());
          }}
          className="mt-4 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-primary/20 text-primary"
        >
          {busy ? t.saving : t.save}
        </button>
      </div>
    </div>
  );
}

