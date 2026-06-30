"use client";

import { useEffect, useState } from "react";
import {
  type Order,
  listOrders,
  subscribeOrders,
  SERVING_LABELS,
} from "@/lib/orders";
import {
  type WaiterTask,
  type WaiterTaskType,
  type WaiterTaskStatus,
  type WaiterTaskPriority,
  TASK_LABEL,
  TASK_ACTION_LABEL,
  TASK_STATUS_LABEL,
  TASK_PRIORITY,
  listTasks,
  updateTaskStatus,
  subscribeWaiterTasks,
  syncReadyToServeTasks,
  getActiveTasks,
  getTasksByTable,
  countActiveTables,
} from "@/lib/waiterTasks";
import {
  UtensilsCrossed, Receipt, Bell, ShoppingBag,
  ChefHat, Clock, CheckCircle2, ChevronDown, ChevronUp,
  Table2, List,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";

// ── Filter types ──────────────────────────────────────────────────────────────

type TaskFilter = "all" | "ready" | "bills" | "calls" | "completed";

const FILTER_LABELS: Record<TaskFilter, string> = {
  all: "Visi",
  ready: "Maistas",
  bills: "Sąskaitos",
  calls: "Kvietimai",
  completed: "Atlikti",
};

// ── View modes ────────────────────────────────────────────────────────────────

type ViewMode = "tasks" | "tables";

// ── Icons ─────────────────────────────────────────────────────────────────────

const TASK_ICON: Record<WaiterTaskType, React.ReactNode> = {
  ready_to_serve: <UtensilsCrossed size={24} />,
  bill_requested: <Receipt size={24} />,
  waiter_called: <Bell size={24} />,
  additional_order: <ShoppingBag size={24} />,
};

const TASK_ICON_LG: Record<WaiterTaskType, React.ReactNode> = {
  ready_to_serve: <UtensilsCrossed size={28} />,
  bill_requested: <Receipt size={28} />,
  waiter_called: <Bell size={28} />,
  additional_order: <ShoppingBag size={28} />,
};

// ── Color maps ────────────────────────────────────────────────────────────────

const PRIORITY_COLOR: Record<WaiterTaskPriority, string> = {
  high: "text-amber-400 bg-amber-400/10 border-amber-400/25",
  normal: "text-blue-400 bg-blue-400/10 border-blue-400/25",
};

const STATUS_DOT: Record<WaiterTaskStatus, string> = {
  waiting: "bg-amber-400",
  accepted: "bg-blue-400",
  completed: "bg-emerald-500",
};

const TYPE_ACCENT: Record<WaiterTaskType, string> = {
  ready_to_serve: "border-l-amber-400",
  bill_requested: "border-l-blue-400",
  waiter_called: "border-l-red-400",
  additional_order: "border-l-purple-400",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("lt-LT", { hour: "2-digit", minute: "2-digit" });
}

function minutesAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "ką tik";
  if (mins === 1) return "prieš 1 min.";
  return `prieš ${mins} min.`;
}

function filterTasks(tasks: WaiterTask[], filter: TaskFilter): WaiterTask[] {
  switch (filter) {
    case "ready":    return tasks.filter((t) => t.type === "ready_to_serve" && t.status !== "completed");
    case "bills":    return tasks.filter((t) => t.type === "bill_requested" && t.status !== "completed");
    case "calls":    return tasks.filter((t) => t.type === "waiter_called" && t.status !== "completed");
    case "completed":return tasks.filter((t) => t.status === "completed");
    default:         return tasks.filter((t) => t.status !== "completed");
  }
}

function getOrderById(orders: Order[], id: string): Order | undefined {
  return orders.find((o) => o.id === id);
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WaiterPage() {
  const [tasks, setTasks] = useState<WaiterTask[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [view, setView] = useState<ViewMode>("tasks");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const refreshOrders = () => {
      const fresh = listOrders();
      setOrders(fresh);
      syncReadyToServeTasks(fresh); // auto-generate ready tasks
    };

    const refreshTasks = () => setTasks(listTasks());

    // Initial load
    refreshOrders();
    refreshTasks();

    const unsubOrders = subscribeOrders(() => {
      refreshOrders();
      // After syncReadyToServeTasks writes new tasks, waiter event fires → refreshTasks
    });
    const unsubTasks = subscribeWaiterTasks(refreshTasks);

    return () => {
      unsubOrders();
      unsubTasks();
    };
  }, []);

  const activeTasks = getActiveTasks(tasks);
  const displayedTasks = filterTasks(tasks, filter);
  const activeTables = countActiveTables(orders);

  const readyCount = activeTasks.filter((t) => t.type === "ready_to_serve").length;
  const billCount  = activeTasks.filter((t) => t.type === "bill_requested").length;
  const callCount  = activeTasks.filter((t) => t.type === "waiter_called").length;

  const toggle = (id: string) => setExpandedId((p) => (p === id ? null : id));

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Header */}
      <div className="border-b border-white/8 px-4 sm:px-6 py-4 sticky top-0 bg-[#0a0a0f]/95 backdrop-blur z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-400/15 flex items-center justify-center">
              <UtensilsCrossed size={17} className="text-amber-400" />
            </div>
            <div>
              <h1 className="font-black text-base tracking-tight">Padavėjas</h1>
              <p className="text-[11px] text-white/40 leading-none">Dzūkų Ainiai</p>
            </div>
          </div>

          {/* View toggle */}
          <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-1">
            <ViewBtn active={view === "tasks"} onClick={() => setView("tasks")}>
              <List size={13} />
            </ViewBtn>
            <ViewBtn active={view === "tables"} onClick={() => setView("tables")}>
              <Table2 size={13} />
            </ViewBtn>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-5 space-y-5">

        {/* ── Summary cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryCard
            label="Nešti maistą"
            value={readyCount}
            icon={<UtensilsCrossed size={15} />}
            accent="amber"
            urgent={readyCount > 0}
          />
          <SummaryCard
            label="Aktyvūs stalai"
            value={activeTables}
            icon={<Table2 size={15} />}
            accent="blue"
          />
          <SummaryCard
            label="Sąskaita"
            value={billCount}
            icon={<Receipt size={15} />}
            accent="emerald"
            urgent={billCount > 0}
          />
          <SummaryCard
            label="Kvietimai"
            value={callCount}
            icon={<Bell size={15} />}
            accent="red"
            urgent={callCount > 0}
          />
        </div>

        {/* ── Filter tabs ── */}
        <div className="flex gap-1 overflow-x-auto pb-0.5 scrollbar-none">
          {(Object.keys(FILTER_LABELS) as TaskFilter[]).map((f) => {
            const count = f === "completed"
              ? tasks.filter((t) => t.status === "completed").length
              : f === "all"
                ? activeTasks.length
                : activeTasks.filter((t) =>
                    f === "ready" ? t.type === "ready_to_serve"
                    : f === "bills" ? t.type === "bill_requested"
                    : t.type === "waiter_called"
                  ).length;
            return (
              <FilterTab key={f} active={filter === f} onClick={() => setFilter(f)} count={count}>
                {FILTER_LABELS[f]}
              </FilterTab>
            );
          })}
        </div>

        {/* ── Content ── */}
        {displayedTasks.length === 0 ? (
          <EmptyState filter={filter} />
        ) : view === "tables" ? (
          <TableView tasks={displayedTasks} orders={orders} expandedId={expandedId} onToggle={toggle} />
        ) : (
          <TaskList tasks={displayedTasks} orders={orders} expandedId={expandedId} onToggle={toggle} />
        )}
      </div>
    </div>
  );
}

// ── Task list ─────────────────────────────────────────────────────────────────

function TaskList({
  tasks,
  orders,
  expandedId,
  onToggle,
}: {
  tasks: WaiterTask[];
  orders: Order[];
  expandedId: string | null;
  onToggle: (id: string) => void;
}) {
  // High priority first, then by createdAt
  const sorted = [...tasks].sort((a, b) => {
    const pa = TASK_PRIORITY[a.type] === "high" ? 0 : 1;
    const pb = TASK_PRIORITY[b.type] === "high" ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return a.createdAt.localeCompare(b.createdAt);
  });

  return (
    <div className="flex flex-col gap-4">
      {sorted.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          order={getOrderById(orders, task.orderId)}
          expanded={expandedId === task.id}
          onToggle={() => onToggle(task.id)}
        />
      ))}
    </div>
  );
}

// ── Table view ────────────────────────────────────────────────────────────────

function TableView({
  tasks,
  orders,
  expandedId,
  onToggle,
}: {
  tasks: WaiterTask[];
  orders: Order[];
  expandedId: string | null;
  onToggle: (id: string) => void;
}) {
  const byTable = getTasksByTable(tasks);
  const sorted = Array.from(byTable.entries()).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="flex flex-col gap-4">
      {sorted.map(([table, tableTasks]) => (
        <div key={table} className="bg-white/3 border border-white/8 rounded-2xl overflow-hidden">
          {/* Table header */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/8 bg-white/2">
            <Table2 size={13} className="text-white/40" />
            <span className="text-xs font-bold uppercase tracking-widest text-white/50">
              {table === "—" ? "Stalas nenurodytas" : `Stalas ${table}`}
            </span>
            <span className="ml-auto text-[11px] text-white/30">
              {tableTasks.filter((t) => t.status !== "completed").length} aktyvūs
            </span>
          </div>
          {/* Tasks for this table */}
          <div className="flex flex-col divide-y divide-white/5">
            {tableTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                order={getOrderById(orders, task.orderId)}
                expanded={expandedId === task.id}
                onToggle={() => onToggle(task.id)}
                flat
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Task card ─────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  order,
  expanded,
  onToggle,
  flat = false,
}: {
  task: WaiterTask;
  order: Order | undefined;
  expanded: boolean;
  onToggle: () => void;
  flat?: boolean;
}) {
  const priority = TASK_PRIORITY[task.type];
  const isCompleted = task.status === "completed";
  const accentBorder = TYPE_ACCENT[task.type];

  const handleAction = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (task.status === "waiting") {
      updateTaskStatus(task.id, "accepted");
    } else if (task.status === "accepted") {
      updateTaskStatus(task.id, "completed");
    }
  };

  const wrapCls = flat
    ? `px-5 py-4 border-l-[5px] ${accentBorder} ${isCompleted ? "opacity-40" : ""}`
    : `border border-white/8 rounded-3xl overflow-hidden border-l-[5px] ${accentBorder} bg-white/3 ${isCompleted ? "opacity-40" : ""}`;

  return (
    <div className={wrapCls}>
      {/* Collapsed main row */}
      <button onClick={onToggle} className="w-full text-left p-1">
        <div className="flex items-start gap-4">
          {/* Type icon */}
          <div className={`mt-1 w-12 h-12 rounded-xl flex items-center justify-center shrink-0 border ${PRIORITY_COLOR[priority]}`}>
            {TASK_ICON[task.type]}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Title + chevron */}
            <div className="flex items-start justify-between gap-3">
              <span className="font-black text-[30px] leading-tight tracking-tight">
                {TASK_LABEL[task.type]}
              </span>
              <span className="text-white/30 shrink-0 mt-2">
                {expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </span>
            </div>

            {/* Table + status */}
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              {task.tableNumber && (
                <span className="text-base font-bold text-white/70 bg-white/10 px-3 py-1 rounded-full">
                  Stalas {task.tableNumber}
                </span>
              )}
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${STATUS_DOT[task.status]}`} />
              <span className="text-base text-white/50 font-medium">{TASK_STATUS_LABEL[task.status]}</span>
            </div>

            {/* Meta — order, time, dish */}
            <div className="flex items-center gap-2.5 mt-2 flex-wrap">
              <span className="text-lg text-white/40 font-medium">#{task.orderId}</span>
              <span className="text-lg text-white/20">·</span>
              <Clock size={15} className="text-white/30 shrink-0" />
              <span className="text-lg text-white/40">{minutesAgo(task.createdAt)}</span>
              {task.items.length > 0 && (
                <>
                  <span className="text-lg text-white/20">·</span>
                  <span className="text-lg text-white/50 font-semibold">
                    {task.items.length === 1
                      ? task.items[0].name
                      : `${task.items.length} patiekalai`}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="mt-4 space-y-4 px-1">
          <Separator className="opacity-10" />

          {/* Items */}
          {task.items.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-widest text-white/25 mb-2">Patiekalai</p>
              <div className="space-y-2">
                {task.items.map((item) => {
                  const liveStatus = order?.items.find((i) => i.productId === item.productId)?.itemStatus;
                  return (
                    <div key={item.productId} className="flex items-center justify-between gap-3">
                      <span className="text-lg text-white/80 font-medium">
                        {item.name} ×{item.quantity}
                      </span>
                      {liveStatus && <ItemStatusBadge status={liveStatus} />}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Order detail */}
          {order && (
            <div className="grid grid-cols-2 gap-3 text-base">
              <div>
                <p className="text-white/25 mb-0.5 text-xs uppercase tracking-wide">Patiekimas</p>
                <p className="text-white/70 font-semibold">
                  {SERVING_LABELS[order.servingPreference ?? "together"].short}
                </p>
              </div>
              {order.notes && (
                <div>
                  <p className="text-white/25 mb-0.5 text-xs uppercase tracking-wide">Pastabos</p>
                  <p className="text-white/70">{order.notes}</p>
                </div>
              )}
              <div>
                <p className="text-white/25 mb-0.5 text-xs uppercase tracking-wide">Suma</p>
                <p className="text-white/70 font-bold">{order.total.toFixed(2)} €</p>
              </div>
            </div>
          )}

          {/* Action button */}
          {!isCompleted && (
            <button
              onClick={handleAction}
              className={`w-full h-16 rounded-2xl text-lg font-black transition-colors mt-1
                ${task.status === "waiting"
                  ? "bg-amber-400/15 text-amber-300 hover:bg-amber-400/25 border border-amber-400/30"
                  : "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/30"}`}
            >
              {task.status === "waiting" ? "Priimti užduotį" : TASK_ACTION_LABEL[task.type]}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Item status badge ─────────────────────────────────────────────────────────

function ItemStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    NEW: "text-amber-400/70 bg-amber-400/10",
    PREPARING: "text-blue-400/70 bg-blue-400/10",
    READY: "text-green-400/70 bg-green-400/10",
    COMPLETED: "text-emerald-400/70 bg-emerald-400/10",
    CANCELLED: "text-red-400/70 bg-red-400/10",
  };
  const label: Record<string, string> = {
    NEW: "Naujas", PREPARING: "Gaminamas", READY: "Paruoštas",
    COMPLETED: "Atlikta", CANCELLED: "Atšaukta",
  };
  return (
    <span className={`text-sm font-semibold px-3 py-1 rounded-full ${map[status] ?? "text-white/30 bg-white/5"}`}>
      {label[status] ?? status}
    </span>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ filter }: { filter: TaskFilter }) {
  const msgs: Record<TaskFilter, string> = {
    all: "Nėra aktyvių užduočių.",
    ready: "Nėra maisto, kurį reikia nešti.",
    bills: "Niekas neprašė sąskaitos.",
    calls: "Niekas neskambino.",
    completed: "Dar nėra atliktų užduočių.",
  };
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-14 h-14 rounded-2xl bg-white/4 flex items-center justify-center mb-4">
        <CheckCircle2 size={24} className="text-white/20" />
      </div>
      <p className="font-bold text-white/50">{msgs[filter]}</p>
      <p className="text-sm text-white/25 mt-1">Užduotys atsiras automatiškai.</p>
    </div>
  );
}

// ── UI primitives ─────────────────────────────────────────────────────────────

type Accent = "amber" | "blue" | "emerald" | "red";
const ACCENT_CLS: Record<Accent, string> = {
  amber:   "text-amber-400 bg-amber-400/8 border-amber-400/20",
  blue:    "text-blue-400 bg-blue-400/8 border-blue-400/20",
  emerald: "text-emerald-400 bg-emerald-400/8 border-emerald-400/20",
  red:     "text-red-400 bg-red-400/8 border-red-400/20",
};

function SummaryCard({
  label, value, icon, accent, urgent = false,
}: {
  label: string; value: number; icon: React.ReactNode; accent: Accent; urgent?: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-4 flex flex-col gap-2 transition-all
      ${urgent ? ACCENT_CLS[accent] : "bg-white/3 border-white/8"}`}>
      <div className={`flex items-center gap-1.5 ${urgent ? "" : "text-white/30"}`}>
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p className={`font-black text-3xl tracking-tight ${urgent ? "" : "text-white/60"}`}>{value}</p>
    </div>
  );
}

function FilterTab({
  active, onClick, children, count,
}: {
  active: boolean; onClick: () => void; children: React.ReactNode; count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors shrink-0
        ${active ? "bg-white/12 text-white" : "text-white/35 hover:text-white/60"}`}
    >
      {children}
      {count > 0 && (
        <span className={`px-1.5 py-0 rounded-full text-[10px] font-bold
          ${active ? "bg-white/20 text-white" : "bg-white/8 text-white/40"}`}>
          {count}
        </span>
      )}
    </button>
  );
}

function ViewBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors
        ${active ? "bg-white/15 text-white" : "text-white/35 hover:text-white/60"}`}
    >
      {children}
    </button>
  );
}
