"use client";

import { AlertCircle } from "lucide-react";
import { useCartStore } from "@/lib/store";
import { useT } from "@/lib/i18n";
import { guestAllergenHonesty } from "@/lib/allergens";
import { cn } from "@/lib/utils";

/**
 * Product sheet / product page allergen box.
 * Empty catalog lists still render — they mean "we do not know", never safe.
 */
export default function AllergenNotice({
  declaredAllergens,
}: {
  declaredAllergens: readonly string[];
}) {
  const lang = useCartStore((s) => s.lang);
  const guestAllergens = useCartStore((s) => s.guestAllergens);
  const tr = useT(lang);
  const honesty = guestAllergenHonesty(declaredAllergens, guestAllergens);
  const hasDeclared = declaredAllergens.some((item) => item.trim().length > 0);
  const emphasize = honesty.kind === "unknown" || honesty.kind === "declared_match";

  return (
    <div
      className={cn(
        "mt-3 flex items-start gap-2 border rounded-xl p-3",
        emphasize
          ? "bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800/50"
          : "bg-secondary/70 border-border/50"
      )}
    >
      <AlertCircle
        size={14}
        className={cn(
          "mt-0.5 shrink-0",
          emphasize ? "text-orange-500" : "text-muted-foreground"
        )}
      />
      <div className="min-w-0">
        {hasDeclared ? (
          <>
            <p
              className={cn(
                "text-xs font-bold",
                emphasize
                  ? "text-orange-700 dark:text-orange-400"
                  : "text-orange-700 dark:text-orange-400"
              )}
            >
              {tr.allergens}
            </p>
            <p className="text-xs text-orange-600 dark:text-orange-500 mt-0.5">
              {declaredAllergens.join(", ")}
            </p>
            {honesty.kind === "declared_match" && (
              <p className="text-xs font-bold text-orange-800 dark:text-orange-300 mt-1">
                {tr.allergen_warning}
              </p>
            )}
            <p className="text-[11px] text-orange-700/80 dark:text-orange-500/80 mt-1 leading-snug">
              {tr.allergen_incomplete}
            </p>
          </>
        ) : (
          <>
            <p
              className={cn(
                "text-xs font-bold",
                honesty.kind === "unknown"
                  ? "text-orange-700 dark:text-orange-400"
                  : "text-muted-foreground"
              )}
            >
              {tr.allergens}
            </p>
            <p
              className={cn(
                "text-xs mt-0.5 leading-snug",
                honesty.kind === "unknown"
                  ? "text-orange-600 dark:text-orange-500 font-semibold"
                  : "text-muted-foreground"
              )}
            >
              {honesty.kind === "unknown" ? tr.allergen_unknown : tr.allergen_none_known}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
