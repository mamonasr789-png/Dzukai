"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { categories, type Category, type Product } from "@/lib/data";
import { categoryLabels } from "@/lib/i18n";
import { useLiveMenu } from "@/lib/hooks/useLiveMenu";
import type { StaffLang } from "@/lib/staff-i18n";

type NightPreset = "86" | "alus" | "limonadai" | "populiarus" | "kategorijos";

const NIGHT_PRESETS: { id: NightPreset; lt: string; en: string }[] = [
  { id: "86", lt: "86", en: "86" },
  { id: "alus", lt: "Alus", en: "Beer" },
  { id: "limonadai", lt: "Limonadai", en: "Lemonades" },
  { id: "populiarus", lt: "Populiarūs", en: "Popular" },
  { id: "kategorijos", lt: "Kategorijos", en: "Categories" },
];

const MENU_CATEGORIES = categories.filter((c) => c.id !== "visi");

const CAT_CHIP: Record<StaffLang, Partial<Record<Category, string>>> = {
  lt: {
    uzkandziai: "Užkandžiai",
    salotos: "Salotos",
    sriubos: "Sriubos",
    lietiniai: "Lietiniai",
    koldumai: "Koldūnai",
    wok: "Wok",
    bulviniai: "Bulviniai",
    picos: "Picos",
    grilinis: "Grilis",
    vistiena: "Vištiena",
    kiauliena: "Kiauliena",
    jautiena: "Jautiena",
    zuvis: "Žuvis",
    vaikiskas: "Vaikams",
    "prie-alaus": "Prie alaus",
    desertai: "Desertai",
    limonadai: "Limonadai",
    "nealko-alus": "Nealko alus",
    kava: "Kava",
    gerimai: "Gaivieji",
    alus: "Alus",
    sidras: "Sidras",
    "alus-kokteiliai": "Alaus kokt.",
    kokteiliai: "Kokteiliai",
    stiprieji: "Stiprieji",
    sampanas: "Šampanas",
    vynas: "Vynas",
  },
  en: {
    uzkandziai: "Starters",
    salotos: "Salads",
    sriubos: "Soups",
    lietiniai: "Pancakes",
    koldumai: "Dumplings",
    wok: "Wok",
    bulviniai: "Potato",
    picos: "Pizza",
    grilinis: "Grill",
    vistiena: "Chicken",
    kiauliena: "Pork",
    jautiena: "Beef",
    zuvis: "Fish",
    vaikiskas: "Kids",
    "prie-alaus": "Beer snacks",
    desertai: "Desserts",
    limonadai: "Lemonades",
    "nealko-alus": "Non-alc beer",
    kava: "Coffee",
    gerimai: "Soft drinks",
    alus: "Beer",
    sidras: "Cider",
    "alus-kokteiliai": "Beer cocktails",
    kokteiliai: "Cocktails",
    stiprieji: "Spirits",
    sampanas: "Sparkling",
    vynas: "Wine",
  },
};

const TEXT: Record<StaffLang, Record<string, string>> = {
  lt: {
    title: "86 — išparduota",
    search: "Ieškoti pavadinimo ar kategorijos…",
    mark86: "86",
    undo: "Grąžinti",
    error: "Nepavyko atnaujinti.",
    already86: "Jau 86",
    available: "Yra — palieskite 86",
    empty86: "Nėra 86 patiekalų.",
    emptySearch: "Nerasta.",
    pickCategory: "Pasirinkite kategoriją.",
    emptyPreset: "Šioje grupėje nieko nėra.",
  },
  en: {
    title: "86 — sold out",
    search: "Search name or category…",
    mark86: "86",
    undo: "Restore",
    error: "Could not update.",
    already86: "Already 86",
    available: "In — tap 86",
    empty86: "Nothing is 86'd.",
    emptySearch: "No matches.",
    pickCategory: "Pick a category.",
    emptyPreset: "Nothing in this group.",
  },
};

function catLabel(lang: StaffLang, id: Category): string {
  if (lang === "en") {
    return CAT_CHIP.en[id] ?? categoryLabels.en[id] ?? id;
  }
  return (
    CAT_CHIP.lt[id] ??
    categories.find((c) => c.id === id)?.label ??
    id
  );
}

function isPopular(product: Product): boolean {
  return Boolean(product.featured) || product.badge === "Populiaru";
}

function matchesQuery(product: Product, q: string, lang: StaffLang): boolean {
  const label = catLabel(lang, product.category);
  const official =
    lang === "en"
      ? categoryLabels.en[product.category] ?? ""
      : categories.find((c) => c.id === product.category)?.label ?? "";
  return (
    product.name.toLowerCase().includes(q) ||
    product.id.toLowerCase().includes(q) ||
    product.category.toLowerCase().includes(q) ||
    label.toLowerCase().includes(q) ||
    official.toLowerCase().includes(q)
  );
}

function byId(a: Product, b: Product): number {
  return a.id.localeCompare(b.id, "lt");
}

export default function Kitchen86Panel({
  lang,
  dark,
}: {
  lang: StaffLang;
  dark: boolean;
}) {
  const t = TEXT[lang];
  const { products, refresh } = useLiveMenu();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<NightPreset>("alus");
  const [category, setCategory] = useState<Category | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const soldOutCount = products.filter((p) => p.soldOut).length;
  const searching = query.trim().length > 0;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) {
      return products.filter((p) => matchesQuery(p, q, lang)).sort(byId).slice(0, 80);
    }
    if (preset === "86") {
      return products.filter((p) => p.soldOut).sort(byId);
    }
    if (preset === "alus") {
      return products.filter((p) => p.category === "alus").sort(byId);
    }
    if (preset === "limonadai") {
      return products.filter((p) => p.category === "limonadai").sort(byId);
    }
    if (preset === "populiarus") {
      return products.filter(isPopular).sort(byId);
    }
    if (!category) return [];
    return products.filter((p) => p.category === category).sort(byId);
  }, [products, query, preset, category, lang]);

  const soldOutItems = visible.filter((p) => p.soldOut);
  const availableItems = visible.filter((p) => !p.soldOut);
  const showCategoryHint = !searching && preset === "kategorijos" && !category;
  const showRowCategory =
    searching || preset === "86" || preset === "populiarus";

  async function toggle(productId: string, soldOut: boolean) {
    setBusyId(productId);
    setError(null);
    try {
      const res = await fetch("/api/staff/menu", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, soldOut }),
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

  function selectPreset(next: NightPreset) {
    setQuery("");
    setPreset(next);
    if (next !== "kategorijos") setCategory(null);
  }

  const wrap = dark ? "border-border/50 bg-card" : "border-gray-200 bg-white";
  const chipOn = dark ? "bg-primary/20 text-primary" : "bg-primary/15 text-primary";
  const chipOff = dark
    ? "bg-secondary text-muted-foreground"
    : "bg-gray-100 text-gray-600";
  const chip86On = dark
    ? "bg-red-500/20 text-red-400"
    : "bg-red-500/15 text-red-600";

  return (
    <div className={`mb-4 rounded-2xl border ${wrap} p-3`}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-left"
      >
        <span className="text-xs font-bold uppercase tracking-widest">
          {t.title}
          {soldOutCount > 0 && (
            <span className="ml-2 normal-case tracking-normal text-red-500">
              ({soldOutCount})
            </span>
          )}
        </span>
        <span className="text-xs text-muted-foreground">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="mt-3">
          <div className="flex items-center gap-2 rounded-xl bg-secondary px-3 py-2 mb-2">
            <Search size={13} className="text-muted-foreground shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.search}
              className="bg-transparent text-sm flex-1 outline-none"
            />
          </div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {NIGHT_PRESETS.map((item) => {
              const on = !searching && preset === item.id;
              const is86 = item.id === "86";
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectPreset(item.id)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                    on ? (is86 ? chip86On : chipOn) : chipOff
                  }`}
                >
                  {item[lang]}
                  {is86 && soldOutCount > 0 && (
                    <span className="ml-1 font-semibold">({soldOutCount})</span>
                  )}
                </button>
              );
            })}
          </div>
          {preset === "kategorijos" && !searching && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {MENU_CATEGORIES.map((item) => {
                const on = category === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                      setCategory((prev) => (prev === item.id ? null : item.id))
                    }
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                      on ? chipOn : chipOff
                    }`}
                  >
                    {catLabel(lang, item.id)}
                  </button>
                );
              })}
            </div>
          )}
          {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
          {showCategoryHint ? (
            <p className="text-xs text-muted-foreground py-2">{t.pickCategory}</p>
          ) : (
            <div className="flex flex-col gap-1.5 max-h-80 overflow-y-auto">
              {soldOutItems.length > 0 && (
                <SectionLabel label={`${t.already86} (${soldOutItems.length})`} />
              )}
              {soldOutItems.map((product) => (
                <DishRow
                  key={product.id}
                  product={product}
                  busy={busyId === product.id}
                  dark={dark}
                  showCategory={showRowCategory}
                  categoryName={catLabel(lang, product.category)}
                  mark86={t.mark86}
                  undo={t.undo}
                  onToggle={() => toggle(product.id, false)}
                />
              ))}
              {availableItems.length > 0 && (
                <SectionLabel label={`${t.available} (${availableItems.length})`} />
              )}
              {availableItems.map((product) => (
                <DishRow
                  key={product.id}
                  product={product}
                  busy={busyId === product.id}
                  dark={dark}
                  showCategory={showRowCategory}
                  categoryName={catLabel(lang, product.category)}
                  mark86={t.mark86}
                  undo={t.undo}
                  onToggle={() => toggle(product.id, true)}
                />
              ))}
              {visible.length === 0 && (
                <p className="text-xs text-muted-foreground py-2">
                  {searching
                    ? t.emptySearch
                    : preset === "86"
                      ? t.empty86
                      : t.emptyPreset}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground pt-1 first:pt-0">
      {label}
    </p>
  );
}

function DishRow({
  product,
  busy,
  dark,
  showCategory,
  categoryName,
  mark86,
  undo,
  onToggle,
}: {
  product: Product;
  busy: boolean;
  dark: boolean;
  showCategory: boolean;
  categoryName: string;
  mark86: string;
  undo: string;
  onToggle: () => void;
}) {
  const sold = Boolean(product.soldOut);
  const row = sold
    ? dark
      ? "bg-red-500/10"
      : "bg-red-50"
    : "";
  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 ${row}`}
    >
      <div className="min-w-0">
        <p
          className={`text-sm font-medium truncate ${
            sold ? "text-red-600" : ""
          }`}
        >
          {product.name}
        </p>
        {showCategory && (
          <p className="text-[10px] text-muted-foreground truncate">
            {categoryName}
          </p>
        )}
      </div>
      <button
        disabled={busy}
        onClick={onToggle}
        className={`shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-bold ${
          sold
            ? "bg-red-500/15 text-red-600"
            : "bg-secondary text-muted-foreground"
        }`}
      >
        {sold ? undo : mark86}
      </button>
    </div>
  );
}
