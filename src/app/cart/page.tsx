"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Trash2, ShoppingBag, ArrowLeft, CheckCircle, UtensilsCrossed,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import QuantitySelector from "@/components/QuantitySelector";
import { useCartStore } from "@/lib/store";
import { useT } from "@/lib/i18n";

export default function CartPage() {
  const { items, removeItem, updateQuantity, totalPrice, totalItems, clearCart, tableNumber, lang } =
    useCartStore();
  const tr = useT(lang);
  const [submitted, setSubmitted] = useState(false);
  const total = totalPrice();
  const count = totalItems();

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center">
        <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center mb-5">
          <CheckCircle size={44} className="text-primary" />
        </div>
        <h2 className="font-black text-2xl">{tr.order_success_title}</h2>
        {tableNumber && (
          <p className="text-muted-foreground text-sm mt-2">
            {tr.table_label} Nr. <span className="font-bold text-foreground">{tableNumber}</span>
          </p>
        )}
        <p className="text-muted-foreground text-sm mt-2 mb-8 max-w-xs">{tr.order_success_sub}</p>
        <Link href="/menu">
          <Button className="rounded-full px-8 h-12 font-bold">{tr.back_to_menu}</Button>
        </Link>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center">
        <div className="w-24 h-24 rounded-full bg-secondary flex items-center justify-center mb-5">
          <ShoppingBag size={36} className="text-muted-foreground" />
        </div>
        <h2 className="font-black text-xl">{tr.cart_empty_title}</h2>
        <p className="text-muted-foreground text-sm mt-1 mb-6">{tr.cart_empty_sub}</p>
        <Link href="/menu">
          <Button className="rounded-full px-8 h-12 font-bold">{tr.view_menu}</Button>
        </Link>
      </div>
    );
  }

  const handleSubmit = () => {
    clearCart();
    setSubmitted(true);
  };

  const dishLabel = count === 1 ? tr.dish1 : tr.dish234;

  return (
    <div className="flex flex-col min-h-screen bg-background pb-6">
      <header className="flex items-center gap-3 px-4 pt-14 pb-4 border-b border-border/40">
        <Link href="/menu">
          <button className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center shrink-0">
            <ArrowLeft size={17} className="text-foreground" />
          </button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="font-black text-xl tracking-tight leading-tight">{tr.cart_title}</h1>
          <p className="text-xs text-muted-foreground">
            {count} {dishLabel}
            {tableNumber && ` · ${tr.table_label} ${tableNumber}`}
          </p>
        </div>
        <UtensilsCrossed size={20} className="text-muted-foreground shrink-0" />
      </header>

      <div className="flex flex-col gap-2.5 px-4 mt-4">
        {items.map(({ product, quantity }) => (
          <div key={product.id} className="flex gap-3 bg-card border border-border/40 rounded-2xl p-3 shadow-sm">
            <div className="relative w-20 h-20 rounded-xl overflow-hidden bg-muted shrink-0">
              <Image src={product.image} alt={product.name} fill className="object-cover" sizes="80px" />
            </div>
            <div className="flex-1 min-w-0 flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-sm leading-snug line-clamp-2 flex-1">{product.name}</p>
                <button
                  onClick={() => removeItem(product.id)}
                  className="shrink-0 w-7 h-7 rounded-full bg-destructive/10 flex items-center justify-center text-destructive active:bg-destructive/20 transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <p className="text-primary font-bold text-sm mt-auto">{(product.price * quantity).toFixed(2)} €</p>
              <div className="mt-1.5">
                <QuantitySelector
                  quantity={quantity}
                  onIncrease={() => updateQuantity(product.id, quantity + 1)}
                  onDecrease={() => updateQuantity(product.id, quantity - 1)}
                  min={0}
                  size="sm"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="px-4 mt-4">
        <div className="bg-card border border-border/40 rounded-2xl p-4 shadow-sm">
          <h3 className="font-bold text-sm mb-3">{tr.summary}</h3>
          <div className="space-y-2 text-sm">
            {items.map(({ product, quantity }) => (
              <div key={product.id} className="flex justify-between text-muted-foreground">
                <span className="truncate mr-2">{product.name} × {quantity}</span>
                <span className="shrink-0">{(product.price * quantity).toFixed(2)} €</span>
              </div>
            ))}
            <Separator className="my-2" />
            <div className="flex justify-between font-bold text-base">
              <span>{tr.total}</span>
              <span className="text-primary">{total.toFixed(2)} €</span>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 mt-4">
        <Button onClick={handleSubmit} className="w-full rounded-2xl h-14 text-base font-bold gap-2 shadow-lg shadow-primary/20">
          {tr.submit_order} · {total.toFixed(2)} €
        </Button>
        <p className="text-center text-muted-foreground text-xs mt-3">{tr.order_note}</p>
      </div>
    </div>
  );
}
