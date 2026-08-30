import "server-only";

import { z } from "zod";
import {
  AllergySchema,
  AmbiguityStateSchema,
  ConversationStateUpdateSchema,
  DietaryRequirementSchema,
  ProductIdSchema,
  ToolNameSchema,
  UnresolvedQuestionSchema,
  type ToolName,
} from "../schemas.ts";

const ProviderIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/);
const ProviderTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_500)
  .regex(/^[^\u0000-\u001F\u007F-\u009F]*$/u);
const ProviderReasonSchema = ProviderTextSchema.max(160);

const ProviderModifierSelectionSchema = z
  .object({
    modifierId: ProviderIdentifierSchema,
    optionId: ProviderIdentifierSchema,
  })
  .strict();

export const ProviderToolInputSchemas = {
  search_menu: z
    .object({
      query: ProviderTextSchema.max(1_000),
      category: ProviderIdentifierSchema.optional(),
      limit: z.number().int().min(1).max(8).default(6),
    })
    .strict(),
  get_product_details: z.object({ productId: ProductIdSchema }).strict(),
  recommend_products: z
    .object({
      category: ProviderIdentifierSchema.optional(),
      maxPrice: z.number().finite().positive().max(1_000).optional(),
      excludeProductIds: z.array(ProductIdSchema).max(20).default([]),
      dietaryRequirements: z
        .array(DietaryRequirementSchema)
        .max(12)
        .default([]),
      allergies: z.array(AllergySchema).max(20).default([]),
      limit: z.number().int().min(1).max(5).default(3),
    })
    .strict(),
  add_to_cart: z
    .object({
      productId: ProductIdSchema,
      quantity: z.number().int().min(1).max(20),
      modifiers: z.array(ProviderModifierSelectionSchema).max(20).default([]),
      customerNote: ProviderTextSchema.max(200).nullable().default(null),
    })
    .strict(),
  update_cart_item: z
    .object({
      lineId: z.string().regex(/^line_[a-f0-9]{32}$/),
      quantity: z.number().int().min(1).max(20).optional(),
      modifiers: z
        .array(ProviderModifierSelectionSchema)
        .max(20)
        .optional(),
      customerNote: ProviderTextSchema.max(200).nullable().optional(),
    })
    .strict()
    .refine(
      (input) =>
        input.quantity !== undefined ||
        input.modifiers !== undefined ||
        input.customerNote !== undefined,
      { message: "At least one cart line field must be updated" }
    ),
  remove_from_cart: z
    .object({ lineId: z.string().regex(/^line_[a-f0-9]{32}$/) })
    .strict(),
  view_cart: z.object({}).strict(),
  clear_cart: z.object({ confirm: z.literal(true) }).strict(),
  request_waiter: z
    .object({ note: ProviderTextSchema.max(200).optional() })
    .strict(),
  request_bill: z
    .object({ note: ProviderTextSchema.max(200).optional() })
    .strict(),
} satisfies Record<ToolName, z.ZodType>;

export function validateProviderToolInput(
  toolName: ToolName,
  input: unknown
): { success: true; data: unknown } | { success: false } {
  const result = ProviderToolInputSchemas[toolName].safeParse(input);
  return result.success
    ? { success: true, data: result.data }
    : { success: false };
}

// Provider state proposals intentionally exclude customer safety/preferences.
// Those fields are changed only by the deterministic state extractor/reducer.
export const ProviderStateUpdateSchema =
  ConversationStateUpdateSchema.pick({
    language: true,
    stage: true,
    latestReferencedProductIds: true,
    unresolvedQuestion: true,
    ambiguity: true,
  });

export const ProviderClaimSchema = z
  .object({
    claimType: z.enum([
      "product_price",
      "cart_total",
      "ingredient",
      "allergen",
      "dietary",
      "certification",
      "availability",
      "discount",
      "popularity",
      "kitchen_status",
      "payment_status",
      "staff_action",
      "restaurant_fact",
    ]),
    productId: ProductIdSchema.optional(),
    actionId: ProviderIdentifierSchema.optional(),
    proposedValue: z.union([
      z.string().trim().min(1).max(300),
      z.number().finite(),
      z.boolean(),
    ]),
    provenance: z.enum([
      "official_menu",
      "grounded_product",
      "current_cart",
      "action_ledger",
      "restaurant_knowledge",
    ]),
  })
  .strict();
export type ProviderClaim = z.infer<typeof ProviderClaimSchema>;

export const ProviderToolCallSchema = z
  .object({
    callId: ProviderIdentifierSchema,
    toolName: ToolNameSchema,
    input: z.unknown(),
    reason: ProviderReasonSchema.optional(),
  })
  .strict();
export type ProviderToolCall = z.infer<typeof ProviderToolCallSchema>;

const ResponseCommon = {
  stateUpdate: ProviderStateUpdateSchema.optional(),
};

export const ProviderStepSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("tool_requests"),
      toolCalls: z.array(ProviderToolCallSchema).min(1).max(8),
      ...ResponseCommon,
    })
    .strict(),
  z
    .object({
      kind: z.literal("final"),
      message: ProviderTextSchema,
      referencedProductIds: z.array(ProductIdSchema).max(10).default([]),
      claims: z.array(ProviderClaimSchema).max(20).optional(),
      ...ResponseCommon,
    })
    .strict(),
  z
    .object({
      kind: z.literal("clarification"),
      message: ProviderTextSchema,
      unresolvedQuestion: UnresolvedQuestionSchema,
      ambiguity: AmbiguityStateSchema.nullable().default(null),
      ...ResponseCommon,
    })
    .strict(),
  z
    .object({
      kind: z.literal("staff_escalation"),
      message: ProviderTextSchema,
      recommendedAction: z.enum(["request_waiter", "request_bill", "none"]),
      ...ResponseCommon,
    })
    .strict(),
]);
export type ProviderStep = z.infer<typeof ProviderStepSchema>;

function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const converted = z.toJSONSchema(schema, { target: "draft-7" }) as Record<
    string,
    unknown
  >;
  delete converted.$schema;
  return converted;
}

export const PROVIDER_STATE_UPDATE_JSON_SCHEMA = jsonSchema(
  ProviderStateUpdateSchema
);
export const PROVIDER_CLAIMS_JSON_SCHEMA = jsonSchema(
  z.array(ProviderClaimSchema).max(20)
);

export interface ProviderToolDefinition {
  name: ToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}

const descriptions: Record<ToolName, string> = {
  search_menu:
    "Search the official menu using current customer wording. Use this to resolve a named dish before pairing, answering ingredients, allergens, wait times, or portions. Returns capped official summaries. Never invent items.",
  get_product_details:
    "Fetch official details (ingredients, declared allergens, portion/SKU, availability) for a catalog product. Use before answering what is in a dish, allergens, sizes, or sold-out status.",
  recommend_products:
    "Recommend 1-3 available official menu items. Use for pairing drinks-with-food, food-with-drinks, sides, and what goes with X, as well as general suggestions. Respect stored budget, dietary requirements, and allergies. Sold-out items are excluded. Never invent dishes.",
  add_to_cart:
    "Propose adding exactly one explicitly requested grounded product. The server independently authorizes intent, target, quantity, price, revision, and idempotency.",
  update_cart_item:
    "Propose updating one explicitly requested exact cart line. The server independently authorizes it.",
  remove_from_cart:
    "Propose removing one explicitly requested exact cart line. Never guess.",
  view_cart: "Load the current reconciled cart.",
  clear_cart:
    "Propose clearing the cart only after an explicit customer instruction. The server independently authorizes it.",
  request_waiter:
    "Propose a waiter request only after explicit first-person customer intent and verified table context.",
  request_bill:
    "Call a waiter to settle the bill at the table. Use when the guest asks to pay or for the bill. There is no in-app guest pay.",
};

export const PROVIDER_TOOL_DEFINITIONS: readonly ProviderToolDefinition[] =
  ToolNameSchema.options.map((name) => ({
    name,
    description: descriptions[name],
    inputSchema: jsonSchema(ProviderToolInputSchemas[name]),
  }));
