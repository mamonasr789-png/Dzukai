"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Beer } from "lucide-react";
import { Button } from "@/components/ui/button";
import ProductCard from "@/components/ProductCard";
import ThemeToggle from "@/components/ThemeToggle";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { featuredProducts } from "@/lib/data";

export default function HomePage() {
  return (
    <div className="flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-5 pt-14 pb-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl overflow-hidden bg-white shadow-md border border-border/30">
            <Image
              src="https://www.dzukuainiai.lt/wp-content/uploads/2020/11/Ainiai-1-2.png"
              alt="Dzūkų Ainiai logo"
              width={40}
              height={40}
              className="object-contain w-full h-full"
            />
          </div>
          <div>
            <span className="font-black text-base tracking-tight leading-tight block">Dzūkų Ainiai</span>
            <span className="text-muted-foreground text-[10px] font-medium">Alaus Restoranas · Alytus</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </header>

      {/* Hero */}
      <section className="relative mx-4 mt-4 rounded-3xl overflow-hidden h-64">
        <Image
          src="https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=900&q=85"
          alt="Dzūkų Ainiai restoranas"
          fill
          className="object-cover"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-5">
          <p className="text-white/70 text-xs font-medium tracking-widest uppercase mb-1">Alytus, Lietuva</p>
          <h1 className="text-white text-3xl font-black tracking-tight leading-tight mb-3">
            Dzūkų<br />Alaus Restoranas
          </h1>
          <Link href="/menu">
            <Button
              size="sm"
              className="rounded-full bg-white text-black hover:bg-white/90 font-semibold gap-1.5 shadow-lg"
            >
              Žiūrėti meniu <ArrowRight size={14} strokeWidth={2.5} />
            </Button>
          </Link>
        </div>
      </section>

      {/* Featured */}
      <section className="mt-6 px-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-lg">Rekomenduojame</h2>
          <Link href="/menu" className="text-primary text-sm font-medium">
            Visi patiekalai
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {featuredProducts.slice(0, 6).map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </section>

      {/* Beer Banner */}
      <Link href="/menu?cat=alus" className="block mx-4 mt-6 mb-2">
      <section className="rounded-3xl overflow-hidden relative h-36 active:scale-[0.98] transition-transform">
        <Image
          src="https://images.unsplash.com/photo-1608270586620-248524c67de9?w=800&q=80"
          alt="Dzūkų craft beer"
          fill
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-amber-900/90 to-amber-700/50" />
        <div className="absolute inset-0 flex flex-col justify-center px-5">
          <div className="flex items-center gap-2 mb-1">
            <Beer size={16} className="text-amber-300" />
            <p className="text-amber-300 text-xs font-semibold tracking-widest uppercase">Savos daryklos alus</p>
          </div>
          <h3 className="text-white text-xl font-black leading-tight">
            6 rūšių<br />Craft alus 🍺
          </h3>
        </div>
      </section>
      </Link>
    </div>
  );
}
