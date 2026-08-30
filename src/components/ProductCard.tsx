"use client";

import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { Product } from "@/lib/data";
import { useCartStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { productTranslations, badgeTranslations } from "@/lib/product-translations";
import { useT } from "@/lib/i18n";

function tProduct(id: string, lang: string, field: "name" | "description", fallback: string) {
  if (lang === "lt") return fallback;
  return productTranslations[lang as "en" | "ru"]?.[id]?.[field] ?? fallback;
}

interface Props {
  product: Product;
  compact?: boolean;
}

export default function ProductCard({ product, compact = false }: Props) {
  const addItem = useCartStore((s) => s.addItem);
  const lang = useCartStore((s) => s.lang);
  const tr = useT(lang);
  const name = tProduct(product.id, lang, "name", product.name);
  const desc = tProduct(product.id, lang, "description", product.description);
  const badge = product.badge ? (badgeTranslations[lang as "en" | "ru"]?.[product.badge] ?? product.badge) : null;

  return (
    <div
      className={cn(
        "group relative bg-card rounded-3xl overflow-hidden border border-border/50 shadow-sm hover:shadow-md transition-all duration-300",
        compact ? "flex gap-3 p-3" : "flex flex-col"
      )}
    >
      <Link href={`/product/${product.id}`} className={cn(compact ? "shrink-0" : "block")}>
        <div
          className={cn(
            "relative overflow-hidden bg-muted",
            compact ? "w-24 h-24 rounded-2xl" : "aspect-[4/3] w-full"
          )}
        >
          <Image
            src={product.image}
            alt={product.name}
            fill
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            sizes={compact ? "96px" : "(max-width: 768px) 50vw, 33vw"}
          />
          {badge && !compact && (
            <Badge className="absolute top-2 left-2 bg-primary text-primary-foreground text-[10px] font-semibold border-0 shadow">
              {badge}
            </Badge>
          )}
        </div>
      </Link>

      <div className={cn("flex flex-col", compact ? "flex-1 min-w-0 py-1" : "p-3 gap-1")}>
        <Link href={`/product/${product.id}`}>
          <h3
            className={cn(
              "font-semibold text-foreground leading-tight hover:text-primary transition-colors",
              compact ? "text-sm" : "text-base"
            )}
          >
            {name}
          </h3>
        </Link>
        <p className={cn("text-muted-foreground line-clamp-2 leading-snug", compact ? "text-xs" : "text-xs mt-0.5")}>
          {desc}
        </p>
        <div className={cn("flex items-center justify-between", compact ? "mt-auto pt-2" : "mt-2")}>
          <span className={cn("font-bold text-foreground", compact ? "text-sm" : "text-base")}>
            {product.soldOut
              ? tr.sold_out
              : product.price > 0
                ? `${product.price.toFixed(2)} €`
                : tr.ask_price}
          </span>
          {product.price > 0 && !product.soldOut && (
          <button
            onClick={(e) => {
              e.preventDefault();
              addItem(product);
            }}
            className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 active:scale-95 transition-all shadow-sm"
            aria-label="Pridėti į krepšelį"
          >
            <Plus size={16} strokeWidth={2.5} />
          </button>
          )}
        </div>
      </div>
    </div>
  );
}
