/**
 * Static restaurant knowledge — info, hours, FAQs.
 * Designed to be replaced or extended with a CMS/API later.
 */

export interface KnowledgeEntry {
  lt: string;
  en: string;
  ru: string;
}

export const restaurantInfo: Record<string, KnowledgeEntry> = {
  name: {
    lt: "Dzūkų Ainiai — alaus restoranas Alytuje",
    en: "Dzūkų Ainiai — craft beer restaurant in Alytus",
    ru: "Dzūkų Ainiai — ресторан крафтового пива в Алитусе",
  },
  address: {
    lt: "Vilniaus g. 35, Alytus",
    en: "Vilniaus g. 35, Alytus, Lithuania",
    ru: "Vilniaus g. 35, Алитус, Литва",
  },
  hours: {
    lt: "Pirmadieniais–ketvirtadieniais 11:00–22:00, penktadieniais–šeštadieniais 11:00–24:00, sekmadieniais 11:00–21:00.",
    en: "Mon–Thu 11:00–22:00, Fri–Sat 11:00–24:00, Sun 11:00–21:00.",
    ru: "Пн–Чт 11:00–22:00, Пт–Сб 11:00–24:00, Вс 11:00–21:00.",
  },
  brewery: {
    lt: "Turime savo alaus daryklą. Gaminama 6 rūšių craft alus: Čystas, Šposas, Kviecinis, Razumnas, Spakainas ir Slyvinis Porteris.",
    en: "We have our own brewery. We brew 6 craft beers: Čystas, Šposas, Kviecinis, Razumnas, Spakainas, and Slyvinis Porteris.",
    ru: "У нас собственная пивоварня. Варим 6 сортов крафтового пива: Čystas, Šposas, Kviecinis, Razumnas, Spakainas, Slyvinis Porteris.",
  },
  parking: {
    lt: "Parkavimas galimas šalia restorano.",
    en: "Parking is available near the restaurant.",
    ru: "Парковка доступна рядом с рестораном.",
  },
};

export function getInfo(key: string, lang: string): string {
  const entry = restaurantInfo[key];
  if (!entry) return "";
  return entry[lang as "lt" | "en" | "ru"] ?? entry.lt;
}

export function getFullInfo(lang: string): string {
  const name    = getInfo("name", lang);
  const address = getInfo("address", lang);
  const hours   = getInfo("hours", lang);
  const brewery = getInfo("brewery", lang);

  const templates: Record<string, string> = {
    lt: `**${name}**\n📍 ${address}\n🕐 ${hours}\n\n🍺 ${brewery}`,
    en: `**${name}**\n📍 ${address}\n🕐 ${hours}\n\n🍺 ${brewery}`,
    ru: `**${name}**\n📍 ${address}\n🕐 ${hours}\n\n🍺 ${brewery}`,
  };

  return templates[lang] ?? templates.lt;
}

export function getHours(lang: string): string {
  const hours = getInfo("hours", lang);
  const prefix: Record<string, string> = {
    lt: `⏰ Darbo laikas: ${hours}`,
    en: `⏰ Opening hours: ${hours}`,
    ru: `⏰ Часы работы: ${hours}`,
  };
  return prefix[lang] ?? prefix.lt;
}
