import { getStaffSession } from "../../../../lib/server/auth/requireSession";
import { listTasks } from "../../../../lib/server/taskService";
import { visibleTableNumbersForWaiter } from "../../../../lib/server/waiterTableAccess";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const session = await getStaffSession();
  if (!session) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    let tasks = await listTasks();
    if (session.role === "waiter") {
      const visible = await visibleTableNumbersForWaiter(session.accountId);
      tasks = tasks.filter((t) => t.tableNumber === null || visible.has(t.tableNumber));
    }
    return Response.json({ ok: true, tasks });
  } catch {
    return Response.json({ ok: false, error: "store_not_configured" }, { status: 503 });
  }
}
