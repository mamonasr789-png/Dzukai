import "server-only";

import { StandaloneVaiseCartAdapter } from "./cartPort.ts";
import { InMemoryActionLedger } from "./actionLedger.ts";
import { AnthropicAIProvider } from "./anthropicProvider.ts";
import { GeminiAIProvider } from "./geminiProvider.ts";
import { InMemoryConversationStateStore } from "./conversationStateStore.ts";
import { DeterministicFallbackProvider } from "./deterministicFallbackProvider.ts";
import { StaticMenuRepository } from "./menuRepository.ts";
import { InMemoryRateLimitAdapter } from "./rateLimitPort.ts";
import { InMemoryStaffTaskAdapter } from "./staffTaskPort.ts";
import { SafeToolRegistry } from "./toolRegistry.ts";
import { WaiterTurnController } from "./turnController.ts";
import { InMemoryTurnIdempotencyStore } from "./turnIdempotencyStore.ts";
import { InMemorySessionTurnCoordinator } from "./sessionTurnCoordinator.ts";

export const runtimeStorageKind = "process-local-memory" as const;

export interface RuntimeAvailability {
  available: boolean;
  code?: "storage_not_configured";
  message?: string;
}

export function getAiWaiterRuntimeAvailability(
  nodeEnvironment = process.env.NODE_ENV,
  storageKind: string = runtimeStorageKind,
  demoAllowInMemory = process.env.AI_WAITER_DEMO_ALLOW_IN_MEMORY
): RuntimeAvailability {
  if (
    nodeEnvironment === "production" &&
    storageKind === runtimeStorageKind &&
    demoAllowInMemory !== "true"
  ) {
    return {
      available: false,
      code: "storage_not_configured",
      message:
        "AI waiter persistent storage and shared production adapters are not configured.",
    };
  }
  return { available: true };
}

export function isProductionInMemoryDemoOverride(
  nodeEnvironment = process.env.NODE_ENV,
  demoAllowInMemory = process.env.AI_WAITER_DEMO_ALLOW_IN_MEMORY,
  storageKind: string = runtimeStorageKind
): boolean {
  return (
    nodeEnvironment === "production" &&
    storageKind === runtimeStorageKind &&
    demoAllowInMemory === "true"
  );
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
export const turnIdempotencyStore =
  new InMemoryTurnIdempotencyStore();
export const actionLedger = new InMemoryActionLedger();
export const sessionTurnCoordinator =
  new InMemorySessionTurnCoordinator();

conversationStateStore.registerSessionCleanup((sessionId) =>
  cartPort.cleanupSession(sessionId)
);
conversationStateStore.registerSessionCleanup((sessionId) =>
  staffTaskPort.cleanupSession(sessionId)
);
conversationStateStore.registerSessionCleanup((sessionId) =>
  turnIdempotencyStore.cleanupSession(sessionId)
);
conversationStateStore.registerSessionCleanup((sessionId) =>
  actionLedger.cleanupSession(sessionId)
);
conversationStateStore.registerSessionCleanup((sessionId) =>
  sessionTurnCoordinator.cleanupSession(sessionId)
);

export const safeToolRegistry = new SafeToolRegistry(
  conversationStateStore,
  menuRepository,
  cartPort,
  staffTaskPort,
  rateLimitPort
);
export const anthropicProvider = new AnthropicAIProvider();
export const geminiProvider = new GeminiAIProvider();
export const deterministicFallbackProvider =
  new DeterministicFallbackProvider();
export const waiterTurnController = new WaiterTurnController({
  conversationStore: conversationStateStore,
  menuRepository,
  cartPort,
  toolRegistry: safeToolRegistry,
  provider: geminiProvider,
  fallbackProvider: deterministicFallbackProvider,
  turnIdempotency: turnIdempotencyStore,
  actionLedger,
  sessionCoordinator: sessionTurnCoordinator,
});
export const deterministicWaiterTurnController = new WaiterTurnController({
  conversationStore: conversationStateStore,
  menuRepository,
  cartPort,
  toolRegistry: safeToolRegistry,
  provider: deterministicFallbackProvider,
  fallbackProvider: deterministicFallbackProvider,
  turnIdempotency: turnIdempotencyStore,
  actionLedger,
  sessionCoordinator: sessionTurnCoordinator,
});

export async function resetDevelopmentRuntime(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("The production AI waiter runtime cannot be reset.");
  }
  await conversationStateStore.reset();
  await cartPort.reset();
  await staffTaskPort.reset();
  await rateLimitPort.reset();
  await turnIdempotencyStore.reset();
  await actionLedger.reset();
  await sessionTurnCoordinator.reset();
}
