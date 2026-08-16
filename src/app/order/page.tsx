"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  CheckCircle2, Clock, ChefHat, Bell, XCircle,
  UtensilsCrossed, Utensils, Zap, Truck, CreditCard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  type Order,
  type OrderStatus,
  getOrder,
  getLatestActiveOrder,
  markOrderPaid,
  allOrdersPaid,
  subscribeOrders,
  STATUS_ORDER,
} from "@/lib/orders";
import {
  type TableSession,
  getTrackableSession,
  subscribeSession,
  updateSessionStatus,
  markSessionPaid,
} from "@/lib/tableSession";
import { createUniqueTask, completeTasksForOrders, subscribeWaiterTasks } from "@/lib/waiterTasks";
import { clearCartStorage, useLanguage, type Lang } from "@/lib/store";
import {
  useT,
  orderStatusLabels,
  orderStatusMessages,
  servingPreferenceLabels,
  sessionStatusLabels,
} from "@/lib/i18n";
import { tProduct } from "@/lib/product-translations";
import { processPayment } from "@/lib/payment";
import {
  splitEqually,
  splitByItems,
  type SplitLine,
  type ItemGuest,
} from "@/lib/splitBill";

// ── Status display maps ───────────────────────────────────────────────────────

const STATUS_ICON: Record<OrderStatus, React.ReactNode> = {
  NEW: <Clock size={28} className="text-amber-400" />,
  PREPARING: <ChefHat size={28} className="text-blue-400" />,
  READY: <Bell size={28} className="text-green-400" />,
  DELIVERING: <Truck size={28} className="text-purple-400" />,
  COMPLETED: <CheckCircle2 size={28} className="text-green-500" />,
  CANCELLED: <XCircle size={28} className="text-destructive" />,
};

const STATUS_ICON_SM: Record<OrderStatus, React.ReactNode> = {
  NEW: <Clock size={12} className="text-amber-400" />,
  PREPARING: <ChefHat size={12} className="text-blue-400" />,
  READY: <Bell size={12} className="text-green-400" />,
  DELIVERING: <Truck size={12} className="text-purple-400" />,
  COMPLETED: <CheckCircle2 size={12} className="text-green-500" />,
  CANCELLED: <XCircle size={12} className="text-destructive" />,
};

const STATUS_COLOR: Record<OrderStatus, string> = {
  NEW: "text-amber-400",
  PREPARING: "text-blue-400",
  READY: "text-green-400",
  DELIVERING: "text-purple-400",
  COMPLETED: "text-green-500",
  CANCELLED: "text-destructive",
};

const ITEM_BADGE: Record<OrderStatus, string> = {
  NEW: "bg-amber-500/10 text-amber-400",
  PREPARING: "bg-blue-500/10 text-blue-400",
  READY: "bg-green-500/10 text-green-400",
  DELIVERING: "bg-purple-500/10 text-purple-400",
  COMPLETED: "bg-secondary text-muted-foreground",
  CANCELLED: "bg-destructive/10 text-destructive",
};

function formatTime(iso: string, lang: Lang): string {
  const locale = lang === "en" ? "en-GB" : lang === "ru" ? "ru-RU" : "lt-LT";
  return new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

// ── Main content ──────────────────────────────────────────────────────────────

function OrderContent() {
  const params = useSearchParams();
  const id = params.get("id");
  const [lang] = useLanguage();
  const copy = useT(lang);

  const [order, setOrder] = useState<Order | null | undefined>(undefined);
  const [session, setSession] = useState<TableSession | null>(null);
  const [sessionOrders, setSessionOrders] = useState<Order[]>([]);
  const [sessionEnded, setSessionEnded] = useState(false);
  const hadSessionRef = useRef(false);

  // Payment state
  const [justPaid, setJustPaid] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const [billCalledFeedback, setBillCalledFeedback] = useState(false);

  // Keep a ref to the latest id so subscription callbacks never capture
  // a stale value from the initial render closure.
  const idRef = useRef(id);
  idRef.current = id;

  // Defined in the render body so it always closes over the latest setState
  // functions (stable) and reads idRef.current at call time (fresh).
  const doRefresh = () => {
    const currentId = idRef.current;

    // Trackable session survives payment — it only disappears once the visit is
    // fully settled AND every order is delivered/cancelled.
    const s = getTrackableSession();
    if (hadSessionRef.current && !s) {
      // No specific order pinned → the whole visit is over: show the thank-you
      // screen. With ?id= we keep rendering that order (it may be COMPLETED).
      if (!currentId) {
        setSessionEnded(true);
        return;
      }
    }
    if (s) hadSessionRef.current = true;
    setSession(s);

    if (currentId) {
      setOrder(getOrder(currentId) ?? null);
      // When the session contains multiple orders (customer ordered again),
      // populate sessionOrders so the action card total covers the full session.
      if (s && s.orderIds.length > 1) {
        const orders = s.orderIds.map((oid) => getOrder(oid)).filter(Boolean) as Order[];
        setSessionOrders(orders);
      } else {
        setSessionOrders([]);
      }
      return;
    }

    if (s && s.orderIds.length > 1) {
      const orders = s.orderIds.map((oid) => getOrder(oid)).filter(Boolean) as Order[];
      setSessionOrders(orders);
      setOrder(null);
    } else if (s && s.orderIds.length === 1) {
      setSessionOrders([]);
      setOrder(getOrder(s.orderIds[0]) ?? null);
    } else {
      setSessionOrders([]);
      setOrder(getLatestActiveOrder() ?? null);
    }
  };

  // refreshRef always points to the latest doRefresh — subscription callbacks
  // call through this ref so they never hold a stale version.
  const refreshRef = useRef(doRefresh);
  refreshRef.current = doRefresh;

  // Re-read data when id changes (session → specific order view and vice-versa).
  // Subscriptions are NOT torn down — only the initial data fetch repeats.
  useEffect(() => {
    doRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Stable subscriptions — registered once on mount, never re-registered.
  // Covers orders + session + waiter-tasks (all three can signal a state change
  // the customer cares about). visibilitychange / focus are fallback catches
  // for the case where a cross-tab storage event was missed while the tab was
  // backgrounded or the browser throttled the listener.
  useEffect(() => {
    const reload = () => refreshRef.current();
    reload(); // initial read on mount

    const unsubOrders = subscribeOrders(reload);
    const unsubSession = subscribeSession(reload);
    const unsubTasks = subscribeWaiterTasks(reload);

    const onVisible = () => { if (document.visibilityState === "visible") reload(); };
    const onFocus = () => reload();

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);

    return () => {
      unsubOrders();
      unsubSession();
      unsubTasks();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Derived payment helpers (safe to compute before early returns)
  const allOrders = sessionOrders.length > 0 ? sessionOrders : (order ? [order] : []);

  // Payment scope: single-order when ?id= is set, full session otherwise.
  // Single-order scope only counts unpaid orders for the remaining total.
  const unpaidOrders = allOrders.filter((o) => !o.isPaid);
  const isSessionScope = !id;
  // Amount the customer will actually pay now.
  const payableOrders = isSessionScope ? unpaidOrders : (order && !order.isPaid ? [order] : []);
  const payableTotal = payableOrders.reduce((s, o) => s + o.total, 0);
  // Split-the-bill is informational only, so line ids just need to be stable
  // for this render — they never persist beyond the open modal.
  const splitLines: SplitLine[] = payableOrders.flatMap((o) =>
    o.items.map((item, index) => ({
      id: `${o.id}:${index}`,
      name: tProduct(item.productId, lang, "name", item.name),
      lineTotal: item.price * item.quantity,
    }))
  );
  // Full session total shown in the session view header.
  const sessionTotal = allOrders.reduce((s, o) => s + o.total, 0);

  const sessionIsOpen =
    !!session &&
    session.status !== "PAID" &&
    session.status !== "CLOSED";

  // Payment card shown when session is open and there's something left to pay.
  const isPaymentEligible = sessionIsOpen && payableOrders.length > 0;
  const isBillRequested = session?.status === "BILL_REQUESTED" || billCalledFeedback;

  // Status used for the payment card hint text (most advanced payable order wins).
  const STATUS_RANK: Record<OrderStatus, number> = {
    NEW: 0, PREPARING: 1, READY: 2, DELIVERING: 3, COMPLETED: 4, CANCELLED: -1,
  };
  const paymentHintStatus: OrderStatus = payableOrders.reduce<OrderStatus>((best, o) => {
    return STATUS_RANK[o.status] > STATUS_RANK[best] ? o.status : best;
  }, "NEW");

  const handleCallWaiter = () => {
    if (!session || billCalledFeedback) return;
    const anchorOrderId = session.orderIds[session.orderIds.length - 1];
    updateSessionStatus("BILL_REQUESTED");
    createUniqueTask(`session:${session.id}:bill_requested`, {
      type: "bill_requested",
      orderId: anchorOrderId,
      tableNumber: session.tableNumber,
    });
    setBillCalledFeedback(true);
  };

  const handleInAppPayment = async () => {
    if (!session || paymentProcessing || payableOrders.length === 0) return;
    setPaymentProcessing(true);
    const result = await processPayment(payableTotal);
    if (result.success) {
      // Record payment only — this is a financial event. Each paid order is
      // flagged isPaid; the session's bill is settled once every order is paid.
      // Crucially we do NOT navigate away: the customer keeps tracking food
      // preparation and delivery on this page until it's all delivered.
      payableOrders.forEach((o) => markOrderPaid(o.id));
      if (allOrdersPaid(session.orderIds)) {
        completeTasksForOrders(session.orderIds); // clears bill tasks, keeps food tasks
        markSessionPaid("APP");
        clearCartStorage();
      }
      setShowPaymentModal(false);
      setJustPaid(true);
      doRefresh();
    }
    setPaymentProcessing(false);
  };

  // Auto-dismiss the "payment successful" banner; tracking stays put.
  useEffect(() => {
    if (!justPaid) return;
    const t = setTimeout(() => setJustPaid(false), 4000);
    return () => clearTimeout(t);
  }, [justPaid]);

  // ── Early returns ─────────────────────────────────────────────────────────

  if (sessionEnded) return <SessionEndedView lang={lang} />;

  if (order === undefined) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!id && !order && session && sessionOrders.length > 1) {
    return (
      <>
        {justPaid && <PaidBanner lang={lang} />}
        <SessionView
          lang={lang}
          session={session}
          orders={sessionOrders}
          isPaymentEligible={isPaymentEligible}
          sessionTotal={sessionTotal}
          paymentHintStatus={paymentHintStatus}
          isBillRequested={!!isBillRequested}
          onPayInApp={() => setShowPaymentModal(true)}
          onCallWaiter={handleCallWaiter}
          onSplitBill={() => setShowSplitModal(true)}
        />
        {showSplitModal && (
          <SplitBillModal
            lang={lang}
            total={payableTotal}
            lines={splitLines}
            onClose={() => setShowSplitModal(false)}
          />
        )}
        {showPaymentModal && (
          <PaymentModal
            lang={lang}
            total={payableTotal}
            processing={paymentProcessing}
            onCancel={() => setShowPaymentModal(false)}
            onConfirm={handleInAppPayment}
          />
        )}
      </>
    );
  }

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center">
        <UtensilsCrossed size={48} className="text-muted-foreground mb-4" />
        <h2 className="font-black text-xl mb-2">
          {id ? copy.order_not_found : copy.no_active_order}
        </h2>
        <p className="text-muted-foreground text-sm mb-6">
          {id ? copy.order_not_found_sub : copy.no_active_order_sub}
        </p>
        <Link href="/menu">
          <Button className="rounded-full px-8 h-12 font-bold">{copy.back_to_menu}</Button>
        </Link>
      </div>
    );
  }

  const activeIdx = order.status === "CANCELLED" ? -1 : STATUS_ORDER.indexOf(order.status);
  const itemStatuses = order.items.map((i) => i.itemStatus ?? order.status);
  const hasItemVariation = new Set(itemStatuses).size > 1;

  return (
    <>
      {justPaid && <PaidBanner lang={lang} />}
      <div className="flex flex-col min-h-screen bg-background pb-10">
        {/* Header */}
        <div className="px-4 pt-14 pb-6 border-b border-border/40">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-xs text-muted-foreground">{copy.order_number}</p>
            {order.isPaid && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 size={11} /> {copy.paid}
              </span>
            )}
          </div>
          <h1 className="font-black text-3xl tracking-tight">#{order.id}</h1>
          {order.tableNumber && (
            <p className="text-sm text-muted-foreground mt-1">
              {copy.table_no} <span className="font-bold text-foreground">{order.tableNumber}</span>
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-1">{copy.ordered_at}: {formatTime(order.createdAt, lang)}</p>
        </div>

        {/* Overall status */}
        <div className="mx-4 mt-5 bg-card border border-border/40 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            {STATUS_ICON[order.status]}
            <p className={`font-black text-xl ${STATUS_COLOR[order.status]}`}>
              {orderStatusLabels[lang][order.status]}
            </p>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {orderStatusMessages[lang][order.status]}
          </p>
        </div>

        {/* Serving preference */}
        {(() => {
          const pref = order.servingPreference ?? "together";
          const info = servingPreferenceLabels[lang][pref];
          return (
            <div className="mx-4 mt-3 bg-card border border-border/40 rounded-2xl px-4 py-3 shadow-sm flex items-start gap-3">
              <span className="shrink-0 mt-0.5 text-muted-foreground">
                {pref === "together" ? <Utensils size={16} /> : <Zap size={16} />}
              </span>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">{copy.serving}</p>
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
                      {orderStatusLabels[lang][s]}
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

        {/* Items */}
        <div className="mx-4 mt-4 bg-card border border-border/40 rounded-2xl p-4 shadow-sm">
          <h3 className="font-bold text-sm mb-3">{copy.ordered_dishes}</h3>
          <div className="space-y-2.5">
            {order.items.map((item) => {
              const itemStatus = item.itemStatus ?? order.status;
              return (
                <div key={item.productId}>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="truncate text-muted-foreground">
                        {tProduct(item.productId, lang, "name", item.name)} × {item.quantity}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-muted-foreground">
                        {(item.price * item.quantity).toFixed(2)} €
                      </span>
                      {hasItemVariation && (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${ITEM_BADGE[itemStatus]}`}>
                          {STATUS_ICON_SM[itemStatus]}
                          {orderStatusLabels[lang][itemStatus]}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            <Separator className="my-1" />
            {order.isPaid ? (
              /* Receipt: bill is settled — neutral amount + explicit paid confirmation,
                 never the primary "amount to pay" accent. */
              <div className="flex items-end justify-between">
                <div className="flex flex-col">
                  <span className="font-bold text-base">{copy.total}</span>
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5">
                    <CheckCircle2 size={13} className="shrink-0" />
                    {copy.paid}{order.paidAt ? ` · ${formatTime(order.paidAt, lang)}` : ""}
                  </span>
                </div>
                <span className="font-bold text-base text-foreground tabular-nums">{order.total.toFixed(2)} €</span>
              </div>
            ) : (
              <div className="flex justify-between font-bold text-base">
                <span>{copy.total}</span>
                <span className="text-primary tabular-nums">{order.total.toFixed(2)} €</span>
              </div>
            )}
          </div>
        </div>

        {/* Action card — visible while order is unpaid */}
        {isPaymentEligible && session && (
          <ActionCard
            lang={lang}
            total={payableTotal}
            orderStatus={order.status}
            isBillRequested={!!isBillRequested}
            onPayInApp={() => setShowPaymentModal(true)}
            onCallWaiter={handleCallWaiter}
            onSplitBill={() => setShowSplitModal(true)}
          />
        )}

        {/* Actions */}
        <div className="px-4 mt-6">
          <Link href="/menu">
            <Button variant="outline" className="w-full rounded-2xl h-12 font-semibold">
              {copy.back_to_menu}
            </Button>
          </Link>
        </div>
      </div>

      {showSplitModal && (
        <SplitBillModal
          lang={lang}
          total={payableTotal}
          lines={splitLines}
          onClose={() => setShowSplitModal(false)}
        />
      )}
      {showPaymentModal && (
        <PaymentModal
          lang={lang}
          total={payableTotal}
          processing={paymentProcessing}
          onCancel={() => setShowPaymentModal(false)}
          onConfirm={handleInAppPayment}
        />
      )}
    </>
  );
}

// ── Payment card ──────────────────────────────────────────────────────────────

function ActionCard({
  lang,
  total,
  orderStatus,
  isBillRequested,
  onPayInApp,
  onCallWaiter,
  onSplitBill,
}: {
  lang: Lang;
  total: number;
  orderStatus: OrderStatus;
  isBillRequested: boolean;
  onPayInApp: () => void;
  onCallWaiter: () => void;
  onSplitBill: () => void;
}) {
  const copy = useT(lang);
  const hint =
    orderStatus === "COMPLETED"
      ? copy.order_hint_completed
      : orderStatus === "READY" || orderStatus === "DELIVERING"
        ? copy.order_hint_arriving
        : copy.order_hint_default;

  return (
    <div className="mx-4 mt-4 bg-card border border-primary/30 rounded-2xl p-5 shadow-sm">
      <h3 className="font-black text-base mb-1">{copy.order_action_title}</h3>
      <p className="text-xs text-muted-foreground mb-1">{hint}</p>
      <p className="text-xs text-muted-foreground mb-4">
        {copy.total}: <span className="font-bold text-foreground">{total.toFixed(2)} €</span>
      </p>
      <div className="flex flex-col gap-2.5">
        <Link href="/menu" className="w-full">
          <button className="flex items-center justify-center gap-2 w-full h-12 rounded-2xl bg-primary text-primary-foreground font-bold text-sm hover:bg-primary/90 transition-colors">
            🍽️ {copy.order_more}
          </button>
        </Link>
        <button
          onClick={onPayInApp}
          className="flex items-center justify-center gap-2 w-full h-12 rounded-2xl border border-border/60 text-sm font-semibold bg-secondary/60 hover:bg-secondary transition-colors"
        >
          💳 {copy.pay_in_app}
        </button>
        <button
          onClick={onSplitBill}
          className="flex items-center justify-center gap-2 w-full h-12 rounded-2xl border border-border/60 text-sm font-semibold bg-secondary/60 hover:bg-secondary transition-colors"
        >
          🧾 {copy.split_bill}
        </button>
        {isBillRequested ? (
          <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-3">
            <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
            <p className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">
              {copy.bill_requested_msg}
            </p>
          </div>
        ) : (
          <button
            onClick={onCallWaiter}
            className="flex items-center justify-center gap-2 w-full h-12 rounded-2xl border border-border/60 text-sm font-semibold bg-secondary/60 hover:bg-secondary transition-colors"
          >
            👨‍💼 {copy.request_bill}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Payment modal ─────────────────────────────────────────────────────────────

function PaymentModal({
  lang,
  total,
  processing,
  onCancel,
  onConfirm,
}: {
  lang: Lang;
  total: number;
  processing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const copy = useT(lang);
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm shadow-xl">
        <div className="flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 mx-auto mb-4">
          <CreditCard size={26} className="text-primary" />
        </div>
        <h2 className="font-black text-xl text-center mb-1">
          {copy.payment_question} {total.toFixed(2)} €?
        </h2>
        <p className="text-muted-foreground text-sm text-center mb-6">
          {copy.payment_secure}
        </p>
        <div className="flex flex-col gap-2.5">
          <button
            onClick={onConfirm}
            disabled={processing}
            className="w-full h-12 rounded-2xl bg-primary text-primary-foreground font-bold text-sm hover:bg-primary/90 transition-colors disabled:opacity-70 flex items-center justify-center gap-2"
          >
            {processing ? (
              <>
                <div className="w-4 h-4 rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground animate-spin" />
                {copy.processing}
              </>
            ) : (
              copy.pay
            )}
          </button>
          <button
            onClick={onCancel}
            disabled={processing}
            className="w-full h-12 rounded-2xl border border-border/60 text-sm font-semibold bg-secondary/60 hover:bg-secondary transition-colors disabled:opacity-50"
          >
            {copy.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Split-the-bill modal ──────────────────────────────────────────────────────
// Informational only: no order or payment data changes. One device computes
// shares so the table can settle among themselves or pay together.

function SplitBillModal({
  lang,
  total,
  lines,
  onClose,
}: {
  lang: Lang;
  total: number;
  lines: SplitLine[];
  onClose: () => void;
}) {
  const copy = useT(lang);
  const [tab, setTab] = useState<"equal" | "items">("equal");
  const [guestCount, setGuestCount] = useState(2);
  const guestCounterRef = useRef(2);
  const [itemGuests, setItemGuests] = useState<ItemGuest[]>([
    { id: "g1", name: `${copy.split_guest} 1` },
    { id: "g2", name: `${copy.split_guest} 2` },
  ]);
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});

  const equalShares = splitEqually(total, guestCount);
  const { shares: itemShares, unassigned } = splitByItems(
    lines,
    itemGuests,
    assignments
  );

  const addGuest = () => {
    guestCounterRef.current += 1;
    const id = `g${guestCounterRef.current}`;
    setItemGuests((prev) => [
      ...prev,
      { id, name: `${copy.split_guest} ${guestCounterRef.current}` },
    ]);
  };
  const removeGuest = (id: string) => {
    setItemGuests((prev) => prev.filter((g) => g.id !== id));
    setAssignments((prev) => {
      const next: Record<string, string[]> = {};
      for (const [lineId, guestIds] of Object.entries(prev)) {
        next[lineId] = guestIds.filter((g) => g !== id);
      }
      return next;
    });
  };
  const toggleAssignment = (lineId: string, guestId: string) => {
    setAssignments((prev) => {
      const current = prev[lineId] ?? [];
      const nextForLine = current.includes(guestId)
        ? current.filter((g) => g !== guestId)
        : [...current, guestId];
      return { ...prev, [lineId]: nextForLine };
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 px-4">
      <div className="bg-card border border-border rounded-t-3xl sm:rounded-2xl p-6 w-full max-w-sm shadow-xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-black text-lg">{copy.split_bill_title}</h2>
          <button
            onClick={onClose}
            aria-label={copy.split_close}
            className="text-muted-foreground hover:text-foreground text-xl leading-none px-1"
          >
            ×
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          {copy.split_informational_hint}
        </p>

        <div className="flex gap-2 mb-4 bg-secondary/60 rounded-2xl p-1">
          <button
            onClick={() => setTab("equal")}
            className={`flex-1 h-9 rounded-xl text-xs font-bold transition-colors ${
              tab === "equal" ? "bg-card text-primary shadow-sm" : "text-muted-foreground"
            }`}
          >
            {copy.split_equal_tab}
          </button>
          <button
            onClick={() => setTab("items")}
            className={`flex-1 h-9 rounded-xl text-xs font-bold transition-colors ${
              tab === "items" ? "bg-card text-primary shadow-sm" : "text-muted-foreground"
            }`}
          >
            {copy.split_items_tab}
          </button>
        </div>

        <div className="overflow-y-auto flex-1 -mx-1 px-1">
          {tab === "equal" ? (
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-semibold">{copy.split_guest_count}</span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setGuestCount((n) => Math.max(1, n - 1))}
                    aria-label="-"
                    className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center font-bold"
                  >
                    −
                  </button>
                  <span className="w-6 text-center font-black tabular-nums">{guestCount}</span>
                  <button
                    onClick={() => setGuestCount((n) => Math.min(20, n + 1))}
                    aria-label="+"
                    className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center font-bold"
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                {equalShares.map((share) => (
                  <div
                    key={share.guestIndex}
                    className="flex items-center justify-between bg-secondary/40 rounded-xl px-3 py-2.5"
                  >
                    <span className="text-sm font-medium">
                      {copy.split_guest} {share.guestIndex + 1}
                    </span>
                    <span className="font-bold tabular-nums">{share.amount.toFixed(2)} €</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <p className="text-xs text-muted-foreground mb-3">{copy.split_tap_hint}</p>
              <div className="flex flex-wrap gap-2 mb-4">
                {itemGuests.map((guest) => (
                  <span
                    key={guest.id}
                    className="inline-flex items-center gap-1.5 bg-primary/10 text-primary rounded-full pl-3 pr-1.5 py-1 text-xs font-bold"
                  >
                    {guest.name}
                    {itemGuests.length > 1 && (
                      <button
                        onClick={() => removeGuest(guest.id)}
                        aria-label={copy.split_remove_guest}
                        className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center leading-none"
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
                <button
                  onClick={addGuest}
                  className="inline-flex items-center gap-1 bg-secondary rounded-full px-3 py-1 text-xs font-bold text-muted-foreground hover:text-foreground"
                >
                  + {copy.split_add_guest}
                </button>
              </div>

              <div className="space-y-3">
                {lines.map((line) => (
                  <div key={line.id} className="bg-secondary/40 rounded-xl px-3 py-2.5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">{line.name}</span>
                      <span className="text-xs font-bold text-muted-foreground tabular-nums">
                        {line.lineTotal.toFixed(2)} €
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {itemGuests.map((guest) => {
                        const active = (assignments[line.id] ?? []).includes(guest.id);
                        return (
                          <button
                            key={guest.id}
                            onClick={() => toggleAssignment(line.id, guest.id)}
                            className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors ${
                              active
                                ? "bg-primary text-primary-foreground"
                                : "bg-card border border-border/60 text-muted-foreground"
                            }`}
                          >
                            {guest.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 space-y-2">
                {itemShares.map((share) => (
                  <div
                    key={share.guestId}
                    className="flex items-center justify-between bg-secondary/40 rounded-xl px-3 py-2.5"
                  >
                    <span className="text-sm font-medium">{share.guestName}</span>
                    <span className="font-bold tabular-nums">{share.amount.toFixed(2)} €</span>
                  </div>
                ))}
                {unassigned > 0 && (
                  <div className="flex items-center justify-between bg-amber-500/10 rounded-xl px-3 py-2.5">
                    <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
                      {copy.split_unassigned}
                    </span>
                    <span className="font-bold tabular-nums text-amber-700 dark:text-amber-400">
                      {unassigned.toFixed(2)} €
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <button
          onClick={onClose}
          className="mt-5 w-full h-12 rounded-2xl border border-border/60 text-sm font-semibold bg-secondary/60 hover:bg-secondary transition-colors"
        >
          {copy.split_close}
        </button>
      </div>
    </div>
  );
}

// ── Payment success banner ────────────────────────────────────────────────────
// Non-blocking: payment is confirmed but the order tracking stays on screen so
// the customer can keep following food preparation and delivery.

function PaidBanner({ lang }: { lang: Lang }) {
  const copy = useT(lang);
  return (
    <div className="fixed top-4 inset-x-0 z-50 flex justify-center px-4 pointer-events-none">
      <div className="flex items-center gap-2 bg-emerald-500 text-white rounded-full px-4 py-2.5 shadow-lg shadow-emerald-500/30">
        <CheckCircle2 size={18} className="shrink-0" />
        <p className="text-sm font-bold">{copy.payment_success_tracking}</p>
      </div>
    </div>
  );
}

// ── Session overview (multiple orders) ───────────────────────────────────────

function SessionView({
  lang,
  session,
  orders,
  isPaymentEligible,
  sessionTotal,
  paymentHintStatus,
  isBillRequested,
  onPayInApp,
  onCallWaiter,
  onSplitBill,
}: {
  lang: Lang;
  session: TableSession;
  orders: Order[];
  isPaymentEligible: boolean;
  sessionTotal: number;
  paymentHintStatus: OrderStatus;
  isBillRequested: boolean;
  onPayInApp: () => void;
  onCallWaiter: () => void;
  onSplitBill: () => void;
}) {
  const copy = useT(lang);
  // Remaining amount: only unpaid orders. Paid orders are kept in history.
  const unpaidTotal = orders.filter((o) => !o.isPaid).reduce((s, o) => s + o.total, 0);
  // Nothing left to track once food is delivered and paid, or the order was
  // cancelled — keeping those in the list is just clutter on a repeat visit.
  const visibleOrders = orders.filter(
    (o) => o.status !== "CANCELLED" && !(o.status === "COMPLETED" && o.isPaid)
  );
  const isPaid = session.paymentStatus === "PAID";
  // Paid and bill-requested are both "success"; only a live open session is accent.
  const successChip = isPaid || isBillRequested;

  return (
    <div className="flex flex-col min-h-screen bg-background pb-10">
      {/* Header */}
      <div className="px-4 pt-14 pb-6 border-b border-border/40">
        <p className="text-xs text-muted-foreground mb-1">{copy.active_table}</p>
        <h1 className="font-black text-3xl tracking-tight">
          {session.tableNumber ? `${copy.table_no} ${session.tableNumber}` : copy.session}
        </h1>
        <div className="flex items-center gap-2 mt-1">
          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold
            ${successChip
              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              : "bg-primary/10 text-primary"}`}>
            {isPaid && <CheckCircle2 size={12} className="shrink-0" />}
            {sessionStatusLabels[lang][session.status] ?? session.status}
          </span>
          <span className="text-xs text-muted-foreground">
            {orders.length} {orders.length === 1 ? copy.order1 : copy.order234} · {isPaid ? copy.paid_lower : copy.total.toLowerCase()} {sessionTotal.toFixed(2)} €
          </span>
        </div>
      </div>

      {/* Action card — visible while there are unpaid orders */}
      {isPaymentEligible && (
        <ActionCard
          lang={lang}
          total={unpaidTotal}
          orderStatus={paymentHintStatus}
          isBillRequested={isBillRequested}
          onPayInApp={onPayInApp}
          onCallWaiter={onCallWaiter}
          onSplitBill={onSplitBill}
        />
      )}

      {/* Orders list — delivered-and-paid or cancelled orders are hidden, not
          just here for history; the customer has nothing left to track. */}
      {visibleOrders.length > 0 && (
      <div className="px-4 mt-5 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{copy.your_orders}</p>
        {[...visibleOrders].reverse().map((o) => (
          <Link key={o.id} href={`/order?id=${o.id}`}>
            <div className="bg-card border border-border/40 rounded-2xl p-4 shadow-sm flex items-center gap-3 hover:border-border transition-colors">
              <div className="shrink-0">{STATUS_ICON[o.status]}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-bold text-sm">#{o.id}</p>
                  {/* Food status is always shown; a paid order additionally gets a paid chip. */}
                  <span className={`text-xs font-semibold ${STATUS_COLOR[o.status]}`}>
                    {orderStatusLabels[lang][o.status]}
                  </span>
                  {o.isPaid && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 size={10} className="shrink-0" /> {copy.paid}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {formatTime(o.createdAt, lang)} · {o.items.length} {o.items.length === 1 ? copy.dish1 : copy.dish234}
                </p>
              </div>
              {/* Paid amount stays legible (receipt), never struck through (voided). */}
              <p className={`text-sm font-bold shrink-0 tabular-nums ${o.isPaid ? "text-foreground" : "text-primary"}`}>
                {o.total.toFixed(2)} €
              </p>
            </div>
          </Link>
        ))}
      </div>
      )}

      {/* Actions */}
      <div className="px-4 mt-6 flex flex-col gap-2.5">
        <Link href="/menu">
          <Button variant="outline" className="w-full rounded-2xl h-12 font-semibold">
            {copy.order_more}
          </Button>
        </Link>
        <Link href="/cart">
          <Button variant="ghost" className="w-full rounded-2xl h-12 font-semibold text-muted-foreground">
            {copy.back}
          </Button>
        </Link>
      </div>
    </div>
  );
}

// ── Session ended (waiter paid) ───────────────────────────────────────────────

function SessionEndedView({ lang }: { lang: Lang }) {
  const copy = useT(lang);
  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center">
      <div className="w-20 h-20 rounded-full bg-emerald-500/10 flex items-center justify-center mb-5">
        <CheckCircle2 size={40} className="text-emerald-500" />
      </div>
      <h2 className="font-black text-2xl mb-2">{copy.session_ended_title}</h2>
      <p className="text-muted-foreground text-sm mb-8">
        {copy.session_ended_sub}
      </p>
      <Link href="/menu">
        <Button className="rounded-full px-8 h-12 font-bold">{copy.back_to_menu}</Button>
      </Link>
    </div>
  );
}

// ── Page root ─────────────────────────────────────────────────────────────────

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
