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
  // Vaise is the ordering platform; Dzūkų Ainiai is the demo restaurant it powers.
  title: "Vaise — Dzūkų Ainiai",
  description:
    "Vaise — išmani restorano užsakymų platforma. Demonstracinis restoranas: Dzūkų Alaus Restoranas, Vilniaus g. 35, Alytus. Tel. (0-601) 90888.",
  applicationName: "Vaise",
  openGraph: {
    title: "Vaise — Dzūkų Ainiai",
    description:
      "Vaise — išmani restorano užsakymų platforma. Demonstracinis restoranas: Dzūkų Alaus Restoranas, Alytus.",
    siteName: "Vaise",
    type: "website",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Vaišė",
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
