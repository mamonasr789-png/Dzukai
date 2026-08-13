"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import type { StaffLang } from "@/lib/staff-i18n";

const LABEL: Record<StaffLang, string> = { lt: "Atsijungti", en: "Log out" };

export default function StaffLogoutButton({
  lang,
  variant = "dark",
}: {
  lang: StaffLang;
  /** "dark" fits the black staff-panel headers (/admin, /waiter, /kitchen);
   *  "light" fits the light /app hub background. */
  variant?: "dark" | "light";
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleLogout() {
    setPending(true);
    try {
      await fetch("/api/staff/logout", { method: "POST" });
    } finally {
      // /app is public and shows the role cards again — handy for testing
      // multiple accounts back-to-back without retyping the login URL.
      router.push("/app");
      router.refresh();
    }
  }

  const colors =
    variant === "light"
      ? "text-muted-foreground hover:text-foreground hover:bg-muted"
      : "text-white/40 hover:text-white/80 hover:bg-white/5";

  return (
    <button
      onClick={handleLogout}
      disabled={pending}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50 ${colors}`}
    >
      <LogOut size={12} />
      <span className="hidden sm:inline">{LABEL[lang]}</span>
    </button>
  );
}
