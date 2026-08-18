"use client";

import { useEffect, useRef, useState } from "react";
import {
  type Order,
  type OrderItem,
  type OrderStatus,
  type ServingPreference,
  type StaffStamp,
} from "@/lib/orderTypes";
import { useStaffOrders } from "@/lib/hooks/useStaffOrders";
import {
  type StaffLang,
  type StaffDict,
  useStaffLang,
  staffT,
  ORDER_STATUS_LABEL,
  SERVING_SHORT,
  minutesAgoLabel,
} from "@/lib/staff-i18n";
import StaffLangSwitch from "@/components/StaffLangSwitch";
import StaffLogoutButton from "@/components/StaffLogoutButton";
import { tProduct } from "@/lib/product-translations";
import { useCurrentStaff } from "@/lib/useCurrentStaff";
import {
  Clock, ChefHat, Bell, CheckCircle2, XCircle,
  UtensilsCrossed, Sun, Moon, Utensils, Zap, ChevronDown, ChevronUp,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";

// ── Kitchen-specific theme ────────────────────────────────────────────────────

const THEME_KEY = "dzukai-kitchen-theme";
type KitchenTheme = "light" | "dark";

function useKitchenTheme(): [KitchenTheme, () => void] {
  const [theme, setTheme] = useState<KitchenTheme>("light");
  const prevHtmlClass = useRef<string>("");

  useEffect(() => {
    const saved = (localStorage.getItem(THEME_KEY) ?? "light") as KitchenTheme;
    setTheme(saved);
    prevHtmlClass.current = document.documentElement.className;
    applyTheme(saved);
    return () => { document.documentElement.className = prevHtmlClass.current; };
  }, []);

  const toggle = () => {
    setTheme((prev) => {
      const next: KitchenTheme = prev === "light" ? "dark" : "light";
      localStorage.setItem(THEME_KEY, next);
      applyTheme(next);
      return next;
    });
  };

  return [theme, toggle];
}

function applyTheme(theme: KitchenTheme): void {
  if (theme === "dark") document.documentElement.classList.add("dark");
  else document.documentElement.classList.remove("dark");
}

// ── Status style maps (colors only — labels come from staff-i18n) ─────────────

const STATUS_BADGE_LIGHT: Record<OrderStatus, string> = {
  PENDING_CONFIRMATION: "bg-slate-100 text-slate-600 border border-slate-300",
  NEW: "bg-amber-100 text-amber-700 border border-amber-300",
  PREPARING: "bg-blue-100 text-blue-700 border border-blue-300",
  READY: "bg-green-100 text-green-700 border border-green-300",
  DELIVERING: "bg-purple-100 text-purple-700 border border-purple-300",
  COMPLETED: "bg-gray-100 text-gray-500 border border-gray-200",
  CANCELLED: "bg-red-100 text-red-600 border border-red-200",
};

const STATUS_BADGE_DARK: Record<OrderStatus, string> = {
  PENDING_CONFIRMATION: "bg-slate-500/20 text-slate-300 border border-slate-500/30",
  NEW: "bg-amber-500/20 text-amber-300 border border-amber-500/30",
  PREPARING: "bg-blue-500/20 text-blue-300 border border-blue-500/30",
  READY: "bg-green-500/20 text-green-300 border border-green-500/30",
  DELIVERING: "bg-purple-500/20 text-purple-300 border border-purple-500/30",
  COMPLETED: "bg-secondary text-muted-foreground border border-border/30",
  CANCELLED: "bg-destructive/20 text-destructive border border-destructive/30",
};

const CARD_BORDER_LIGHT: Record<OrderStatus, string> = {
  PENDING_CONFIRMATION: "border-slate-300 bg-slate-50",
  NEW: "border-amber-300 bg-amber-50",
  PREPARING: "border-blue-300 bg-blue-50",
  READY: "border-green-400 bg-green-50",
  DELIVERING: "border-purple-300 bg-purple-50",
  COMPLETED: "border-gray-200 bg-gray-50",
  CANCELLED: "border-red-200 bg-red-50",
};

const CARD_BORDER_DARK: Record<OrderStatus, string> = {
  PENDING_CONFIRMATION: "border-slate-500/30 bg-slate-500/5",
  NEW: "border-amber-500/40 bg-amber-500/5",
  PREPARING: "border-blue-500/40 bg-blue-500/5",
  READY: "border-green-500/40 bg-green-500/10",
  DELIVERING: "border-purple-500/30 bg-purple-500/5",
  COMPLETED: "border-border/30 bg-card/30",
  CANCELLED: "border-destructive/30 bg-destructive/5",
};

const STATUS_ICON_SM: Record<OrderStatus, React.ReactNode> = {
  PENDING_CONFIRMATION: <Clock size={13} />,
  NEW: <Clock size={13} />,
  PREPARING: <ChefHat size={13} />,
  READY: <Bell size={13} />,
  DELIVERING: <UtensilsCrossed size={13} />,
  COMPLETED: <CheckCircle2 size={13} />,
  CANCELLED: <XCircle size={13} />,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// Kitchen is responsible for NEW → PREPARING → READY only.
// DELIVERING and beyond are waiter territory.
const ACTIVE_STATUSES: OrderStatus[] = ["NEW", "PREPARING", "READY"];
const DONE_STATUSES: OrderStatus[] = ["DELIVERING", "COMPLETED", "CANCELLED"];

function isActive(o: Order): boolean {
  // An order is active if it has its own active status OR has any active item
  if (ACTIVE_STATUSES.includes(o.status)) return true;
  return o.items.some((i) => ACTIVE_STATUSES.includes(i.itemStatus ?? "NEW"));
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("lt-LT", { hour: "2-digit", minute: "2-digit" });
}

type Tab = "active" | "history";

// ── Page ──────────────────────────────────────────────────────────────────────

export default function KitchenPage() {
  const { orders, updateItemStatus } = useStaffOrders();
  const [tab, setTab] = useState<Tab>("active");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [theme, toggleTheme] = useKitchenTheme();
  const [lang, setLang] = useStaffLang();
  const t = staffT(lang);
  const staff = useCurrentStaff();

  const activeOrders = orders
    .filter(isActive)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const historyOrders = orders
    .filter((o) => !isActive(o) && DONE_STATUSES.includes(o.status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const tabBase = "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors";
  const tabOn = theme === "dark" ? "bg-background text-foreground shadow-sm" : "bg-white text-gray-900 shadow-sm";
  const tabOff = "text-muted-foreground";
  const wrapBg = theme === "dark" ? "bg-secondary" : "bg-gray-100";

  const toggleExpand = (id: string) =>
    setExpandedId((prev) => (prev === id ? null : id));

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border/40 px-4 py-3">
        <div className="flex items-center justify-between max-w-6xl mx-auto gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <UtensilsCrossed size={20} className="text-primary shrink-0" />
            <h1 className="font-black text-lg tracking-tight">{t.kitchenTitle}</h1>
            {activeOrders.length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-primary/20 text-primary text-xs font-bold">
                {activeOrders.length}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className={`flex gap-1 rounded-xl p-1 ${wrapBg}`}>
              <button onClick={() => setTab("active")} className={`${tabBase} ${tab === "active" ? tabOn : tabOff}`}>
                {t.kitchenTabActive}
              </button>
              <button onClick={() => setTab("history")} className={`${tabBase} ${tab === "history" ? tabOn : tabOff}`}>
                {t.kitchenTabHistory}
                {historyOrders.length > 0 && (
                  <span className="ml-1.5 px-1.5 py-0 rounded-full bg-muted-foreground/20 text-muted-foreground text-[10px] font-bold">
                    {historyOrders.length}
                  </span>
                )}
              </button>
            </div>

            <StaffLangSwitch lang={lang} onChange={setLang} variant="panel" />
            <StaffLogoutButton lang={lang} />

            <button
              onClick={toggleTheme}
              aria-label={theme === "dark" ? t.themeLight : t.themeDark}
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors
                ${theme === "dark" ? "bg-secondary text-muted-foreground hover:text-foreground" : "bg-gray-100 text-gray-500 hover:text-gray-800"}`}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 max-w-6xl mx-auto">
        {tab === "active" ? (
          activeOrders.length === 0 ? (
            <EmptyState message={t.kitchenEmptyActive} hint={t.kitchenEmptyHint} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {activeOrders.map((order) => (
                <OrderCard key={order.id} order={order} theme={theme} lang={lang} t={t} staff={staff} updateItemStatus={updateItemStatus} />
              ))}
            </div>
          )
        ) : (
          historyOrders.length === 0 ? (
            <EmptyState message={t.kitchenEmptyHistory} hint={t.kitchenEmptyHint} />
          ) : (
            <div className="flex flex-col gap-2 max-w-lg">
              {historyOrders.map((order) => (
                <HistoryRow
                  key={order.id}
                  order={order}
                  theme={theme}
                  lang={lang}
                  t={t}
                  expanded={expandedId === order.id}
                  onToggle={() => toggleExpand(order.id)}
                />
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ message, hint }: { message: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <ChefHat size={48} className="text-muted-foreground mb-4" />
      <p className="font-bold text-lg mb-1">{message}</p>
      <p className="text-muted-foreground text-sm">{hint}</p>
    </div>
  );
}

// ── Active order card ─────────────────────────────────────────────────────────

function OrderCard({
  order,
  theme,
  lang,
  t,
  staff,
  updateItemStatus,
}: {
  order: Order;
  theme: KitchenTheme;
  lang: StaffLang;
  t: StaffDict;
  staff: StaffStamp | null;
  updateItemStatus: (orderId: string, productId: string, status: OrderStatus, staff?: StaffStamp) => Promise<void>;
}) {
  const cardBorder = theme === "dark" ? CARD_BORDER_DARK[order.status] : CARD_BORDER_LIGHT[order.status];

  return (
    <div className={`border-2 rounded-2xl p-4 flex flex-col gap-3 transition-all ${cardBorder}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">{t.kitchenOrder}</p>
          <p className="font-black text-2xl tracking-tight leading-none mt-0.5">#{order.id}</p>
        </div>
        <div className="text-right shrink-0">
          {order.tableNumber && (
            <>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">{t.table}</p>
              <p className="font-black text-2xl leading-none mt-0.5">{order.tableNumber}</p>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 -mt-1">
        <p className="text-xs text-muted-foreground">
          {formatTime(order.createdAt)} · {minutesAgoLabel(order.createdAt, lang)}
        </p>
        <ServingBadge preference={order.servingPreference ?? "together"} theme={theme} lang={lang} />
      </div>

      <Separator className="opacity-30" />

      <div className="flex flex-col gap-2.5">
        {order.items.map((item) => (
          <ItemRow key={item.productId} orderId={order.id} item={item} theme={theme} lang={lang} t={t} staff={staff} updateItemStatus={updateItemStatus} />
        ))}
      </div>

      <Separator className="opacity-30" />

      <div className="flex justify-between text-sm font-bold">
        <span className="text-muted-foreground">{t.total}</span>
        <span className="text-primary">{order.total.toFixed(2)} €</span>
      </div>
    </div>
  );
}

// ── History row ───────────────────────────────────────────────────────────────

function HistoryRow({
  order,
  theme,
  lang,
  t,
  expanded,
  onToggle,
}: {
  order: Order;
  theme: KitchenTheme;
  lang: StaffLang;
  t: StaffDict;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isCompleted = order.status === "COMPLETED";
  const badge = theme === "dark" ? STATUS_BADGE_DARK[order.status] : STATUS_BADGE_LIGHT[order.status];
  const rowBg = theme === "dark" ? "bg-card/60 border-border/30" : "bg-white border-gray-200";
  const expandedBorder = theme === "dark" ? CARD_BORDER_DARK[order.status] : CARD_BORDER_LIGHT[order.status];
  const statusLabel = ORDER_STATUS_LABEL[lang];

  if (expanded) {
    return (
      <div className={`border-2 rounded-2xl overflow-hidden ${expandedBorder}`}>
        {/* Collapse header */}
        <button
          onClick={onToggle}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-black/5 transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className="font-black text-lg">#{order.id}</span>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${badge}`}>
              {STATUS_ICON_SM[order.status]}
              {statusLabel[order.status]}
            </span>
          </div>
          <ChevronUp size={16} className="text-muted-foreground" />
        </button>
        {/* Full card body */}
        <div className="px-4 pb-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {formatTime(order.createdAt)}
              {order.tableNumber && ` · ${t.table} ${order.tableNumber}`}
            </p>
            <ServingBadge preference={order.servingPreference ?? "together"} theme={theme} lang={lang} />
          </div>
          <Separator className="opacity-30" />
          <div className="space-y-1.5">
            {order.items.map((item) => {
              const st = item.itemStatus ?? order.status;
              const ib = theme === "dark" ? STATUS_BADGE_DARK[st] : STATUS_BADGE_LIGHT[st];
              return (
                <div key={item.productId} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-muted-foreground">{tProduct(item.productId, lang, "name", item.name)} ×{item.quantity}</span>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${ib}`}>
                    {STATUS_ICON_SM[st]}
                    {statusLabel[st]}
                  </span>
                </div>
              );
            })}
          </div>
          <Separator className="opacity-30" />
          <div className="flex justify-between text-sm font-bold">
            <span className="text-muted-foreground">{t.total}</span>
            <span className="text-primary">{order.total.toFixed(2)} €</span>
          </div>
        </div>
      </div>
    );
  }

  // Collapsed row
  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-center gap-3 px-4 py-3 border rounded-xl hover:opacity-80 transition-opacity text-left ${rowBg}`}
    >
      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full shrink-0
        ${isCompleted ? (theme === "dark" ? "text-green-400" : "text-green-600") : (theme === "dark" ? "text-red-400" : "text-red-500")}`}>
        {isCompleted ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
      </span>
      <span className="font-bold text-sm text-foreground shrink-0">#{order.id}</span>
      <span className="text-xs text-muted-foreground shrink-0">{formatTime(order.createdAt)}</span>
      <span className="flex-1" />
      <span className="text-sm font-semibold text-foreground shrink-0">{order.total.toFixed(2)} €</span>
      <ChevronDown size={14} className="text-muted-foreground shrink-0" />
    </button>
  );
}

// ── Serving preference badge ──────────────────────────────────────────────────

function ServingBadge({ preference, theme, lang }: { preference: ServingPreference; theme: KitchenTheme; lang: StaffLang }) {
  const isTogether = preference === "together";
  const light = isTogether
    ? "bg-purple-100 text-purple-700 border border-purple-200"
    : "bg-orange-100 text-orange-700 border border-orange-200";
  const dark = isTogether
    ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
    : "bg-orange-500/20 text-orange-300 border border-orange-500/30";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${theme === "dark" ? dark : light}`}>
      {isTogether ? <Utensils size={10} /> : <Zap size={10} />}
      {SERVING_SHORT[lang][preference]}
    </span>
  );
}

// ── Item row ──────────────────────────────────────────────────────────────────

function ItemRow({
  orderId,
  item,
  theme,
  lang,
  t,
  staff,
  updateItemStatus,
}: {
  orderId: string;
  item: OrderItem;
  theme: KitchenTheme;
  lang: StaffLang;
  t: StaffDict;
  staff: StaffStamp | null;
  updateItemStatus: (orderId: string, productId: string, status: OrderStatus, staff?: StaffStamp) => Promise<void>;
}) {
  const status = item.itemStatus ?? "NEW";
  const badge = theme === "dark" ? STATUS_BADGE_DARK[status] : STATUS_BADGE_LIGHT[status];
  // Kitchen's job ends at READY. DELIVERING and beyond are waiter territory.
  const isDone = status === "COMPLETED" || status === "CANCELLED" || status === "DELIVERING";

  const advance = () => {
    if (status === "NEW") void updateItemStatus(orderId, item.productId, "PREPARING");
    else if (status === "PREPARING")
      void updateItemStatus(orderId, item.productId, "READY", staff ?? undefined);
    // No action for READY — waiter takes over from here
  };

  const cancel = () => void updateItemStatus(orderId, item.productId, "CANCELLED");

  const actionLabel: Partial<Record<OrderStatus, string>> = {
    NEW: t.kitchenStart,
    PREPARING: t.kitchenReady,
  };

  const actionColor: Record<string, string> = {
    NEW: "bg-blue-600 hover:bg-blue-700 text-white",
    PREPARING: "bg-green-600 hover:bg-green-700 text-white",
  };

  return (
    <div className={`rounded-xl p-2.5 transition-opacity ${isDone ? "opacity-50" : ""} ${theme === "dark" ? "bg-black/10" : "bg-white/60"}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="font-semibold text-sm leading-snug">{tProduct(item.productId, lang, "name", item.name)}</span>
          {item.quantity > 1 && (
            <span className="shrink-0 text-xs font-bold text-muted-foreground">×{item.quantity}</span>
          )}
        </div>
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${badge}`}>
          {STATUS_ICON_SM[status]}
          {ORDER_STATUS_LABEL[lang][status]}
        </span>
      </div>
      {!isDone && (
        <div className="flex gap-1.5">
          {actionLabel[status] && (
            <button onClick={advance} className={`flex-1 h-8 rounded-lg text-xs font-bold transition-colors ${actionColor[status]}`}>
              {actionLabel[status]}
            </button>
          )}
          {status !== "READY" && (
            <button
              onClick={cancel}
              className={`h-8 px-3 rounded-lg text-xs font-semibold transition-colors
                ${theme === "dark" ? "bg-destructive/20 text-destructive hover:bg-destructive/30" : "bg-red-100 text-red-600 hover:bg-red-200"}`}
            >
              <XCircle size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
