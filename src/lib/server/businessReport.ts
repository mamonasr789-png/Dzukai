import "server-only";

import type { Order, TableSession, WaiterTask } from "../orderTypes";
import { calculateRevenue, dateKey } from "../analytics";
import { categories, products } from "../data";

/**
 * Deep weekly/monthly business report — a rolling window (last 7 or 30 days)
 * plus the equivalent prior window for comparison. Everything here is a pure
 * function over already-fetched Order/TableSession/WaiterTask arrays; the
 * route handler pulls those from syncStore and calls buildPeriodReportText.
 *
 * "Profitability" throughout uses unit price / revenue as a proxy — there is
 * no cost-of-goods data anywhere in this system, so a real margin cannot be
 * computed. This is stated explicitly in the report text rather than implied.
 */

export type ReportPeriod = "week" | "month";

const WEEKDAY_LABELS_LT = ["Sekmadienis", "Pirmadienis", "Antradienis", "Trečiadienis", "Ketvirtadienis", "Penktadienis", "Šeštadienis"];

function periodDays(period: ReportPeriod): number {
  return period === "week" ? 7 : 30;
}

function inRange(iso: string, start: number, end: number): boolean {
  const t = new Date(iso).getTime();
  return t >= start && t < end;
}

function minutesBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 60_000;
}

interface RangedData {
  orders: Order[];
  sessions: TableSession[];
  tasks: WaiterTask[];
}

function sliceRange(all: RangedData, start: number, end: number): RangedData {
  return {
    orders: all.orders.filter((o) => inRange(o.createdAt, start, end)),
    sessions: all.sessions.filter((s) => inRange(s.createdAt, start, end)),
    tasks: all.tasks.filter((t) => inRange(t.createdAt, start, end)),
  };
}

function billableOrders(orders: Order[]): Order[] {
  return orders.filter((o) => o.status !== "CANCELLED" && o.status !== "PENDING_CONFIRMATION");
}

function pctChange(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? "0%" : "n/a (praeitą periodą duomenų nebuvo)";
  const change = ((current - previous) / previous) * 100;
  const sign = change >= 0 ? "+" : "";
  return `${sign}${change.toFixed(1)}%`;
}

// ── Daily breakdown + anomalies ─────────────────────────────────────────────

function dailyBreakdown(orders: Order[]): { day: string; weekday: string; orders: number; revenue: number }[] {
  const byDay = new Map<string, { orders: number; revenue: number; weekday: string }>();
  for (const o of billableOrders(orders)) {
    const d = new Date(o.createdAt);
    const key = dateKey(d);
    const entry = byDay.get(key) ?? { orders: 0, revenue: 0, weekday: WEEKDAY_LABELS_LT[d.getDay()] };
    entry.orders += 1;
    entry.revenue += o.total;
    byDay.set(key, entry);
  }
  return [...byDay.entries()]
    .map(([day, v]) => ({ day, weekday: v.weekday, orders: v.orders, revenue: Math.round(v.revenue * 100) / 100 }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

function weekdayAverages(days: { weekday: string; orders: number; revenue: number }[]): Map<string, { avgOrders: number; avgRevenue: number; count: number }> {
  const byWeekday = new Map<string, { orders: number; revenue: number; count: number }>();
  for (const d of days) {
    const e = byWeekday.get(d.weekday) ?? { orders: 0, revenue: 0, count: 0 };
    e.orders += d.orders;
    e.revenue += d.revenue;
    e.count += 1;
    byWeekday.set(d.weekday, e);
  }
  const result = new Map<string, { avgOrders: number; avgRevenue: number; count: number }>();
  for (const [weekday, v] of byWeekday) {
    result.set(weekday, { avgOrders: v.orders / v.count, avgRevenue: v.revenue / v.count, count: v.count });
  }
  return result;
}

function findAnomalies(days: { day: string; weekday: string; orders: number }[]): string[] {
  const avgByWeekday = weekdayAverages(days.map((d) => ({ weekday: d.weekday, orders: d.orders, revenue: 0 })));
  const flags: string[] = [];
  for (const d of days) {
    const baseline = avgByWeekday.get(d.weekday);
    if (!baseline || baseline.count < 2) continue; // need at least one other same-weekday sample to compare against
    const deviation = (d.orders - baseline.avgOrders) / baseline.avgOrders;
    if (Math.abs(deviation) >= 0.3) {
      const direction = deviation > 0 ? "gerokai daugiau" : "gerokai mažiau";
      flags.push(
        `${d.day} (${d.weekday}): ${d.orders} užsakymų — ${direction} nei įprastą ${d.weekday.toLowerCase()} (vidurkis ${baseline.avgOrders.toFixed(0)}).`
      );
    }
  }
  return flags;
}

// ── Tables ───────────────────────────────────────────────────────────────────

function tableStats(orders: Order[], sessions: TableSession[], days: number) {
  const byTable = new Map<string, { orders: number; revenue: number }>();
  for (const o of billableOrders(orders)) {
    if (!o.tableNumber) continue;
    const e = byTable.get(o.tableNumber) ?? { orders: 0, revenue: 0 };
    e.orders += 1;
    e.revenue += o.total;
    byTable.set(o.tableNumber, e);
  }
  const sessionsByTable = new Map<string, number>();
  for (const s of sessions) {
    if (!s.tableNumber) continue;
    sessionsByTable.set(s.tableNumber, (sessionsByTable.get(s.tableNumber) ?? 0) + 1);
  }
  const rows = [...byTable.entries()]
    .map(([table, v]) => ({
      table,
      orders: v.orders,
      revenue: Math.round(v.revenue * 100) / 100,
      visits: sessionsByTable.get(table) ?? 0,
      turnoverPerDay: Math.round(((sessionsByTable.get(table) ?? 0) / days) * 100) / 100,
    }))
    .sort((a, b) => b.orders - a.orders);
  return rows;
}

// ── Menu engineering matrix ─────────────────────────────────────────────────

function menuMatrix(orders: Order[]) {
  const byProduct = new Map<string, { name: string; qty: number; revenue: number; price: number }>();
  for (const o of billableOrders(orders)) {
    for (const item of o.items) {
      if (item.itemStatus === "CANCELLED") continue;
      const e = byProduct.get(item.productId) ?? { name: item.name, qty: 0, revenue: 0, price: item.price };
      e.qty += item.quantity;
      e.revenue += item.price * item.quantity;
      byProduct.set(item.productId, e);
    }
  }
  const rows = [...byProduct.values()];
  if (rows.length === 0) return { stars: [], plowhorses: [], puzzles: [], dogs: [] };

  const sortedQty = [...rows].map((r) => r.qty).sort((a, b) => a - b);
  const sortedPrice = [...rows].map((r) => r.price).sort((a, b) => a - b);
  const median = (arr: number[]) => arr[Math.floor(arr.length / 2)];
  const medianQty = median(sortedQty);
  const medianPrice = median(sortedPrice);

  const stars: string[] = [];
  const plowhorses: string[] = [];
  const puzzles: string[] = [];
  const dogs: string[] = [];
  for (const r of rows) {
    const popular = r.qty >= medianQty;
    const pricey = r.price >= medianPrice;
    const line = `${r.name} (${r.qty} vnt., ${r.revenue.toFixed(2)} EUR)`;
    if (popular && pricey) stars.push(line);
    else if (popular && !pricey) plowhorses.push(line);
    else if (!popular && pricey) puzzles.push(line);
    else dogs.push(line);
  }
  const topN = (arr: string[]) => arr.slice(0, 6);
  return { stars: topN(stars), plowhorses: topN(plowhorses), puzzles: topN(puzzles), dogs: topN(dogs) };
}

// ── Staffing vs hourly demand ────────────────────────────────────────────────

function hourlyDemand(orders: Order[], days: number) {
  const byHour = new Map<number, { orders: number; staff: Set<string> }>();
  for (const o of billableOrders(orders)) {
    const hour = new Date(o.createdAt).getHours();
    const e = byHour.get(hour) ?? { orders: 0, staff: new Set<string>() };
    e.orders += 1;
    for (const item of o.items) {
      if (item.preparedBy) e.staff.add(item.preparedBy.username);
      if (item.deliveredBy) e.staff.add(item.deliveredBy.username);
    }
    byHour.set(hour, e);
  }
  return [...byHour.entries()]
    .map(([hour, v]) => ({
      hour,
      avgOrdersPerDay: Math.round((v.orders / days) * 10) / 10,
      distinctStaffSeen: v.staff.size,
      ordersPerStaff: v.staff.size > 0 ? Math.round((v.orders / v.staff.size) * 10) / 10 : v.orders,
    }))
    .sort((a, b) => b.avgOrdersPerDay - a.avgOrdersPerDay);
}

// ── Customer behavior ────────────────────────────────────────────────────────

function customerBehavior(orders: Order[], tasks: WaiterTask[]) {
  const billable = billableOrders(orders);
  const totalItems = billable.reduce((sum, o) => sum + o.items.reduce((s, i) => s + i.quantity, 0), 0);
  const avgItemsPerOrder = billable.length ? totalItems / billable.length : 0;
  const revenue = calculateRevenue(orders);
  const avgOrderValue = billable.length ? revenue / billable.length : 0;
  const cancelledCount = orders.filter((o) => o.status === "CANCELLED").length;
  const cancellationRate = orders.length ? (cancelledCount / orders.length) * 100 : 0;

  const confirmations = tasks.filter((t) => t.type === "order_confirmation").length;
  const additional = tasks.filter((t) => t.type === "additional_order").length;
  const upsellRate = confirmations > 0 ? (additional / confirmations) * 100 : 0;

  return { avgItemsPerOrder, avgOrderValue, cancellationRate, upsellRate, cancelledCount };
}

// ── Service speed ────────────────────────────────────────────────────────────

function serviceSpeed(orders: Order[]) {
  const prepTimes: number[] = [];
  const deliveryTimes: number[] = [];
  for (const o of orders) {
    for (const item of o.items) {
      if (item.preparedAt) prepTimes.push(minutesBetween(o.createdAt, item.preparedAt));
      if (item.preparedAt && item.deliveredAt) deliveryTimes.push(minutesBetween(item.preparedAt, item.deliveredAt));
    }
  }
  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  return { avgPrepMinutes: avg(prepTimes), avgDeliveryMinutes: avg(deliveryTimes) };
}

// ── Combo analysis ───────────────────────────────────────────────────────────

function comboPairs(orders: Order[]): string[] {
  const pairCounts = new Map<string, number>();
  const pairNames = new Map<string, string>();
  for (const o of billableOrders(orders)) {
    const uniqueNames = [...new Set(o.items.filter((i) => i.itemStatus !== "CANCELLED").map((i) => i.name))];
    for (let i = 0; i < uniqueNames.length; i++) {
      for (let j = i + 1; j < uniqueNames.length; j++) {
        const key = [uniqueNames[i], uniqueNames[j]].sort().join(" + ");
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
        pairNames.set(key, key);
      }
    }
  }
  return [...pairCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([pair, count]) => `${pair} (kartu užsakyta ${count} kartus)`);
}

// ── Lost-revenue estimate ────────────────────────────────────────────────────

function lostRevenueEstimate(days: { day: string; revenue: number }[]): { estimate: number; weakDays: string[] } {
  if (days.length < 3) return { estimate: 0, weakDays: [] };
  const avg = days.reduce((s, d) => s + d.revenue, 0) / days.length;
  const threshold = avg * 0.7;
  const weak = days.filter((d) => d.revenue < threshold);
  const estimate = weak.reduce((s, d) => s + (avg - d.revenue), 0);
  return { estimate: Math.round(estimate * 100) / 100, weakDays: weak.map((d) => d.day) };
}

// ── Assemble the full text snapshot fed to Gemini ───────────────────────────

export function buildPeriodReportText(all: RangedData, period: ReportPeriod): string {
  const days = periodDays(period);
  const now = Date.now();
  const start = now - days * 24 * 60 * 60 * 1000;
  const prevStart = start - days * 24 * 60 * 60 * 1000;

  const current = sliceRange(all, start, now);
  const previous = sliceRange(all, prevStart, start);

  const currentRevenue = calculateRevenue(current.orders);
  const previousRevenue = calculateRevenue(previous.orders);
  const currentBillable = billableOrders(current.orders);
  const previousBillable = billableOrders(previous.orders);

  const daily = dailyBreakdown(current.orders);
  const dailyLines = daily.map((d) => `${d.day} (${d.weekday}): ${d.orders} užsakymų, ${d.revenue.toFixed(2)} EUR`).join("\n");
  const weekdayAvg = weekdayAverages(daily);
  const weekdayLines = [...weekdayAvg.entries()]
    .sort((a, b) => b[1].avgOrders - a[1].avgOrders)
    .map(([wd, v]) => `${wd}: vidutiniškai ${v.avgOrders.toFixed(0)} užsakymų/dieną, ${v.avgRevenue.toFixed(2)} EUR/dieną (${v.count} dienų imtis)`)
    .join("\n");

  const anomalies = findAnomalies(daily);

  const tables = tableStats(current.orders, current.sessions, days);
  const tableLines = tables
    .slice(0, 10)
    .map((t) => `${t.table}: ${t.orders} užsakymų, ${t.revenue.toFixed(2)} EUR pajamų, ${t.visits} apsilankymų (${t.turnoverPerDay}/dieną)`)
    .join("\n");
  const topTableByOrders = tables[0];
  const topTableByRevenue = [...tables].sort((a, b) => b.revenue - a.revenue)[0];
  const leastUsedTables = [...tables].sort((a, b) => a.orders - b.orders).slice(0, 3);

  const matrix = menuMatrix(current.orders);

  const hourly = hourlyDemand(current.orders, days);
  const hourlyLines = hourly
    .slice(0, 6)
    .map((h) => `${h.hour}:00 val.: vidutiniškai ${h.avgOrdersPerDay} užsakymų/dieną, matyta ${h.distinctStaffSeen} darbuotojų, ~${h.ordersPerStaff} užsakymų/darbuotojui`)
    .join("\n");

  const behavior = customerBehavior(current.orders, current.tasks);
  const speed = serviceSpeed(current.orders);
  const combos = comboPairs(current.orders);
  const lostRevenue = lostRevenueEstimate(daily);

  const periodLabel = period === "week" ? "savaitės" : "mėnesio";

  return [
    `=== ${periodLabel.toUpperCase()} ATASKAITOS DUOMENYS (paskutinės ${days} dienos, lyginant su ankstesnėmis ${days} dienomis) ===`,
    "",
    `BENDRA APŽVALGA:`,
    `Užsakymų: ${currentBillable.length} (praeitą periodą: ${previousBillable.length}, pokytis ${pctChange(currentBillable.length, previousBillable.length)}).`,
    `Pajamos: ${currentRevenue.toFixed(2)} EUR (praeitą periodą: ${previousRevenue.toFixed(2)} EUR, pokytis ${pctChange(currentRevenue, previousRevenue)}).`,
    `Vidutinė užsakymo vertė: ${behavior.avgOrderValue.toFixed(2)} EUR. Vidutiniškai ${behavior.avgItemsPerOrder.toFixed(1)} patiekalų/užsakyme.`,
    `Atšaukimų dažnis: ${behavior.cancellationRate.toFixed(1)}% (${behavior.cancelledCount} atšaukimai).`,
    `Papildomo užsakymo (kryžminio pardavimo) rodiklis: ${behavior.upsellRate.toFixed(1)}% sesijų užsisakė papildomai per pirmą užsakymą.`,
    "",
    `PAJAMOS PAGAL DIENAS:`,
    dailyLines || "nėra duomenų",
    "",
    `VIDUTINIAI RODIKLIAI PAGAL SAVAITĖS DIENĄ:`,
    weekdayLines || "nėra duomenų",
    "",
    `ANOMALIJOS (dienos, ryškiai nukrypstančios nuo įprasto tos savaitės dienos šablono):`,
    anomalies.length ? anomalies.join("\n") : "nerasta reikšmingų nukrypimų.",
    "",
    `STALIUKŲ ANALIZĖ (pagal užsakymų kiekį):`,
    tableLines || "nėra duomenų",
    topTableByOrders ? `Mėgstamiausias staliukas pagal užsakymus: ${topTableByOrders.table} (${topTableByOrders.orders} užsakymų).` : "",
    topTableByRevenue ? `Pelningiausias staliukas: ${topTableByRevenue.table} (${topTableByRevenue.revenue.toFixed(2)} EUR).` : "",
    leastUsedTables.length ? `Mažiausiai naudojami staliukai: ${leastUsedTables.map((t) => `${t.table} (${t.orders})`).join(", ")}.` : "",
    "",
    `MENIU INŽINERIJOS MATRICA (populiarumas x kaina kaip pelningumo indikatorius — NĖRA tikros savikainos duomenų, tai proxy, ne tikras maržos skaičiavimas):`,
    `ŽVAIGŽDĖS (populiaru + brangu, reklamuoti daugiau): ${matrix.stars.join("; ") || "nėra"}.`,
    `DARBINIAI ARKLIAI (populiaru, bet pigu — kelti kainą atsargiai): ${matrix.plowhorses.join("; ") || "nėra"}.`,
    `GALVOSŪKIAI (brangu, bet retai perkama — reikia geresnio pristatymo/rekomendacijų): ${matrix.puzzles.join("; ") || "nėra"}.`,
    `BALASTAS (nei populiaru, nei pelninga — kandidatai išmesti iš meniu): ${matrix.dogs.join("; ") || "nėra"}.`,
    "",
    `PERSONALO POREIKIS PAGAL VALANDĄ (populiariausios 6 valandos):`,
    hourlyLines || "nėra duomenų",
    "",
    `APTARNAVIMO GREITIS:`,
    `Vidutinis laikas nuo užsakymo iki paruošimo (virtuvė): ${speed.avgPrepMinutes !== null ? speed.avgPrepMinutes.toFixed(1) + " min." : "nėra duomenų"}.`,
    `Vidutinis laikas nuo paruošimo iki pristatymo (padavėjas): ${speed.avgDeliveryMinutes !== null ? speed.avgDeliveryMinutes.toFixed(1) + " min." : "nėra duomenų"}.`,
    "",
    `KARTU DAŽNIAUSIAI UŽSAKOMI PATIEKALAI (combo galimybės):`,
    combos.length ? combos.join("\n") : "nepakanka duomenų kombinacijoms nustatyti.",
    "",
    `NEIŠNAUDOTOS PAJAMOS: dienos su pajamomis <70% periodo vidurkio: ${lostRevenue.weakDays.join(", ") || "nėra"}. Apytikslė praleista pajamų suma iki vidurkio: ${lostRevenue.estimate.toFixed(2)} EUR.`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}
