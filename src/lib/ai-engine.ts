/**
 * Compatibility shim — maps the old ai-engine interface to the new brain.
 * The UI (app/ai/page.tsx) imports from here; the real logic is in src/lib/assistant/.
 */

import { createState, processMessage } from "./assistant/brain.ts";
import type { ConversationState } from "./assistant/types.ts";

// Re-export ConversationState as WaiterContext for UI compatibility
export type WaiterContext = ConversationState;

export function emptyContext(lang = "lt"): WaiterContext {
  return createState(lang);
}

/** Called by page.tsx before generateReply — no-op in new arch */
export function updateContext(_ctx: WaiterContext, _input: string): void {
  // Memory update happens inside generateReply → processMessage
}

/**
 * Generate a reply. Mutates ctx in place (state persists via ref in UI).
 */
export function generateReply(input: string, ctx: WaiterContext, lang: string): string {
  ctx.currentLanguage = lang;
  return processMessage(input, ctx);
}
