"use client";

import { usePathname } from "next/navigation";
import SessionEndedGate from "@/components/SessionEndedGate";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isKitchen = pathname.startsWith("/kitchen");
  const isAdmin = pathname.startsWith("/admin");
  const isWaiter = pathname.startsWith("/waiter");
  const isStaffHub = pathname.startsWith("/app");
  const isStaffLogin = pathname.startsWith("/staff-login");

  if (isKitchen || isAdmin || isWaiter || isStaffHub || isStaffLogin) {
    return <>{children}</>;
  }

  return (
    <main className="max-w-lg mx-auto min-h-screen pb-24">
      <SessionEndedGate>{children}</SessionEndedGate>
    </main>
  );
}
