import { z } from "zod";
import { hashPassword } from "../../../../lib/server/auth/password";
import { requireStaffRole } from "../../../../lib/server/auth/requireSession";
import {
  DuplicateUsernameError,
  getStaffAccountStore,
} from "../../../../lib/server/staffAccountStore";

export const runtime = "nodejs";

// Admin accounts are created by us, outside the app (scripts/create-staff-account.mjs) —
// the panel only ever creates the two employee-facing roles.
const CreatableRoleSchema = z.enum(["waiter", "kitchen"]);

const CreateAccountRequestSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(3)
      .max(40)
      .regex(/^[a-zA-Z0-9_.]+$/, "Only letters, digits, dot and underscore are allowed."),
    password: z.string().min(8).max(200),
    role: CreatableRoleSchema,
  })
  .strict();

export async function GET(): Promise<Response> {
  const session = await requireStaffRole("admin");
  if (!session) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const store = await getStaffAccountStore();
  if (!store) {
    return Response.json({ ok: false, error: "store_not_configured" }, { status: 503 });
  }
  const accounts = await store.list();
  return Response.json({ ok: true, accounts });
}

export async function POST(request: Request): Promise<Response> {
  const session = await requireStaffRole("admin");
  if (!session) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const store = await getStaffAccountStore();
  if (!store) {
    return Response.json({ ok: false, error: "store_not_configured" }, { status: 503 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const parsed = CreateAccountRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }

  const passwordHash = await hashPassword(parsed.data.password);
  try {
    const account = await store.create({
      username: parsed.data.username,
      passwordHash,
      role: parsed.data.role,
    });
    return Response.json({ ok: true, account }, { status: 201 });
  } catch (error) {
    if (error instanceof DuplicateUsernameError) {
      return Response.json({ ok: false, error: "username_taken" }, { status: 409 });
    }
    throw error;
  }
}
