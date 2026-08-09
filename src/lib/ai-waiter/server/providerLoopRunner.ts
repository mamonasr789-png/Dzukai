import "server-only";

import type {
  AIProvider,
  AIProviderStepRequest,
} from "./aiProvider.ts";
import {
  ProviderStepSchema,
  type ProviderStep,
} from "./providerTooling.ts";

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("provider_timeout")),
      timeoutMs
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export type ProviderStepOutcome =
  | { ok: true; step: ProviderStep }
  | {
      ok: false;
      category: "provider_failure" | "invalid_provider_output";
      fallbackAvailable: boolean;
    };

export class ProviderLoopRunner {
  private activeProvider: AIProvider;
  private readonly fallbackProvider: AIProvider;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly allowFallback: boolean;
  private providerDurationMs = 0;
  private fallback = false;
  private validationCategory: string | undefined;

  constructor(options: {
    provider: AIProvider;
    fallbackProvider: AIProvider;
    timeoutMs: number;
    now?: () => number;
    allowFallback?: boolean;
  }) {
    this.activeProvider = options.provider.isAvailable()
      ? options.provider
      : options.fallbackProvider;
    this.fallbackProvider = options.fallbackProvider;
    this.fallback = this.activeProvider === options.fallbackProvider;
    this.timeoutMs = options.timeoutMs;
    this.now = options.now ?? Date.now;
    this.allowFallback = options.allowFallback ?? true;
  }

  async generate(
    request: AIProviderStepRequest
  ): Promise<ProviderStepOutcome> {
    const startedAt = this.now();
    let raw: unknown;
    try {
      raw = await withTimeout(
        this.activeProvider.generateStep(request),
        this.timeoutMs
      );
    } catch {
      this.providerDurationMs += this.now() - startedAt;
      return {
        ok: false,
        category: "provider_failure",
        fallbackAvailable: this.activateFallback("provider_failure"),
      };
    }
    this.providerDurationMs += this.now() - startedAt;
    const parsed = ProviderStepSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        category: "invalid_provider_output",
        fallbackAvailable: this.activateFallback("invalid_provider_output"),
      };
    }
    return { ok: true, step: parsed.data };
  }

  activateFallback(category: string): boolean {
    this.validationCategory = category;
    if (
      !this.allowFallback ||
      this.activeProvider === this.fallbackProvider
    ) {
      return false;
    }
    this.activeProvider = this.fallbackProvider;
    this.fallback = true;
    return true;
  }

  get providerId(): string {
    return this.activeProvider.providerId;
  }

  get fallbackUsed(): boolean {
    return this.fallback;
  }

  get providerMs(): number {
    return this.providerDurationMs;
  }

  get validationFailureCategory(): string | undefined {
    return this.validationCategory;
  }
}
