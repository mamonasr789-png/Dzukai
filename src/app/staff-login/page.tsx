"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LockKeyhole } from "lucide-react";

const ROLE_HOME: Record<string, string> = {
  admin: "/admin",
  waiter: "/waiter",
  kitchen: "/kitchen",
};

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/staff/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        setError("Neteisingas vartotojo vardas arba slaptažodis.");
        return;
      }
      const data = (await res.json()) as { role: string };
      router.push(next && next.startsWith("/") ? next : ROLE_HOME[data.role] ?? "/app");
      router.refresh();
    } catch {
      setError("Nepavyko prisijungti. Bandykite dar kartą.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <div className="w-12 h-12 rounded-2xl bg-primary/20 flex items-center justify-center mb-3">
            <LockKeyhole size={22} className="text-primary" />
          </div>
          <h1 className="font-black text-xl tracking-tight">Vaišė</h1>
          <p className="text-sm text-white/40">Darbuotojų prisijungimas</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="border border-white/8 rounded-2xl bg-white/3 p-5 flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-white/40">Vartotojo vardas</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              required
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-white/40">Slaptažodis</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
            />
          </div>
          {error && <p className="text-[12px] text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="mt-1 w-full py-2.5 rounded-xl text-sm font-bold bg-primary text-black hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {submitting ? "Jungiamasi…" : "Prisijungti"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function StaffLoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
