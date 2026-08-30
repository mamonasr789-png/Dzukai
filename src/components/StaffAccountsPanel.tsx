"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChefHat, ClipboardList, KeyRound, Trash2, UserPlus } from "lucide-react";
import type { StaffLang } from "@/lib/staff-i18n";
import { useStaffOrders } from "@/lib/hooks/useStaffOrders";
import { useStaffTasks } from "@/lib/hooks/useStaffTasks";
import { getStaffActivityToday } from "@/lib/analytics";
import CollapsibleSection from "./CollapsibleSection";

type StaffRole = "waiter" | "kitchen";

interface StaffAccount {
  id: string;
  username: string;
  role: "admin" | StaffRole;
  createdAt: string;
  lastSeenAt: string | null;
}

/** Pinged every 30s by active tabs — a ping within this window counts as "online". */
const ONLINE_WINDOW_MS = 90_000;
const ACCOUNTS_POLL_MS = 20_000;

function isOnline(lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < ONLINE_WINDOW_MS;
}

const TEXT: Record<StaffLang, Record<string, string>> = {
  lt: {
    title: "Darbuotojų paskyros",
    username: "Vartotojo vardas",
    password: "Slaptažodis",
    role: "Pareigos",
    waiter: "Padavėjas",
    kitchen: "Virėjas",
    create: "Sukurti paskyrą",
    creating: "Kuriama…",
    empty: "Kol kas paskyrų nesukurta.",
    delete: "Ištrinti",
    confirmDelete: "Tikrai ištrinti?",
    yes: "Taip",
    no: "Ne",
    usernameTaken: "Toks vartotojo vardas jau užimtas.",
    genericError: "Nepavyko. Bandykite dar kartą.",
    createdAt: "Sukurta",
    online: "Dirba dabar",
    offline: "Neprisijungęs",
    prepared: "paruošta",
    delivered: "pristatyta",
    tasksDone: "užduočių atlikta",
    noActivityToday: "Šiandien dar nieko neatliko.",
    resetPassword: "Keisti slaptažodį",
    resetPasswordPlaceholder: "Naujas slaptažodis",
    save: "Išsaugoti",
  },
  en: {
    title: "Staff accounts",
    username: "Username",
    password: "Password",
    role: "Role",
    waiter: "Waiter",
    kitchen: "Kitchen",
    create: "Create account",
    creating: "Creating…",
    empty: "No accounts yet.",
    delete: "Delete",
    confirmDelete: "Delete for real?",
    yes: "Yes",
    no: "No",
    usernameTaken: "That username is already taken.",
    genericError: "Something went wrong. Try again.",
    createdAt: "Created",
    online: "Working now",
    offline: "Offline",
    prepared: "prepared",
    delivered: "delivered",
    tasksDone: "tasks done",
    noActivityToday: "No activity yet today.",
    resetPassword: "Reset password",
    resetPasswordPlaceholder: "New password",
    save: "Save",
  },
};

export default function StaffAccountsPanel({ lang }: { lang: StaffLang }) {
  const t = TEXT[lang];
  const [accounts, setAccounts] = useState<StaffAccount[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<StaffRole>("waiter");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [resettingFor, setResettingFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetSubmitting, setResetSubmitting] = useState(false);

  const { orders } = useStaffOrders();
  const { tasks } = useStaffTasks();

  const refresh = useCallback(async () => {
    const res = await fetch("/api/staff/accounts");
    if (!res.ok) return;
    const data = (await res.json()) as { accounts: StaffAccount[] };
    setAccounts(data.accounts);
    setLoaded(true);
  }, []);

  useEffect(() => {
    fetch("/api/staff/accounts")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { accounts: StaffAccount[] } | null) => {
        if (!data) return;
        setAccounts(data.accounts);
        setLoaded(true);
      });
    // Polling (rather than a push channel) keeps the online dot and account
    // list fresh without adding another sync mechanism to the project.
    const interval = setInterval(() => {
      fetch("/api/staff/accounts")
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { accounts: StaffAccount[] } | null) => {
          if (data) setAccounts(data.accounts);
        });
    }, ACCOUNTS_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  const activityByStaffId = useMemo(() => getStaffActivityToday(orders, tasks), [orders, tasks]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/staff/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, role }),
      });
      if (res.status === 409) {
        setError(t.usernameTaken);
        return;
      }
      if (!res.ok) {
        setError(t.genericError);
        return;
      }
      setUsername("");
      setPassword("");
      await refresh();
    } catch {
      setError(t.genericError);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/staff/accounts/${id}`, { method: "DELETE" });
    if (res.ok) await refresh();
    setConfirmingDelete(null);
  }

  async function handleResetPassword(e: React.FormEvent, id: string) {
    e.preventDefault();
    setResetSubmitting(true);
    try {
      const res = await fetch(`/api/staff/accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
      });
      if (res.ok) {
        setResettingFor(null);
        setNewPassword("");
      }
    } finally {
      setResetSubmitting(false);
    }
  }

  if (!loaded) return null;

  return (
    <CollapsibleSection title={t.title} count={accounts.length}>
      <div className="staff-accounts-panel">
      <div className="border border-white/8 rounded-xl bg-white/3 p-4 mb-3">
        <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-white/40">{t.username}</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              maxLength={40}
              className="bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-sm w-40 focus:outline-none focus:border-primary/50"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-white/40">{t.password}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              maxLength={200}
              className="bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-sm w-40 focus:outline-none focus:border-primary/50"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-white/40">{t.role}</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as StaffRole)}
              className="bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-primary/50"
            >
              <option value="waiter" className="bg-zinc-900 text-white">{t.waiter}</option>
              <option value="kitchen" className="bg-zinc-900 text-white">{t.kitchen}</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary/20 text-primary hover:bg-primary/30 border border-primary/30 transition-colors disabled:opacity-50"
          >
            <UserPlus size={13} />
            {submitting ? t.creating : t.create}
          </button>
        </form>
        {error && <p className="text-[11px] text-red-400 mt-2">{error}</p>}
      </div>

      {accounts.length === 0 ? (
        <div className="border border-white/8 rounded-xl bg-white/3 p-4">
          <p className="text-white/40 text-sm">{t.empty}</p>
        </div>
      ) : (
        <div className="border border-white/8 rounded-xl bg-white/3 divide-y divide-white/5">
          {accounts.map((account) => {
            const online = isOnline(account.lastSeenAt);
            const activity = activityByStaffId.get(account.id);
            return (
            <div key={account.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <div className="relative w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center text-white/50">
                  {account.role === "kitchen" ? <ChefHat size={14} /> : <ClipboardList size={14} />}
                  <span
                    title={online ? t.online : t.offline}
                    className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#0a0a0f] ${online ? "bg-emerald-400" : "bg-white/20"}`}
                  />
                </div>
                <div>
                  <p className="text-sm font-semibold">{account.username}</p>
                  <p className="text-[11px] text-white/40">
                    {account.role === "kitchen" ? t.kitchen : account.role === "waiter" ? t.waiter : account.role}
                    {" · "}
                    {t.createdAt} {new Date(account.createdAt).toLocaleDateString(lang === "en" ? "en-GB" : "lt-LT")}
                  </p>
                  {account.role !== "admin" && (
                    <p className="text-[11px] text-white/30 mt-0.5">
                      {activity
                        ? [
                            account.role === "kitchen" && activity.preparedCount > 0
                              ? `${activity.preparedCount} ${t.prepared}`
                              : null,
                            account.role === "waiter" && activity.deliveredCount > 0
                              ? `${activity.deliveredCount} ${t.delivered}`
                              : null,
                            account.role === "waiter" && activity.tasksCompletedCount > 0
                              ? `${activity.tasksCompletedCount} ${t.tasksDone}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || t.noActivityToday
                        : t.noActivityToday}
                    </p>
                  )}
                </div>
              </div>
              {account.role === "admin" ? null : resettingFor === account.id ? (
                <form
                  onSubmit={(e) => handleResetPassword(e, account.id)}
                  className="flex items-center gap-1.5"
                >
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder={t.resetPasswordPlaceholder}
                    required
                    minLength={8}
                    maxLength={200}
                    autoFocus
                    className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-[11px] w-32 focus:outline-none focus:border-primary/50"
                  />
                  <button
                    type="submit"
                    disabled={resetSubmitting}
                    className="px-2 py-1 rounded-md text-[11px] font-bold bg-primary/20 text-primary hover:bg-primary/30 border border-primary/30 disabled:opacity-50"
                  >
                    {t.save}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setResettingFor(null);
                      setNewPassword("");
                    }}
                    className="px-2 py-1 rounded-md text-[11px] text-white/40 hover:text-white/70"
                  >
                    {t.no}
                  </button>
                </form>
              ) : confirmingDelete === account.id ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-red-400/80">{t.confirmDelete}</span>
                  <button
                    onClick={() => handleDelete(account.id)}
                    className="px-2 py-1 rounded-md text-[11px] font-bold bg-red-500/20 text-red-400 hover:bg-red-500/35 border border-red-500/40"
                  >
                    {t.yes}
                  </button>
                  <button
                    onClick={() => setConfirmingDelete(null)}
                    className="px-2 py-1 rounded-md text-[11px] text-white/40 hover:text-white/70"
                  >
                    {t.no}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setResettingFor(account.id)}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-white/30 hover:text-primary hover:bg-primary/10 transition-colors"
                  >
                    <KeyRound size={12} />
                    {t.resetPassword}
                  </button>
                  <button
                    onClick={() => setConfirmingDelete(account.id)}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 size={12} />
                    {t.delete}
                  </button>
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}
      </div>
    </CollapsibleSection>
  );
}
