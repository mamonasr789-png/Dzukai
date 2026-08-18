import { z } from "zod";
import { requireStaffRole } from "../../../../lib/server/auth/requireSession";
import { getSyncStore } from "../../../../lib/server/syncStore";

export const runtime = "nodejs";

const AskRequestSchema = z
  .object({
    question: z.string().trim().min(1).max(1000),
  })
  .strict();

interface OrderLike {
  id: string;
  tableNumber: string | null;
  createdAt: string;
  status: string;
  items: { productId: string; name: string; price: number; quantity: number }[];
  total: number;
  isPaid?: boolean;
}

interface TaskLike {
  id: string;
  type: string;
  status: string;
  orderId: string;
  tableNumber: string | null;
  createdAt: string;
  completedBy?: { username: string };
}

async function gatherSnapshot() {
  const store = await getSyncStore();
  if (!store) return null;
  const [ordersPull, tasksPull] = await Promise.all([
    store.pull("orders", 0),
    store.pull("tasks", 0),
  ]);
  const orders: OrderLike[] = ordersPull.records.map((r) => JSON.parse(r.data));
  const tasks: TaskLike[] = tasksPull.records.map((r) => JSON.parse(r.data));
  return { orders, tasks };
}

function buildSnapshotText(orders: OrderLike[], tasks: TaskLike[]): string {
  const active = orders.filter((o) => o.status !== "CANCELLED");
  const revenue = active
    .filter((o) => o.status !== "PENDING_CONFIRMATION")
    .reduce((sum, o) => sum + o.total, 0);
  const itemCounts = new Map<string, number>();
  for (const o of active) {
    for (const item of o.items) {
      itemCounts.set(item.name, (itemCounts.get(item.name) ?? 0) + item.quantity);
    }
  }
  const topItems = [...itemCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, qty]) => `${name} x${qty}`)
    .join(", ");
  const byStatus = new Map<string, number>();
  for (const o of orders) byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);
  const statusLine = [...byStatus.entries()].map(([s, n]) => `${s}: ${n}`).join(", ");
  const staffCounts = new Map<string, number>();
  for (const t of tasks) {
    if (t.completedBy?.username) {
      staffCounts.set(t.completedBy.username, (staffCounts.get(t.completedBy.username) ?? 0) + 1);
    }
  }
  const staffLine = [...staffCounts.entries()].map(([n, c]) => `${n}: ${c} užduočių`).join(", ") || "nėra";
  const cancelled = orders.filter((o) => o.status === "CANCELLED").length;

  return [
    `Iš viso užsakymų: ${orders.length}. Statusai: ${statusLine || "nėra"}.`,
    `Pajamos (be atšauktų ir nepatvirtintų): ${revenue.toFixed(2)} EUR.`,
    `Populiariausi patiekalai: ${topItems || "nėra duomenų"}.`,
    `Atšaukta: ${cancelled}.`,
    `Personalo aktyvumas (užbaigtos padavėjo/virtuvės užduotys): ${staffLine}.`,
    `Iš viso padavėjo užduočių įvykių: ${tasks.length}.`,
  ].join("\n");
}

async function callGemini(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("provider_unavailable");
  const model = process.env.AI_WAITER_GEMINI_MODEL ?? "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error("provider_request_failed");
  const json = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) throw new Error("provider_empty_response");
  return text.trim();
}

const SYSTEM_PREFIX =
  "Tu esi restorano 'Dzūkų Ainiai' administracijos analitikos asistentas. " +
  "Tau pateikiami tikri, dabartiniai restorano duomenys (užsakymai, pajamos, personalas). " +
  "Atsakinėk lietuviškai, trumpai ir konkrečiai, remdamasis TIK pateiktais duomenimis. " +
  "Jei duomenų nepakanka atsakyti, taip ir pasakyk. Neišgalvok skaičių.";

export async function GET(): Promise<Response> {
  const session = await requireStaffRole("admin");
  if (!session) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const snapshot = await gatherSnapshot();
  if (!snapshot) {
    return Response.json({ ok: false, error: "store_not_configured" }, { status: 503 });
  }
  const snapshotText = buildSnapshotText(snapshot.orders, snapshot.tasks);
  if (snapshot.orders.length === 0) {
    return Response.json({ ok: true, summary: "Kol kas nėra užsakymų analizei.", snapshot: snapshotText });
  }
  try {
    const summary = await callGemini(
      `${SYSTEM_PREFIX}\n\nDuomenys:\n${snapshotText}\n\nPateik trumpą (4-6 sakinių) šios dienos veiklos apžvalgą administratoriui: kaip sekasi, kas išsiskiria, ką verta atkreipti dėmesį.`
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
  const snapshotText = buildSnapshotText(snapshot.orders, snapshot.tasks);
  try {
    const answer = await callGemini(
      `${SYSTEM_PREFIX}\n\nDuomenys:\n${snapshotText}\n\nAdministratoriaus klausimas: ${parsed.data.question}\n\nAtsakyk į klausimą remdamasis šiais duomenimis.`
    );
    return Response.json({ ok: true, answer });
  } catch {
    return Response.json({ ok: false, error: "ai_unavailable" }, { status: 502 });
  }
}
