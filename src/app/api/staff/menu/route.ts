import { z } from "zod";
import { products } from "../../../../lib/data";
import { requireStaffRole } from "../../../../lib/server/auth/requireSession";
import { getMenuOverrideStore } from "../../../../lib/server/menuOverrideStore";

export const runtime = "nodejs";

const PatchSchema = z
  .object({
    productId: z.string().trim().min(1),
    soldOut: z.boolean().optional(),
    price: z.number().finite().nonnegative().max(10_000).optional(),
    name: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .refine(
    (body) => body.soldOut !== undefined || body.price !== undefined || body.name !== undefined,
    { message: "empty_patch" }
  );

export async function PATCH(request: Request): Promise<Response> {
  const session = await requireStaffRole("kitchen");
  if (!session) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }

  const wantsCatalogEdit =
    parsed.data.price !== undefined || parsed.data.name !== undefined;
  if (wantsCatalogEdit && session.role !== "admin") {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  if (!products.some((product) => product.id === parsed.data.productId)) {
    return Response.json({ ok: false, error: "unknown_product" }, { status: 400 });
  }

  const store = await getMenuOverrideStore();
  if (!store) {
    return Response.json({ ok: false, error: "store_not_configured" }, { status: 503 });
  }
  const override = await store.upsert(parsed.data);
  return Response.json({ ok: true, override });
}
