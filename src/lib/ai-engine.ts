/**
 * Compatibility shim — maps the old ai-engine interface to the new brain.
 * The UI (app/ai/page.tsx) imports from here; the real logic is in src/lib/assistant/.
 */

import { createState, processMessage } from "./assistant/brain.ts";
import type { AssistantAction, ConversationState } from "./assistant/types.ts";

// Re-export ConversationState as WaiterContext for UI compatibility
export type WaiterContext = ConversationState;
export type { AssistantAction };

export interface ProcessMessageResult {
  text: string;
  actions?: AssistantAction[];
}

export function emptyContext(lang = "lt"): WaiterContext {
  return createState(lang);
}

/** Called by page.tsx before generateReply — no-op in new arch */
export function updateContext(_ctx: WaiterContext, _input: string): void {
  // Memory update happens inside generateReply → processMessage
}

/**
 * Generate a reply. Mutates ctx in place (state persists via ref in UI).
 * Returns text + any pending cart actions set by the assistant.
 */
export function generateReply(input: string, ctx: WaiterContext, lang: string): ProcessMessageResult {
  ctx.currentLanguage = lang;
  const text = processMessage(input, ctx);
  const actions = ctx.pendingActions?.length ? [...ctx.pendingActions] : undefined;
  ctx.pendingActions = [];
  return { text, actions };
}
