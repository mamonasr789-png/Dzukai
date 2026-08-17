"use client";

import { QrCode } from "lucide-react";
import { useLanguage } from "@/lib/store";

const COPY = {
  lt: {
    title: "Nuskenuokite QR kodą prie savo stalo",
    sub: "Meniu pasiekiamas tik nuskenavus restorano stalo QR kodą.",
  },
  en: {
    title: "Scan the QR code at your table",
    sub: "The menu is only reachable by scanning the restaurant's table QR code.",
  },
  ru: {
    title: "Отсканируйте QR-код за вашим столом",
    sub: "Меню доступно только после сканирования QR-кода столика ресторана.",
  },
};

export default function TableRequiredPage() {
  const [lang] = useLanguage();
  const copy = COPY[lang];
  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center bg-background">
      <div className="w-24 h-24 rounded-full bg-secondary flex items-center justify-center mb-5">
        <QrCode size={36} className="text-muted-foreground" />
      </div>
      <h1 className="font-black text-xl">{copy.title}</h1>
      <p className="text-muted-foreground text-sm mt-1">{copy.sub}</p>
    </div>
  );
}
