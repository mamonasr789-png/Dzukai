"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Clock, ChefHat, Bell, XCircle, UtensilsCrossed, Utensils, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  type Order,
  type OrderStatus,
  getOrder,
  getLatestActiveOrder,
  subscribeOrders,
  STATUS_MESSAGES,
  STATUS_ORDER,
  SERVING_LABELS,
} from "@/lib/orders";
import {
  type TableSession,
  getActiveSession,
  subscribeSession,
} from "@/lib/tableSession";

const STATUS_ICON: Record<OrderStatus, React.ReactNode> = {
  NEW: <Clock size={28} className="text-amber-400" />,
  PREPARING: <ChefHat size={28} className="text-blue-400" />,
  READY: <Bell size={28} className="text-green-400" />,
  COMPLETED: <CheckCircle2 size={28} className="text-green-500" />,
  CANCELLED: <XCircle size={28} className="text-destructive" />,
};

const STATUS_ICON_SM: Record<OrderStatus, React.ReactNode> = {
  NEW: <Clock size={12} className="text-amber-400" />,
  PREPARING: <ChefHat size={12} className="text-blue-400" />,
  READY: <Bell size={12} className="text-green-400" />,
  COMPLETED: <CheckCircle2 size={12} className="text-green-500" />,
  CANCELLED: <XCircle size={12} className="text-destructive" />,
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  NEW: "Naujas",
  PREPARING: "Gaminamas",
  READY: "Paruoštas",
  COMPLETED: "Įvykdytas",
  CANCELLED: "Atšauktas",
};

const STATUS_COLOR: Record<OrderStatus, string> = {
  NEW: "text-amber-400",
  PREPARING: "text-blue-400",
  READY: "text-green-400",
  COMPLETED: "text-green-500",
  CANCELLED: "text-destructive",
};

const ITEM_BADGE: Record<OrderStatus, string> = {
  NEW: "bg-amber-500/10 text-amber-400",
  PREPARING: "bg-blue-500/10 text-blue-400",
  READY: "bg-green-500/10 text-green-400",
  COMPLETED: "bg-secondary text-muted-foreground",
  CANCELLED: "bg-destructive/10 text-destructive",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("lt-LT", { hour: "2-digit", minute: "2-digit" });
}

function OrderContent() {
  const params = useSearchParams();
  const id = params.get("id");
  const [order, setOrder] = useState<Order | null | undefined>(undefined);
  const [session, setSession] = useState<TableSession | null>(null);
  const [sessionOrders, setSessionOrders] = useState<Order[]>([]);

  useEffect(() => {
    const refresh = () => {
      if (id) {
        setOrder(getOrder(id) ?? null);
        return;
      }
      const s = getActiveSession();
      setSession(s);
      if (s && s.orderIds.length > 1) {
        // Multi-order session: load all orders, show session view
        const orders = s.orderIds.map((oid) => getOrder(oid)).filter(Boolean) as Order[];
        setSessionOrders(orders);
        setOrder(null); // signals "show session view"
      } else if (s && s.orderIds.length === 1) {
        setOrder(getOrder(s.orderIds[0]) ?? null);
      } else {
        setOrder(getLatestActiveOrder() ?? null);
      }
    };
    refresh();
    const unsubOrders = subscribeOrders(refresh);
    const unsubSession = subscribeSession(refresh);
    return () => { unsubOrders(); unsubSession(); };
  }, [id]);

  if (order === undefined) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  // Multi-order session view
  if (!id && !order && session && sessionOrders.length > 1) {
    return <SessionView session={session} orders={sessionOrders} />;
  }

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center">
        <UtensilsCrossed size={48} className="text-muted-foreground mb-4" />
        <h2 className="font-black text-xl mb-2">
          {id ? "Užsakymas nerastas" : "Aktyvaus užsakymo nėra."}
        </h2>
        <p className="text-muted-foreground text-sm mb-6">
          {id ? "Patikrinkite nuorodą arba kreipkitės į padavėją." : "Pateikite užsakymą iš meniu."}
        </p>
        <Link href="/menu">
          <Button className="rounded-full px-8 h-12 font-bold">Grįžti į meniu</Button>
        </Link>
      </div>
    );
  }

  const activeIdx = order.status === "CANCELLED"
    ? -1
    : STATUS_ORDER.indexOf(order.status);

  // Check if any items have individual status variation worth showing
  const itemStatuses = order.items.map((i) => i.itemStatus ?? order.status);
  const hasItemVariation = new Set(itemStatuses).size > 1;

  return (
    <div className="flex flex-col min-h-screen bg-background pb-10">
      {/* Header */}
      <div className="px-4 pt-14 pb-6 border-b border-border/40">
        <p className="text-xs text-muted-foreground mb-1">Užsakymo numeris</p>
        <h1 className="font-black text-3xl tracking-tight">#{order.id}</h1>
        {order.tableNumber && (
          <p className="text-sm text-muted-foreground mt-1">
            Stalas Nr. <span className="font-bold text-foreground">{order.tableNumber}</span>
          </p>
        )}
        <p className="text-xs text-muted-foreground mt-1">Užsakyta: {formatTime(order.createdAt)}</p>
      </div>

      {/* Overall status */}
      <div className="mx-4 mt-5 bg-card border border-border/40 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center gap-3 mb-3">
          {STATUS_ICON[order.status]}
          <p className={`font-black text-xl ${STATUS_COLOR[order.status]}`}>
            {STATUS_LABEL[order.status]}
          </p>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {STATUS_MESSAGES[order.status]}
        </p>
      </div>

      {/* Serving preference */}
      {(() => {
        const pref = order.servingPreference ?? "together";
        const info = SERVING_LABELS[pref];
        return (
          <div className="mx-4 mt-3 bg-card border border-border/40 rounded-2xl px-4 py-3 shadow-sm flex items-start gap-3">
            <span className="shrink-0 mt-0.5 text-muted-foreground">
              {pref === "together" ? <Utensils size={16} /> : <Zap size={16} />}
            </span>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Patiekimas</p>
              <p className="text-sm font-semibold text-foreground">{info.short}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{info.long}</p>
            </div>
          </div>
        );
      })()}

      {/* Progress timeline */}
      {order.status !== "CANCELLED" && (
        <div className="mx-4 mt-4 bg-card border border-border/40 rounded-2xl p-4 shadow-sm">
          <div className="flex items-end justify-between gap-1">
            {STATUS_ORDER.map((s, i) => {
              const done = i <= activeIdx;
              const active = i === activeIdx;
              return (
                <div key={s} className="flex-1 flex flex-col items-center gap-1.5">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors
                      ${active ? "bg-primary text-primary-foreground" : done ? "bg-primary/40 text-primary" : "bg-secondary text-muted-foreground"}`}
                  >
                    {i + 1}
                  </div>
                  <p className={`text-[10px] text-center leading-tight ${done ? "text-foreground font-semibold" : "text-muted-foreground"}`}>
                    {STATUS_LABEL[s]}
                  </p>
                </div>
              );
            })}
          </div>
          <div className="mt-3 h-1 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-700"
              style={{ width: `${Math.max(0, (activeIdx + 1) / STATUS_ORDER.length) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Items — show per-item status when they differ */}
      <div className="mx-4 mt-4 bg-card border border-border/40 rounded-2xl p-4 shadow-sm">
        <h3 className="font-bold text-sm mb-3">Užsakyti patiekalai</h3>
        <div className="space-y-2.5">
          {order.items.map((item) => {
            const itemStatus = item.itemStatus ?? order.status;
            return (
              <div key={item.productId}>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="truncate text-muted-foreground">
                      {item.name} × {item.quantity}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-muted-foreground">
                      {(item.price * item.quantity).toFixed(2)} €
                    </span>
                    {hasItemVariation && (
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${ITEM_BADGE[itemStatus]}`}>
                        {STATUS_ICON_SM[itemStatus]}
                        {STATUS_LABEL[itemStatus]}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <Separator className="my-1" />
          <div className="flex justify-between font-bold text-base">
            <span>Iš viso</span>
            <span className="text-primary">{order.total.toFixed(2)} €</span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="px-4 mt-6">
        <Link href="/menu">
          <Button variant="outline" className="w-full rounded-2xl h-12 font-semibold">
            Grįžti į meniu
          </Button>
        </Link>
      </div>
    </div>
  );
}

// ── Session overview (multiple orders) ───────────────────────────────────────

const SESSION_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Aktyvi sesija",
  BILL_REQUESTED: "Sąskaita paprašyta",
  PAID: "Apmokėta",
  CLOSED: "Uždaryta",
};

function SessionView({ session, orders }: { session: TableSession; orders: Order[] }) {
  const isBillRequested = session.status === "BILL_REQUESTED";
  const sessionTotal = orders.reduce((s, o) => s + o.total, 0);

  return (
    <div className="flex flex-col min-h-screen bg-background pb-10">
      {/* Header */}
      <div className="px-4 pt-14 pb-6 border-b border-border/40">
        <p className="text-xs text-muted-foreground mb-1">Aktyvus stalas</p>
        <h1 className="font-black text-3xl tracking-tight">
          {session.tableNumber ? `Stalas Nr. ${session.tableNumber}` : "Sesija"}
        </h1>
        <div className="flex items-center gap-2 mt-1">
          <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold
            ${isBillRequested
              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              : "bg-primary/10 text-primary"}`}>
            {SESSION_STATUS_LABEL[session.status] ?? session.status}
          </span>
          <span className="text-xs text-muted-foreground">
            {orders.length} užsakymai · iš viso {sessionTotal.toFixed(2)} €
          </span>
        </div>
      </div>

      {/* Bill requested banner */}
      {isBillRequested && (
        <div className="mx-4 mt-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl px-4 py-3 flex items-start gap-3">
          <CheckCircle2 size={18} className="text-emerald-500 shrink-0 mt-0.5" />
          <p className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">
            Sąskaita paprašyta. Padavėjas netrukus prieis.
          </p>
        </div>
      )}

      {/* Orders list */}
      <div className="px-4 mt-5 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Jūsų užsakymai</p>
        {[...orders].reverse().map((o) => (
          <Link key={o.id} href={`/order?id=${o.id}`}>
            <div className="bg-card border border-border/40 rounded-2xl p-4 shadow-sm flex items-center gap-3 hover:border-border transition-colors">
              <div className="shrink-0">{STATUS_ICON[o.status]}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-bold text-sm">#{o.id}</p>
                  <span className={`text-xs font-semibold ${STATUS_COLOR[o.status]}`}>
                    {STATUS_LABEL[o.status]}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {formatTime(o.createdAt)} · {o.items.length} patiekal{o.items.length === 1 ? "as" : "ai"}
                </p>
              </div>
              <p className="text-sm font-bold text-primary shrink-0">{o.total.toFixed(2)} €</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Actions */}
      <div className="px-4 mt-6 flex flex-col gap-2.5">
        <Link href="/menu">
          <Button variant="outline" className="w-full rounded-2xl h-12 font-semibold">
            Užsisakyti papildomai
          </Button>
        </Link>
        <Link href="/cart">
          <Button variant="ghost" className="w-full rounded-2xl h-12 font-semibold text-muted-foreground">
            Grįžti
          </Button>
        </Link>
      </div>
    </div>
  );
}

export default function OrderPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    }>
      <OrderContent />
    </Suspense>
  );
}
