"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import {
  Search, ShoppingCart, Bot, X, AlertCircle, Plus, ChevronRight,
} from "lucide-react";
import { categories, products, Product, Category } from "@/lib/data";
import { useCartStore } from "@/lib/store";
import { useT, categoryLabels } from "@/lib/i18n";
import { productTranslations, badgeTranslations } from "@/lib/product-translations";
import ThemeToggle from "@/components/ThemeToggle";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import QuantitySelector from "@/components/QuantitySelector";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

function tProduct(id: string, lang: string, field: "name" | "description", fallback: string) {
  if (lang === "lt") return fallback;
  const l = lang as "en" | "ru";
  return productTranslations[l]?.[id]?.[field] ?? fallback;
}

function tBadge(badge: string, lang: string) {
  if (lang === "lt") return badge;
  return badgeTranslations[lang as "en" | "ru"]?.[badge] ?? badge;
}

function ProductRow({ product, onOpen }: { product: Product; onOpen: () => void }) {
  const { addItem, items, lang } = useCartStore();
  const tr = useT(lang);
  const inCart = items.find((i) => i.product.id === product.id);
  const qty = inCart?.quantity ?? 0;
  const hasPrice = product.price > 0;
  const name = tProduct(product.id, lang, "name", product.name);
  const desc = tProduct(product.id, lang, "description", product.description);
  const badge = product.badge ? tBadge(product.badge, lang) : null;

  return (
    <div className="flex gap-3 bg-card border border-border/40 rounded-2xl p-3 shadow-sm active:scale-[0.985] transition-transform">
      <button onClick={onOpen} className="flex-1 min-w-0 flex flex-col gap-0.5 text-left">
        {badge && (
          <span className="text-[10px] font-bold text-primary uppercase tracking-wide">{badge}</span>
        )}
        <p className="font-semibold text-sm leading-snug line-clamp-2">{name}</p>
        {desc ? (
          <p className="text-muted-foreground text-xs leading-snug line-clamp-1 mt-0.5">{desc}</p>
        ) : product.priceNote ? (
          <p className="text-muted-foreground text-xs mt-0.5">{product.priceNote}</p>
        ) : null}
        <div className="mt-2">
          <span className="font-bold text-sm text-foreground">
            {hasPrice ? `${product.price.toFixed(2)} €` : tr.ask_price}
          </span>
        </div>
      </button>
      <div className="flex flex-col items-center gap-2 shrink-0">
        <button onClick={onOpen} className="relative w-[88px] h-[88px] rounded-xl overflow-hidden bg-muted">
          <Image src={product.image} alt={product.name} fill className="object-cover" sizes="88px" />
        </button>
        {hasPrice && (
          <button
            onClick={() => addItem(product)}
            className={cn(
              "flex items-center justify-center gap-1 rounded-full font-bold text-xs transition-all active:scale-90 shadow-sm",
              qty > 0
                ? "bg-primary text-primary-foreground px-3 h-8"
                : "bg-primary text-primary-foreground w-8 h-8"
            )}
          >
            <Plus size={14} strokeWidth={3} />
            {qty > 0 && <span>{qty}</span>}
          </button>
        )}
      </div>
    </div>
  );
}

function ProductSheet({ product, open, onClose }: { product: Product | null; open: boolean; onClose: () => void }) {
  const { addItem, lang } = useCartStore();
  const tr = useT(lang);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    if (open) { setQty(1); setAdded(false); }
  }, [open, product?.id]);

  if (!product) return null;
  const hasPrice = product.price > 0;
  const name = tProduct(product.id, lang, "name", product.name);
  const desc = tProduct(product.id, lang, "description", product.description);
  const badge = product.badge ? tBadge(product.badge, lang) : null;

  const handleAdd = () => {
    addItem(product, qty);
    setAdded(true);
    setTimeout(onClose, 700);
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="bottom" showCloseButton={false} className="p-0 rounded-t-3xl max-h-[92vh] overflow-y-auto border-0 gap-0">
        <div className="flex justify-center pt-3 pb-0 shrink-0">
          <div className="w-10 h-1 rounded-full bg-border" />
        </div>
        <button onClick={onClose} className="absolute top-4 right-4 w-8 h-8 rounded-full bg-secondary flex items-center justify-center z-10">
          <X size={15} className="text-muted-foreground" />
        </button>
        <div className="relative mx-4 mt-3 rounded-2xl overflow-hidden bg-muted shrink-0 aspect-[16/9]">
          <Image src={product.image} alt={product.name} fill className="object-cover object-center" sizes="(max-width: 512px) 100vw, 512px" priority />
          {product.badge && (
            <Badge className="absolute top-3 left-3 bg-primary text-primary-foreground border-0 shadow">{product.badge}</Badge>
          )}
        </div>
        <div className="px-5 pt-4 pb-8">
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-black text-xl leading-tight flex-1">{name}</h2>
            <span className="font-black text-xl text-primary shrink-0 pt-0.5">
              {hasPrice ? `${product.price.toFixed(2)} €` : tr.ask_price}
            </span>
          </div>
          {product.priceNote && <p className="text-xs text-muted-foreground mt-1 font-medium">{product.priceNote}</p>}
          {desc && <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{desc}</p>}
          {badge && <span className="mt-1 inline-block text-[10px] font-bold text-primary uppercase tracking-wide">{badge}</span>}
          {product.ingredients.length > 0 && (
            <div className="mt-4">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">{tr.ingredients}</p>
              <div className="flex flex-wrap gap-1.5">
                {product.ingredients.map((ing) => (
                  <span key={ing} className="px-2.5 py-1 bg-secondary rounded-full text-xs font-medium">{ing}</span>
                ))}
              </div>
            </div>
          )}
          {product.allergens.length > 0 && (
            <div className="mt-3 flex items-start gap-2 bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800/50 rounded-xl p-3">
              <AlertCircle size={14} className="text-orange-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-bold text-orange-700 dark:text-orange-400">{tr.allergens}</p>
                <p className="text-xs text-orange-600 dark:text-orange-500 mt-0.5">{product.allergens.join(", ")}</p>
              </div>
            </div>
          )}
          {hasPrice && (
            <div className="mt-5 flex items-center gap-3">
              <QuantitySelector quantity={qty} onIncrease={() => setQty((q) => q + 1)} onDecrease={() => setQty((q) => Math.max(1, q - 1))} size="md" />
              <button
                onClick={handleAdd}
                className="flex-1 h-14 rounded-2xl bg-primary text-primary-foreground font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-all shadow-lg shadow-primary/25"
              >
                <ShoppingCart size={17} />
                {added ? tr.added : `${tr.add_to_cart} · ${(product.price * qty).toFixed(2)} €`}
              </button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CartBar() {
  const totalItems = useCartStore((s) => s.totalItems());
  const totalPrice = useCartStore((s) => s.totalPrice());
  const lang = useCartStore((s) => s.lang);
  const tr = useT(lang);
  if (totalItems === 0) return null;
  const label = totalItems === 1 ? tr.cart_bar_dishes1 : totalItems < 10 ? tr.cart_bar_dishes234 : tr.cart_bar_dishesN;
  return (
    <div className="fixed bottom-20 left-0 right-0 z-40 px-4 pointer-events-none">
      <div className="max-w-lg mx-auto pointer-events-auto">
        <Link href="/cart">
          <div className="bg-primary text-primary-foreground rounded-2xl h-14 flex items-center px-4 gap-3 shadow-2xl shadow-primary/40 active:scale-[0.98] transition-transform">
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
              <ShoppingCart size={17} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium opacity-80">{totalItems} {label}</p>
            </div>
            <p className="font-black text-base shrink-0">{totalPrice.toFixed(2)} €</p>
            <ChevronRight size={16} className="opacity-70 shrink-0" />
          </div>
        </Link>
      </div>
    </div>
  );
}

function MenuScreen() {
  const searchParams = useSearchParams();
  const { setTableNumber, tableNumber, lang } = useCartStore();
  const tr = useT(lang);
  const [activeCategory, setActiveCategory] = useState<Category>("visi");
  const [query, setQuery] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(0);
  const headerRef = useRef<HTMLElement>(null);
  const catScrollRef = useRef<HTMLDivElement>(null);
  const dragState = useRef({ dragging: false, startX: 0, scrollLeft: 0 });

  useEffect(() => {
    const t = searchParams.get("table") || searchParams.get("t");
    if (t) setTableNumber(t);
    const cat = searchParams.get("cat") as Category | null;
    if (cat && categories.find((c) => c.id === cat)) setActiveCategory(cat);
  }, [searchParams, setTableNumber]);

  useEffect(() => {
    const measure = () => {
      if (headerRef.current) setHeaderHeight(headerRef.current.offsetHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (headerRef.current) ro.observe(headerRef.current);
    return () => ro.disconnect();
  }, []);

  const filtered = query
    ? products.filter(
        (p) =>
          p.name.toLowerCase().includes(query.toLowerCase()) ||
          p.description.toLowerCase().includes(query.toLowerCase())
      )
    : activeCategory === "visi" ? products : products.filter((p) => p.category === activeCategory);

  const openSheet = useCallback((product: Product) => {
    setSelectedProduct(product);
    setSheetOpen(true);
  }, []);

  const handleCategory = (cat: Category, e: React.MouseEvent) => {
    if (dragState.current.dragging) { e.preventDefault(); return; }
    setActiveCategory(cat);
    setQuery("");
    setTimeout(() => {
      const btn = catScrollRef.current?.querySelector(`[data-cat="${cat}"]`) as HTMLElement;
      btn?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    }, 50);
  };

  return (
    <div className="flex flex-col min-h-screen bg-background">

      <header ref={headerRef} className="sticky top-0 z-30 bg-background border-b border-border/40">
        <div className="flex items-center gap-3 px-4 pt-12 pb-2">
          <Link href="/" className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-9 h-9 rounded-xl overflow-hidden bg-white border border-border/30 shrink-0 shadow-sm">
              <Image
                src="https://www.dzukuainiai.lt/wp-content/uploads/2020/11/Ainiai-1-2.png"
                alt="Dzūkų Ainiai"
                width={36}
                height={36}
                className="object-contain w-full h-full"
              />
            </div>
            <div className="min-w-0">
              <p className="font-black text-[15px] leading-tight">Dzūkų Ainiai</p>
              {tableNumber ? (
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="text-[11px] text-muted-foreground">{tr.table_label}</span>
                  <span className="text-[11px] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-full leading-tight">{tableNumber}</span>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">{tr.restaurant_subtitle}</p>
              )}
            </div>
          </Link>
          <LanguageSwitcher />
          <Link href="/ai" className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center shrink-0">
            <Bot size={16} className="text-muted-foreground" />
          </Link>
          <ThemeToggle />
        </div>
        <div className="px-4 pb-3">
          <div className="flex items-center gap-2.5 bg-secondary rounded-xl px-3.5 py-2.5">
            <Search size={15} className="text-muted-foreground shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tr.search_placeholder}
              className="bg-transparent text-sm flex-1 outline-none placeholder:text-muted-foreground"
            />
            {query && (
              <button onClick={() => setQuery("")} className="shrink-0">
                <X size={14} className="text-muted-foreground" />
              </button>
            )}
          </div>
        </div>
      </header>

      {!query && (
        <div
          className="sticky z-20 bg-background border-b border-border/40"
          style={{ top: headerHeight || 130 }}
        >
          <div className="relative">
            <div
              ref={catScrollRef}
              className="no-scrollbar flex gap-2 px-4 py-2.5"
              style={{
                overflowX: "scroll",
                overflowY: "hidden",
                WebkitOverflowScrolling: "touch" as React.CSSProperties["WebkitOverflowScrolling"],
                cursor: dragState.current.dragging ? "grabbing" : "grab",
                userSelect: "none",
              }}
              onMouseDown={(e) => {
                const el = catScrollRef.current;
                if (!el) return;
                dragState.current = { dragging: true, startX: e.pageX - el.offsetLeft, scrollLeft: el.scrollLeft };
                el.style.cursor = "grabbing";
              }}
              onMouseMove={(e) => {
                const el = catScrollRef.current;
                if (!el || !dragState.current.dragging) return;
                e.preventDefault();
                const x = e.pageX - el.offsetLeft;
                el.scrollLeft = dragState.current.scrollLeft - (x - dragState.current.startX);
              }}
              onMouseUp={() => {
                dragState.current.dragging = false;
                if (catScrollRef.current) catScrollRef.current.style.cursor = "grab";
              }}
              onMouseLeave={() => {
                dragState.current.dragging = false;
                if (catScrollRef.current) catScrollRef.current.style.cursor = "grab";
              }}
            >
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  data-cat={cat.id}
                  onClick={(e) => handleCategory(cat.id, e)}
                  className={cn(
                    "flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap transition-all shrink-0 border",
                    activeCategory === cat.id
                      ? "bg-primary text-primary-foreground border-transparent shadow-sm"
                      : "bg-card text-foreground border-border/50"
                  )}
                >
                  <span>{cat.emoji}</span>
                  {categoryLabels[lang][cat.id] ?? cat.label}
                </button>
              ))}
              <div className="w-6 shrink-0" aria-hidden />
            </div>
            <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-background to-transparent pointer-events-none" />
          </div>
        </div>
      )}

      <main className="flex-1 px-4 pt-3 pb-48">
        {query && (
          <p className="text-xs text-muted-foreground mb-3">{filtered.length} {tr.results}: „{query}“</p>
        )}
        {filtered.length === 0 ? (
          <div className="text-center py-24 text-muted-foreground">
            <p className="text-4xl mb-3">🔍</p>
            <p className="font-semibold">{tr.nothing_found}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((product) => (
              <ProductRow key={product.id} product={product} onOpen={() => openSheet(product)} />
            ))}
          </div>
        )}
      </main>

      <ProductSheet product={selectedProduct} open={sheetOpen} onClose={() => setSheetOpen(false)} />
      <CartBar />
    </div>
  );
}

export default function MenuPage() {
  return (
    <Suspense>
      <MenuScreen />
    </Suspense>
  );
}
