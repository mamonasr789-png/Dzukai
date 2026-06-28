"use client";

import { useCartStore, Lang } from "@/lib/store";
import { cn } from "@/lib/utils";

const LANGS: { id: Lang; label: string }[] = [
  { id: "lt", label: "LT" },
  { id: "en", label: "EN" },
  { id: "ru", label: "RU" },
];

export default function LanguageSwitcher() {
  const { lang, setLang } = useCartStore();
  return (
    <div className="flex items-center gap-0.5 bg-secondary rounded-full p-0.5">
      {LANGS.map((l) => (
        <button
          key={l.id}
          onClick={() => setLang(l.id)}
          className={cn(
            "px-2.5 py-1 rounded-full text-[11px] font-bold transition-all",
            lang === l.id
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
