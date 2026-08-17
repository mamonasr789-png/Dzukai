"use client";

import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { Copy, Plus, QrCode as QrCodeIcon, Trash2 } from "lucide-react";
import type { StaffLang } from "@/lib/staff-i18n";

interface RestaurantTable {
  id: string;
  tableNumber: string;
  createdAt: string;
  link: string | null;
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

  // Render each table's QR as a data URL once its link is known.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        tables
          .filter((table) => table.link && !qrByTable[table.id])
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
  }, [tables]);

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
      if (res.status === 409) {
        setError(t.tableTaken);
        return;
      }
      if (!res.ok) {
        setError(t.genericError);
        return;
      }
      setTableNumber("");
      await refresh();
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
    <section>
      <p className="text-[11px] font-semibold uppercase tracking-widest text-white/30 mb-3">
        {t.title}
      </p>

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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {tables.map((table) => (
            <div key={table.id} className="border border-white/8 rounded-xl bg-white/3 p-4 flex flex-col items-center gap-3">
              <div className="flex items-center gap-1.5 self-start">
                <QrCodeIcon size={14} className="text-white/40" />
                <p className="text-sm font-semibold">{table.tableNumber}</p>
              </div>
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
              <div className="flex items-center gap-1 w-full">
                {table.link && (
                  <button
                    onClick={() => handleCopy(table.id, table.link!)}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[11px] text-white/50 hover:text-primary hover:bg-primary/10 transition-colors border border-white/10"
                  >
                    <Copy size={12} />
                    {copiedId === table.id ? t.copied : t.copy}
                  </button>
                )}
                {confirmingDelete === table.id ? (
                  <div className="flex items-center gap-1">
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
                    className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
