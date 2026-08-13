"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, UtensilsCrossed, ShoppingCart, Bot } from "lucide-react";
import { useCartStore } from "@/lib/store";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export default function BottomNav() {
  const pathname = usePathname();
  const totalItems = useCartStore((s) => s.totalItems());
  const lang = useCartStore((s) => s.lang);
  const tr = useT(lang);
  // The cart is restored from localStorage, so the server always renders an
  // empty badge. Waiting for hydration keeps the two renders identical.
  const hydrated = useSyncExternalStore(
    (onChange) => useCartStore.persist.onFinishHydration(onChange),
    () => useCartStore.persist.hasHydrated(),
    () => false
  );

  if (
    pathname.startsWith("/kitchen") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/waiter") ||
    pathname.startsWith("/app") ||
    pathname.startsWith("/staff-login")
  ) return null;

  const navItems = [
    { href: "/", label: tr.nav_home, icon: Home },
    { href: "/menu", label: tr.nav_menu, icon: UtensilsCrossed },
    { href: "/cart", label: tr.nav_cart, icon: ShoppingCart },
    { href: "/ai", label: tr.nav_ai, icon: Bot },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-t border-border pb-safe">
      <div className="max-w-lg mx-auto flex items-center justify-around px-2 pt-2 pb-2">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== "/" && pathname.startsWith(href));
          const content = (
            <>
              {active && <span className="absolute inset-0 bg-primary/10 rounded-2xl" />}
              <span className="relative">
                <Icon
                  size={22}
                  strokeWidth={active ? 2.2 : 1.8}
                  className="transition-transform duration-200"
                  style={{ transform: active ? "scale(1.1)" : "scale(1)" }}
                />
                {href === "/cart" && hydrated && totalItems > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 bg-primary text-primary-foreground text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                    {totalItems > 9 ? "9+" : totalItems}
                  </span>
                )}
              </span>
              <span className={cn("text-[10px] font-medium tracking-wide transition-all", active ? "opacity-100" : "opacity-60")}>
                {label}
              </span>
            </>
          );
          const className = cn(
            "flex flex-col items-center gap-1 px-4 py-2 rounded-2xl transition-all duration-200 relative",
            active ? "text-primary" : "text-muted-foreground hover:text-foreground"
          );
          return (
            <Link
              key={href}
              href={href}
              className={className}
            >
              {content}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
