import { getStaffSession } from "../../../../lib/server/auth/requireSession";
import { listTasks } from "../../../../lib/server/taskService";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const session = await getStaffSession();
  if (!session) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const tasks = await listTasks();
    return Response.json({ ok: true, tasks });
  } catch {
    return Response.json({ ok: false, error: "store_not_configured" }, { status: 503 });
  }
}
