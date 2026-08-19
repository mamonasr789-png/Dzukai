"use client";

import { useState } from "react";
import { Bot, CalendarRange, RefreshCw, Send, Sparkles } from "lucide-react";
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
    weekReport: "Savaitės ataskaita",
    monthReport: "Mėnesio ataskaita",
    reportLoading: "Ruošiama gili analizė…",
    reportEmpty: "Paspausk mygtuką, kad AI paruoštų gilią savaitės ar mėnesio verslo ataskaitą su rekomendacijomis.",
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
    weekReport: "Weekly report",
    monthReport: "Monthly report",
    reportLoading: "Preparing deep analysis…",
    reportEmpty: "Press a button to have the AI prepare a deep weekly or monthly business report with recommendations.",
  },
};

const BULLET_RE = /^[-*]\s+/;
const NUMBERED_RE = /^\d+[.)]\s+/;

/** "**bold**" → <strong> — the only inline markdown Gemini's report prompt tends to produce. */
function inlineMarkdown(line: string): React.ReactNode[] {
  const parts = line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part
  );
}

function stripMarker(line: string): string {
  return line.trim().replace(BULLET_RE, "").replace(NUMBERED_RE, "");
}

function ListBlock({ lines, ordered }: { lines: string[]; ordered: boolean }) {
  const items = lines.map((l, j) => <li key={j}>{inlineMarkdown(stripMarker(l))}</li>);
  return ordered ? <ol className="list-decimal">{items}</ol> : <ul>{items}</ul>;
}

type LineKind = "bullet" | "numbered" | "text";
function classify(line: string): LineKind {
  const trimmed = line.trim();
  if (BULLET_RE.test(trimmed)) return "bullet";
  if (NUMBERED_RE.test(trimmed)) return "numbered";
  return "text";
}

/**
 * Renders one block's lines as a run of paragraphs/lists, grouping consecutive
 * same-kind lines together — Gemini's reports often mix a numbered top level
 * with bulleted sub-points under each number, which a single all-lines-must-
 * match check can't represent; this at least keeps every line's marker
 * stripped and groups what it visibly can, rather than dumping raw "* "/"1."
 * text into one paragraph.
 */
function renderLines(lines: string[], keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const kind = classify(lines[i]);
    if (kind === "text") {
      nodes.push(<p key={`${keyPrefix}-${i}`}>{inlineMarkdown(lines[i])}</p>);
      i++;
      continue;
    }
    const group: string[] = [];
    while (i < lines.length && classify(lines[i]) === kind) {
      group.push(lines[i]);
      i++;
    }
    nodes.push(<ListBlock key={`${keyPrefix}-${i}`} lines={group} ordered={kind === "numbered"} />);
  }
  return nodes;
}

/**
 * Renders the report's constrained markdown subset (## headings, "- "/"1. "
 * lists, "**bold**", blank-line-separated paragraphs) without pulling in a
 * markdown dependency — the prompt only ever asks Gemini for those constructs.
 */
function ReportMarkdown({ text, period, lang }: { text: string; period: "week" | "month" | null; lang: StaffLang }) {
  const periodLabel = period ? (lang === "lt" ? (period === "week" ? "Savaitės ataskaita" : "Mėnesio ataskaita") : (period === "week" ? "Weekly report" : "Monthly report")) : null;
  const blocks = text.split(/\n{2,}/);
  return (
    <div>
      {periodLabel && <p className="text-xs text-white/40 mb-2">{periodLabel}</p>}
      {blocks.map((block, i) => {
        const lines = block.split("\n").filter((l) => l.trim());
        if (lines.length === 0) return null;
        if (lines[0].startsWith("## ")) {
          const heading = lines[0].slice(3).trim();
          return (
            <div key={i}>
              <h2>{heading}</h2>
              {renderLines(lines.slice(1), `h${i}`)}
            </div>
          );
        }
        return <div key={i}>{renderLines(lines, `b${i}`)}</div>;
      })}
    </div>
  );
}

export default function AdminAiPanel({ lang }: { lang: StaffLang }) {
  const t = TEXT[lang];
  const [summary, setSummary] = useState<string | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);

  const [report, setReport] = useState<string | null>(null);
  const [reportPeriod, setReportPeriod] = useState<"week" | "month" | null>(null);
  const [loadingReport, setLoadingReport] = useState<"week" | "month" | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);

  async function refreshSummary() {
    setLoadingSummary(true);
    setSummaryError(null);
    try {
      const res = await fetch(`/api/staff/ai-analytics?lang=${lang}`);
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

  async function loadReport(period: "week" | "month") {
    setLoadingReport(period);
    setReportError(null);
    try {
      const res = await fetch(`/api/staff/ai-analytics/report?period=${period}&lang=${lang}`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setReportError(data.error === "store_not_configured" ? t.notConfigured : t.unavailable);
        return;
      }
      setReport(data.report);
      setReportPeriod(period);
    } catch {
      setReportError(t.unavailable);
    } finally {
      setLoadingReport(null);
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
        body: JSON.stringify({ question: question.trim(), lang }),
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
      <p className="text-[11px] font-semibold uppercase tracking-widest text-white mb-3 flex items-center gap-1.5">
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

      <div className="border border-white/8 rounded-xl bg-white/3 p-4 mb-3">
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => loadReport("week")}
            disabled={loadingReport !== null}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary/20 text-primary hover:bg-primary/30 border border-primary/30 transition-colors disabled:opacity-50"
          >
            <CalendarRange size={13} className={loadingReport === "week" ? "animate-pulse" : ""} />
            {t.weekReport}
          </button>
          <button
            onClick={() => loadReport("month")}
            disabled={loadingReport !== null}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary/20 text-primary hover:bg-primary/30 border border-primary/30 transition-colors disabled:opacity-50"
          >
            <CalendarRange size={13} className={loadingReport === "month" ? "animate-pulse" : ""} />
            {t.monthReport}
          </button>
        </div>

        {loadingReport && <p className="text-white/40 text-sm">{t.reportLoading}</p>}
        {reportError && !loadingReport && <p className="text-[11px] text-red-400 mb-2">{reportError}</p>}
        {!report && !reportError && !loadingReport && (
          <p className="text-white/40 text-sm">{t.reportEmpty}</p>
        )}
        {report && !loadingReport && (
          <div className="flex items-start gap-2">
            <Bot size={16} className="text-primary shrink-0 mt-0.5" />
            <div className="text-sm text-white/80 leading-relaxed [&_h2]:text-primary [&_h2]:font-bold [&_h2]:text-xs [&_h2]:uppercase [&_h2]:tracking-wide [&_h2]:mt-4 [&_h2]:mb-1.5 [&_h2:first-child]:mt-0 [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:space-y-0.5 [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:space-y-0.5 [&_strong]:text-white/95 [&_p]:mb-2">
              <ReportMarkdown text={report} period={reportPeriod} lang={lang} />
            </div>
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
