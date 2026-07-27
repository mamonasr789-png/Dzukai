import "server-only";

import {
  createState as createLegacyState,
  processMessage as processLegacyMessage,
} from "../../assistant/brain.ts";
import type { SupportedLanguage } from "../schemas.ts";

const LEGACY_ACTION_TAG = /\[ADD:[^\]]+\]/gu;

/**
 * Migration boundary for the existing deterministic assistant.
 *
 * It is intentionally limited to non-mutating greetings. Legacy pending
 * actions and browser-cart tags are discarded and can never reach the new
 * server tool loop.
 */
export function safeLegacyGreeting(
  message: string,
  language: SupportedLanguage
): string | null {
  const state = createLegacyState(language);
  const response = processLegacyMessage(message, state)
    .replace(LEGACY_ACTION_TAG, "")
    .trim();
  state.pendingActions = [];
  if (!response || state.lastRecommendedIds.length > 0) return null;
  return response.slice(0, 500);
}
