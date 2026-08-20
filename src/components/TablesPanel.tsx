"use client";

import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { ChevronDown, ChevronUp, Copy, Plus, QrCode as QrCodeIcon, Trash2 } from "lucide-react";
import type { StaffLang } from "@/lib/staff-i18n";
import CollapsibleSection from "./CollapsibleSection";

interface RestaurantTable {
  id: string;
  tableNumber: string;
  createdAt: string;
  link: string | null;
  waiterId: string | null;
}

interface WaiterAccountLite {
  id: string;
  username: string;
}

const TEXT: Record<StaffLang, Record<string, string>> = {
  lt: {
    title: "Stalai",
    tableNumber: "Stalo numeris",
    create: "Pridėti stalą",
    creating: "Kuriama…",
    empty: "Kol kas nė vieno stalo nesukurta.",
    delete: "Ištrinti",
    confirmDelete: "Tikrai ištrinti?",
    yes: "Taip",
    no: "Ne",
    tableTaken: "Toks stalo numeris jau yra.",
    genericError: "Nepavyko. Bandykite dar kartą.",
    notConfigured: "QR raktas nesukonfigūruotas serveryje.",
    copy: "Kopijuoti nuorodą",
    copied: "Nukopijuota!",
    showQr: "Rodyti QR",
    hideQr: "Slėpti QR",
    waiterLabel: "Padavėjas",
    unassigned: "Nepriskirta",
  },
  en: {
    title: "Tables",
    tableNumber: "Table number",
    create: "Add table",
    creating: "Creating…",
    empty: "No tables created yet.",
    delete: "Delete",
    confirmDelete: "Delete for real?",
    yes: "Yes",
    no: "No",
    tableTaken: "That table number already exists.",
    genericError: "Something went wrong. Try again.",
    notConfigured: "The QR secret isn't configured on the server.",
    copy: "Copy link",
    copied: "Copied!",
    showQr: "Show QR",
    hideQr: "Hide QR",
    waiterLabel: "Waiter",
    unassigned: "Unassigned",
  },
};

export default function TablesPanel({ lang }: { lang: StaffLang }) {
  const t = TEXT[lang];
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tableNumber, setTableNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [qrByTable, setQrByTable] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [waiters, setWaiters] = useState<WaiterAccountLite[]>([]);
  const [assigningId, setAssigningId] = useState<string | null>(null);

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const refresh = useCallback(async () => {
    const res = await fetch("/api/staff/tables");
    if (!res.ok) return;
    const data = (await res.json()) as { tables: RestaurantTable[] };
    setTables(data.tables);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    fetch("/api/staff/accounts")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { accounts: Array<{ id: string; username: string; role: string }> } | null) => {
        if (!data) return;
        setWaiters(data.accounts.filter((a) => a.role === "waiter").map((a) => ({ id: a.id, username: a.username })));
      });
  }, []);

  async function handleAssignWaiter(tableId: string, waiterId: string | null) {
    setAssigningId(tableId);
    try {
      const res = await fetch(`/api/staff/tables/${tableId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waiterId }),
      });
      if (res.ok) await refresh();
    } finally {
      setAssigningId(null);
    }
  }

  // Render a table's QR as a data URL only once it's actually expanded —
  // generating all of them up front doesn't cost much per-table, but there's
  // no reason to pay it for tables nobody has opened yet.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        tables
          .filter((table) => expandedIds.has(table.id) && table.link && !qrByTable[table.id])
          .map(async (table) => {
            const url = `${window.location.origin}${table.link}`;
            const dataUrl = await QRCode.toDataURL(url, { width: 176, margin: 1 });
            return [table.id, dataUrl] as const;
          })
      );
      if (!cancelled && entries.length > 0) {
        setQrByTable((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables, expandedIds]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/staff/tables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableNumber }),
      });
      // Refresh regardless of outcome — a 409 ("already exists") can mean an
      // earlier attempt actually succeeded server-side even though its own
      // response looked like a failure, so the list must always be re-synced
      // rather than only on the happy path.
      await refresh();
      if (res.status === 409) {
        setError(t.tableTaken);
        return;
      }
      if (!res.ok) {
        setError(t.genericError);
        return;
      }
      setTableNumber("");
    } catch {
      setError(t.genericError);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/staff/tables/${id}`, { method: "DELETE" });
    if (res.ok) await refresh();
    setConfirmingDelete(null);
  }

  async function handleCopy(id: string, link: string) {
    await navigator.clipboard.writeText(`${window.location.origin}${link}`);
    setCopiedId(id);
    setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1500);
  }

  if (!loaded) return null;

  return (
    <CollapsibleSection title={t.title} count={tables.length}>
      <div className="border border-white/8 rounded-xl bg-white/3 p-4 mb-3">
        <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-white/40">{t.tableNumber}</label>
            <input
              value={tableNumber}
              onChange={(e) => setTableNumber(e.target.value)}
              required
              minLength={1}
              maxLength={20}
              className="bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-sm w-32 focus:outline-none focus:border-primary/50"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary/20 text-primary hover:bg-primary/30 border border-primary/30 transition-colors disabled:opacity-50"
          >
            <Plus size={13} />
            {submitting ? t.creating : t.create}
          </button>
        </form>
        {error && <p className="text-[11px] text-red-400 mt-2">{error}</p>}
      </div>

      {tables.length === 0 ? (
        <div className="border border-white/8 rounded-xl bg-white/3 p-4">
          <p className="text-white/40 text-sm">{t.empty}</p>
        </div>
      ) : (
        <div className="border border-white/8 rounded-xl bg-white/3 divide-y divide-white/5">
          {tables.map((table) => {
            const expanded = expandedIds.has(table.id);
            return (
              <div key={table.id}>
                {/* Collapsed row — always visible */}
                <div className="flex items-center gap-3 px-4 py-3 flex-wrap">
                  <QrCodeIcon size={14} className="text-white/40 shrink-0" />
                  <p className="text-sm font-semibold flex-1 min-w-0 truncate">{table.tableNumber}</p>
                  <select
                    value={table.waiterId ?? ""}
                    disabled={assigningId === table.id}
                    onChange={(e) => handleAssignWaiter(table.id, e.target.value || null)}
                    title={t.waiterLabel}
                    className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-[11px] text-white/60 focus:outline-none focus:border-primary/50 shrink-0 disabled:opacity-50 max-w-[120px]"
                  >
                    <option value="">{t.unassigned}</option>
                    {waiters.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.username}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => toggleExpanded(table.id)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-white/50 hover:text-primary hover:bg-primary/10 transition-colors border border-white/10 shrink-0"
                  >
                    {expanded ? t.hideQr : t.showQr}
                    {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>
                  {confirmingDelete === table.id ? (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleDelete(table.id)}
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
                      onClick={() => setConfirmingDelete(table.id)}
                      className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>

                {/* Expanded — QR image + copy link */}
                {expanded && (
                  <div className="px-4 pb-4 flex flex-col items-center gap-3 border-t border-white/5 pt-4">
                    {table.link ? (
                      qrByTable[table.id] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={qrByTable[table.id]} alt={table.tableNumber} width={176} height={176} className="rounded-lg bg-white p-2" />
                      ) : (
                        <div className="w-[176px] h-[176px] rounded-lg bg-white/5 animate-pulse" />
                      )
                    ) : (
                      <p className="text-[11px] text-red-400 text-center">{t.notConfigured}</p>
                    )}
                    {table.link && (
                      <button
                        onClick={() => handleCopy(table.id, table.link!)}
                        className="w-full flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[11px] text-white/50 hover:text-primary hover:bg-primary/10 transition-colors border border-white/10"
                      >
                        <Copy size={12} />
                        {copiedId === table.id ? t.copied : t.copy}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </CollapsibleSection>
  );
}
