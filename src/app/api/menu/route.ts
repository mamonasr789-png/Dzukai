import { listMenuOverrides } from "../../../lib/server/menuCatalog";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const overrides = await listMenuOverrides();
  return Response.json({ ok: true, overrides });
}
