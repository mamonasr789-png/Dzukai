import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import BottomNav from "@/components/BottomNav";
import GuestWelcome from "@/components/GuestWelcome";
import AppShell from "@/components/AppShell";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Dzūkų Ainiai — Alaus Restoranas, Alytus",
  description: "Dzūkų Alaus Restoranas Alytuje. Vilniaus g. 35, Alytus. Tel. (0-601) 90888.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Dzūkų Ainiai",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a1a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="lt" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="antialiased bg-background">
        <AppShell>{children}</AppShell>
        <BottomNav />
        <GuestWelcome />
      </body>
    </html>
  );
}
