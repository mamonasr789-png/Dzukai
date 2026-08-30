"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowLeft, ShoppingCart, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import QuantitySelector from "@/components/QuantitySelector";
import { useCartStore } from "@/lib/store";
import { useLiveMenu } from "@/lib/hooks/useLiveMenu";
import { useT } from "@/lib/i18n";

export default function ProductPage() {
  const { id } = useParams();
  const router = useRouter();
  const addItem = useCartStore((s) => s.addItem);
  const lang = useCartStore((s) => s.lang);
  const tr = useT(lang);
  const { products } = useLiveMenu();
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  const product = products.find((p) => p.id === id);

  if (!product) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-3xl">🍽️</p>
        <p className="font-semibold text-muted-foreground">Patiekalas nerastas</p>
        <Button onClick={() => router.back()} variant="outline" className="rounded-full">
          Grįžti
        </Button>
      </div>
    );
  }

  const hasPrice = product.price > 0;

  const handleAdd = () => {
    addItem(product, quantity);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  return (
    <div className="flex flex-col min-h-screen">
      <div className="relative h-56 w-full">
        <Image src={product.image} alt={product.name} fill className="object-cover" priority />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/10 to-transparent" />
        <button
          onClick={() => router.back()}
          className="absolute top-12 left-4 w-10 h-10 rounded-full bg-background/80 backdrop-blur-md flex items-center justify-center shadow-md border border-border/30"
        >
          <ArrowLeft size={18} />
        </button>
        {product.badge && (
          <Badge className="absolute top-12 right-4 bg-primary text-primary-foreground border-0 shadow">
            {product.badge}
          </Badge>
        )}
      </div>

      <div className="flex-1 px-5 -mt-8 relative z-10 bg-background rounded-t-3xl pt-6 pb-10">
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-black text-2xl leading-tight flex-1">{product.name}</h1>
          <span className="font-black text-2xl text-primary shrink-0">
            {hasPrice ? `${product.price.toFixed(2)} €` : "Teirautis"}
          </span>
        </div>

        {product.priceNote && (
          <p className="text-xs text-muted-foreground mt-1 font-medium">{product.priceNote}</p>
        )}

        {product.description && (
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{product.description}</p>
        )}

        {product.ingredients.length > 0 && (
          <div className="mt-5">
            <h2 className="font-bold text-[10px] mb-2.5 uppercase tracking-widest text-muted-foreground">
              Sudestis
            </h2>
            <div className="flex flex-wrap gap-2">
              {product.ingredients.map((ing) => (
                <span key={ing} className="px-3 py-1.5 bg-secondary rounded-full text-xs font-medium">
                  {ing}
                </span>
              ))}
            </div>
          </div>
        )}

        {product.allergens.length > 0 && (
          <div className="mt-4 flex items-start gap-2 bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800/50 rounded-2xl p-3">
            <AlertCircle size={15} className="text-orange-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-orange-700 dark:text-orange-400">Alergenai</p>
              <p className="text-xs text-orange-600 dark:text-orange-500 mt-0.5">
                {product.allergens.join(", ")}
              </p>
            </div>
          </div>
        )}

        {product.soldOut && (
          <p className="mt-5 text-sm font-bold text-red-600">{tr.sold_out}</p>
        )}
        {hasPrice && !product.soldOut && (
          <div className="mt-6 flex items-center justify-between gap-3">
            <QuantitySelector
              quantity={quantity}
              onIncrease={() => setQuantity((q) => q + 1)}
              onDecrease={() => setQuantity((q) => Math.max(1, q - 1))}
            />
            <Button onClick={handleAdd} className="rounded-full gap-2 px-6 font-semibold flex-1" size="lg">
              <ShoppingCart size={17} />
              {added ? "Prideta! v" : `I krepšeli · ${(product.price * quantity).toFixed(2)} €`}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}