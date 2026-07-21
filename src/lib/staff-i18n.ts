"use client";

/**
 * Staff-panel internationalization (LT / EN) for /admin, /kitchen, /waiter.
 *
 * Centralized dictionaries — no hardcoded UI strings in the staff pages.
 * Language persists in localStorage ("dzukai-staff-lang") and switches
 * instantly (React state, no reload). All three panels share the setting.
 *
 * Customer-facing i18n lives in i18n.ts; product names stay Lithuanian
 * (translations, where they exist, come from product-translations.ts).
 */

import { useEffect, useState } from "react";
import type { OrderStatus, ServingPreference } from "./orders";
import type { WaiterTaskType, WaiterTaskStatus } from "./waiterTasks";

export type StaffLang = "lt" | "en";

const STORAGE_KEY = "dzukai-staff-lang";
const SYNC_EVENT = "dzukai:staff-lang";

export function useStaffLang(): [StaffLang, (l: StaffLang) => void] {
  const [lang, setLangState] = useState<StaffLang>("lt");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "lt") setLangState(saved);
    // Sync across mounted panels (and tabs via the storage event)
    const onSync = () => {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === "en" || v === "lt") setLangState(v);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null) onSync();
    };
    window.addEventListener(SYNC_EVENT, onSync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(SYNC_EVENT, onSync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setLang = (l: StaffLang) => {
    setLangState(l);
    localStorage.setItem(STORAGE_KEY, l);
    window.dispatchEvent(new CustomEvent(SYNC_EVENT));
  };

  return [lang, setLang];
}

// ── Shared enum label maps ────────────────────────────────────────────────────

export const ORDER_STATUS_LABEL: Record<StaffLang, Record<OrderStatus, string>> = {
  lt: {
    NEW: "Naujas", PREPARING: "Gaminamas", READY: "Paruoštas",
    DELIVERING: "Neša padavėjas", COMPLETED: "Įvykdytas", CANCELLED: "Atšauktas",
  },
  en: {
    NEW: "New", PREPARING: "Preparing", READY: "Ready",
    DELIVERING: "Being served", COMPLETED: "Completed", CANCELLED: "Cancelled",
  },
};

export const SERVING_SHORT: Record<StaffLang, Record<ServingPreference, string>> = {
  lt: { together: "Visi kartu", as_ready: "Kai tik paruošta" },
  en: { together: "All together", as_ready: "As ready" },
};

export const TASK_TYPE_LABEL: Record<StaffLang, Record<WaiterTaskType, string>> = {
  lt: {
    ready_to_serve: "Nešti maistą", bill_requested: "Sąskaita",
    waiter_called: "Padavėjas kviestas", additional_order: "Papildomas užsakymas",
  },
  en: {
    ready_to_serve: "Serve food", bill_requested: "Bill",
    waiter_called: "Waiter called", additional_order: "Additional order",
  },
};

export const TASK_ACTION_LABEL_I18N: Record<StaffLang, Record<WaiterTaskType, string>> = {
  lt: {
    ready_to_serve: "Atnešta", bill_requested: "Sąskaita įteikta",
    waiter_called: "Atlikta", additional_order: "Peržiūrėti",
  },
  en: {
    ready_to_serve: "Delivered", bill_requested: "Bill handed over",
    waiter_called: "Done", additional_order: "Review",
  },
};

export const TASK_STATUS_LABEL_I18N: Record<StaffLang, Record<WaiterTaskStatus, string>> = {
  lt: { waiting: "Laukia", accepted: "Priimta", completed: "Atlikta" },
  en: { waiting: "Waiting", accepted: "Accepted", completed: "Done" },
};

export type PaymentBadgeKey = "PAID_APP" | "PAID_WAITER" | "BILL_REQUESTED" | "UNPAID";
export const PAYMENT_BADGE_LABEL_I18N: Record<StaffLang, Record<PaymentBadgeKey, string>> = {
  lt: {
    PAID_APP: "Apmokėta programėlėje", PAID_WAITER: "Apmokėta padavėjui",
    BILL_REQUESTED: "Sąskaita paprašyta", UNPAID: "Neapmokėta",
  },
  en: {
    PAID_APP: "Paid in app", PAID_WAITER: "Paid to waiter",
    BILL_REQUESTED: "Bill requested", UNPAID: "Unpaid",
  },
};

// ── Time helpers ──────────────────────────────────────────────────────────────

export function minutesAgoLabel(iso: string, lang: StaffLang): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (lang === "en") {
    if (mins < 1) return "just now";
    return mins === 1 ? "1 min ago" : `${mins} min ago`;
  }
  if (mins < 1) return "ką tik";
  return mins === 1 ? "prieš 1 min." : `prieš ${mins} min.`;
}

// ── Pluralized counters ───────────────────────────────────────────────────────

export function ordersCount(n: number, lang: StaffLang): string {
  if (lang === "en") return `${n} order${n === 1 ? "" : "s"}`;
  return `${n} užsakym${n === 1 ? "as" : "ai"}`;
}

export function tasksCount(n: number, lang: StaffLang): string {
  if (lang === "en") return `${n} task${n === 1 ? "" : "s"}`;
  return `${n} užduot${n === 1 ? "is" : "ys"}`;
}

export function activeTasksCount(n: number, lang: StaffLang): string {
  if (lang === "en") return `${n} active`;
  return `${n} aktyv${n === 1 ? "i" : "ios"}`;
}

export function dishesCount(n: number, lang: StaffLang): string {
  if (lang === "en") return `${n} dish${n === 1 ? "" : "es"}`;
  return `${n} patiekal${n === 1 ? "as" : "ai"}`;
}

// ── UI string dictionaries ────────────────────────────────────────────────────

const lt = {
    // Shared
    table: "Stalas",
    tableUnset: "Stalas nenurodytas",
    restaurantLabel: "Restoranas",
    total: "Suma",
    noData: "Nėra duomenų.",
    all: "Visi",
    today: "Šiandien",

    // Kitchen
    kitchenTitle: "Virtuvė",
    kitchenTabActive: "Aktyvūs",
    kitchenTabHistory: "Istorija",
    kitchenEmptyActive: "Nėra aktyvių užsakymų",
    kitchenEmptyHistory: "Istorija tuščia",
    kitchenEmptyHint: "Nauji užsakymai pasirodys automatiškai.",
    kitchenOrder: "Užsakymas",
    kitchenStart: "Pradėti",
    kitchenReady: "Paruošta",
    themeLight: "Šviesi tema",
    themeDark: "Tamsi tema",

    // Waiter
    waiterTitle: "Padavėjas",
    waiterServeFood: "Nešti maistą",
    waiterActiveTables: "Aktyvūs stalai",
    waiterBill: "Sąskaita",
    waiterCalls: "Kvietimai",
    waiterPaidInApp: "Apmokėta appse",
    waiterFilterAll: "Visi",
    waiterFilterFood: "Maistas",
    waiterFilterBills: "Sąskaitos",
    waiterFilterCalls: "Kvietimai",
    waiterFilterDone: "Atlikti",
    waiterActiveSessions: "Aktyvūs stalai",
    waiterPaidAmount: "apmokėta",
    waiterActiveTasksSuffix: "aktyvios užduotys",
    waiterLeftOf: "liko iš",
    waiterDone: "atlikta",
    waiterServing: "Patiekimas",
    waiterNotes: "Pastabos",
    waiterAcceptTask: "Priimti užduotį",
    waiterMarkPaid: "Pažymėti kaip apmokėta",
    waiterEmptyAll: "Nėra aktyvių užduočių.",
    waiterEmptyReady: "Nėra maisto, kurį reikia nešti.",
    waiterEmptyBills: "Niekas neprašė sąskaitos.",
    waiterEmptyCalls: "Nėra aktyvių kvietimų.",
    waiterEmptyDone: "Dar nėra atliktų užduočių.",
    waiterEmptyHint: "Užduotys atsiras automatiškai.",
    waiterActiveShort: "aktyvūs",

    // Admin
    adminSubtitle: "Direktoriaus valdymo skydelis",
    adminRefresh: "Atnaujinti",
    adminResetConfirmQ: "Tikrai?",
    adminResetYes: "Taip, išvalyti",
    adminResetNo: "Ne",
    adminResetBtn: "Išvalyti testinius duomenis",
    adminResetHint: "Tik testavimui",
    adminSummary: "Suvestinė",
    adminSummaryToday: " — šiandien",
    adminKitchenNow: "Virtuvė — dabar",
    adminTableSessions: "Stalų sesijos",
    adminPaymentsToday: "Mokėjimai šiandien",
    adminPopular: "Populiariausi patiekalai",
    adminRecent: "Paskutiniai užsakymai",
    adminOrders: "Užsakymų",
    adminRevenue: "Pajamos",
    adminAvgOrder: "Vid. užsakymas",
    adminActive: "Aktyvūs",
    adminCancelled: "Atšaukti",
    adminNew: "Nauji",
    adminPreparing: "Gaminami",
    adminReady: "Paruošti",
    adminDelivering: "Neša padavėjas",
    adminCompleted: "Įvykdyti",
    adminActiveSessions: "Aktyvios sesijos",
    adminBillRequested: "Sąskaita prašoma",
    adminTotalSessions: "Iš viso sesijų",
    adminPaidApp: "Programėlėje",
    adminPaidWaiter: "Padavėjas",
    adminPaidTotal: "Iš viso",
    adminRevenueSuffix: "€ pajamos",
    adminUnits: "vnt.",
    adminEmptyTitle: "Užsakymų nėra",
    adminEmptyToday: "Šiandien dar nebuvo užsakymų.",
    adminEmptyAll: "Lokaliai nėra išsaugotų užsakymų.",
};

export type StaffDict = { [K in keyof typeof lt]: string };

const en: StaffDict = {
    // Shared
    table: "Table",
    tableUnset: "No table set",
    restaurantLabel: "Restaurant",
    total: "Total",
    noData: "No data.",
    all: "All",
    today: "Today",

    // Kitchen
    kitchenTitle: "Kitchen",
    kitchenTabActive: "Active",
    kitchenTabHistory: "History",
    kitchenEmptyActive: "No active orders",
    kitchenEmptyHistory: "History is empty",
    kitchenEmptyHint: "New orders will appear automatically.",
    kitchenOrder: "Order",
    kitchenStart: "Start",
    kitchenReady: "Ready",
    themeLight: "Light theme",
    themeDark: "Dark theme",

    // Waiter
    waiterTitle: "Waiter",
    waiterServeFood: "Serve food",
    waiterActiveTables: "Active tables",
    waiterBill: "Bill",
    waiterCalls: "Calls",
    waiterPaidInApp: "Paid in app",
    waiterFilterAll: "All",
    waiterFilterFood: "Food",
    waiterFilterBills: "Bills",
    waiterFilterCalls: "Calls",
    waiterFilterDone: "Done",
    waiterActiveSessions: "Active tables",
    waiterPaidAmount: "paid",
    waiterActiveTasksSuffix: "active tasks",
    waiterLeftOf: "left of",
    waiterDone: "done",
    waiterServing: "Serving",
    waiterNotes: "Notes",
    waiterAcceptTask: "Accept task",
    waiterMarkPaid: "Mark as paid",
    waiterEmptyAll: "No active tasks.",
    waiterEmptyReady: "No food waiting to be served.",
    waiterEmptyBills: "No bill requests.",
    waiterEmptyCalls: "No active calls.",
    waiterEmptyDone: "No completed tasks yet.",
    waiterEmptyHint: "Tasks will appear automatically.",
    waiterActiveShort: "active",

    // Admin
    adminSubtitle: "Director's dashboard",
    adminRefresh: "Refresh",
    adminResetConfirmQ: "Are you sure?",
    adminResetYes: "Yes, clear",
    adminResetNo: "No",
    adminResetBtn: "Clear test data",
    adminResetHint: "Testing only",
    adminSummary: "Summary",
    adminSummaryToday: " — today",
    adminKitchenNow: "Kitchen — live",
    adminTableSessions: "Table sessions",
    adminPaymentsToday: "Payments today",
    adminPopular: "Most popular dishes",
    adminRecent: "Recent orders",
    adminOrders: "Orders",
    adminRevenue: "Revenue",
    adminAvgOrder: "Avg. order",
    adminActive: "Active",
    adminCancelled: "Cancelled",
    adminNew: "New",
    adminPreparing: "Preparing",
    adminReady: "Ready",
    adminDelivering: "Being served",
    adminCompleted: "Completed",
    adminActiveSessions: "Active sessions",
    adminBillRequested: "Bill requested",
    adminTotalSessions: "Total sessions",
    adminPaidApp: "In app",
    adminPaidWaiter: "Waiter",
    adminPaidTotal: "Total",
    adminRevenueSuffix: "€ revenue",
    adminUnits: "pcs",
    adminEmptyTitle: "No orders",
    adminEmptyToday: "No orders yet today.",
    adminEmptyAll: "No orders stored locally.",
};

const dict: Record<StaffLang, StaffDict> = { lt, en };

export function staffT(lang: StaffLang): StaffDict {
  return dict[lang];
}
