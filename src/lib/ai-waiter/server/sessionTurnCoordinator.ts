import "server-only";

import type { DiningSessionId } from "../schemas.ts";
import { logStorageCapacityReached } from "./safeLogger.ts";

export interface SessionTurnCoordinatorPort {
  runExclusive<T>(
    sessionId: DiningSessionId,
    operation: () => Promise<T>
  ): Promise<T>;
  cleanupSession(sessionId: DiningSessionId): Promise<void>;
  reset(): Promise<void>;
}

interface SessionQueue {
  tail: Promise<void>;
  queued: number;
  cleanupRequested: boolean;
}

export class SessionTurnCapacityError extends Error {
  constructor() {
    super("session_turn_capacity_exceeded");
  }
}

/**
 * Development-only per-session serialization. The port is intentionally small
 * so a distributed lock or transactional coordinator can replace it later.
 */
export class InMemorySessionTurnCoordinator
  implements SessionTurnCoordinatorPort
{
  private readonly queues = new Map<DiningSessionId, SessionQueue>();
  private readonly maximumSessions: number;

  constructor(options: { maximumSessions?: number } = {}) {
    this.maximumSessions = options.maximumSessions ?? 10_000;
  }

  async runExclusive<T>(
    sessionId: DiningSessionId,
    operation: () => Promise<T>
  ): Promise<T> {
    let queue = this.queues.get(sessionId);
    if (!queue) {
      if (this.queues.size >= this.maximumSessions) {
        logStorageCapacityReached(
          "session_turn_coordinator",
          this.maximumSessions
        );
        throw new SessionTurnCapacityError();
      }
      queue = {
        tail: Promise.resolve(),
        queued: 0,
        cleanupRequested: false,
      };
      this.queues.set(sessionId, queue);
    }

    const predecessor = queue.tail.catch(() => undefined);
    let release = (): void => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    queue.queued += 1;
    queue.tail = predecessor.then(() => current);

    await predecessor;
    try {
      return await operation();
    } finally {
      release();
      queue.queued -= 1;
      if (queue.queued === 0) {
        this.queues.delete(sessionId);
      }
    }
  }

  async cleanupSession(sessionId: DiningSessionId): Promise<void> {
    const queue = this.queues.get(sessionId);
    if (!queue) return;
    queue.cleanupRequested = true;
    if (queue.queued === 0) this.queues.delete(sessionId);
  }

  async reset(): Promise<void> {
    for (const [sessionId, queue] of this.queues) {
      queue.cleanupRequested = true;
      if (queue.queued === 0) this.queues.delete(sessionId);
    }
  }
}
