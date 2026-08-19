import { z } from "zod";
import { requireStaffRole } from "../../../../../lib/server/auth/requireSession";
import { getSyncStore, pullAllRecords } from "../../../../../lib/server/syncStore";
import type { Order, TableSession, WaiterTask } from "../../../../../lib/orderTypes";
import { buildPeriodReportText, type ReportPeriod } from "../../../../../lib/server/businessReport";
import { callGemini } from "../../../../../lib/server/geminiClient";

export const runtime = "nodejs";

const PeriodSchema = z.enum(["week", "month"]);

const REPORT_SYSTEM_PREFIX =
  "Tu esi restorano 'Dzūkų Ainiai' vyriausias verslo strategas ir analitikas, padedantis savininkui priimti sprendimus, kad " +
  "restoranas pranoktų konkurentus. Tau pateikiami tikri, konkretūs restorano duomenys (pajamos, staliukai, meniu, personalas, " +
  "aptarnavimo greitis). Rašyk lietuviškai, TIESIAI ŠVIESIAI, be vandens — savininkas nori faktų ir konkrečių veiksmų, ne bendrų frazių. " +
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
  "## Rekomendacijos\n(3-6 konkretūs, veiksmais paremti punktai — kas tiksliai daryti, kad padidėtų pelnas)";

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
  const periodParam = new URL(request.url).searchParams.get("period");
  const parsedPeriod = PeriodSchema.safeParse(periodParam);
  if (!parsedPeriod.success) {
    return Response.json({ ok: false, error: "invalid_period" }, { status: 400 });
  }
  const period: ReportPeriod = parsedPeriod.data;

  const all = await gatherAllRecords();
  if (!all) {
    return Response.json({ ok: false, error: "store_not_configured" }, { status: 503 });
  }
  if (all.orders.length === 0) {
    return Response.json({ ok: true, report: "Kol kas nėra užsakymų ataskaitai.", snapshot: "" });
  }
  const snapshotText = buildPeriodReportText(all, period);
  try {
    const report = await callGemini(`${REPORT_SYSTEM_PREFIX}\n\nDUOMENYS:\n${snapshotText}`, 4096);
    return Response.json({ ok: true, report, snapshot: snapshotText });
  } catch {
    return Response.json({ ok: false, error: "ai_unavailable", snapshot: snapshotText }, { status: 502 });
  }
}
