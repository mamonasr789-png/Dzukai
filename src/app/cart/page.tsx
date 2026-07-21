"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Trash2, ShoppingBag, ArrowLeft, UtensilsCrossed, Utensils, Zap, Bell, Receipt, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import QuantitySelector from "@/components/QuantitySelector";
import { useCartStore } from "@/lib/store";
import { useT } from "@/lib/i18n";
import { tProduct } from "@/lib/product-translations";
import { createOrder, subscribeOrders, hasActiveOrders, type ServingPreference } from "@/lib/orders";
import { type TableSession, getTrackableSession, addOrderToSession, updateSessionStatus, subscribeSession } from "@/lib/tableSession";
import { createUniqueTask } from "@/lib/waiterTasks";

export default function CartPage() {
  const { items, removeItem, updateQuantity, totalPrice, totalItems, clearCart, tableNumber, lang } =
    useCartStore();
  const tr = useT(lang);
  const router = useRouter();
  const [serving, setServing] = useState<ServingPreference>("together");
  const [submitting, setSubmitting] = useState(false);
  // Whether the customer has an active/trackable order or table session.
  // Deliberately NOT seeded from a render-time read: on the server (and during
  // static prerender of /cart) localStorage is unavailable, so a render-time
  // read is always null and would wrongly commit the "empty cart" screen.
  // The single source of truth is a client-side storage read in the effect
  // below; `sessionChecked` guards against deciding before that read happens.
  const [activeSession, setActiveSession] = useState<TableSession | null>(null);
  const [hasActive, setHasActive] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  const total = totalPrice();
  const count = totalItems();

  useEffect(() => {
    const refresh = () => {
      // Source of truth = active ORDERS (not the cart, not payment). The session
      // is resolved from those orders for the tracking card.
      setHasActive(hasActiveOrders());
      setActiveSession(getTrackableSession());
      setSessionChecked(true);
    };
    refresh();
    // Trackability depends on order delivery state and on session/payment state —
    // watch both so the card appears/disappears at the right time.
    const unsubSession = subscribeSession(refresh);
    const unsubOrders = subscribeOrders(refresh);
    return () => {
      unsubSession();
      unsubOrders();
    };
  }, []);

  if (items.length === 0) {
    // Active order/session? Track it — independent of the empty cart.
    if (activeSession) return <ActiveSessionState session={activeSession} />;
    // Defensive: an active order exists but its session couldn't be resolved.
    // Still never show "empty" — route the customer to live order tracking.
    if (sessionChecked && hasActive) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center">
          <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center mb-5">
            <UtensilsCrossed size={36} className="text-primary" />
          </div>
          <h2 className="font-black text-xl">{tr.active_order_title}</h2>
          <p className="text-muted-foreground text-sm mt-1 mb-6">
            {tr.track_order_sub}
          </p>
          <Link href="/order">
            <Button className="rounded-full px-8 h-12 font-bold">{tr.track_order}</Button>
          </Link>
        </div>
      );
    }
    // Cart is empty but we haven't confirmed there's no active order yet
    // (e.g. right after payment, before the client storage read). Never flash
    // the empty-cart screen on an unconfirmed state — show a neutral loader.
    if (!sessionChecked) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        </div>
      );
    }
    // Confirmed: cart empty AND no active order/session → genuinely empty.
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
    if (submitting || items.length === 0) return; // guard against double-tap
    setSubmitting(true);
    const order = createOrder({
      tableNumber,
      items: items.map(({ product, quantity }) => ({
        productId: product.id,
        name: product.name,
        price: product.price,
        quantity,
      })),
      total,
      language: lang,
      servingPreference: serving,
    });
    const session = addOrderToSession(order.id, tableNumber);
    // Second+ order in the same session — tell the waiter, otherwise the
    // additional order arrives silently.
    if (session.orderIds.length > 1) {
      createUniqueTask(`order:${order.id}:additional_order`, {
        type: "additional_order",
        orderId: order.id,
        tableNumber: session.tableNumber ?? tableNumber,
        items: order.items.map((i) => ({ productId: i.productId, name: i.name, quantity: i.quantity })),
      });
    }
    clearCart();
    router.push(`/order?id=${order.id}`);
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

      {/* Cart items */}
      <div className="flex flex-col gap-2.5 px-4 mt-4">
        {items.map(({ product, quantity }) => {
          const name = tProduct(product.id, lang, "name", product.name);
          return (
          <div key={product.id} className="flex gap-3 bg-card border border-border/40 rounded-2xl p-3 shadow-sm">
            <div className="relative w-20 h-20 rounded-xl overflow-hidden bg-muted shrink-0">
              <Image src={product.image} alt={name} fill className="object-cover" sizes="80px" />
            </div>
            <div className="flex-1 min-w-0 flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-sm leading-snug line-clamp-2 flex-1">{name}</p>
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
          );
        })}
      </div>

      {/* Summary */}
      <div className="px-4 mt-4">
        <div className="bg-card border border-border/40 rounded-2xl p-4 shadow-sm">
          <h3 className="font-bold text-sm mb-3">{tr.summary}</h3>
          <div className="space-y-2 text-sm">
            {items.map(({ product, quantity }) => (
              <div key={product.id} className="flex justify-between text-muted-foreground">
                <span className="truncate mr-2">{tProduct(product.id, lang, "name", product.name)} × {quantity}</span>
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

      {/* Serving preference */}
      <div className="px-4 mt-4">
        <div className="bg-card border border-border/40 rounded-2xl p-4 shadow-sm">
          <h3 className="font-bold text-sm mb-3">{tr.serving_heading}</h3>
          <div className="flex flex-col gap-2">
            <ServingOption
              value="together"
              selected={serving}
              icon={<Utensils size={17} />}
              label={tr.serving_together}
              onSelect={setServing}
            />
            <ServingOption
              value="as_ready"
              selected={serving}
              icon={<Zap size={17} />}
              label={tr.serving_as_ready}
              onSelect={setServing}
            />
          </div>
        </div>
      </div>

      {/* Submit */}
      <div className="px-4 mt-4">
        <Button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full rounded-2xl h-14 text-base font-bold gap-2 shadow-lg shadow-primary/20"
        >
          {submitting ? tr.submitting : `${tr.submit_order} · ${total.toFixed(2)} €`}
        </Button>
        <p className="text-center text-muted-foreground text-xs mt-3">{tr.order_note}</p>
      </div>
    </div>
  );
}

// ── Active session empty state ─────────────────────────────────────────────────

function ActiveSessionState({ session }: { session: TableSession }) {
  const lang = useCartStore((s) => s.lang);
  const tr = useT(lang);
  type ActionFeedback = "waiter_sent" | "bill_sent" | null;
  const [feedback, setFeedback] = useState<ActionFeedback>(null);

  const anchorOrderId = session.orderIds[session.orderIds.length - 1] ?? "unknown";

  const handleCallWaiter = () => {
    createUniqueTask(`session:${session.id}:waiter_called`, {
      type: "waiter_called",
      orderId: anchorOrderId,
      tableNumber: session.tableNumber,
    });
    setFeedback("waiter_sent");
  };

  const handleRequestBill = () => {
    updateSessionStatus("BILL_REQUESTED");
    createUniqueTask(`session:${session.id}:bill_requested`, {
      type: "bill_requested",
      orderId: anchorOrderId,
      tableNumber: session.tableNumber,
    });
    setFeedback("bill_sent");
  };

  const isBillRequested = session.status === "BILL_REQUESTED" || feedback === "bill_sent";
  // Bill already settled — the visit stays trackable until food is delivered,
  // but there's nothing left to pay, so hide the bill/settle actions.
  const isPaid = session.paymentStatus === "PAID";

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center">
      <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center mb-5">
        <UtensilsCrossed size={36} className="text-primary" />
      </div>

      <h2 className="font-black text-xl">{tr.active_order_title}</h2>
      <p className="text-muted-foreground text-sm mt-1 mb-1">
        {tr.active_order_sub}
      </p>

      {isPaid && (
        <div className="w-full max-w-xs bg-emerald-500/10 border border-emerald-500/30 rounded-2xl px-4 py-3 mt-2 mb-2 flex items-center gap-2">
          <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
          <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400 text-left">
            {tr.paid_tracking}
          </p>
        </div>
      )}
      {session.tableNumber && (
        <p className="text-xs text-muted-foreground mb-2">
          {tr.table_no} <span className="font-bold text-foreground">{session.tableNumber}</span>
          {" · "}
          {session.orderIds.length}{" "}
          {session.orderIds.length === 1 ? tr.order1 : tr.order234}
        </p>
      )}

      {isBillRequested && (
        <div className="w-full max-w-xs bg-emerald-500/10 border border-emerald-500/30 rounded-2xl px-4 py-3 mb-4 flex items-center gap-2">
          <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
          <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400 text-left">
            {tr.bill_requested_msg}
          </p>
        </div>
      )}

      {feedback === "waiter_sent" && (
        <div className="w-full max-w-xs bg-blue-500/10 border border-blue-500/30 rounded-2xl px-4 py-3 mb-4 flex items-center gap-2">
          <CheckCircle2 size={16} className="text-blue-500 shrink-0" />
          <p className="text-sm font-medium text-blue-600 dark:text-blue-400 text-left">
            {tr.waiter_called_msg}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2.5 w-full max-w-xs mt-2">
        <Link href="/order" className="w-full">
          <Button className="w-full rounded-2xl h-12 font-bold">
            {tr.track_order}
          </Button>
        </Link>

        <Link href="/menu" className="w-full">
          <Button variant="outline" className="w-full rounded-2xl h-12 font-bold">
            {tr.order_more}
          </Button>
        </Link>

        <button
          onClick={handleCallWaiter}
          disabled={feedback === "waiter_sent"}
          className="flex items-center justify-center gap-2 w-full h-12 rounded-2xl border border-border/60 text-sm font-semibold bg-secondary/60 hover:bg-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Bell size={15} />
          {tr.call_waiter}
        </button>

        {!isPaid && (
          <button
            onClick={handleRequestBill}
            disabled={isBillRequested}
            className="flex items-center justify-center gap-2 w-full h-12 rounded-2xl border border-border/60 text-sm font-semibold bg-secondary/60 hover:bg-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Receipt size={15} />
            {tr.request_bill}
          </button>
        )}
      </div>
    </div>
  );
}

function ServingOption({
  value,
  selected,
  icon,
  label,
  onSelect,
}: {
  value: ServingPreference;
  selected: ServingPreference;
  icon: React.ReactNode;
  label: string;
  onSelect: (v: ServingPreference) => void;
}) {
  const active = value === selected;
  return (
    <button
      onClick={() => onSelect(value)}
      className={`flex items-center gap-3 w-full rounded-xl px-4 py-3 border text-left transition-colors
        ${active
          ? "border-primary/60 bg-primary/8 text-foreground"
          : "border-border/40 bg-transparent text-muted-foreground hover:border-border hover:text-foreground"}`}
    >
      {/* Radio dot */}
      <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors
        ${active ? "border-primary" : "border-muted-foreground/40"}`}>
        {active && <span className="w-2 h-2 rounded-full bg-primary" />}
      </span>
      <span className={`shrink-0 ${active ? "text-primary" : ""}`}>{icon}</span>
      <span className="text-sm font-medium leading-snug">{label}</span>
    </button>
  );
}
