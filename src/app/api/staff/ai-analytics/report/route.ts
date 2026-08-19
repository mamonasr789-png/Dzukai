import { z } from "zod";
import { requireStaffRole } from "../../../../../lib/server/auth/requireSession";
import { getSyncStore, pullAllRecords } from "../../../../../lib/server/syncStore";
import type { Order, TableSession, WaiterTask } from "../../../../../lib/orderTypes";
import { buildPeriodReportText, type ReportPeriod } from "../../../../../lib/server/businessReport";
import { callGemini } from "../../../../../lib/server/geminiClient";

export const runtime = "nodejs";

const PeriodSchema = z.enum(["week", "month"]);

/** Query-string lang param is untrusted free text — anything but "en" falls back to lt. */
function parseLang(value: string | null | undefined): "lt" | "en" {
  return value === "en" ? "en" : "lt";
}

function reportSystemPrefix(lang: "lt" | "en", username: string): string {
  if (lang === "en") {
    return (
      "You are the chief business strategist and analyst for the restaurant 'Dzūkų Ainiai', helping the admin make decisions so the " +
      "restaurant outperforms competitors. You are given real, specific restaurant data (revenue, tables, menu, staff, service speed). " +
      `You are speaking with the admin logged in as '${username}' — address them by that name (e.g. "Hi ${username},") instead of a generic term like "owner". ` +
      "Write in ENGLISH ONLY, DIRECTLY and PLAINLY, no fluff — they want facts and concrete actions, not generic phrases. " +
      "Back every claim with a specific number from the data. Never invent numbers — if something is missing, say so openly. " +
      "Clearly note that 'profitability' in the menu analysis is a price/sales proxy, NOT real margin (there is no cost-of-goods data in the system).\n\n" +
      "Structure the answer with these MARKDOWN headings (## before each):\n" +
      "## Summary\n(3-4 sentences, the most important numbers and direction vs. the prior period)\n" +
      "## Revenue and trends\n" +
      "## Tables\n(favorite, most profitable, least utilized)\n" +
      "## Menu\n(stars, what to raise the price of, what to consider removing)\n" +
      "## Staffing\n(when more staff is needed, by hour/day)\n" +
      "## Service speed\n" +
      "## Observations\n(anomalies, combo opportunities, lost revenue)\n" +
      "## Recommendations\n(3-6 concrete, action-based points — exactly what to do to increase profit)"
    );
  }
  return (
    "Tu esi restorano 'Dzūkų Ainiai' vyriausias verslo strategas ir analitikas, padedantis savininkui priimti sprendimus, kad " +
    "restoranas pranoktų konkurentus. Tau pateikiami tikri, konkretūs restorano duomenys (pajamos, staliukai, meniu, personalas, " +
    "aptarnavimo greitis). " +
    `Kalbiesi su administratoriumi, prisijungusiu kaip '${username}' — kreipkis į jį šiuo vardu (pvz. kreipiamuoju linksniu, jei tai lietuviškas vardas), o ne bendrai „savininke“. ` +
    "Rašyk lietuviškai, TIESIAI ŠVIESIAI, be vandens — savininkas nori faktų ir konkrečių veiksmų, ne bendrų frazių. " +
    "Kiekvieną teiginį pagrįsk konkrečiu skaičiumi iš duomenų. Niekada neišgalvok skaičių — jei ko trūksta, pasakyk atvirai. " +
    "Aiškiai pažymėk, kad 'pelningumas' meniu analizėje yra kainos/pardavimų proxy, NE tikra marža (savikainos duomenų nėra sistemoje).\n\n" +
    "Struktūrizuok atsakymą su šiomis MARKDOWN antraštėmis (## prieš kiekvieną):\n" +
    "## Santrauka\n(3-4 sakiniai, patys svarbiausi skaičiai ir kryptis palyginus su ankstesniu periodu)\n" +
    "## Pajamos ir tendencijos\n" +
    "## Staliukai\n(mėgstamiausias, pelningiausias, prasčiausiai išnaudojami)\n" +
    "## Meniu\n(žvaigždės, ką kelti kainos, ką svarstyti pašalinti)\n" +
    "## Personalas\n(kada reikia daugiau darbuotojų, pagal valandas/dienas)\n" +
    "## Aptarnavimo greitis\n" +
    "## Pastebėjimai\n(anomalijos, combo galimybės, neišnaudotos pajamos)\n" +
    "## Rekomendacijos\n(3-6 konkretūs, veiksmais paremti punktai — kas tiksliai daryti, kad padidėtų pelnas)"
  );
}

async function gatherAllRecords() {
  const store = await getSyncStore();
  if (!store) return null;
  const [orderRecords, sessionRecords, taskRecords] = await Promise.all([
    pullAllRecords(store, "orders"),
    pullAllRecords(store, "sessions"),
    pullAllRecords(store, "tasks"),
  ]);
  const orders: Order[] = orderRecords.map((r) => JSON.parse(r.data));
  const sessions: TableSession[] = sessionRecords.map((r) => JSON.parse(r.data));
  const tasks: WaiterTask[] = taskRecords.map((r) => JSON.parse(r.data));
  return { orders, sessions, tasks };
}

export async function GET(request: Request): Promise<Response> {
  const session = await requireStaffRole("admin");
  if (!session) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const periodParam = url.searchParams.get("period");
  const parsedPeriod = PeriodSchema.safeParse(periodParam);
  if (!parsedPeriod.success) {
    return Response.json({ ok: false, error: "invalid_period" }, { status: 400 });
  }
  const period: ReportPeriod = parsedPeriod.data;
  const lang = parseLang(url.searchParams.get("lang"));

  const all = await gatherAllRecords();
  if (!all) {
    return Response.json({ ok: false, error: "store_not_configured" }, { status: 503 });
  }
  if (all.orders.length === 0) {
    return Response.json({
      ok: true,
      report: lang === "en" ? "No orders to report on yet." : "Kol kas nėra užsakymų ataskaitai.",
      snapshot: "",
    });
  }
  const snapshotText = buildPeriodReportText(all, period);
  try {
    const report = await callGemini(`${reportSystemPrefix(lang, session.username)}\n\nDUOMENYS:\n${snapshotText}`, 4096);
    return Response.json({ ok: true, report, snapshot: snapshotText });
  } catch {
    return Response.json({ ok: false, error: "ai_unavailable", snapshot: snapshotText }, { status: 502 });
  }
}
