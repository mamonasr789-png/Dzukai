"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

/**
 * Section header that starts closed and expands on click — long lists
 * (staff accounts, tables, recent orders) used to always render in full,
 * pushing everything below them far down the admin page. Anyone who wants
 * the list just clicks to open it; the count stays visible either way.
 */
export default function CollapsibleSection({
  title,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 mb-3 group"
      >
        <span className="text-[11px] font-semibold uppercase tracking-widest text-white flex items-center gap-1.5">
          {title}
          {count !== undefined && (
            <span className="text-white/50 normal-case tracking-normal">({count})</span>
          )}
        </span>
        {open ? (
          <ChevronUp size={13} className="text-white shrink-0" />
        ) : (
          <ChevronDown size={13} className="text-white shrink-0" />
        )}
      </button>
      {open && children}
    </section>
  );
}
