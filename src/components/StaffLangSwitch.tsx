"use client";

/**
 * LT / EN toggle for staff panels (/admin, /kitchen, /waiter).
 * Reads and writes the shared staff language via useStaffLang.
 *
 * `variant` matches the host panel's chrome:
 *   "dark"  — white-on-dark pills (waiter/admin panels)
 *   "panel" — theme-aware pills (kitchen, which has its own light/dark theme)
 */

import type { StaffLang } from "@/lib/staff-i18n";

export default function StaffLangSwitch({
  lang,
  onChange,
  variant = "dark",
}: {
  lang: StaffLang;
  onChange: (l: StaffLang) => void;
  variant?: "dark" | "panel";
}) {
  const wrap =
    variant === "dark"
      ? "flex gap-1 bg-white/5 border border-white/10 rounded-xl p-1"
      : "flex gap-1 bg-secondary rounded-xl p-1";

  const btn = (active: boolean) =>
    variant === "dark"
      ? `px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
          active ? "bg-white/15 text-white" : "text-white/35 hover:text-white/60"
        }`
      : `px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
          active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
        }`;

  return (
    <div className={wrap}>
      {(["lt", "en"] as StaffLang[]).map((l) => (
        <button key={l} onClick={() => onChange(l)} className={btn(lang === l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
