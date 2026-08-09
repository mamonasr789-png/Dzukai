import "server-only";

import type {
  Cart,
  ConversationState,
  ConversationTurnRequest,
  WaiterTurnResult,
} from "../schemas.ts";
import type {
  ActionLedgerPort,
  StoredActionLedgerEntry,
} from "./actionLedger.ts";
import type { CartPort } from "./cartPort.ts";
import type { ConversationStateStore } from "./conversationStateStore.ts";
import type { GroundedResponseRenderer } from "./groundedResponseRenderer.ts";
import { buildVoiceContext, turnSeed } from "./waiterVoice.ts";
import type {
  SafeToolRegistry,
  ToolExecutionResponse,
} from "./toolRegistry.ts";
import {
  TurnResultFactory,
  type TurnRuntimeObservation,
} from "./turnResultFactory.ts";
import {
  attachServerOwnedActionInput,
  waiterActionFromToolResult,
} from "./turnExecutionSupport.ts";

function inferCompletedCartAction(
  ledger: StoredActionLedgerEntry,
  cart: Cart
): ToolExecutionResponse | null {
  if (cart.revision <= ledger.cartRevision) return null;
  const input = ledger.canonicalInput as Record<string, unknown>;
  let affectedLineId: string | null = null;
  if (ledger.entry.toolName === "add_to_cart") {
    const line = [...cart.lines].reverse().find(
      (candidate) =>
        candidate.productId === input.productId &&
        candidate.quantity === input.quantity &&
        candidate.customerNote === (input.customerNote ?? null)
    );
    if (!line) return null;
    affectedLineId = line.lineId;
  } else if (ledger.entry.toolName === "update_cart_item") {
    const line = cart.lines.find(
      (candidate) => candidate.lineId === input.lineId
    );
    if (
      !line ||
      (input.quantity !== undefined && line.quantity !== input.quantity)
    ) {
      return null;
    }
    affectedLineId = line.lineId;
  } else if (ledger.entry.toolName === "remove_from_cart") {
    if (cart.lines.some((line) => line.lineId === input.lineId)) return null;
    affectedLineId = String(input.lineId);
  } else if (ledger.entry.toolName === "clear_cart") {
    if (cart.lines.length !== 0) return null;
  } else {
    return null;
  }
  return {
    ok: true,
    toolName: ledger.entry.toolName,
    data: {
      cart,
      affectedLineId,
      operationId: null,
      replayed: true,
    },
  } as ToolExecutionResponse;
}

export class ActionOutcomeService {
  private readonly actionLedger: ActionLedgerPort;
  private readonly conversationStore: ConversationStateStore;
  private readonly cartPort: CartPort;
  private readonly toolRegistry: SafeToolRegistry;
  private readonly responseRenderer: GroundedResponseRenderer;
  private readonly resultFactory: TurnResultFactory;

  constructor(
    actionLedger: ActionLedgerPort,
    conversationStore: ConversationStateStore,
    cartPort: CartPort,
    toolRegistry: SafeToolRegistry,
    responseRenderer: GroundedResponseRenderer,
    resultFactory: TurnResultFactory
  ) {
    this.actionLedger = actionLedger;
    this.conversationStore = conversationStore;
    this.cartPort = cartPort;
    this.toolRegistry = toolRegistry;
    this.responseRenderer = responseRenderer;
    this.resultFactory = resultFactory;
  }

  renderCompleted(command: {
    request: ConversationTurnRequest;
    state: ConversationState;
    beforeCart: Cart;
    currentCart: Cart;
    ledger: StoredActionLedgerEntry;
    status:
      | "success_with_response_fallback"
      | "partial_success_state_update_failed";
    runtime?: TurnRuntimeObservation;
  }): WaiterTurnResult {
    const toolResult = command.ledger.toolResult;
    const action = toolResult
      ? waiterActionFromToolResult(toolResult)
      : null;
    return this.resultFactory.success({
      command: command.request,
      state: command.state,
      cart: command.currentCart,
      message: this.responseRenderer.actionSuccess({
        voice: buildVoiceContext({
          language: command.state.language,
          sessionId: command.state.sessionId,
          turn: turnSeed(command.request.message, command.state.updatedAt),
          message: command.request.message,
        }),
        ledger: command.ledger,
        beforeCart: command.beforeCart,
        currentCart: command.currentCart,
      }),
      references: [],
      actions: action ? [action] : [],
      status: command.status,
      actionLedger: [command.ledger.entry],
      fallbackUsed: command.runtime?.providerLoop.fallbackUsed ?? true,
      runtime: command.runtime,
    });
  }

  async recoverExceptional(
    request: ConversationTurnRequest,
    turnId: string
  ): Promise<WaiterTurnResult> {
    const actions = await this.actionLedger.getByTurn(
      request.sessionId,
      turnId
    );
    let succeeded = actions.find(
      (action) =>
        action.entry.status === "succeeded" && action.toolResult?.ok
    );
    const unfinished = actions.find(
      (action) =>
        action.entry.status === "executing" ||
        action.entry.status === "authorized"
    );
    if (!succeeded && unfinished) {
      const cartBeforeRetry = await this.cartPort.getCart(request.sessionId);
      if (cartBeforeRetry.ok) {
        const retry = await this.toolRegistry.execute({
          sessionId: request.sessionId,
          toolName: unfinished.entry.toolName,
          input: attachServerOwnedActionInput({
            toolName: unfinished.entry.toolName,
            input: unfinished.canonicalInput,
            cart: {
              ...cartBeforeRetry.data.cart,
              revision: unfinished.cartRevision,
            },
            idempotencyKey: unfinished.idempotencyKey,
          }),
        });
        const recoveredResult =
          retry.ok
            ? retry
            : inferCompletedCartAction(
                unfinished,
                cartBeforeRetry.data.cart
              ) ?? retry;
        const completed = await this.actionLedger.markCompleted(
          unfinished.entry.actionId,
          recoveredResult
        );
        if (completed?.entry.status === "succeeded") succeeded = completed;
      }
    }
    if (!succeeded) {
      return this.resultFactory.error(
        "internal_error",
        "The waiter turn ended before any action could be confirmed."
      );
    }
    const state = await this.conversationStore.getSession(
      request.sessionId
    );
    const cart = await this.cartPort.getCart(request.sessionId);
    if (!state || !cart.ok) {
      return this.resultFactory.error(
        "internal_error",
        "A completed action could not be reconciled."
      );
    }
    return this.renderCompleted({
      request,
      state,
      beforeCart: cart.data.cart,
      currentCart: cart.data.cart,
      ledger: succeeded,
      status: "partial_success_state_update_failed",
    });
  }
}
