"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type Order,
  type OrderStatus,
  listOrders,
  subscribeOrders,
} from "@/lib/orders";
import {
  type KitchenStats,
  type PopularItem,
  getTodayOrders,
  calculateRevenue,
  averageOrderValue,
  getKitchenStats,
  getPopularItems,
  getRecentOrders,
} from "@/lib/analytics";
import {
  ShoppingBag, TrendingUp, Clock, ChefHat, Bell,
  CheckCircle2, XCircle, BarChart3, RefreshCw, Calendar, Layers, Table2, Receipt, Truck, CreditCard,
} from "lucide-react";
import { getSessionStats, getPaymentStats, subscribeSession } from "@/lib/tableSession";
import { resetDemoData } from "@/lib/devReset";
import {
  type StaffLang,
  type StaffDict,
  useStaffLang,
  staffT,
  ORDER_STATUS_LABEL,
  SERVING_SHORT,
} from "@/lib/staff-i18n";
import StaffLangSwitch from "@/components/StaffLangSwitch";
import StaffLogoutButton from "@/components/StaffLogoutButton";
import StaffAccountsPanel from "@/components/StaffAccountsPanel";
import { useCurrentStaff } from "@/lib/useCurrentStaff";
import { tProduct } from "@/lib/product-translations";

// ── Types ─────────────────────────────────────────────────────────────────────

type DateFilter = "today" | "all";

// ── Status display (colors only — labels come from staff-i18n) ────────────────

const STATUS_DOT: Record<OrderStatus, string> = {
  NEW: "bg-amber-400",
  PREPARING: "bg-blue-400",
  READY: "bg-green-400",
  DELIVERING: "bg-purple-400",
  COMPLETED: "bg-emerald-500",
  CANCELLED: "bg-red-500",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toFixed(2);
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("lt-LT", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(iso: string, lang: StaffLang): string {
  return new Date(iso).toLocaleDateString(lang === "en" ? "en-GB" : "lt-LT", { month: "short", day: "numeric" });
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<DateFilter>("today");
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [sessionStats, setSessionStats] = useState({ active: 0, billRequested: 0, total: 0 });
  const [paymentStats, setPaymentStats] = useState({ paidInApp: 0, paidByWaiter: 0, total: 0 });
  const [spinning, setSpinning] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lang, setLang] = useStaffLang();
  const t = staffT(lang);
  useCurrentStaff(); // side effect only here: keeps this admin's last-seen ping alive

  const handleReset = async () => {
    await resetDemoData();
    refreshAll();
    setConfirmReset(false);
  };

  const requestConfirm = () => {
    setConfirmReset(true);
    // Auto-cancel confirmation after 5 s to prevent accidental clicks later
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    confirmTimeoutRef.current = setTimeout(() => setConfirmReset(false), 5000);
  };

  const cancelConfirm = () => {
    setConfirmReset(false);
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
  };

  const refreshAll = useCallback(() => {
    setAllOrders(listOrders());
    setSessionStats(getSessionStats());
    setPaymentStats(getPaymentStats(true));
    setLastRefresh(new Date());
  }, []);

  const handleManualRefresh = () => {
    refreshAll();
    setSpinning(true);
    setTimeout(() => setSpinning(false), 600);
  };

  useEffect(() => {
    refreshAll();
    const unsubOrders = subscribeOrders(refreshAll);
    const unsubSessions = subscribeSession(refreshAll);
    return () => { unsubOrders(); unsubSessions(); };
  }, [refreshAll]);

  const orders = filter === "today" ? getTodayOrders(allOrders) : allOrders;
  const activeOrders = orders.filter((o) => ["NEW", "PREPARING", "READY"].includes(o.status));
  const cancelledOrders = orders.filter((o) => o.status === "CANCELLED");
  const revenue = calculateRevenue(orders);
  const avg = averageOrderValue(orders);
  const kitchenStats = getKitchenStats(allOrders); // always live, not filtered
  const popularItems = getPopularItems(orders);
  const recentOrders = getRecentOrders(orders);

  const isEmpty = orders.length === 0;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Header */}
      <div className="border-b border-white/8 px-4 sm:px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <BarChart3 size={18} className="text-primary" />
            </div>
            <div>
              <h1 className="font-black text-base tracking-tight">Vaise</h1>
              <p className="text-[11px] text-white/40 leading-none">{t.adminSubtitle}</p>
              <p className="text-[11px] text-white/30 leading-none mt-0.5">{t.restaurantLabel}: Dzūkų Ainiai</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <StaffLangSwitch lang={lang} onChange={setLang} />
            <StaffLogoutButton lang={lang} />

            {/* Filter */}
            <div className="flex bg-white/5 border border-white/10 rounded-xl p-1 gap-1">
              <FilterBtn active={filter === "today"} onClick={() => setFilter("today")}>
                <Calendar size={12} />
                {t.today}
              </FilterBtn>
              <FilterBtn active={filter === "all"} onClick={() => setFilter("all")}>
                <Layers size={12} />
                {t.all}
              </FilterBtn>
            </div>

            {/* Manual refresh */}
            <button
              onClick={handleManualRefresh}
              className="flex items-center gap-1.5 text-[11px] text-white/30 hover:text-white/60 transition-colors px-2 py-1.5 rounded-lg hover:bg-white/5"
              title={t.adminRefresh}
            >
              <RefreshCw size={11} className={spinning ? "animate-spin" : ""} />
              <span className="hidden sm:inline">{formatTime(lastRefresh.toISOString())}</span>
            </button>

            {/* Dev reset */}
            {confirmReset ? (
              <div className="flex items-center gap-1.5">
                <span className="hidden sm:inline text-[11px] text-red-400/80">{t.adminResetConfirmQ}</span>
                <button
                  onClick={handleReset}
                  className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-red-500/20 text-red-400 hover:bg-red-500/35 border border-red-500/40 transition-colors"
                >
                  {t.adminResetYes}
                </button>
                <button
                  onClick={cancelConfirm}
                  className="px-2.5 py-1.5 rounded-lg text-[11px] text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors"
                >
                  {t.adminResetNo}
                </button>
              </div>
            ) : (
              <button
                onClick={requestConfirm}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-red-400/70 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/25 transition-colors"
                title={t.adminResetHint}
              >
                <XCircle size={11} />
                <span className="hidden sm:inline">{t.adminResetBtn}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {isEmpty ? (
          <EmptyState filter={filter} t={t} />
        ) : (
          <>
            {/* ── Summary cards ── */}
            <section>
              <SectionLabel>{t.adminSummary}{filter === "today" ? t.adminSummaryToday : ""}</SectionLabel>
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <StatCard
                  label={t.adminOrders}
                  value={orders.length}
                  icon={<ShoppingBag size={16} />}
                  color="text-primary"
                />
                <StatCard
                  label={t.adminRevenue}
                  value={`${fmt(revenue)} €`}
                  icon={<TrendingUp size={16} />}
                  color="text-emerald-400"
                />
                <StatCard
                  label={t.adminAvgOrder}
                  value={`${fmt(avg)} €`}
                  icon={<BarChart3 size={16} />}
                  color="text-blue-400"
                />
                <StatCard
                  label={t.adminActive}
                  value={activeOrders.length}
                  icon={<Clock size={16} />}
                  color="text-amber-400"
                  highlight={activeOrders.length > 0}
                />
                <StatCard
                  label={t.adminCancelled}
                  value={cancelledOrders.length}
                  icon={<XCircle size={16} />}
                  color="text-red-400"
                />
              </div>
            </section>

            {/* ── Kitchen live ── */}
            <section>
              <SectionLabel>{t.adminKitchenNow}</SectionLabel>
              <KitchenLive stats={kitchenStats} t={t} />
            </section>

            {/* ── Table sessions ── */}
            <section>
              <SectionLabel>{t.adminTableSessions}</SectionLabel>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <StatCard
                  label={t.adminActiveSessions}
                  value={sessionStats.active}
                  icon={<Table2 size={16} />}
                  color="text-amber-400"
                  highlight={sessionStats.active > 0}
                />
                <StatCard
                  label={t.adminBillRequested}
                  value={sessionStats.billRequested}
                  icon={<Receipt size={16} />}
                  color="text-emerald-400"
                  highlight={sessionStats.billRequested > 0}
                />
                <StatCard
                  label={t.adminTotalSessions}
                  value={sessionStats.total}
                  icon={<Layers size={16} />}
                  color="text-white/50"
                />
              </div>
            </section>

            {/* ── Payments today ── */}
            <section>
              <SectionLabel>{t.adminPaymentsToday}</SectionLabel>
              <PaymentStats stats={paymentStats} t={t} />
            </section>

            {/* ── Popular + Recent ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Popular dishes */}
              <section>
                <SectionLabel>{t.adminPopular}</SectionLabel>
                {popularItems.length === 0 ? (
                  <Card><p className="text-white/40 text-sm py-2">{t.noData}</p></Card>
                ) : (
                  <Card noPad>
                    <div className="divide-y divide-white/5">
                      {popularItems.map((item, i) => (
                        <PopularRow key={item.productId} item={item} rank={i + 1} lang={lang} t={t} />
                      ))}
                    </div>
                  </Card>
                )}
              </section>

              {/* Recent orders */}
              <section>
                <SectionLabel>{t.adminRecent}</SectionLabel>
                {recentOrders.length === 0 ? (
                  <Card><p className="text-white/40 text-sm py-2">{t.noData}</p></Card>
                ) : (
                  <Card noPad>
                    <div className="divide-y divide-white/5">
                      {recentOrders.map((order) => (
                        <RecentRow key={order.id} order={order} lang={lang} t={t} />
                      ))}
                    </div>
                  </Card>
                )}
              </section>
            </div>
          </>
        )}

        <StaffAccountsPanel lang={lang} />
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ filter, t }: { filter: DateFilter; t: StaffDict }) {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
        <ShoppingBag size={28} className="text-white/30" />
      </div>
      <p className="font-bold text-lg text-white/70 mb-1">{t.adminEmptyTitle}</p>
      <p className="text-sm text-white/30">
        {filter === "today" ? t.adminEmptyToday : t.adminEmptyAll}
      </p>
    </div>
  );
}

// ── Kitchen live status ───────────────────────────────────────────────────────

function KitchenLive({ stats, t }: { stats: KitchenStats; t: StaffDict }) {
  const items = [
    { label: t.adminNew, value: stats.newCount, icon: <Clock size={15} />, color: "text-amber-400", bg: "bg-amber-400/10 border-amber-400/20" },
    { label: t.adminPreparing, value: stats.preparingCount, icon: <ChefHat size={15} />, color: "text-blue-400", bg: "bg-blue-400/10 border-blue-400/20" },
    { label: t.adminReady, value: stats.readyCount, icon: <Bell size={15} />, color: "text-green-400", bg: "bg-green-400/10 border-green-400/20" },
    { label: t.adminDelivering, value: stats.deliveringCount, icon: <Truck size={15} />, color: "text-purple-400", bg: "bg-purple-400/10 border-purple-400/20" },
    { label: t.adminCompleted, value: stats.completedCount, icon: <CheckCircle2 size={15} />, color: "text-emerald-400", bg: "bg-emerald-400/10 border-emerald-400/20" },
    { label: t.adminCancelled, value: stats.cancelledCount, icon: <XCircle size={15} />, color: "text-red-400", bg: "bg-red-400/10 border-red-400/20" },
  ];

  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
      {items.map(({ label, value, icon, color, bg }) => (
        <div key={label} className={`border rounded-xl p-3 flex flex-col gap-2 ${bg}`}>
          <div className={`flex items-center gap-1.5 ${color}`}>
            {icon}
            <span className="text-[11px] font-semibold uppercase tracking-wide">{label}</span>
          </div>
          <p className={`font-black text-2xl ${color}`}>{value}</p>
        </div>
      ))}
    </div>
  );
}

// ── Popular item row ──────────────────────────────────────────────────────────

function PopularRow({ item, rank, lang, t }: { item: PopularItem; rank: number; lang: StaffLang; t: StaffDict }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="w-5 text-center text-xs font-bold text-white/20 shrink-0">{rank}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">{tProduct(item.productId, lang, "name", item.name)}</p>
        <p className="text-[11px] text-white/40">{item.revenue.toFixed(2)} {t.adminRevenueSuffix}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-black text-primary">{item.quantitySold}</p>
        <p className="text-[11px] text-white/30">{t.adminUnits}</p>
      </div>
    </div>
  );
}

// ── Recent order row ──────────────────────────────────────────────────────────

function RecentRow({ order, lang, t }: { order: Order; lang: StaffLang; t: StaffDict }) {
  const pref = order.servingPreference ?? "together";
  const prefShort = SERVING_SHORT[lang][pref];
  const isToday = new Date(order.createdAt).toDateString() === new Date().toDateString();

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold">#{order.id}</span>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[order.status]}`} />
          <span className="text-[11px] text-white/40 truncate">{ORDER_STATUS_LABEL[lang][order.status]}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[11px] text-white/30">
            {isToday ? formatTime(order.createdAt) : formatDate(order.createdAt, lang)}
          </span>
          <span className="text-[11px] text-white/20">·</span>
          <span className="text-[11px] text-white/30 truncate">{prefShort}</span>
          {order.tableNumber && (
            <>
              <span className="text-[11px] text-white/20">·</span>
              <span className="text-[11px] text-white/30">{t.table} {order.tableNumber}</span>
            </>
          )}
        </div>
      </div>
      <span className="text-sm font-bold text-white/80 shrink-0">{order.total.toFixed(2)} €</span>
    </div>
  );
}

// ── UI primitives ─────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  color,
  highlight = false,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-4 flex flex-col gap-3 transition-colors
      ${highlight ? "bg-amber-400/5 border-amber-400/20" : "bg-white/3 border-white/8"}`}>
      <div className={`flex items-center gap-2 ${color}`}>
        {icon}
        <span className="text-[11px] font-semibold uppercase tracking-wide text-white/40">{label}</span>
      </div>
      <p className={`font-black text-2xl sm:text-3xl tracking-tight ${color}`}>{value}</p>
    </div>
  );
}

function Card({ children, noPad = false }: { children: React.ReactNode; noPad?: boolean }) {
  return (
    <div className={`bg-white/3 border border-white/8 rounded-2xl overflow-hidden ${noPad ? "" : "p-4"}`}>
      {children}
    </div>
  );
}

function PaymentStats({
  stats,
  t,
}: {
  stats: { paidInApp: number; paidByWaiter: number; total: number };
  t: StaffDict;
}) {
  const total = stats.total || 1; // avoid division by zero
  const appPct = Math.round((stats.paidInApp / total) * 100);
  const waiterPct = Math.round((stats.paidByWaiter / total) * 100);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="border border-white/8 rounded-xl p-4 bg-white/3 flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-blue-400">
          <CreditCard size={14} />
          <span className="text-[11px] font-semibold uppercase tracking-wide">{t.adminPaidApp}</span>
        </div>
        <div className="flex items-end gap-2">
          <p className="font-black text-2xl text-blue-400">{stats.paidInApp}</p>
          {stats.total > 0 && (
            <p className="text-xs text-white/40 mb-0.5">{appPct}%</p>
          )}
        </div>
      </div>
      <div className="border border-white/8 rounded-xl p-4 bg-white/3 flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-emerald-400">
          <Receipt size={14} />
          <span className="text-[11px] font-semibold uppercase tracking-wide">{t.adminPaidWaiter}</span>
        </div>
        <div className="flex items-end gap-2">
          <p className="font-black text-2xl text-emerald-400">{stats.paidByWaiter}</p>
          {stats.total > 0 && (
            <p className="text-xs text-white/40 mb-0.5">{waiterPct}%</p>
          )}
        </div>
      </div>
      <div className="border border-white/8 rounded-xl p-4 bg-white/3 flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-white/50">
          <Layers size={14} />
          <span className="text-[11px] font-semibold uppercase tracking-wide">{t.adminPaidTotal}</span>
        </div>
        <p className="font-black text-2xl text-white/60">{stats.total}</p>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-widest text-white/30 mb-3">
      {children}
    </p>
  );
}

function FilterBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors
        ${active ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"}`}
    >
      {children}
    </button>
  );
}
