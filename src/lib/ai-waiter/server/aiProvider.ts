import "server-only";

import type {
  ConversationStageSchema,
  CustomerPreferencesSchema,
  DietaryRequirementSchema,
  HungerLevelSchema,
  SupportedLanguage,
  ToolName,
} from "../schemas.ts";
import type { z } from "zod";

export interface AIProviderTurnContext {
  language: SupportedLanguage;
  stage: z.infer<typeof ConversationStageSchema>;
  preferences: z.infer<typeof CustomerPreferencesSchema>;
  dietaryRequirements: z.infer<typeof DietaryRequirementSchema>[];
  hungerLevel: z.infer<typeof HungerLevelSchema> | null;
  budget: number | null;
  latestReferencedProductIds: string[];
  userMessage: string;
}

export interface ProposedToolCall {
  callId: string;
  toolName: ToolName;
  input: unknown;
}

export interface AIProviderTurnResult {
  assistantText: string;
  proposedToolCalls: ProposedToolCall[];
}

/**
 * Provider integration point for Phase 2B.
 *
 * Implementations may propose registered tool calls, but must never execute
 * them directly. Every proposal still passes through SafeToolRegistry.
 */
export interface AIProvider {
  readonly providerId: string;
  generateTurn(context: AIProviderTurnContext): Promise<AIProviderTurnResult>;
}
