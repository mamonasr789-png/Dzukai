import { normalizeText } from "./synonyms.ts";

export { normalizeText };

export function normalizedWords(input: string): string[] {
  return normalizeText(input).split(/\s+/).filter(Boolean);
}
