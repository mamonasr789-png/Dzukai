"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChefHat, ClipboardList, BarChart3 } from "lucide-react";
import StaffLogoutButton from "@/components/StaffLogoutButton";

/**
 * Staff hub — the PWA entry point. Staff install this page to the home
 * screen; guests never see it (they arrive through table QR codes).
 * Public by design: no session needed to see the hub. Tapping into a role
 * (/waiter, /kitchen, /admin) is what proxy.ts gates behind login. The
 * logout button here is shown only when a session exists — useful for
 * switching between accounts while testing without visiting a role page.
 */

const ROLES = [
  {
    href: "/waiter",
    label: "Padavėjas",
    description: "Užsakymų pristatymas, staliukai, iškvietimai",
    icon: ClipboardList,
    accent: "bg-emerald-500/15 text-emerald-500",
  },
  {
    href: "/kitchen",
    label: "Virtuvė",
    description: "Aktyvūs užsakymai ir gaminimo eiga",
    icon: ChefHat,
    accent: "bg-amber-500/15 text-amber-500",
  },
  {
    href: "/admin",
    label: "Administratorius",
    description: "Pardavimai, statistika, staliukų apžvalga",
    icon: BarChart3,
    accent: "bg-sky-500/15 text-sky-500",
  },
] as const;

export default function StaffHubPage() {
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    fetch("/api/staff/session")
      .then((res) => setLoggedIn(res.ok))
      .catch(() => setLoggedIn(false));
  }, []);

  return (
    <main className="min-h-screen bg-background flex flex-col px-6 pt-16 pb-10 max-w-lg mx-auto">
      <header className="mb-10 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-widest uppercase text-muted-foreground">
            Vaišė Staff
          </p>
          <h1 className="font-black text-3xl tracking-tight mt-1">
            Pasirinkite darbo vietą
          </h1>
        </div>
        {loggedIn && <StaffLogoutButton lang="lt" variant="light" />}
      </header>

      <div className="flex flex-col gap-4">
        {ROLES.map(({ href, label, description, icon: Icon, accent }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-4 rounded-3xl border border-border/60 bg-card p-5 shadow-sm active:scale-[0.98] transition-transform"
          >
            <span
              className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${accent}`}
            >
              <Icon size={28} strokeWidth={2} />
            </span>
            <span className="min-w-0">
              <span className="block font-bold text-lg leading-tight">
                {label}
              </span>
              <span className="block text-sm text-muted-foreground mt-0.5">
                {description}
              </span>
            </span>
          </Link>
        ))}
      </div>

      <p className="mt-auto pt-10 text-center text-xs text-muted-foreground">
        Įrenginiai sinchronizuojami automatiškai, kai veikia serveris.
      </p>
    </main>
  );
}
