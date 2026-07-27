import "server-only";

import { createHash } from "node:crypto";
import {
  ReferenceSetIdSchema,
  type DiningSessionId,
  type ReferenceSetId,
} from "../schemas.ts";

export function referenceSetIdFor(
  sessionId: DiningSessionId,
  productIds: readonly string[]
): ReferenceSetId {
  const digest = createHash("sha256")
    .update(sessionId)
    .update("\0")
    .update(productIds.join("\0"))
    .digest("hex")
    .slice(0, 24);
  return ReferenceSetIdSchema.parse(`refs_${digest}`);
}
