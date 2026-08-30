"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CheckCircle2, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTableSession } from "@/lib/hooks/useTableOrders";
import { isSettledSessionStatus } from "@/lib/orderTypes";
import { useT } from "@/lib/i18n";
import { useLanguage } from "@/lib/store";

const TABLE_GATED_PREFIXES = ["/menu", "/cart", "/ai"];

function isTableGatedPath(pathname: string): boolean {
  return TABLE_GATED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

/** Full-screen "session ended, scan QR again" shown on guest gated pages after settle. */
export function SessionEndedScreen() {
  const [lang] = useLanguage();
  const copy = useT(lang);
  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center">
      <div className="w-20 h-20 rounded-full bg-emerald-500/10 flex items-center justify-center mb-5">
        <CheckCircle2 size={40} className="text-emerald-500" />
      </div>
      <h2 className="font-black text-2xl mb-2">{copy.session_ended_title}</h2>
      <p className="text-muted-foreground text-sm mb-3">{copy.session_ended_sub}</p>
      <div className="flex items-start gap-2 text-sm text-muted-foreground mb-8 max-w-xs">
        <QrCode size={18} className="shrink-0 mt-0.5" />
        <p className="text-left">{copy.session_ended_rescan}</p>
      </div>
      <Link href="/order">
        <Button variant="outline" className="rounded-full px-8 h-12 font-bold">
          {copy.track_order}
        </Button>
      </Link>
    </div>
  );
}

function SettledVisitGate({ children }: { children: React.ReactNode }) {
  const { session, loading } = useTableSession();
  if (loading) return <>{children}</>;
  if (session && isSettledSessionStatus(session.status)) {
    return <SessionEndedScreen />;
  }
  return <>{children}</>;
}

/**
 * On /menu, /cart and /ai: if this visit's table session is already paid/closed,
 * bounce to the scan-again screen instead of letting the stale cookie browse
 * and submit. /order stays reachable so the sitting party can keep tracking food.
 */
export default function SessionEndedGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (!isTableGatedPath(pathname)) return <>{children}</>;
  return <SettledVisitGate>{children}</SettledVisitGate>;
}
