"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type Order,
  type OrderStatus,
  listOrders,
  subscribeOrders,
  SERVING_LABELS,
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
  CheckCircle2, XCircle, BarChart3, RefreshCw, Calendar, Layers, Table2, Receipt,
} from "lucide-react";
import { getSessionStats, subscribeSession } from "@/lib/tableSession";
import { resetDemoData } from "@/lib/devReset";
import { Separator } from "@/components/ui/separator";

// ── Types ─────────────────────────────────────────────────────────────────────

type DateFilter = "today" | "all";

// ── Status display ────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<OrderStatus, string> = {
  NEW: "Naujas",
  PREPARING: "Gaminamas",
  READY: "Paruoštas",
  COMPLETED: "Įvykdytas",
  CANCELLED: "Atšauktas",
};

const STATUS_DOT: Record<OrderStatus, string> = {
  NEW: "bg-amber-400",
  PREPARING: "bg-blue-400",
  READY: "bg-green-400",
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("lt-LT", { month: "short", day: "numeric" });
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<DateFilter>("today");
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [sessionStats, setSessionStats] = useState({ active: 0, billRequested: 0, total: 0 });
  const [spinning, setSpinning] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleReset = () => {
    resetDemoData();
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
              <h1 className="font-black text-base tracking-tight">Dzūkų Ainiai</h1>
              <p className="text-[11px] text-white/40 leading-none">Direktoriaus valdymo skydelis</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Filter */}
            <div className="flex bg-white/5 border border-white/10 rounded-xl p-1 gap-1">
              <FilterBtn active={filter === "today"} onClick={() => setFilter("today")}>
                <Calendar size={12} />
                Šiandien
              </FilterBtn>
              <FilterBtn active={filter === "all"} onClick={() => setFilter("all")}>
                <Layers size={12} />
                Visi
              </FilterBtn>
            </div>

            {/* Manual refresh */}
            <button
              onClick={handleManualRefresh}
              className="flex items-center gap-1.5 text-[11px] text-white/30 hover:text-white/60 transition-colors px-2 py-1.5 rounded-lg hover:bg-white/5"
              title="Atnaujinti"
            >
              <RefreshCw size={11} className={spinning ? "animate-spin" : ""} />
              <span className="hidden sm:inline">{formatTime(lastRefresh.toISOString())}</span>
            </button>

            {/* Dev reset */}
            {confirmReset ? (
              <div className="flex items-center gap-1.5">
                <span className="hidden sm:inline text-[11px] text-red-400/80">Tikrai?</span>
                <button
                  onClick={handleReset}
                  className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-red-500/20 text-red-400 hover:bg-red-500/35 border border-red-500/40 transition-colors"
                >
                  Taip, išvalyti
                </button>
                <button
                  onClick={cancelConfirm}
                  className="px-2.5 py-1.5 rounded-lg text-[11px] text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors"
                >
                  Ne
                </button>
              </div>
            ) : (
              <button
                onClick={requestConfirm}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-red-400/70 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/25 transition-colors"
                title="Tik testavimui"
              >
                <XCircle size={11} />
                <span className="hidden sm:inline">Išvalyti testinius duomenis</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {isEmpty ? (
          <EmptyState filter={filter} />
        ) : (
          <>
            {/* ── Summary cards ── */}
            <section>
              <SectionLabel>Suvestinė{filter === "today" ? " — šiandien" : ""}</SectionLabel>
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <StatCard
                  label="Užsakymų"
                  value={orders.length}
                  icon={<ShoppingBag size={16} />}
                  color="text-primary"
                />
                <StatCard
                  label="Pajamos"
                  value={`${fmt(revenue)} €`}
                  icon={<TrendingUp size={16} />}
                  color="text-emerald-400"
                />
                <StatCard
                  label="Vid. užsakymas"
                  value={`${fmt(avg)} €`}
                  icon={<BarChart3 size={16} />}
                  color="text-blue-400"
                />
                <StatCard
                  label="Aktyvūs"
                  value={activeOrders.length}
                  icon={<Clock size={16} />}
                  color="text-amber-400"
                  highlight={activeOrders.length > 0}
                />
                <StatCard
                  label="Atšaukti"
                  value={cancelledOrders.length}
                  icon={<XCircle size={16} />}
                  color="text-red-400"
                />
              </div>
            </section>

            {/* ── Kitchen live ── */}
            <section>
              <SectionLabel>Virtuvė — dabar</SectionLabel>
              <KitchenLive stats={kitchenStats} />
            </section>

            {/* ── Table sessions ── */}
            <section>
              <SectionLabel>Stalų sesijos</SectionLabel>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <StatCard
                  label="Aktyvios sesijos"
                  value={sessionStats.active}
                  icon={<Table2 size={16} />}
                  color="text-amber-400"
                  highlight={sessionStats.active > 0}
                />
                <StatCard
                  label="Sąskaita prašoma"
                  value={sessionStats.billRequested}
                  icon={<Receipt size={16} />}
                  color="text-emerald-400"
                  highlight={sessionStats.billRequested > 0}
                />
                <StatCard
                  label="Iš viso sesijų"
                  value={sessionStats.total}
                  icon={<Layers size={16} />}
                  color="text-white/50"
                />
              </div>
            </section>

            {/* ── Popular + Recent ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Popular dishes */}
              <section>
                <SectionLabel>Populiariausi patiekalai</SectionLabel>
                {popularItems.length === 0 ? (
                  <Card><p className="text-white/40 text-sm py-2">Nėra duomenų.</p></Card>
                ) : (
                  <Card noPad>
                    <div className="divide-y divide-white/5">
                      {popularItems.map((item, i) => (
                        <PopularRow key={item.productId} item={item} rank={i + 1} />
                      ))}
                    </div>
                  </Card>
                )}
              </section>

              {/* Recent orders */}
              <section>
                <SectionLabel>Paskutiniai užsakymai</SectionLabel>
                {recentOrders.length === 0 ? (
                  <Card><p className="text-white/40 text-sm py-2">Nėra duomenų.</p></Card>
                ) : (
                  <Card noPad>
                    <div className="divide-y divide-white/5">
                      {recentOrders.map((order) => (
                        <RecentRow key={order.id} order={order} />
                      ))}
                    </div>
                  </Card>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ filter }: { filter: DateFilter }) {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
        <ShoppingBag size={28} className="text-white/30" />
      </div>
      <p className="font-bold text-lg text-white/70 mb-1">Užsakymų nėra</p>
      <p className="text-sm text-white/30">
        {filter === "today" ? "Šiandien dar nebuvo užsakymų." : "Lokaliai nėra išsaugotų užsakymų."}
      </p>
    </div>
  );
}

// ── Kitchen live status ───────────────────────────────────────────────────────

function KitchenLive({ stats }: { stats: KitchenStats }) {
  const items = [
    { label: "Nauji", value: stats.newCount, icon: <Clock size={15} />, color: "text-amber-400", bg: "bg-amber-400/10 border-amber-400/20" },
    { label: "Gaminami", value: stats.preparingCount, icon: <ChefHat size={15} />, color: "text-blue-400", bg: "bg-blue-400/10 border-blue-400/20" },
    { label: "Paruošti", value: stats.readyCount, icon: <Bell size={15} />, color: "text-green-400", bg: "bg-green-400/10 border-green-400/20" },
    { label: "Įvykdyti", value: stats.completedCount, icon: <CheckCircle2 size={15} />, color: "text-emerald-400", bg: "bg-emerald-400/10 border-emerald-400/20" },
    { label: "Atšaukti", value: stats.cancelledCount, icon: <XCircle size={15} />, color: "text-red-400", bg: "bg-red-400/10 border-red-400/20" },
  ];

  return (
    <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
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

function PopularRow({ item, rank }: { item: PopularItem; rank: number }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="w-5 text-center text-xs font-bold text-white/20 shrink-0">{rank}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">{item.name}</p>
        <p className="text-[11px] text-white/40">{item.revenue.toFixed(2)} € pajamos</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-black text-primary">{item.quantitySold}</p>
        <p className="text-[11px] text-white/30">vnt.</p>
      </div>
    </div>
  );
}

// ── Recent order row ──────────────────────────────────────────────────────────

function RecentRow({ order }: { order: Order }) {
  const pref = order.servingPreference ?? "together";
  const prefShort = SERVING_LABELS[pref].short;
  const isToday = new Date(order.createdAt).toDateString() === new Date().toDateString();

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold">#{order.id}</span>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[order.status]}`} />
          <span className="text-[11px] text-white/40 truncate">{STATUS_LABEL[order.status]}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[11px] text-white/30">
            {isToday ? formatTime(order.createdAt) : formatDate(order.createdAt)}
          </span>
          <span className="text-[11px] text-white/20">·</span>
          <span className="text-[11px] text-white/30 truncate">{prefShort}</span>
          {order.tableNumber && (
            <>
              <span className="text-[11px] text-white/20">·</span>
              <span className="text-[11px] text-white/30">Stalas {order.tableNumber}</span>
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
