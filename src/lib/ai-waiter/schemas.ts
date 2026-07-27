import { z } from "zod";

const NO_CONTROL_CHARACTERS = /^[^\u0000-\u001F\u007F-\u009F]*$/u;
const MAX_SAFE_REVISION = Number.MAX_SAFE_INTEGER;

function safeText(maximumLength: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(maximumLength)
    .regex(NO_CONTROL_CHARACTERS, "Control characters are not allowed.");
}

const IdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/);

const ShortTextSchema = safeText(120);
const IsoDateSchema = z.string().datetime({ offset: true });
const RevisionSchema = z.number().int().nonnegative().max(MAX_SAFE_REVISION);

export const SupportedLanguageSchema = z.enum(["lt", "en", "ru"]);
export type SupportedLanguage = z.infer<typeof SupportedLanguageSchema>;

export const DiningSessionIdSchema = z
  .string()
  .regex(/^ds_[a-f0-9]{32}$/);
export type DiningSessionId = z.infer<typeof DiningSessionIdSchema>;

export const RestaurantIdSchema = IdentifierSchema;
export const TableTokenIdSchema = IdentifierSchema;

export const TableNumberSchema = z
  .string()
  .trim()
  .min(1)
  .max(12)
  .regex(/^[A-Za-z0-9-]+$/);

export const SignedTableTokenSchema = z
  .string()
  .min(16)
  .max(2_048)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

export const CustomerMessageSchema = safeText(1_000);
export const CustomerNoteSchema = safeText(200);

export const ProductIdSchema = IdentifierSchema;
export const CartLineIdSchema = z.string().regex(/^line_[a-f0-9]{32}$/);
export const OperationIdSchema = z.string().regex(/^op_[a-f0-9]{32}$/);
export const IdempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/);
export const ClientTurnIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/);
export type ClientTurnId = z.infer<typeof ClientTurnIdSchema>;

export const ReferenceSetIdSchema = z.string().regex(/^refs_[a-f0-9]{24}$/);
export type ReferenceSetId = z.infer<typeof ReferenceSetIdSchema>;

export const ClientSelectionHintSchema = z
  .object({
    actionType: z.literal("add_to_cart"),
    referenceSetId: ReferenceSetIdSchema,
    productId: ProductIdSchema,
    ordinal: z.number().int().nonnegative().max(9),
  })
  .strict();
export type ClientSelectionHint = z.infer<typeof ClientSelectionHintSchema>;

export const ProductReferenceSchema = z
  .object({
    productId: ProductIdSchema,
  })
  .strict();

export const DietaryRequirementSchema = z.enum([
  "vegetarian",
  "vegan",
  "gluten_free",
  "lactose_free",
  "no_pork",
  "halal",
  "kosher",
  "no_alcohol",
]);

export const AllergenNameSchema = z.enum([
  "gluten",
  "milk",
  "eggs",
  "nuts",
  "fish",
  "soy",
  "mustard",
  "crustaceans",
  "molluscs",
  "other",
]);

export const AllergySchema = z
  .object({
    allergen: AllergenNameSchema,
    otherLabel: ShortTextSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.allergen === "other" && !value.otherLabel) {
      context.addIssue({
        code: "custom",
        path: ["otherLabel"],
        message: "otherLabel is required for an unlisted allergen",
      });
    }
    if (value.allergen !== "other" && value.otherLabel) {
      context.addIssue({
        code: "custom",
        path: ["otherLabel"],
        message: "otherLabel is only allowed for an unlisted allergen",
      });
    }
  });

export const CustomerPreferencesSchema = z
  .object({
    preferredProductIds: z.array(ProductIdSchema).max(20).default([]),
    preferredCategories: z.array(IdentifierSchema).max(12).default([]),
    preferredProteins: z.array(ShortTextSchema).max(12).default([]),
    preferredDrinks: z.array(ShortTextSchema).max(12).default([]),
  })
  .strict();

export const BudgetScopeSchema = z
  .object({
    kind: z.enum(["total", "per_person"]),
    partySize: z.number().int().positive().max(100).nullable(),
  })
  .strict();

export const ConversationStageSchema = z.enum([
  "greeting",
  "discovering_preferences",
  "recommending",
  "clarifying",
  "cart_review",
  "service_request",
]);

export const HungerLevelSchema = z.enum(["light", "medium", "hungry", "very_hungry"]);

export const UnresolvedQuestionSchema = z
  .object({
    kind: z.enum([
      "product_reference",
      "modifier_confirmation",
      "cart_line_reference",
      "dietary_detail",
      "other",
    ]),
    promptKey: IdentifierSchema,
    relatedProductIds: z.array(ProductIdSchema).max(10).default([]),
  })
  .strict();

export const AmbiguityStateSchema = z
  .object({
    kind: z.enum(["product", "cart_line", "modifier"]),
    candidateIds: z.array(IdentifierSchema).min(2).max(10),
  })
  .strict();

export const ConversationStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    sessionId: DiningSessionIdSchema,
    restaurantId: RestaurantIdSchema.nullable(),
    tableNumber: TableNumberSchema.nullable(),
    tableTokenId: TableTokenIdSchema.nullable(),
    language: SupportedLanguageSchema,
    stage: ConversationStageSchema,
    preferences: CustomerPreferencesSchema,
    temporaryPreferences: CustomerPreferencesSchema.default({
      preferredProductIds: [],
      preferredCategories: [],
      preferredProteins: [],
      preferredDrinks: [],
    }),
    dislikedIngredients: z.array(ShortTextSchema).max(30),
    dietaryRequirements: z.array(DietaryRequirementSchema).max(12),
    allergies: z.array(AllergySchema).max(20),
    budget: z.number().finite().positive().max(1_000).nullable(),
    budgetScope: BudgetScopeSchema.nullable().default(null),
    hungerLevel: HungerLevelSchema.nullable(),
    latestReferencedProductIds: z.array(ProductIdSchema).max(10),
    unresolvedQuestion: UnresolvedQuestionSchema.nullable(),
    ambiguity: AmbiguityStateSchema.nullable(),
    cartRevision: RevisionSchema,
    lastIntent: IdentifierSchema.nullable().default(null),
    lastToolNames: z.array(IdentifierSchema).max(8).default([]),
    lastInteractionAt: IsoDateSchema.nullable().default(null),
    createdAt: IsoDateSchema,
    updatedAt: IsoDateSchema,
    expiresAt: IsoDateSchema,
  })
  .strict();
export type ConversationState = z.infer<typeof ConversationStateSchema>;

export const ConversationTurnRequestSchema = z
  .object({
    sessionId: DiningSessionIdSchema,
    message: CustomerMessageSchema,
    clientTurnId: ClientTurnIdSchema.optional(),
    requestedLanguage: SupportedLanguageSchema.optional(),
    selectionHint: ClientSelectionHintSchema.optional(),
  })
  .strict();
export type ConversationTurnRequest = z.infer<
  typeof ConversationTurnRequestSchema
>;

export const ConversationStateUpdateSchema = z
  .object({
    language: SupportedLanguageSchema.optional(),
    stage: ConversationStageSchema.optional(),
    preferences: CustomerPreferencesSchema.optional(),
    temporaryPreferences: CustomerPreferencesSchema.optional(),
    dislikedIngredients: z.array(ShortTextSchema).max(30).optional(),
    dietaryRequirements: z
      .array(DietaryRequirementSchema)
      .max(12)
      .optional(),
    allergies: z.array(AllergySchema).max(20).optional(),
    budget: z.number().finite().positive().max(1_000).nullable().optional(),
    budgetScope: BudgetScopeSchema.nullable().optional(),
    hungerLevel: HungerLevelSchema.nullable().optional(),
    latestReferencedProductIds: z
      .array(ProductIdSchema)
      .max(10)
      .optional(),
    unresolvedQuestion: UnresolvedQuestionSchema.nullable().optional(),
    ambiguity: AmbiguityStateSchema.nullable().optional(),
  })
  .strict();
export type ConversationStateUpdate = z.infer<
  typeof ConversationStateUpdateSchema
>;

export const AllergenCertaintySchema = z.enum(["confirmed", "incomplete", "unknown"]);
export const AllergenStatusSchema = z
  .object({
    certainty: AllergenCertaintySchema,
    declaredAllergens: z.array(safeText(80)).max(30),
    reason: z.enum([
      "verified_complete_record",
      "unverified_declared_record",
      "no_allergen_record",
    ]),
  })
  .strict();

export const ModifierOptionSchema = z
  .object({
    optionId: IdentifierSchema,
    name: ShortTextSchema,
    officialPriceDeltaCents: z.number().int().nonnegative().max(10_000),
    incompatibleOptionIds: z.array(IdentifierSchema).max(20).default([]),
  })
  .strict();

export const SupportedModifierSchema = z
  .object({
    modifierId: IdentifierSchema,
    name: ShortTextSchema,
    minimumSelections: z.number().int().nonnegative().max(20),
    maximumSelections: z.number().int().positive().max(20),
    options: z.array(ModifierOptionSchema).min(1).max(30),
  })
  .strict()
  .refine((modifier) => modifier.maximumSelections >= modifier.minimumSelections, {
    message: "maximumSelections must be greater than or equal to minimumSelections",
  });

export const ModifierSelectionSchema = z
  .object({
    modifierId: IdentifierSchema,
    optionId: IdentifierSchema,
  })
  .strict();
export type ModifierSelection = z.infer<typeof ModifierSelectionSchema>;

export const ProductOrderabilitySchema = z
  .object({
    status: z.enum(["orderable", "requires_variant"]),
    reason: z.enum(["confirmed_base_price", "variant_data_missing"]),
  })
  .strict();

export const MenuProductSummarySchema = z
  .object({
    productId: ProductIdSchema,
    name: ShortTextSchema,
    category: IdentifierSchema,
    officialUnitPrice: z.number().finite().nonnegative().max(100_000),
    currency: z.literal("EUR"),
    allergenStatus: AllergenStatusSchema,
    orderability: ProductOrderabilitySchema,
  })
  .strict();

export const ProductDetailsSchema = MenuProductSummarySchema.extend({
  description: z
    .string()
    .trim()
    .max(2_000)
    .regex(NO_CONTROL_CHARACTERS, "Control characters are not allowed."),
  ingredients: z.array(safeText(160)).max(100),
  priceNote: z
    .string()
    .trim()
    .max(240)
    .regex(NO_CONTROL_CHARACTERS, "Control characters are not allowed.")
    .nullable(),
  supportedModifiers: z.array(SupportedModifierSchema).max(30),
}).strict();
export type ProductDetails = z.infer<typeof ProductDetailsSchema>;

export const OfficialProductSnapshotSchema = z
  .object({
    productId: ProductIdSchema,
    name: ShortTextSchema,
    category: IdentifierSchema,
    officialUnitPrice: z.number().finite().nonnegative().max(100_000),
    currency: z.literal("EUR"),
    priceNote: z
      .string()
      .trim()
      .max(240)
      .regex(NO_CONTROL_CHARACTERS, "Control characters are not allowed.")
      .nullable(),
  })
  .strict();

export const CartLineSchema = z
  .object({
    lineId: CartLineIdSchema,
    productId: ProductIdSchema,
    product: OfficialProductSnapshotSchema,
    quantity: z.number().int().min(1).max(20),
    modifiers: z.array(ModifierSelectionSchema).max(20),
    customerNote: CustomerNoteSchema.nullable(),
    requiresStaffConfirmation: z.boolean(),
    lineRevision: z.number().int().positive().max(MAX_SAFE_REVISION),
    createdAt: IsoDateSchema,
    updatedAt: IsoDateSchema,
  })
  .strict();
export type CartLine = z.infer<typeof CartLineSchema>;

export const CartSchema = z
  .object({
    sessionId: DiningSessionIdSchema,
    revision: RevisionSchema,
    lines: z.array(CartLineSchema).max(100),
    total: z.number().finite().nonnegative().max(10_000_000),
    currency: z.literal("EUR"),
    updatedAt: IsoDateSchema,
  })
  .strict()
  .superRefine((cart, context) => {
    const lineIds = new Set(cart.lines.map((line) => line.lineId));
    if (lineIds.size !== cart.lines.length) {
      context.addIssue({
        code: "custom",
        path: ["lines"],
        message: "Cart line IDs must be unique.",
      });
    }
    for (const [index, line] of cart.lines.entries()) {
      if (line.productId !== line.product.productId) {
        context.addIssue({
          code: "custom",
          path: ["lines", index, "productId"],
          message: "Cart line product identity must match its official snapshot.",
        });
      }
    }
    const expectedTotalCents = cart.lines.reduce(
      (total, line) =>
        total + Math.round(line.product.officialUnitPrice * 100) * line.quantity,
      0
    );
    if (Math.round(cart.total * 100) !== expectedTotalCents) {
      context.addIssue({
        code: "custom",
        path: ["total"],
        message: "Cart total must match its official line snapshots.",
      });
    }
  });
export type Cart = z.infer<typeof CartSchema>;

export const SearchMenuInputSchema = z
  .object({
    query: CustomerMessageSchema,
    category: IdentifierSchema.optional(),
    limit: z.number().int().min(1).max(20).default(8),
  })
  .strict();
export type SearchMenuInput = z.infer<typeof SearchMenuInputSchema>;

export const GetProductDetailsInputSchema = ProductReferenceSchema;
export type GetProductDetailsInput = z.infer<typeof GetProductDetailsInputSchema>;

export const RecommendProductsInputSchema = z
  .object({
    category: IdentifierSchema.optional(),
    maxPrice: z.number().finite().positive().max(1_000).optional(),
    excludeProductIds: z.array(ProductIdSchema).max(100).default([]),
    dietaryRequirements: z.array(DietaryRequirementSchema).max(12).default([]),
    allergies: z.array(AllergySchema).max(20).default([]),
    limit: z.number().int().min(1).max(10).default(3),
  })
  .strict();
export type RecommendProductsInput = z.infer<typeof RecommendProductsInputSchema>;

export const AddCartItemInputSchema = z
  .object({
    productId: ProductIdSchema,
    quantity: z.number().int().min(1).max(20),
    modifiers: z.array(ModifierSelectionSchema).max(20).default([]),
    customerNote: CustomerNoteSchema.nullable().default(null),
    expectedRevision: RevisionSchema,
    idempotencyKey: IdempotencyKeySchema,
  })
  .strict();
export type AddCartItemInput = z.infer<typeof AddCartItemInputSchema>;

export const UpdateCartItemInputSchema = z
  .object({
    lineId: CartLineIdSchema,
    quantity: z.number().int().min(1).max(20).optional(),
    modifiers: z.array(ModifierSelectionSchema).max(20).optional(),
    customerNote: CustomerNoteSchema.nullable().optional(),
    expectedRevision: RevisionSchema,
  })
  .strict()
  .refine(
    (input) =>
      input.quantity !== undefined ||
      input.modifiers !== undefined ||
      input.customerNote !== undefined,
    { message: "At least one cart line field must be updated" }
  );
export type UpdateCartItemInput = z.infer<typeof UpdateCartItemInputSchema>;

export const RemoveCartItemInputSchema = z
  .object({
    lineId: CartLineIdSchema,
    expectedRevision: RevisionSchema,
  })
  .strict();
export type RemoveCartItemInput = z.infer<typeof RemoveCartItemInputSchema>;

export const ViewCartInputSchema = z.object({}).strict();
export type ViewCartInput = z.infer<typeof ViewCartInputSchema>;

export const ClearCartInputSchema = z
  .object({
    expectedRevision: RevisionSchema,
  })
  .strict();
export type ClearCartInput = z.infer<typeof ClearCartInputSchema>;

export const StaffRequestInputSchema = z
  .object({
    idempotencyKey: IdempotencyKeySchema,
    note: CustomerNoteSchema.optional(),
  })
  .strict();
export type StaffRequestInput = z.infer<typeof StaffRequestInputSchema>;

export const ToolNameSchema = z.enum([
  "search_menu",
  "get_product_details",
  "recommend_products",
  "add_to_cart",
  "update_cart_item",
  "remove_from_cart",
  "view_cart",
  "clear_cart",
  "request_waiter",
  "request_bill",
]);
export type ToolName = z.infer<typeof ToolNameSchema>;

export const ToolExecutionRequestSchema = z
  .object({
    sessionId: DiningSessionIdSchema,
    toolName: ToolNameSchema,
    input: z.unknown(),
  })
  .strict();
export type ToolExecutionRequest = z.infer<typeof ToolExecutionRequestSchema>;

export const ToolErrorCodeSchema = z.enum([
  "invalid_request",
  "invalid_tool_input",
  "invalid_table_token",
  "unknown_tool",
  "session_not_found",
  "product_not_found",
  "price_unavailable",
  "cart_reconciliation_failed",
  "cart_line_not_found",
  "cart_capacity_exceeded",
  "invalid_quantity",
  "unsupported_modifier",
  "required_variant_missing",
  "requires_staff_confirmation",
  "revision_conflict",
  "idempotency_conflict",
  "table_context_required",
  "rate_limited",
  "storage_not_configured",
  "storage_capacity_exceeded",
  "internal_error",
]);
export type ToolErrorCode = z.infer<typeof ToolErrorCodeSchema>;

export const ToolErrorSchema = z
  .object({
    ok: z.literal(false),
    toolName: ToolNameSchema.optional(),
    error: z
      .object({
        code: ToolErrorCodeSchema,
        message: safeText(240),
      })
      .strict(),
  })
  .strict();

export const SearchMenuOutputSchema = z
  .object({
    products: z.array(MenuProductSummarySchema).max(20),
  })
  .strict();

export const ProductDetailsOutputSchema = z
  .object({
    product: ProductDetailsSchema,
  })
  .strict();

export const RecommendProductsOutputSchema = z
  .object({
    products: z.array(MenuProductSummarySchema).max(10),
    allergySafetyConfirmed: z.literal(false),
    certificationStatus: z.enum(["not_requested", "unknown"]),
    requiresStaffConfirmation: z.boolean(),
  })
  .strict();

export const CartOutputSchema = z
  .object({
    cart: CartSchema,
    affectedLineId: CartLineIdSchema.nullable(),
    operationId: OperationIdSchema.nullable(),
    replayed: z.boolean().default(false),
  })
  .strict();

export const StaffRequestOutputSchema = z
  .object({
    requestId: IdentifierSchema,
    type: z.enum(["waiter_called", "bill_requested"]),
    restaurantId: RestaurantIdSchema,
    tableNumber: TableNumberSchema,
    status: z.literal("waiting"),
    replayed: z.boolean(),
  })
  .strict();

export const CreateDiningSessionRequestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create_demo_session"),
      language: SupportedLanguageSchema.default("lt"),
    })
    .strict(),
  z
    .object({
      action: z.literal("create_table_session"),
      language: SupportedLanguageSchema.default("lt"),
      tableToken: SignedTableTokenSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("restore_session"),
      sessionId: DiningSessionIdSchema,
    })
    .strict(),
]);
export type DiningSessionRequest = z.infer<
  typeof CreateDiningSessionRequestSchema
>;

export const DiningSessionCapabilitiesSchema = z
  .object({
    mode: z.enum(["demo", "table"]),
    staffRequestsAvailable: z.boolean(),
  })
  .strict();
export type DiningSessionCapabilities = z.infer<
  typeof DiningSessionCapabilitiesSchema
>;

export const DiningSessionSnapshotResponseSchema = z
  .object({
    ok: z.literal(true),
    state: ConversationStateSchema,
    cart: CartSchema,
    capabilities: DiningSessionCapabilitiesSchema,
  })
  .strict();
export type DiningSessionSnapshotResponse = z.infer<
  typeof DiningSessionSnapshotResponseSchema
>;

export const CreateDiningSessionResponseSchema =
  DiningSessionSnapshotResponseSchema;

export const WaiterReferenceSchema = z
  .object({
    productId: ProductIdSchema,
    name: ShortTextSchema,
    officialUnitPrice: z.number().finite().nonnegative().max(100_000),
    currency: z.literal("EUR"),
    referenceSetId: ReferenceSetIdSchema.optional(),
    ordinal: z.number().int().nonnegative().max(9).optional(),
  })
  .strict();
export type WaiterReference = z.infer<typeof WaiterReferenceSchema>;

export const WaiterActionSchema = z
  .object({
    type: z.enum([
      "cart_updated",
      "staff_requested",
      "clarification_required",
    ]),
    toolName: ToolNameSchema.optional(),
    targetId: IdentifierSchema.nullable().default(null),
  })
  .strict();
export type WaiterAction = z.infer<typeof WaiterActionSchema>;

export const TurnResultStatusSchema = z.enum([
  "success",
  "success_with_response_fallback",
  "partial_success_state_update_failed",
  "clarification_required",
  "rejected_action",
  "provider_failed_without_side_effect",
  "internal_failure_without_side_effect",
]);
export type TurnResultStatus = z.infer<typeof TurnResultStatusSchema>;

export const ActionTypeSchema = z.enum([
  "add_to_cart",
  "update_cart_item",
  "remove_from_cart",
  "clear_cart",
  "request_waiter",
  "request_bill",
]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

export const ActionIntentSchema = z
  .object({
    actionType: ActionTypeSchema.nullable(),
    affirmation: z.enum(["affirmative", "negative", "uncertain"]),
    negated: z.boolean(),
    hypothetical: z.boolean(),
    ambiguous: z.boolean(),
    informationalOnly: z.boolean(),
    comparisonOnly: z.boolean(),
    futureIntent: z.boolean(),
    thirdPartyIntent: z.boolean(),
    targetType: z
      .enum(["product", "cart_line", "cart", "staff"])
      .nullable(),
    targetIds: z.array(IdentifierSchema).max(10),
    quantity: z.number().int().positive().max(20).nullable(),
    customerNote: CustomerNoteSchema.nullable(),
    evidence: z.string().trim().max(500),
    confidence: z.enum(["high", "medium", "low"]),
    clarificationReason: IdentifierSchema.nullable(),
  })
  .strict();
export type ActionIntent = z.infer<typeof ActionIntentSchema>;

export const ActionLedgerEntrySchema = z
  .object({
    actionId: IdentifierSchema,
    turnId: IdentifierSchema,
    intent: ActionIntentSchema,
    toolName: ActionTypeSchema,
    canonicalInputFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.enum(["authorized", "executing", "succeeded", "failed"]),
    result: z
      .object({
        ok: z.boolean(),
        code: IdentifierSchema.nullable(),
        replayed: z.boolean(),
      })
      .strict()
      .nullable(),
    affectedId: IdentifierSchema.nullable(),
    timestamp: IsoDateSchema,
  })
  .strict();
export type ActionLedgerEntry = z.infer<typeof ActionLedgerEntrySchema>;

export const WaiterTurnDebugSchema = z
  .object({
    provider: IdentifierSchema,
    fallbackUsed: z.boolean(),
    toolNames: z.array(ToolNameSchema).max(8),
    toolRounds: z.number().int().nonnegative().max(4),
    totalMs: z.number().int().nonnegative(),
    providerMs: z.number().int().nonnegative(),
    toolMs: z.number().int().nonnegative(),
  })
  .strict();

export const WaiterTurnDataSchema = z
  .object({
    message: safeText(1_500),
    language: SupportedLanguageSchema,
    stage: ConversationStageSchema,
    references: z.array(WaiterReferenceSchema).max(10),
    cart: CartSchema,
    actions: z.array(WaiterActionSchema).max(8),
    status: TurnResultStatusSchema.default("success"),
    actionLedger: z.array(ActionLedgerEntrySchema).max(1).default([]),
    fallbackUsed: z.boolean(),
    replayed: z.boolean(),
    debug: WaiterTurnDebugSchema.optional(),
  })
  .strict();
export type WaiterTurnData = z.infer<typeof WaiterTurnDataSchema>;

export const WaiterTurnSuccessSchema = z
  .object({
    ok: z.literal(true),
    data: WaiterTurnDataSchema,
  })
  .strict();

export const WaiterTurnErrorCodeSchema = z.enum([
  "invalid_request",
  "session_not_found",
  "turn_id_conflict",
  "rate_limited",
  "storage_not_configured",
  "storage_capacity_exceeded",
  "provider_limit_exceeded",
  "safe_fallback_failed",
  "internal_error",
]);
export type WaiterTurnErrorCode = z.infer<
  typeof WaiterTurnErrorCodeSchema
>;

export const WaiterTurnErrorSchema = z
  .object({
    ok: z.literal(false),
    error: z
      .object({
        code: WaiterTurnErrorCodeSchema,
        message: safeText(240),
      })
      .strict(),
  })
  .strict();

export const WaiterTurnResultSchema = z.union([
  WaiterTurnSuccessSchema,
  WaiterTurnErrorSchema,
]);
export type WaiterTurnResult = z.infer<typeof WaiterTurnResultSchema>;
