import "server-only";

import {
  WaiterTurnResultSchema,
  type ActionLedgerEntry,
  type Cart,
  type ConversationState,
  type ConversationTurnRequest,
  type ToolName,
  type TurnResultStatus,
  type WaiterAction,
  type WaiterReference,
  type WaiterTurnData,
  type WaiterTurnErrorCode,
  type WaiterTurnResult,
} from "../schemas.ts";
import type { ProviderLoopRunner } from "./providerLoopRunner.ts";
import { logSafeTurnEvent } from "./safeLogger.ts";
import { sanitizeTurnText } from "./turnExecutionSupport.ts";

export interface TurnRuntimeObservation {
  startedAt: number;
  toolRounds: number;
  toolMs: number;
  toolNames: ToolName[];
  providerLoop: ProviderLoopRunner;
}

export class TurnResultFactory {
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  success(command: {
    command: ConversationTurnRequest;
    state: ConversationState;
    cart: Cart;
    message: string;
    references: WaiterReference[];
    actions: WaiterAction[];
    status: TurnResultStatus;
    actionLedger: ActionLedgerEntry[];
    fallbackUsed: boolean;
    runtime?: TurnRuntimeObservation;
  }): WaiterTurnResult {
    const runtime = command.runtime;
    const totalMs = runtime ? this.now() - runtime.startedAt : 0;
    const debugEnabled =
      process.env.NODE_ENV === "development" &&
      process.env.AI_WAITER_DEBUG_RESPONSE === "true";
    const data: WaiterTurnData = {
      message: sanitizeTurnText(command.message),
      language: command.state.language,
      stage: command.state.stage,
      references: command.references,
      cart: command.cart,
      actions: command.actions,
      status: command.status,
      actionLedger: command.actionLedger,
      fallbackUsed: command.fallbackUsed,
      replayed: false,
      ...(debugEnabled && runtime
        ? {
            debug: {
              provider: runtime.providerLoop.providerId,
              fallbackUsed: runtime.providerLoop.fallbackUsed,
              toolNames: runtime.toolNames,
              toolRounds: runtime.toolRounds,
              totalMs,
              providerMs: runtime.providerLoop.providerMs,
              toolMs: runtime.toolMs,
            },
          }
        : {}),
    };
    if (runtime) {
      logSafeTurnEvent({
        turnId: command.command.clientTurnId ?? null,
        sessionId: command.command.sessionId,
        provider: runtime.providerLoop.providerId,
        fallbackUsed: runtime.providerLoop.fallbackUsed,
        toolNames: runtime.toolNames,
        toolRounds: runtime.toolRounds,
        validationFailureCategory:
          runtime.providerLoop.validationFailureCategory,
        totalMs,
        providerMs: runtime.providerLoop.providerMs,
        toolMs: runtime.toolMs,
        status: "success",
      });
    }
    return WaiterTurnResultSchema.parse({ ok: true, data });
  }

  error(
    code: WaiterTurnErrorCode,
    message: string
  ): WaiterTurnResult {
    return WaiterTurnResultSchema.parse({
      ok: false,
      error: { code, message },
    });
  }
}
