"use client";

import { useEffect, useState } from "react";
import {
  type Order,
  listOrders,
  subscribeOrders,
  startItemsDelivery,
  completeItemsDelivery,
} from "@/lib/orders";
import {
  type WaiterTask,
  type WaiterTaskType,
  type WaiterTaskStatus,
  type WaiterTaskPriority,
  TASK_PRIORITY,
  listTasks,
  updateTaskStatus,
  subscribeWaiterTasks,
  syncReadyToServeTasks,
  getActiveTasks,
  countActiveTables,
  completeTasksForOrders,
} from "@/lib/waiterTasks";
import {
  type TableSession,
  getActiveSession,
  listSessions,
  markSessionPaid,
  subscribeSession,
  getPaymentStats,
} from "@/lib/tableSession";
import { clearCartStorage } from "@/lib/store";
import {
  type StaffLang,
  type StaffDict,
  type PaymentBadgeKey,
  useStaffLang,
  staffT,
  ORDER_STATUS_LABEL,
  SERVING_SHORT,
  TASK_TYPE_LABEL,
  TASK_ACTION_LABEL_I18N,
  TASK_STATUS_LABEL_I18N,
  PAYMENT_BADGE_LABEL_I18N,
  minutesAgoLabel,
  ordersCount,
  tasksCount,
  activeTasksCount,
  dishesCount,
} from "@/lib/staff-i18n";
import StaffLangSwitch from "@/components/StaffLangSwitch";
import {
  UtensilsCrossed, Receipt, Bell, ShoppingBag,
  Clock, CheckCircle2, ChevronDown, ChevronUp,
  Table2, List, CreditCard,
} from "lucide-react";

// ── Payment status derivation ─────────────────────────────────────────────────

type PaymentBadge = PaymentBadgeKey | null;

function derivePaymentBadge(
  orderId: string,
  orders: Order[],
  sessions: TableSession[],
): PaymentBadge {
  const order = orders.find((o) => o.id === orderId);
  const session = sessions.find((s) => s.orderIds.includes(orderId));

  if (order?.isPaid || (session?.status === "PAID" && session.paymentMethod === "APP")) {
    return "PAID_APP";
  }
  if (session?.status === "PAID" && session.paymentMethod === "WAITER") return "PAID_WAITER";
  if (session?.status === "BILL_REQUESTED") return "BILL_REQUESTED";
  return null; // UNPAID — omit badge to reduce clutter
}

const PAYMENT_BADGE_CLS: Record<PaymentBadgeKey, string> = {
  PAID_APP:       "text-emerald-300 bg-emerald-400/15 border border-emerald-400/25",
  PAID_WAITER:    "text-blue-300 bg-blue-400/15 border border-blue-400/25",
  BILL_REQUESTED: "text-amber-300 bg-amber-400/15 border border-amber-400/25",
  UNPAID:         "text-white/30 bg-white/5 border border-white/10",
};

// ── Filter types ──────────────────────────────────────────────────────────────

type TaskFilter = "all" | "ready" | "bills" | "calls" | "completed";

function filterLabels(t: StaffDict): Record<TaskFilter, string> {
  return {
    all: t.waiterFilterAll,
    ready: t.waiterFilterFood,
    bills: t.waiterFilterBills,
    calls: t.waiterFilterCalls,
    completed: t.waiterFilterDone,
  };
}

type ViewMode = "tasks" | "tables";

// ── Icon maps ─────────────────────────────────────────────────────────────────

const TASK_ICON: Record<WaiterTaskType, React.ReactNode> = {
  ready_to_serve: <UtensilsCrossed size={22} />,
  bill_requested: <Receipt size={22} />,
  waiter_called: <Bell size={22} />,
  additional_order: <ShoppingBag size={22} />,
};

const TASK_ICON_SM: Record<WaiterTaskType, React.ReactNode> = {
  ready_to_serve: <UtensilsCrossed size={14} />,
  bill_requested: <Receipt size={14} />,
  waiter_called: <Bell size={14} />,
  additional_order: <ShoppingBag size={14} />,
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

// ── Grouping ──────────────────────────────────────────────────────────────────

interface TaskGroup {
  key: string;             // orderId — stable identity for expand state
  orderId: string;
  tableNumber: string | null;
  tasks: WaiterTask[];     // all tasks in this group (filtered set)
  activeTasks: WaiterTask[];
  completedCount: number;
  hasHighPriority: boolean;
  primaryAccent: string;   // border-l color of highest-priority active task
  earliestAt: string;
}

function groupTasksByOrder(tasks: WaiterTask[]): TaskGroup[] {
  const map = new Map<string, WaiterTask[]>();
  for (const task of tasks) {
    if (!map.has(task.orderId)) map.set(task.orderId, []);
    map.get(task.orderId)!.push(task);
  }

  const groups: TaskGroup[] = Array.from(map.entries()).map(([orderId, grpTasks]) => {
    const sorted = [...grpTasks].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const activeTasks = sorted.filter((t) => t.status !== "completed");
    const primaryActive =
      activeTasks.find((t) => TASK_PRIORITY[t.type] === "high") ??
      activeTasks[0] ??
      sorted[0];

    return {
      key: orderId,
      orderId,
      tableNumber: grpTasks[0]?.tableNumber ?? null,
      tasks: sorted,
      activeTasks,
      completedCount: grpTasks.filter((t) => t.status === "completed").length,
      hasHighPriority: activeTasks.some((t) => TASK_PRIORITY[t.type] === "high"),
      primaryAccent: TYPE_ACCENT[primaryActive?.type ?? "ready_to_serve"],
      earliestAt: sorted[0]?.createdAt ?? new Date().toISOString(),
    };
  });

  // Active groups first → high-priority first → oldest first
  return groups.sort((a, b) => {
    const aActive = a.activeTasks.length > 0;
    const bActive = b.activeTasks.length > 0;
    if (aActive !== bActive) return aActive ? -1 : 1;
    if (a.hasHighPriority !== b.hasHighPriority) return a.hasHighPriority ? -1 : 1;
    return a.earliestAt.localeCompare(b.earliestAt);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function filterTasks(tasks: WaiterTask[], filter: TaskFilter): WaiterTask[] {
  switch (filter) {
    case "ready":     return tasks.filter((t) => t.type === "ready_to_serve" && t.status !== "completed");
    case "bills":     return tasks.filter((t) => t.type === "bill_requested" && t.status !== "completed");
    case "calls":     return tasks.filter((t) => t.type === "waiter_called" && t.status !== "completed");
    case "completed": return tasks.filter((t) => t.status === "completed");
    default:          return tasks.filter((t) => t.status !== "completed");
  }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WaiterPage() {
  const [tasks, setTasks] = useState<WaiterTask[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [sessions, setSessions] = useState<TableSession[]>([]);
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [view, setView] = useState<ViewMode>("tasks");
  // Tracks which group (orderId) is expanded — one at a time
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [lang, setLang] = useStaffLang();
  const t = staffT(lang);

  useEffect(() => {
    const refreshOrders = () => {
      const fresh = listOrders();
      setOrders(fresh);
      syncReadyToServeTasks(fresh);
    };
    const refreshTasks = () => setTasks(listTasks());
    const refreshSessions = () => setSessions(listSessions());

    refreshOrders();
    refreshTasks();
    refreshSessions();

    const unsubOrders = subscribeOrders(() => { refreshOrders(); });
    const unsubTasks = subscribeWaiterTasks(refreshTasks);
    const unsubSessions = subscribeSession(refreshSessions);
    return () => { unsubOrders(); unsubTasks(); unsubSessions(); };
  }, []);

  const activeTasks = getActiveTasks(tasks);
  const displayedTasks = filterTasks(tasks, filter);
  const displayedGroups = groupTasksByOrder(displayedTasks);
  const activeTables = countActiveTables(orders);

  const readyCount = activeTasks.filter((tk) => tk.type === "ready_to_serve").length;
  const billCount  = activeTasks.filter((tk) => tk.type === "bill_requested").length;
  const callCount  = activeTasks.filter((tk) => tk.type === "waiter_called").length;
  const { paidInApp } = getPaymentStats(true);

  const toggle = (key: string) => setExpandedKey((p) => (p === key ? null : key));
  const FILTER_LABELS = filterLabels(t);

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
              <h1 className="font-black text-base tracking-tight">{t.waiterTitle}</h1>
              <p className="text-[11px] text-white/40 leading-none">Vaise</p>
              <p className="text-[11px] text-white/30 leading-none mt-0.5">{t.restaurantLabel}: Dzūkų Ainiai</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StaffLangSwitch lang={lang} onChange={setLang} />
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
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-5 space-y-5">

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <SummaryCard label={t.waiterServeFood} value={readyCount} icon={<UtensilsCrossed size={15} />} accent="amber" urgent={readyCount > 0} />
          <SummaryCard label={t.waiterActiveTables} value={activeTables} icon={<Table2 size={15} />} accent="blue" />
          <SummaryCard label={t.waiterBill} value={billCount} icon={<Receipt size={15} />} accent="emerald" urgent={billCount > 0} />
          <SummaryCard label={t.waiterCalls} value={callCount} icon={<Bell size={15} />} accent="red" urgent={callCount > 0} />
          <SummaryCard label={t.waiterPaidInApp} value={paidInApp} icon={<CreditCard size={15} />} accent="violet" />
        </div>

        {/* Active sessions — payment status overview, shown regardless of tasks */}
        <ActiveSessionsSection sessions={sessions} orders={orders} tasks={tasks} lang={lang} t={t} />

        {/* Filter tabs */}
        <div className="flex gap-1 overflow-x-auto pb-0.5 scrollbar-none">
          {(Object.keys(FILTER_LABELS) as TaskFilter[]).map((f) => {
            const count =
              f === "completed" ? tasks.filter((tk) => tk.status === "completed").length
              : f === "all" ? activeTasks.length
              : activeTasks.filter((tk) =>
                  f === "ready" ? tk.type === "ready_to_serve"
                  : f === "bills" ? tk.type === "bill_requested"
                  : tk.type === "waiter_called"
                ).length;
            return (
              <FilterTab key={f} active={filter === f} onClick={() => setFilter(f)} count={count}>
                {FILTER_LABELS[f]}
              </FilterTab>
            );
          })}
        </div>

        {/* Content */}
        {displayedGroups.length === 0 ? (
          <EmptyState filter={filter} t={t} />
        ) : view === "tables" ? (
          <TableView groups={displayedGroups} orders={orders} sessions={sessions} expandedKey={expandedKey} onToggle={toggle} lang={lang} t={t} />
        ) : (
          <GroupList groups={displayedGroups} orders={orders} sessions={sessions} expandedKey={expandedKey} onToggle={toggle} lang={lang} t={t} />
        )}
      </div>
    </div>
  );
}

// ── Active sessions section ───────────────────────────────────────────────────

function sessionPaymentBadge(session: TableSession, orders: Order[]): PaymentBadge {
  if (session.status === "BILL_REQUESTED") return "BILL_REQUESTED";
  const sessionOrders = session.orderIds.map((id) => orders.find((o) => o.id === id)).filter(Boolean) as Order[];
  if (sessionOrders.some((o) => o.isPaid)) return "PAID_APP";
  return "UNPAID";
}

function ActiveSessionsSection({
  sessions, orders, tasks, lang, t,
}: {
  sessions: TableSession[];
  orders: Order[];
  tasks: WaiterTask[];
  lang: StaffLang;
  t: StaffDict;
}) {
  const active = sessions.filter((s) => s.status === "ACTIVE" || s.status === "BILL_REQUESTED");
  if (active.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-white/30">{t.waiterActiveSessions}</p>
      <div className="flex flex-col gap-2">
        {active.map((session) => (
          <ActiveSessionCard key={session.id} session={session} orders={orders} tasks={tasks} lang={lang} t={t} />
        ))}
      </div>
    </div>
  );
}

function ActiveSessionCard({
  session, orders, tasks, lang, t,
}: {
  session: TableSession;
  orders: Order[];
  tasks: WaiterTask[];
  lang: StaffLang;
  t: StaffDict;
}) {
  const sessionOrders = session.orderIds
    .map((id) => orders.find((o) => o.id === id))
    .filter(Boolean) as Order[];

  const total = sessionOrders.reduce((s, o) => s + o.total, 0);
  const paidAmount = sessionOrders.filter((o) => o.isPaid).reduce((s, o) => s + o.total, 0);
  const unpaidAmount = total - paidAmount;

  const activeTaskCount = tasks.filter(
    (tk) => session.orderIds.includes(tk.orderId) && tk.status !== "completed"
  ).length;

  const badge = sessionPaymentBadge(session, orders);
  const isPaidInApp = badge === "PAID_APP";
  const isBillReq = badge === "BILL_REQUESTED";

  return (
    <div className={`rounded-2xl border px-4 py-3 flex items-center gap-3 transition-colors
      ${isBillReq
        ? "bg-amber-400/8 border-amber-400/25"
        : isPaidInApp
          ? "bg-emerald-400/8 border-emerald-400/25"
          : "bg-white/3 border-white/8"}`}
    >
      {/* Table / session identity */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {session.tableNumber && (
            <span className="font-bold text-sm text-white/80">{t.table} {session.tableNumber}</span>
          )}
          <span className="text-xs text-white/35">#{session.id}</span>
          {/* Payment badge */}
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border
            ${badge ? PAYMENT_BADGE_CLS[badge] : "text-white/30 bg-white/5 border-white/10"}`}>
            {badge ? PAYMENT_BADGE_LABEL_I18N[lang][badge] : ""}
          </span>
        </div>

        <div className="flex items-center gap-3 mt-1 text-xs text-white/40 flex-wrap">
          <span>{ordersCount(sessionOrders.length, lang)}</span>
          {paidAmount > 0 && unpaidAmount > 0 && (
            <span className="text-emerald-400/70">{t.waiterPaidAmount} {paidAmount.toFixed(2)} €</span>
          )}
          {activeTaskCount > 0 && (
            <span className="text-amber-400/80">{activeTaskCount} {t.waiterActiveTasksSuffix}</span>
          )}
        </div>
      </div>

      {/* Amount */}
      <div className="text-right shrink-0">
        {unpaidAmount > 0 && unpaidAmount < total ? (
          <>
            <p className="font-black text-base text-white/80">{unpaidAmount.toFixed(2)} €</p>
            <p className="text-[10px] text-white/30">{t.waiterLeftOf} {total.toFixed(2)} €</p>
          </>
        ) : (
          <p className="font-black text-base text-white/80">{total.toFixed(2)} €</p>
        )}
      </div>
    </div>
  );
}

// ── Group list ────────────────────────────────────────────────────────────────

function GroupList({
  groups, orders, sessions, expandedKey, onToggle, lang, t,
}: {
  groups: TaskGroup[];
  orders: Order[];
  sessions: TableSession[];
  expandedKey: string | null;
  onToggle: (key: string) => void;
  lang: StaffLang;
  t: StaffDict;
}) {
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <GroupCard
          key={group.key}
          group={group}
          orders={orders}
          sessions={sessions}
          expanded={expandedKey === group.key}
          onToggle={() => onToggle(group.key)}
          lang={lang}
          t={t}
        />
      ))}
    </div>
  );
}

// ── Table view ────────────────────────────────────────────────────────────────

function TableView({
  groups, orders, sessions, expandedKey, onToggle, lang, t,
}: {
  groups: TaskGroup[];
  orders: Order[];
  sessions: TableSession[];
  expandedKey: string | null;
  onToggle: (key: string) => void;
  lang: StaffLang;
  t: StaffDict;
}) {
  // Re-group by table, preserving the already-grouped structure
  const byTable = new Map<string, TaskGroup[]>();
  for (const group of groups) {
    const key = group.tableNumber ?? "—";
    if (!byTable.has(key)) byTable.set(key, []);
    byTable.get(key)!.push(group);
  }
  const sorted = Array.from(byTable.entries()).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="flex flex-col gap-4">
      {sorted.map(([table, tableGroups]) => {
        const activeCount = tableGroups.reduce((s, g) => s + g.activeTasks.length, 0);
        return (
          <div key={table} className="bg-white/3 border border-white/8 rounded-2xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/8 bg-white/2">
              <Table2 size={13} className="text-white/40" />
              <span className="text-xs font-bold uppercase tracking-widest text-white/50">
                {table === "—" ? t.tableUnset : `${t.table} ${table}`}
              </span>
              <span className="ml-auto text-[11px] text-white/30">{activeCount} {t.waiterActiveShort}</span>
            </div>
            <div className="flex flex-col gap-3 p-3">
              {tableGroups.map((group) => (
                <GroupCard
                  key={group.key}
                  group={group}
                  orders={orders}
                  sessions={sessions}
                  expanded={expandedKey === group.key}
                  onToggle={() => onToggle(group.key)}
                  lang={lang}
                  t={t}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Group card ────────────────────────────────────────────────────────────────

function GroupCard({
  group, orders, sessions, expanded, onToggle, lang, t,
}: {
  group: TaskGroup;
  orders: Order[];
  sessions: TableSession[];
  expanded: boolean;
  onToggle: () => void;
  lang: StaffLang;
  t: StaffDict;
}) {
  const isAllCompleted = group.activeTasks.length === 0;
  const order = orders.find((o) => o.id === group.orderId);
  const paymentBadge = derivePaymentBadge(group.orderId, orders, sessions);

  // Unique task-type labels for the summary line
  const typeLabels = Array.from(new Set(group.tasks.map((tk) => TASK_TYPE_LABEL[lang][tk.type]))).join(" · ");

  return (
    <div className={`border border-white/8 rounded-3xl overflow-hidden border-l-[5px] ${group.primaryAccent} bg-white/3 transition-opacity ${isAllCompleted ? "opacity-40" : ""}`}>

      {/* Collapsed header — always visible */}
      <button onClick={onToggle} className="w-full text-left px-5 py-4">
        <div className="flex items-start gap-3">
          {/* Primary icon */}
          <div className={`mt-0.5 w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border
            ${group.hasHighPriority ? PRIORITY_COLOR["high"] : PRIORITY_COLOR["normal"]}`}>
            {TASK_ICON[group.tasks.find((tk) => tk.status !== "completed")?.type ?? group.tasks[0]?.type ?? "ready_to_serve"]}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-black text-[22px] leading-tight tracking-tight">
                #{group.orderId}
              </span>
              {group.tableNumber && (
                <span className="text-sm font-bold text-white/60 bg-white/10 px-2.5 py-0.5 rounded-full">
                  {t.table} {group.tableNumber}
                </span>
              )}
              {paymentBadge && (
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${PAYMENT_BADGE_CLS[paymentBadge]}`}>
                  {PAYMENT_BADGE_LABEL_I18N[lang][paymentBadge]}
                </span>
              )}
              <span className="ml-auto text-white/30 shrink-0">
                {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </span>
            </div>

            <p className="text-sm text-white/50 mt-0.5 truncate">{typeLabels}</p>

            <div className="flex items-center gap-2 mt-1.5 flex-wrap text-[13px]">
              <span className="text-white/35">{tasksCount(group.tasks.length, lang)}</span>
              {group.completedCount > 0 && (
                <>
                  <span className="text-white/20">·</span>
                  <span className="text-emerald-400">{group.completedCount} {t.waiterDone}</span>
                </>
              )}
              {group.activeTasks.length > 0 && (
                <>
                  <span className="text-white/20">·</span>
                  <span className="text-amber-400">{activeTasksCount(group.activeTasks.length, lang)}</span>
                </>
              )}
              <span className="text-white/20">·</span>
              <Clock size={11} className="text-white/30 shrink-0" />
              <span className="text-white/35">{minutesAgoLabel(group.earliestAt, lang)}</span>
            </div>
          </div>
        </div>
      </button>

      {/* Expanded — individual task rows */}
      {expanded && (
        <div className="border-t border-white/8">
          {/* Order meta (serving pref, notes, total) */}
          {order && (
            <div className="px-5 py-3 border-b border-white/5 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <div>
                <span className="text-white/25 text-xs uppercase tracking-wide">{t.waiterServing} · </span>
                <span className="text-white/60 font-semibold">
                  {SERVING_SHORT[lang][order.servingPreference ?? "together"]}
                </span>
              </div>
              {order.notes && (
                <div>
                  <span className="text-white/25 text-xs uppercase tracking-wide">{t.waiterNotes} · </span>
                  <span className="text-white/60">{order.notes}</span>
                </div>
              )}
              <div>
                <span className="text-white/25 text-xs uppercase tracking-wide">{t.total} · </span>
                <span className="text-white/70 font-bold">{order.total.toFixed(2)} €</span>
              </div>
            </div>
          )}

          {/* One row per task */}
          {group.tasks.map((task, i) => (
            <TaskRow
              key={task.id}
              task={task}
              order={order}
              isLast={i === group.tasks.length - 1}
              lang={lang}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Task row (inside expanded group) ─────────────────────────────────────────

function TaskRow({
  task, order, isLast, lang, t,
}: {
  task: WaiterTask;
  order: Order | undefined;
  isLast: boolean;
  lang: StaffLang;
  t: StaffDict;
}) {
  const isCompleted = task.status === "completed";

  const handleAction = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (task.status === "waiting") {
      updateTaskStatus(task.id, "accepted");
      if (task.type === "ready_to_serve") {
        startItemsDelivery(task.orderId, task.items.map((i) => i.productId));
      }
    } else if (task.status === "accepted") {
      if (task.type === "ready_to_serve") {
        completeItemsDelivery(task.orderId, task.items.map((i) => i.productId));
        updateTaskStatus(task.id, "completed");
      } else if (task.type === "bill_requested") {
        updateTaskStatus(task.id, "completed");
        const session = getActiveSession();
        if (session && session.orderIds.includes(task.orderId)) {
          completeTasksForOrders(session.orderIds);
          markSessionPaid("WAITER");
          clearCartStorage();
        }
      } else {
        updateTaskStatus(task.id, "completed");
      }
    }
  };

  const actionLabel =
    task.type === "bill_requested" && task.status === "accepted"
      ? t.waiterMarkPaid
      : task.status === "waiting"
        ? t.waiterAcceptTask
        : TASK_ACTION_LABEL_I18N[lang][task.type];

  return (
    <div className={`px-5 py-4 ${!isLast ? "border-b border-white/5" : ""} ${isCompleted ? "opacity-45" : ""}`}>
      {/* Row header: type icon + label + items summary + status dot */}
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${PRIORITY_COLOR[TASK_PRIORITY[task.type]]}`}>
          {TASK_ICON_SM[task.type]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-base text-white/85">{TASK_TYPE_LABEL[lang][task.type]}</span>
            {task.items.length === 1 && (
              <span className="text-sm text-white/45 truncate">— {task.items[0].name}</span>
            )}
            {task.items.length > 1 && (
              <span className="text-sm text-white/45">— {dishesCount(task.items.length, lang)}</span>
            )}
          </div>
        </div>
        {/* Status indicator */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`w-2 h-2 rounded-full ${STATUS_DOT[task.status]}`} />
          <span className="text-xs text-white/40">{TASK_STATUS_LABEL_I18N[lang][task.status]}</span>
        </div>
      </div>

      {/* Item details (multiple items in one task) */}
      {task.items.length > 1 && (
        <div className="mt-2 pl-11 space-y-1">
          {task.items.map((item) => {
            const liveStatus = order?.items.find((i) => i.productId === item.productId)?.itemStatus;
            return (
              <div key={item.productId} className="flex items-center justify-between gap-3">
                <span className="text-sm text-white/55">{item.name} ×{item.quantity}</span>
                {liveStatus && <ItemStatusBadge status={liveStatus} lang={lang} />}
              </div>
            );
          })}
        </div>
      )}

      {/* Action button */}
      {!isCompleted && (
        <button
          onClick={handleAction}
          className={`mt-3 w-full h-12 rounded-xl text-sm font-bold transition-colors
            ${task.status === "waiting"
              ? "bg-amber-400/15 text-amber-300 hover:bg-amber-400/25 border border-amber-400/30"
              : task.type === "bill_requested"
                ? "bg-green-500/15 text-green-300 hover:bg-green-500/25 border border-green-500/30"
                : "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/30"}`}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

// ── Item status badge ─────────────────────────────────────────────────────────

function ItemStatusBadge({ status, lang }: { status: string; lang: StaffLang }) {
  const map: Record<string, string> = {
    NEW: "text-amber-400/70 bg-amber-400/10",
    PREPARING: "text-blue-400/70 bg-blue-400/10",
    READY: "text-green-400/70 bg-green-400/10",
    DELIVERING: "text-purple-400/70 bg-purple-400/10",
    COMPLETED: "text-emerald-400/70 bg-emerald-400/10",
    CANCELLED: "text-red-400/70 bg-red-400/10",
  };
  const labels = ORDER_STATUS_LABEL[lang] as Record<string, string>;
  return (
    <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full shrink-0 ${map[status] ?? "text-white/30 bg-white/5"}`}>
      {labels[status] ?? status}
    </span>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ filter, t }: { filter: TaskFilter; t: StaffDict }) {
  const msgs: Record<TaskFilter, string> = {
    all: t.waiterEmptyAll,
    ready: t.waiterEmptyReady,
    bills: t.waiterEmptyBills,
    calls: t.waiterEmptyCalls,
    completed: t.waiterEmptyDone,
  };
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-14 h-14 rounded-2xl bg-white/4 flex items-center justify-center mb-4">
        <CheckCircle2 size={24} className="text-white/20" />
      </div>
      <p className="font-bold text-white/50">{msgs[filter]}</p>
      <p className="text-sm text-white/25 mt-1">{t.waiterEmptyHint}</p>
    </div>
  );
}

// ── UI primitives ─────────────────────────────────────────────────────────────

type Accent = "amber" | "blue" | "emerald" | "red" | "violet";
const ACCENT_CLS: Record<Accent, string> = {
  amber:   "text-amber-400 bg-amber-400/8 border-amber-400/20",
  blue:    "text-blue-400 bg-blue-400/8 border-blue-400/20",
  emerald: "text-emerald-400 bg-emerald-400/8 border-emerald-400/20",
  red:     "text-red-400 bg-red-400/8 border-red-400/20",
  violet:  "text-violet-400 bg-violet-400/8 border-violet-400/20",
};

function SummaryCard({ label, value, icon, accent, urgent = false }: {
  label: string; value: number; icon: React.ReactNode; accent: Accent; urgent?: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-4 flex flex-col gap-2 transition-all ${urgent ? ACCENT_CLS[accent] : "bg-white/3 border-white/8"}`}>
      <div className={`flex items-center gap-1.5 ${urgent ? "" : "text-white/30"}`}>
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p className={`font-black text-3xl tracking-tight ${urgent ? "" : "text-white/60"}`}>{value}</p>
    </div>
  );
}

function FilterTab({ active, onClick, children, count }: {
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
        <span className={`px-1.5 py-0 rounded-full text-[10px] font-bold ${active ? "bg-white/20 text-white" : "bg-white/8 text-white/40"}`}>
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
      className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${active ? "bg-white/15 text-white" : "text-white/35 hover:text-white/60"}`}
    >
      {children}
    </button>
  );
}
