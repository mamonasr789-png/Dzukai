"use client";

import { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import { useCartStore } from "@/lib/store";
import { useT } from "@/lib/i18n";
import {
  ALLERGEN_I18N_KEY,
  GUEST_ALLERGEN_IDS,
  markAllergenPromptSeen,
  uniqueValidGuestAllergens,
  wasAllergenPromptSeen,
  type GuestAllergenId,
} from "@/lib/allergens";
import { cn } from "@/lib/utils";

/**
 * Night-one allergen sheet on /menu. sessionStorage is keyed by the table
 * number from the table-access cookie so a new scan can re-prompt. The guest
 * must tap continue — there is no auto-dismiss.
 */
export default function AllergenPrompt({
  tableNumber,
}: {
  tableNumber: string | null;
}) {
  const lang = useCartStore((s) => s.lang);
  const setGuestAllergens = useCartStore((s) => s.setGuestAllergens);
  const tr = useT(lang);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<GuestAllergenId[]>([]);

  useEffect(() => {
    if (tableNumber && !wasAllergenPromptSeen(tableNumber)) {
      setSelected([]);
      setOpen(true);
    }
  }, [tableNumber]);

  const finish = (allergens: GuestAllergenId[]) => {
    setGuestAllergens(uniqueValidGuestAllergens(allergens));
    if (tableNumber) markAllergenPromptSeen(tableNumber);
    setOpen(false);
  };

  const toggle = (id: GuestAllergenId) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 supports-backdrop-filter:backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="allergen-prompt-title"
    >
      <div className="w-full max-w-lg bg-popover text-popover-foreground rounded-t-3xl shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex justify-center pt-3 pb-0">
          <div className="w-10 h-1 rounded-full bg-border" />
        </div>
        <div className="px-5 pt-4 pb-8">
          <div className="flex items-start gap-2">
            <AlertCircle size={18} className="text-orange-500 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <h2 id="allergen-prompt-title" className="font-black text-lg leading-tight">
                {tr.allergen_prompt_title}
              </h2>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                {tr.allergen_prompt_body}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mt-4">
            {GUEST_ALLERGEN_IDS.map((id) => {
              const active = selected.includes(id);
              const label = String(tr[ALLERGEN_I18N_KEY[id]]);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggle(id)}
                  className={cn(
                    "px-3.5 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap transition-all border",
                    active
                      ? "bg-orange-500 text-white border-transparent shadow-sm"
                      : "bg-card text-foreground border-border/50"
                  )}
                  aria-pressed={active}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => finish(selected)}
            className="mt-5 w-full h-14 rounded-2xl bg-primary text-primary-foreground font-bold text-sm active:scale-[0.98] transition-all shadow-lg shadow-primary/25"
          >
            {tr.allergen_prompt_continue}
          </button>
          <button
            type="button"
            onClick={() => finish([])}
            className="mt-2 w-full h-12 rounded-2xl bg-secondary text-foreground font-semibold text-sm active:scale-[0.98] transition-all"
          >
            {tr.allergen_prompt_none}
          </button>
        </div>
      </div>
    </div>
  );
}
