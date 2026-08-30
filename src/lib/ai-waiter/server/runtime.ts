import "server-only";

import { createDurableCartAdapter } from "./cartPort.ts";
import { createDurableActionLedger } from "./actionLedger.ts";
import { AnthropicAIProvider } from "./anthropicProvider.ts";
import { GeminiAIProvider } from "./geminiProvider.ts";
import { createDurableConversationStateStore } from "./conversationStateStore.ts";
import { DeterministicFallbackProvider } from "./deterministicFallbackProvider.ts";
import { StaticMenuRepository } from "./menuRepository.ts";
import { getMergedProducts } from "../../server/menuCatalog.ts";
import { InMemoryRateLimitAdapter } from "./rateLimitPort.ts";
import { createDurableStaffTaskAdapter } from "./staffTaskPort.ts";
import { SafeToolRegistry } from "./toolRegistry.ts";
import { WaiterTurnController } from "./turnController.ts";
import { createDurableTurnIdempotencyStore } from "./turnIdempotencyStore.ts";
import { createDurableSessionTurnCoordinator } from "./sessionTurnCoordinator.ts";
import { configuredAiWaiterBackendKind } from "./aiWaiterDb.ts";

// Which backend this process actually talks to for the six AI-waiter session
// stores: "postgres" (Neon, durable across deploys/instances — what Vercel
// production uses once DATABASE_URL is set) or "sqlite" (data/vaise.db, a
// single file on local disk — fine for local dev, not safe to treat as
// durable production storage: Vercel's filesystem is ephemeral and may not
// even be writable, and a second instance would never see writes from the
// first). Read once at module load; env is not expected to change mid-process.
export const runtimeStorageKind = configuredAiWaiterBackendKind();

export interface RuntimeAvailability {
  available: boolean;
  code?: "storage_not_configured";
  message?: string;
}

/**
 * Session state used to be plain in-process Maps, wiped by every deploy or
 * fresh serverless instance — this guard existed to stop production from
 * silently running on that. The six stores are now DB-backed (Postgres in
 * production, SQLite locally), so the guard now only fires for the one case
 * that is still unsafe: NODE_ENV=production without DATABASE_URL/POSTGRES_URL
 * configured, which would otherwise fall back to a non-durable SQLite file.
 * AI_WAITER_DEMO_ALLOW_IN_MEMORY is kept as the same escape hatch for running
 * a stateless demo in that situation (session data just won't survive a
 * redeploy) rather than hard-failing — same knob, narrower trigger.
 */
export function getAiWaiterRuntimeAvailability(
  nodeEnvironment = process.env.NODE_ENV,
  storageKind: string = configuredAiWaiterBackendKind(),
  demoAllowInMemory = process.env.AI_WAITER_DEMO_ALLOW_IN_MEMORY
): RuntimeAvailability {
  if (
    nodeEnvironment === "production" &&
    storageKind === "sqlite" &&
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
  storageKind: string = configuredAiWaiterBackendKind()
): boolean {
  return (
    nodeEnvironment === "production" &&
    storageKind === "sqlite" &&
    demoAllowInMemory === "true"
  );
}

export const menuRepository = new StaticMenuRepository(getMergedProducts);
export const rateLimitPort = new InMemoryRateLimitAdapter();

export const conversationStateStore = await createDurableConversationStateStore();
export const cartPort = await createDurableCartAdapter(menuRepository, conversationStateStore);
export const staffTaskPort = await createDurableStaffTaskAdapter(conversationStateStore);
export const turnIdempotencyStore = await createDurableTurnIdempotencyStore();
export const actionLedger = await createDurableActionLedger();
export const sessionTurnCoordinator = await createDurableSessionTurnCoordinator();

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
