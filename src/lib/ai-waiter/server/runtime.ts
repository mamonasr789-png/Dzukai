import "server-only";

import { StandaloneVaiseCartAdapter } from "./cartPort.ts";
import { InMemoryConversationStateStore } from "./conversationStateStore.ts";
import { StaticMenuRepository } from "./menuRepository.ts";
import { InMemoryRateLimitAdapter } from "./rateLimitPort.ts";
import { InMemoryStaffTaskAdapter } from "./staffTaskPort.ts";
import { SafeToolRegistry } from "./toolRegistry.ts";

export const runtimeStorageKind = "process-local-memory" as const;

export interface RuntimeAvailability {
  available: boolean;
  code?: "storage_not_configured";
  message?: string;
}

export function getAiWaiterRuntimeAvailability(
  nodeEnvironment = process.env.NODE_ENV,
  storageKind: string = runtimeStorageKind
): RuntimeAvailability {
  if (nodeEnvironment === "production" && storageKind === runtimeStorageKind) {
    return {
      available: false,
      code: "storage_not_configured",
      message:
        "AI waiter persistent storage and shared production adapters are not configured.",
    };
  }
  return { available: true };
}

export const conversationStateStore =
  new InMemoryConversationStateStore();
export const menuRepository = new StaticMenuRepository();
export const rateLimitPort = new InMemoryRateLimitAdapter();
export const cartPort = new StandaloneVaiseCartAdapter(
  menuRepository,
  conversationStateStore
);
export const staffTaskPort = new InMemoryStaffTaskAdapter(
  conversationStateStore
);

conversationStateStore.registerSessionCleanup((sessionId) =>
  cartPort.cleanupSession(sessionId)
);
conversationStateStore.registerSessionCleanup((sessionId) =>
  staffTaskPort.cleanupSession(sessionId)
);

export const safeToolRegistry = new SafeToolRegistry(
  conversationStateStore,
  menuRepository,
  cartPort,
  staffTaskPort,
  rateLimitPort
);

export async function resetDevelopmentRuntime(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("The production AI waiter runtime cannot be reset.");
  }
  await conversationStateStore.reset();
  await cartPort.reset();
  await staffTaskPort.reset();
  await rateLimitPort.reset();
}
