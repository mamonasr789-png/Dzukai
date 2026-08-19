import { z } from "zod";
import { requireStaffRole } from "../../../../lib/server/auth/requireSession";
import { getSyncStore, pullAllRecords } from "../../../../lib/server/syncStore";
import { getStaffAccountStore } from "../../../../lib/server/staffAccountStore";
import type { Order, TableSession, WaiterTask } from "../../../../lib/orderTypes";
import {
  calculateRevenue,
  dateKey,
  getPopularItems,
  getStaffActivityToday,
  getTodayOrders,
} from "../../../../lib/analytics";
import { categories, products } from "../../../../lib/data";
import { callGemini } from "../../../../lib/server/geminiClient";

export const runtime = "nodejs";

const AskRequestSchema = z
  .object({
    question: z.string().trim().min(1).max(1000),
    lang: z.enum(["lt", "en"]).optional(),
  })
  .strict();

/** Query-string lang param is untrusted free text — anything but "en" falls back to lt. */
function parseLang(value: string | null | undefined): "lt" | "en" {
  return value === "en" ? "en" : "lt";
}

// Same "still working" window StaffAccountsPanel uses for its online dot —
// keeps "kas dabar dirba?" answers consistent with what the admin sees visually.
const ONLINE_WINDOW_MS = 90_000;

async function gatherSnapshot() {
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
  const accountStore = await getStaffAccountStore();
  const accounts = accountStore ? await accountStore.list() : [];
  return { orders, sessions, tasks, accounts };
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

interface StaffAccountLite {
  id: string;
  username: string;
  role: "admin" | "waiter" | "kitchen";
  lastSeenAt: string | null;
}

function buildSnapshotText(
  orders: Order[],
  sessions: TableSession[],
  tasks: WaiterTask[],
  accounts: StaffAccountLite[]
): string {
  const todayOrders = getTodayOrders(orders);
  const revenue = calculateRevenue(todayOrders);
  const topItems = getPopularItems(todayOrders, 8)
    .map((p) => `${p.name} x${p.quantitySold}`)
    .join(", ");

  // The top-8 overall list can hide a category entirely (e.g. drinks) behind
  // higher-volume food — a "which drink sold best" question needs its own
  // per-category ranking, not just a slice of the global one.
  const categoryLabel = new Map<string, string>(categories.map((c) => [c.id, c.label]));
  const productCategory = new Map<string, string>(products.map((p) => [p.id, p.category]));
  const categoryItemCounts = new Map<string, Map<string, number>>();
  for (const order of todayOrders) {
    if (order.status === "CANCELLED" || order.status === "PENDING_CONFIRMATION") continue;
    for (const item of order.items) {
      if (item.itemStatus === "CANCELLED") continue;
      const category = productCategory.get(item.productId);
      if (!category) continue;
      const perItem = categoryItemCounts.get(category) ?? new Map<string, number>();
      perItem.set(item.name, (perItem.get(item.name) ?? 0) + item.quantity);
      categoryItemCounts.set(category, perItem);
    }
  }
  const categoryLines = [...categoryItemCounts.entries()]
    .map(([category, items]) => {
      const [topName, topQty] = [...items.entries()].sort((a, b) => b[1] - a[1])[0];
      return `${categoryLabel.get(category) ?? category}: populiariausia ${topName} (x${topQty})`;
    })
    .join("; ");

  // The per-category lines above split gėrimai across ~11 separate menu
  // categories (kava, alus, vynas, kokteiliai, ...) — a plain "kokis
  // gėrimas populiariausias?" question has no single line to anchor on
  // there, and testing showed the model guessing from the food list
  // instead. Merge them into one ranked drinks-only answer.
  const DRINK_CATEGORY_IDS = new Set([
    "gerimai",
    "kava",
    "limonadai",
    "nealko-alus",
    "alus",
    "sidras",
    "alus-kokteiliai",
    "kokteiliai",
    "stiprieji",
    "sampanas",
    "vynas",
  ]);
  const drinkCounts = new Map<string, number>();
  for (const [category, items] of categoryItemCounts) {
    if (!DRINK_CATEGORY_IDS.has(category)) continue;
    for (const [name, qty] of items) drinkCounts.set(name, (drinkCounts.get(name) ?? 0) + qty);
  }
  const topDrinks = [...drinkCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, qty]) => `${name} x${qty}`)
    .join(", ");
  const byStatus = new Map<string, number>();
  for (const o of todayOrders) byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);
  const statusLine = [...byStatus.entries()].map(([s, n]) => `${s}: ${n}`).join(", ");
  const cancelled = todayOrders.filter((o) => o.status === "CANCELLED").length;

  // Customer visits — one dining session = one party seated at one table.
  const todaySessions = sessions.filter((s) => new Date(s.createdAt).getTime() >= startOfToday());
  const distinctTables = new Set(todaySessions.map((s) => s.tableNumber).filter(Boolean));

  // Which tables were busiest — by order count, since a table can host
  // several sessions (parties) across the day.
  const ordersByTable = new Map<string, number>();
  for (const o of todayOrders) {
    if (!o.tableNumber) continue;
    ordersByTable.set(o.tableNumber, (ordersByTable.get(o.tableNumber) ?? 0) + 1);
  }
  const busiestTables = [...ordersByTable.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([table, n]) => `${table}: ${n} užsakymų`)
    .join(", ");

  // Staff activity is stamped per role at different places: kitchen stamps
  // preparedBy on order items, waiters stamp deliveredBy on items and
  // completedBy on tasks — getStaffActivityToday already tallies all three
  // per staff account, this just splits the report by which counts fired.
  const activity = getStaffActivityToday(orders, tasks);
  const kitchenLines: string[] = [];
  const waiterLines: string[] = [];
  for (const [, a] of activity) {
    if (a.preparedCount > 0) kitchenLines.push(`${a.username}: ${a.preparedCount} patiekalų paruošta`);
    if (a.deliveredCount > 0 || a.tasksCompletedCount > 0) {
      waiterLines.push(
        `${a.username}: ${a.deliveredCount} patiekalų pristatyta, ${a.tasksCompletedCount} užduočių atlikta`
      );
    }
  }

  // "Kas dabar dirba?" needs a live snapshot, not "who did something today" —
  // same 90s heartbeat window StaffAccountsPanel's online dot uses.
  const onlineStaff = accounts.filter(
    (a) => a.role !== "admin" && a.lastSeenAt && Date.now() - new Date(a.lastSeenAt).getTime() < ONLINE_WINDOW_MS
  );
  const onlineLines = onlineStaff
    .map((a) => `${a.username} (${a.role === "kitchen" ? "virėjas" : "padavėjas"})`)
    .join(", ");

  // Per-day history (last 60 days) so date-specific questions ("kiek pajamų
  // buvo rugpjūčio 5?", "kiek vakar?") can be answered without a separate
  // query path — today's line above stays as the fast/primary summary.
  const historyStart = Date.now() - 60 * 24 * 60 * 60 * 1000;
  const billableForHistory = orders.filter(
    (o) => o.status !== "CANCELLED" && o.status !== "PENDING_CONFIRMATION" && new Date(o.createdAt).getTime() >= historyStart
  );
  const byDay = new Map<string, { orders: number; revenue: number }>();
  for (const o of billableForHistory) {
    const key = dateKey(new Date(o.createdAt));
    const entry = byDay.get(key) ?? { orders: 0, revenue: 0 };
    entry.orders += 1;
    entry.revenue += o.total;
    byDay.set(key, entry);
  }
  const dailyHistoryLines = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, v]) => `${day}: ${v.orders} užsakymų, ${v.revenue.toFixed(2)} EUR`)
    .join("\n");

  return [
    `Iš viso užsakymų šiandien: ${todayOrders.length}. Statusai: ${statusLine || "nėra"}.`,
    `Pajamos šiandien (be atšauktų ir nepatvirtintų): ${revenue.toFixed(2)} EUR.`,
    `Populiariausi patiekalai šiandien (bendras TOP 8): ${topItems || "nėra duomenų"}.`,
    `Populiariausias patiekalas pagal kiekvieną meniu kategoriją šiandien: ${categoryLines || "nėra duomenų"}.`,
    `Populiariausi GĖRIMAI šiandien (apjungus visas gėrimų kategorijas — kava, alus, vynas, kokteiliai, limonadai ir t.t., NEĮSKAITANT patiekalų ar sriubų): ${topDrinks || "nėra duomenų"}.`,
    `Atšaukta šiandien: ${cancelled}.`,
    `Klientų apsilankymų šiandien (naujų stalo sesijų): ${todaySessions.length}, iš ${distinctTables.size} skirtingų staliukų.`,
    `Užimčiausi staliukai šiandien (pagal užsakymų skaičių): ${busiestTables || "nėra duomenų"}.`,
    `Virtuvės personalo aktyvumas šiandien: ${kitchenLines.join("; ") || "nėra duomenų"}.`,
    `Padavėjų aktyvumas šiandien: ${waiterLines.join("; ") || "nėra duomenų"}.`,
    `Iš viso užduočių įvykių šiandien: ${tasks.filter((t) => new Date(t.updatedAt).getTime() >= startOfToday()).length}.`,
    `Šiuo metu dirba (prisijungę per pastarąsias 90 sek.): ${onlineLines || "niekas šiuo metu neprisijungęs"}.`,
    `Pajamos ir užsakymų skaičius pagal dieną (paskutinės 60 dienų, data YYYY-MM-DD, naudok šį sąrašą klausimams apie konkrečią praeitą dieną ar "vakar"): \n${dailyHistoryLines || "nėra duomenų"}`,
  ].join("\n");
}

function systemPrefix(lang: "lt" | "en", username: string): string {
  const today = dateKey(new Date());
  const yesterday = dateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
  if (lang === "en") {
    return (
      "You are the analytics assistant for the restaurant 'Dzūkų Ainiai'. " +
      "You are given real, current restaurant data (orders, customer sessions, staff). " +
      `Today's date: ${today}. Yesterday's date: ${yesterday}. ` +
      `You are speaking with the admin logged in as '${username}' — address them by that name (e.g. "Hi ${username},") instead of a generic term like "owner".` +
      "For questions about a specific past day or 'yesterday', use the 'Revenue and order count by day' list in the data — it covers up to the last 60 days. " +
      "Respond in ENGLISH ONLY, briefly and specifically, based ONLY on the data given. " +
      "If a specific day isn't in the list (too long ago or hasn't happened yet), say so. Never invent numbers."
    );
  }
  return (
    "Tu esi restorano 'Dzūkų Ainiai' administracijos analitikos asistentas. " +
    "Tau pateikiami tikri, dabartiniai restorano duomenys (užsakymai, klientų sesijos, personalas). " +
    `Šiandienos data: ${today}. Vakarykštė data: ${yesterday}. ` +
    `Kalbiesi su administratoriumi, prisijungusiu kaip '${username}' — kreipkis į jį šiuo vardu (pvz. kreipiamuoju linksniu, jei tai lietuviškas vardas), o ne bendrai „savininke“.` +
    "Klausimuose apie konkrečią praeitą dieną ar 'vakar' naudok 'Pajamos ir užsakymų skaičius pagal dieną' sąrašą duomenyse — jame yra iki 60 praėjusių dienų. " +
    "Atsakinėk LIETUVIŠKAI, trumpai ir konkrečiai, remdamasis TIK pateiktais duomenimis. " +
    "Jei konkrečios dienos duomenų sąraše nėra (pvz. per senai arba dar neįvyko), taip ir pasakyk. Neišgalvok skaičių."
  );
}

export async function GET(request: Request): Promise<Response> {
  const session = await requireStaffRole("admin");
  if (!session) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const lang = parseLang(new URL(request.url).searchParams.get("lang"));
  const snapshot = await gatherSnapshot();
  if (!snapshot) {
    return Response.json({ ok: false, error: "store_not_configured" }, { status: 503 });
  }
  const snapshotText = buildSnapshotText(snapshot.orders, snapshot.sessions, snapshot.tasks, snapshot.accounts);
  if (snapshot.orders.length === 0) {
    return Response.json({
      ok: true,
      summary: lang === "en" ? "No orders to analyze yet." : "Kol kas nėra užsakymų analizei.",
      snapshot: snapshotText,
    });
  }
  try {
    const instruction =
      lang === "en"
        ? "Give a short (4-6 sentence) overview of today's activity for the admin: how things are going, what stands out, what deserves attention."
        : "Pateik trumpą (4-6 sakinių) šios dienos veiklos apžvalgą administratoriui: kaip sekasi, kas išsiskiria, ką verta atkreipti dėmesį.";
    const summary = await callGemini(
      `${systemPrefix(lang, session.username)}\n\nDuomenys:\n${snapshotText}\n\n${instruction}`
    );
    return Response.json({ ok: true, summary, snapshot: snapshotText });
  } catch {
    return Response.json({ ok: false, error: "ai_unavailable", snapshot: snapshotText }, { status: 502 });
  }
}

export async function POST(request: Request): Promise<Response> {
  const session = await requireStaffRole("admin");
  if (!session) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const parsed = AskRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }
  const snapshot = await gatherSnapshot();
  if (!snapshot) {
    return Response.json({ ok: false, error: "store_not_configured" }, { status: 503 });
  }
  const snapshotText = buildSnapshotText(snapshot.orders, snapshot.sessions, snapshot.tasks, snapshot.accounts);
  const lang = parsed.data.lang === "en" ? "en" : "lt";
  try {
    const questionLabel = lang === "en" ? "Admin's question" : "Administratoriaus klausimas";
    const answerInstruction = lang === "en" ? "Answer the question based on this data." : "Atsakyk į klausimą remdamasis šiais duomenimis.";
    const answer = await callGemini(
      `${systemPrefix(lang, session.username)}\n\nDuomenys:\n${snapshotText}\n\n${questionLabel}: ${parsed.data.question}\n\n${answerInstruction}`
    );
    return Response.json({ ok: true, answer });
  } catch {
    return Response.json({ ok: false, error: "ai_unavailable" }, { status: 502 });
  }
}
