"use client";

import { useState } from "react";
import { Bot, RefreshCw, Send, Sparkles } from "lucide-react";
import type { StaffLang } from "@/lib/staff-i18n";

const TEXT: Record<StaffLang, Record<string, string>> = {
  lt: {
    title: "AI analitika",
    refresh: "Atnaujinti apžvalgą",
    loading: "Analizuojama…",
    empty: "Paspausk „Atnaujinti apžvalgą“, kad AI peržvelgtų dabartinius duomenis.",
    askPlaceholder: "Klausk apie užsakymus, pajamas, personalą…",
    ask: "Klausti",
    asking: "Klausiama…",
    unavailable: "AI šiuo metu nepasiekiamas. Bandykite vėliau.",
    notConfigured: "Duomenų bazė nesukonfigūruota.",
  },
  en: {
    title: "AI analytics",
    refresh: "Refresh overview",
    loading: "Analyzing…",
    empty: "Press \"Refresh overview\" to have the AI look at current data.",
    askPlaceholder: "Ask about orders, revenue, staff…",
    ask: "Ask",
    asking: "Asking…",
    unavailable: "AI is currently unavailable. Try again later.",
    notConfigured: "The data store isn't configured.",
  },
};

export default function AdminAiPanel({ lang }: { lang: StaffLang }) {
  const t = TEXT[lang];
  const [summary, setSummary] = useState<string | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);

  async function refreshSummary() {
    setLoadingSummary(true);
    setSummaryError(null);
    try {
      const res = await fetch("/api/staff/ai-analytics");
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setSummaryError(data.error === "store_not_configured" ? t.notConfigured : t.unavailable);
        return;
      }
      setSummary(data.summary);
    } catch {
      setSummaryError(t.unavailable);
    } finally {
      setLoadingSummary(false);
    }
  }

  async function handleAsk(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setAsking(true);
    setAskError(null);
    setAnswer(null);
    try {
      const res = await fetch("/api/staff/ai-analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setAskError(t.unavailable);
        return;
      }
      setAnswer(data.answer);
    } catch {
      setAskError(t.unavailable);
    } finally {
      setAsking(false);
    }
  }

  return (
    <section>
      <p className="text-[11px] font-semibold uppercase tracking-widest text-white/30 mb-3 flex items-center gap-1.5">
        <Sparkles size={12} />
        {t.title}
      </p>

      <div className="border border-white/8 rounded-xl bg-white/3 p-4 mb-3">
        <button
          onClick={refreshSummary}
          disabled={loadingSummary}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary/20 text-primary hover:bg-primary/30 border border-primary/30 transition-colors disabled:opacity-50 mb-3"
        >
          <RefreshCw size={13} className={loadingSummary ? "animate-spin" : ""} />
          {loadingSummary ? t.loading : t.refresh}
        </button>

        {summaryError && <p className="text-[11px] text-red-400 mb-2">{summaryError}</p>}
        {!summary && !summaryError && !loadingSummary && (
          <p className="text-white/40 text-sm">{t.empty}</p>
        )}
        {summary && (
          <div className="flex items-start gap-2">
            <Bot size={16} className="text-primary shrink-0 mt-0.5" />
            <p className="text-sm text-white/80 whitespace-pre-line leading-relaxed">{summary}</p>
          </div>
        )}
      </div>

      <div className="border border-white/8 rounded-xl bg-white/3 p-4">
        <form onSubmit={handleAsk} className="flex items-center gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t.askPlaceholder}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary/50"
          />
          <button
            type="submit"
            disabled={asking || !question.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary/20 text-primary hover:bg-primary/30 border border-primary/30 transition-colors disabled:opacity-50 shrink-0"
          >
            <Send size={13} />
            {asking ? t.asking : t.ask}
          </button>
        </form>
        {askError && <p className="text-[11px] text-red-400 mt-2">{askError}</p>}
        {answer && (
          <div className="flex items-start gap-2 mt-3 pt-3 border-t border-white/5">
            <Bot size={16} className="text-primary shrink-0 mt-0.5" />
            <p className="text-sm text-white/80 whitespace-pre-line leading-relaxed">{answer}</p>
          </div>
        )}
      </div>
    </section>
  );
}
