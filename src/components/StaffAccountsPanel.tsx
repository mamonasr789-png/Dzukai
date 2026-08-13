"use client";

import { useCallback, useEffect, useState } from "react";
import { ChefHat, ClipboardList, Trash2, UserPlus } from "lucide-react";
import type { StaffLang } from "@/lib/staff-i18n";

type StaffRole = "waiter" | "kitchen";

interface StaffAccount {
  id: string;
  username: string;
  role: "admin" | StaffRole;
  createdAt: string;
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
    passwordTooShort: "Slaptažodis turi būti bent 8 simbolių.",
    genericError: "Nepavyko. Bandykite dar kartą.",
    createdAt: "Sukurta",
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
    passwordTooShort: "Password must be at least 8 characters.",
    genericError: "Something went wrong. Try again.",
    createdAt: "Created",
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
  }, []);

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
      if (res.status === 400) {
        setError(t.passwordTooShort);
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

  if (!loaded) return null;

  return (
    <section>
      <p className="text-[11px] font-semibold uppercase tracking-widest text-white/30 mb-3">
        {t.title}
      </p>

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
              className="bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary/50"
            >
              <option value="waiter">{t.waiter}</option>
              <option value="kitchen">{t.kitchen}</option>
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
          {accounts.map((account) => (
            <div key={account.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center text-white/50">
                  {account.role === "kitchen" ? <ChefHat size={14} /> : <ClipboardList size={14} />}
                </div>
                <div>
                  <p className="text-sm font-semibold">{account.username}</p>
                  <p className="text-[11px] text-white/40">
                    {account.role === "kitchen" ? t.kitchen : account.role === "waiter" ? t.waiter : account.role}
                    {" · "}
                    {t.createdAt} {new Date(account.createdAt).toLocaleDateString(lang === "en" ? "en-GB" : "lt-LT")}
                  </p>
                </div>
              </div>
              {account.role === "admin" ? null : confirmingDelete === account.id ? (
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
                <button
                  onClick={() => setConfirmingDelete(account.id)}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 size={12} />
                  {t.delete}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
