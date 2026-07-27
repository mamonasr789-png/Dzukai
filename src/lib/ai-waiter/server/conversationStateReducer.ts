import "server-only";

import { z } from "zod";
import {
  AllergySchema,
  AmbiguityStateSchema,
  BudgetScopeSchema,
  ConversationStageSchema,
  ConversationStateUpdateSchema,
  DietaryRequirementSchema,
  HungerLevelSchema,
  ProductIdSchema,
  SupportedLanguageSchema,
  UnresolvedQuestionSchema,
  type ConversationState,
  type ConversationStateUpdate,
} from "../schemas.ts";
import type {
  ConversationStateStore,
  ConversationTurnMetadataUpdate,
} from "./conversationStateStore.ts";

const PreferenceFieldSchema = z.enum([
  "preferredProductIds",
  "preferredCategories",
  "preferredProteins",
  "preferredDrinks",
]);

const DeltaOperationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("add_preference"),
    field: PreferenceFieldSchema,
    value: z.string().trim().min(1).max(120),
  }),
  z.object({
    kind: z.literal("remove_preference"),
    field: PreferenceFieldSchema,
    value: z.string().trim().min(1).max(120),
  }),
  z.object({
    kind: z.literal("add_dislike"),
    value: z.string().trim().min(1).max(120),
  }),
  z.object({
    kind: z.literal("remove_dislike"),
    value: z.string().trim().min(1).max(120),
  }),
  z.object({ kind: z.literal("add_allergy"), allergy: AllergySchema }),
  z.object({ kind: z.literal("remove_allergy"), allergy: AllergySchema }),
  z.object({
    kind: z.literal("add_dietary_requirement"),
    requirement: DietaryRequirementSchema,
  }),
  z.object({
    kind: z.literal("remove_dietary_requirement"),
    requirement: DietaryRequirementSchema,
  }),
  z.object({
    kind: z.literal("set_temporary_preference"),
    field: PreferenceFieldSchema,
    value: z.string().trim().min(1).max(120),
  }),
  z.object({
    kind: z.literal("clear_temporary_preference"),
    field: PreferenceFieldSchema.optional(),
    value: z.string().trim().min(1).max(120).optional(),
  }),
  z.object({
    kind: z.literal("set_budget"),
    amount: z.number().finite().positive().max(1_000),
    scope: BudgetScopeSchema,
  }),
  z.object({ kind: z.literal("clear_budget") }),
  z.object({ kind: z.literal("set_language"), language: SupportedLanguageSchema }),
  z.object({ kind: z.literal("set_stage"), stage: ConversationStageSchema }),
  z.object({
    kind: z.literal("update_references"),
    productIds: z.array(ProductIdSchema).max(10),
  }),
  z.object({
    kind: z.literal("set_unresolved_question"),
    question: UnresolvedQuestionSchema.nullable(),
  }),
  z.object({
    kind: z.literal("set_ambiguity"),
    ambiguity: AmbiguityStateSchema.nullable(),
  }),
  z.object({
    kind: z.literal("set_hunger"),
    hungerLevel: HungerLevelSchema.nullable(),
  }),
]);

export const ConversationStateDeltaSchema = z
  .object({
    operations: z.array(DeltaOperationSchema).max(40),
  })
  .strict();
export type ConversationStateDelta = z.infer<
  typeof ConversationStateDeltaSchema
>;

function unique(values: string[], maximum: number): string[] {
  return [...new Set(values)].slice(0, maximum);
}

function sameAllergy(
  left: ConversationState["allergies"][number],
  right: ConversationState["allergies"][number]
): boolean {
  return (
    left.allergen === right.allergen &&
    (left.otherLabel ?? "") === (right.otherLabel ?? "")
  );
}

export class ConversationStateReducer {
  reduce(
    current: ConversationState,
    rawDelta: ConversationStateDelta
  ): ConversationStateUpdate | null {
    const parsed = ConversationStateDeltaSchema.safeParse(rawDelta);
    if (!parsed.success) return null;

    const next = structuredClone(current);
    for (const operation of parsed.data.operations) {
      switch (operation.kind) {
        case "add_preference":
          next.preferences[operation.field] = unique(
            [...next.preferences[operation.field], operation.value],
            operation.field === "preferredProductIds" ? 20 : 12
          );
          break;
        case "remove_preference":
          next.preferences[operation.field] = next.preferences[
            operation.field
          ].filter((value) => value !== operation.value);
          break;
        case "add_dislike":
          next.dislikedIngredients = unique(
            [...next.dislikedIngredients, operation.value],
            30
          );
          break;
        case "remove_dislike":
          next.dislikedIngredients = next.dislikedIngredients.filter(
            (value) => value !== operation.value
          );
          break;
        case "add_allergy":
          if (!next.allergies.some((value) => sameAllergy(value, operation.allergy))) {
            next.allergies = [...next.allergies, operation.allergy].slice(0, 20);
          }
          break;
        case "remove_allergy":
          next.allergies = next.allergies.filter(
            (value) => !sameAllergy(value, operation.allergy)
          );
          break;
        case "add_dietary_requirement":
          next.dietaryRequirements = [
            ...new Set([
              ...next.dietaryRequirements,
              operation.requirement,
            ]),
          ].slice(0, 12);
          break;
        case "remove_dietary_requirement":
          next.dietaryRequirements = next.dietaryRequirements.filter(
            (value) => value !== operation.requirement
          );
          break;
        case "set_temporary_preference":
          next.temporaryPreferences[operation.field] = unique(
            [
              ...next.temporaryPreferences[operation.field],
              operation.value,
            ],
            operation.field === "preferredProductIds" ? 20 : 12
          );
          break;
        case "clear_temporary_preference":
          if (!operation.field) {
            next.temporaryPreferences = {
              preferredProductIds: [],
              preferredCategories: [],
              preferredProteins: [],
              preferredDrinks: [],
            };
          } else if (operation.value) {
            next.temporaryPreferences[operation.field] =
              next.temporaryPreferences[operation.field].filter(
                (value) => value !== operation.value
              );
          } else {
            next.temporaryPreferences[operation.field] = [];
          }
          break;
        case "set_budget":
          next.budget = operation.amount;
          next.budgetScope = operation.scope;
          break;
        case "clear_budget":
          next.budget = null;
          next.budgetScope = null;
          break;
        case "set_language":
          next.language = operation.language;
          break;
        case "set_stage":
          next.stage = operation.stage;
          break;
        case "update_references":
          next.latestReferencedProductIds = operation.productIds;
          break;
        case "set_unresolved_question":
          next.unresolvedQuestion = operation.question;
          break;
        case "set_ambiguity":
          next.ambiguity = operation.ambiguity;
          break;
        case "set_hunger":
          next.hungerLevel = operation.hungerLevel;
          break;
      }
    }

    const update = {
      language: next.language,
      stage: next.stage,
      preferences: next.preferences,
      temporaryPreferences: next.temporaryPreferences,
      dislikedIngredients: next.dislikedIngredients,
      dietaryRequirements: next.dietaryRequirements,
      allergies: next.allergies,
      budget: next.budget,
      budgetScope: next.budgetScope,
      hungerLevel: next.hungerLevel,
      latestReferencedProductIds: next.latestReferencedProductIds,
      unresolvedQuestion: next.unresolvedQuestion,
      ambiguity: next.ambiguity,
    };
    const validated = ConversationStateUpdateSchema.safeParse(update);
    return validated.success ? validated.data : null;
  }

  providerUpdateToDelta(
    current: ConversationState,
    proposed: ConversationStateUpdate | undefined,
    allowedProductIds: ReadonlySet<string>
  ): ConversationStateDelta | null {
    if (!proposed) return { operations: [] };
    const parsed = ConversationStateUpdateSchema.safeParse(proposed);
    if (!parsed.success) return null;

    const sensitiveKeys: Array<keyof ConversationStateUpdate> = [
      "preferences",
      "temporaryPreferences",
      "dislikedIngredients",
      "dietaryRequirements",
      "allergies",
      "budget",
      "budgetScope",
      "hungerLevel",
    ];
    if (sensitiveKeys.some((key) => parsed.data[key] !== undefined)) {
      return null;
    }
    if (
      parsed.data.latestReferencedProductIds?.some(
        (productId) => !allowedProductIds.has(productId)
      )
    ) {
      return null;
    }

    const operations: ConversationStateDelta["operations"] = [];
    if (parsed.data.language && parsed.data.language !== current.language) {
      operations.push({ kind: "set_language", language: parsed.data.language });
    }
    if (parsed.data.stage && parsed.data.stage !== current.stage) {
      operations.push({ kind: "set_stage", stage: parsed.data.stage });
    }
    if (parsed.data.latestReferencedProductIds) {
      operations.push({
        kind: "update_references",
        productIds: parsed.data.latestReferencedProductIds,
      });
    }
    if (parsed.data.unresolvedQuestion !== undefined) {
      operations.push({
        kind: "set_unresolved_question",
        question: parsed.data.unresolvedQuestion,
      });
    }
    if (parsed.data.ambiguity !== undefined) {
      operations.push({
        kind: "set_ambiguity",
        ambiguity: parsed.data.ambiguity,
      });
    }
    return ConversationStateDeltaSchema.parse({ operations });
  }
}

export class ConversationStateCommitter {
  private readonly store: ConversationStateStore;
  private readonly reducer: ConversationStateReducer;

  constructor(
    store: ConversationStateStore,
    reducer: ConversationStateReducer
  ) {
    this.store = store;
    this.reducer = reducer;
  }

  async apply(
    sessionId: ConversationState["sessionId"],
    delta: ConversationStateDelta,
    metadata: ConversationTurnMetadataUpdate
  ): Promise<ConversationState | null> {
    const current = await this.store.getSession(sessionId);
    if (!current) return null;
    const update = this.reducer.reduce(current, delta);
    if (!update) return null;
    const result = await this.store.applyTurnUpdate(
      sessionId,
      update,
      metadata
    );
    return result.ok ? result.data : null;
  }
}
