"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import type { StaffLang } from "@/lib/staff-i18n";

const LABEL: Record<StaffLang, string> = { lt: "Atsijungti", en: "Log out" };

export default function StaffLogoutButton({ lang }: { lang: StaffLang }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleLogout() {
    setPending(true);
    try {
      await fetch("/api/staff/logout", { method: "POST" });
    } finally {
      router.push("/staff-login");
      router.refresh();
    }
  }

  return (
    <button
      onClick={handleLogout}
      disabled={pending}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-white/40 hover:text-white/80 hover:bg-white/5 transition-colors disabled:opacity-50"
    >
      <LogOut size={12} />
      <span className="hidden sm:inline">{LABEL[lang]}</span>
    </button>
  );
}
