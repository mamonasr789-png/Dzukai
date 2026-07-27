import "server-only";

import { createHash } from "node:crypto";
import { logStorageCapacityReached } from "./safeLogger.ts";

export interface RateLimitCommand {
  key: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface RateLimitPort {
  consume(command: RateLimitCommand): Promise<RateLimitDecision>;
  sweepExpired(): Promise<number>;
  reset(): Promise<void>;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export interface InMemoryRateLimitAdapterOptions {
  now?: () => number;
  maximumBuckets?: number;
}

const DEFAULT_MAXIMUM_BUCKETS = 20_000;

export class InMemoryRateLimitAdapter implements RateLimitPort {
  private readonly buckets = new Map<string, RateLimitBucket>();
  private readonly now: () => number;
  private readonly maximumBuckets: number;

  constructor(options: InMemoryRateLimitAdapterOptions = {}) {
    this.now = options.now ?? Date.now;
    this.maximumBuckets =
      options.maximumBuckets ?? DEFAULT_MAXIMUM_BUCKETS;
  }

  async consume(command: RateLimitCommand): Promise<RateLimitDecision> {
    if (
      !command.key ||
      !Number.isSafeInteger(command.limit) ||
      command.limit <= 0 ||
      !Number.isSafeInteger(command.windowMs) ||
      command.windowMs <= 0
    ) {
      return { allowed: false, remaining: 0, retryAfterMs: command.windowMs || 1_000 };
    }

    await this.sweepExpired();
    const now = this.now();
    const existing = this.buckets.get(command.key);
    if (!existing) {
      if (this.buckets.size >= this.maximumBuckets) {
        logStorageCapacityReached("rate_limit_buckets", this.maximumBuckets);
        return { allowed: false, remaining: 0, retryAfterMs: command.windowMs };
      }
      this.buckets.set(command.key, {
        count: 1,
        resetAt: now + command.windowMs,
      });
      return {
        allowed: true,
        remaining: command.limit - 1,
        retryAfterMs: 0,
      };
    }

    if (existing.count >= command.limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(1, existing.resetAt - now),
      };
    }
    existing.count += 1;
    return {
      allowed: true,
      remaining: command.limit - existing.count,
      retryAfterMs: 0,
    };
  }

  async sweepExpired(): Promise<number> {
    const now = this.now();
    let removed = 0;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  async reset(): Promise<void> {
    this.buckets.clear();
  }
}

export function requestFingerprint(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  const userAgent = request.headers.get("user-agent")?.slice(0, 160) ?? "";
  const source = `${forwardedFor || realIp || "unknown"}:${userAgent}`;
  return createHash("sha256").update(source).digest("hex").slice(0, 24);
}
