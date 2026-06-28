"use client";

import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  quantity: number;
  onIncrease: () => void;
  onDecrease: () => void;
  min?: number;
  size?: "sm" | "md";
}

export default function QuantitySelector({
  quantity,
  onIncrease,
  onDecrease,
  min = 1,
  size = "md",
}: Props) {
  const btnClass = cn(
    "rounded-full bg-secondary flex items-center justify-center active:scale-95 transition-all hover:bg-secondary/70",
    size === "sm" ? "w-7 h-7" : "w-10 h-10"
  );

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onDecrease}
        disabled={quantity <= min}
        className={cn(btnClass, "disabled:opacity-40")}
        aria-label="Decrease quantity"
      >
        <Minus size={size === "sm" ? 13 : 16} strokeWidth={2.5} />
      </button>
      <span className={cn("font-semibold tabular-nums w-5 text-center", size === "sm" ? "text-sm" : "text-lg")}>
        {quantity}
      </span>
      <button
        onClick={onIncrease}
        className={cn(btnClass, "bg-primary text-primary-foreground hover:bg-primary/90")}
        aria-label="Increase quantity"
      >
        <Plus size={size === "sm" ? 13 : 16} strokeWidth={2.5} />
      </button>
    </div>
  );
}
