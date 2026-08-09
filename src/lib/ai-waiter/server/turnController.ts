import "server-only";

import { randomUUID } from "node:crypto";
import {
  ActionTypeSchema,
  ConversationTurnRequestSchema,
  WaiterTurnResultSchema,
  type ActionLedgerEntry,
  type Cart,
  type ConversationState,
  type ConversationTurnRequest,
  type ToolName,
  type TurnResultStatus,
  type WaiterTurnResult,
} from "../schemas.ts";
import { ActionAuthorizationPolicy } from "./actionAuthorizationPolicy.ts";
import {
  InMemoryActionLedger,
  type ActionLedgerPort,
} from "./actionLedger.ts";
import { ActionOutcomeService } from "./actionOutcomeService.ts";
import type {
  AIProvider,
  GroundedWaiterContext,
  ProviderToolExchange,
  ProviderToolResult,
} from "./aiProvider.ts";
import { canonicalFingerprint } from "./canonicalJson.ts";
import type { CartPort } from "./cartPort.ts";
import { ClaimValidation } from "./claimValidation.ts";
import {
  ConversationStateReducer,
  ConversationStateCommitter,
  type ConversationStateDelta,
} from "./conversationStateReducer.ts";
import type { ConversationStateStore } from "./conversationStateStore.ts";
import { GroundedResponseRenderer } from "./groundedResponseRenderer.ts";
import {
  buildVoiceContext,
  turnSeed,
  type VoiceContext,
} from "./waiterVoice.ts";
import { buildGroundedWaiterContext } from "./grounding.ts";
import type { MenuRepository } from "./menuRepository.ts";
import { ProviderLoopRunner } from "./providerLoopRunner.ts";
import {
  validateProviderToolInput,
  type ProviderStep,
  type ProviderToolCall,
} from "./providerTooling.ts";
import {
  InMemorySessionTurnCoordinator,
  SessionTurnCapacityError,
  type SessionTurnCoordinatorPort,
} from "./sessionTurnCoordinator.ts";
import {
  extractTurnState,
  messageUsesPriorReference,
} from "./stateExtraction.ts";
import type { SafeToolRegistry } from "./toolRegistry.ts";
import {
  READ_ONLY_TOOLS,
  TURN_COPY,
  attachServerOwnedActionInput,
  cartFromToolResult,
  isFoodSafetyQuestion,
  productIdsFromToolResult,
  sanitizeTurnText,
  turnMetadata,
} from "./turnExecutionSupport.ts";
import type { TurnIdempotencyPort } from "./turnIdempotencyStore.ts";
import { TurnResultFactory } from "./turnResultFactory.ts";
import { TurnGroundingService } from "./turnGroundingService.ts";

export interface WaiterTurnControllerDependencies {
  conversationStore: ConversationStateStore;
  menuRepository: MenuRepository;
  cartPort: CartPort;
  toolRegistry: SafeToolRegistry;
  provider: AIProvider;
  fallbackProvider: AIProvider;
  turnIdempotency: TurnIdempotencyPort;
  actionLedger?: ActionLedgerPort;
  sessionCoordinator?: SessionTurnCoordinatorPort;
  actionAuthorization?: ActionAuthorizationPolicy;
  stateReducer?: ConversationStateReducer;
  claimValidation?: ClaimValidation;
  responseRenderer?: GroundedResponseRenderer;
}

interface WaiterTurnControllerOptions {
  maximumToolRounds?: number;
  maximumToolCalls?: number;
  providerTimeoutMs?: number;
  now?: () => number;
}

export interface WaiterTurnExecutionOptions {
  allowProviderFallback?: boolean;
}

interface TurnRuntime {
  startedAt: number;
  turnId: string;
  toolRounds: number;
  totalToolCalls: number;
  toolMs: number;
  toolNames: ToolName[];
  seenCalls: Set<string>;
  currentToolProductIds: Set<string>;
  exchanges: ProviderToolExchange[];
  providerLoop: ProviderLoopRunner;
}

export class WaiterTurnController {
  private readonly dependencies: WaiterTurnControllerDependencies;
  private readonly maximumToolRounds: number;
  private readonly maximumToolCalls: number;
  private readonly providerTimeoutMs: number;
  private readonly now: () => number;
  private readonly actionLedger: ActionLedgerPort;
  private readonly sessionCoordinator: SessionTurnCoordinatorPort;
  private readonly actionAuthorization: ActionAuthorizationPolicy;
  private readonly stateReducer: ConversationStateReducer;
  private readonly stateCommitter: ConversationStateCommitter;
  private readonly claimValidation: ClaimValidation;
  private readonly responseRenderer: GroundedResponseRenderer;
  private readonly resultFactory: TurnResultFactory;
  private readonly grounding: TurnGroundingService;
  private readonly actionOutcomes: ActionOutcomeService;

  constructor(
    dependencies: WaiterTurnControllerDependencies,
    options: WaiterTurnControllerOptions = {}
  ) {
    this.dependencies = dependencies;
    this.maximumToolRounds = options.maximumToolRounds ?? 4;
    this.maximumToolCalls = options.maximumToolCalls ?? 12;
    // Outer guard around each provider step. Must stay above
    // AnthropicAIProvider.timeoutMs (45 s) so the provider's own timeout wins
    // and the loop records a clean provider_failure instead of being cut off here.
    this.providerTimeoutMs = options.providerTimeoutMs ?? 60_000;
    this.now = options.now ?? Date.now;
    this.actionLedger =
      dependencies.actionLedger ?? new InMemoryActionLedger();
    this.sessionCoordinator =
      dependencies.sessionCoordinator ??
      new InMemorySessionTurnCoordinator();
    this.actionAuthorization =
      dependencies.actionAuthorization ?? new ActionAuthorizationPolicy();
    this.stateReducer =
      dependencies.stateReducer ?? new ConversationStateReducer();
    this.stateCommitter = new ConversationStateCommitter(
      dependencies.conversationStore,
      this.stateReducer
    );
    this.claimValidation =
      dependencies.claimValidation ?? new ClaimValidation();
    this.responseRenderer =
      dependencies.responseRenderer ?? new GroundedResponseRenderer();
    this.resultFactory = new TurnResultFactory(this.now);
    this.grounding = new TurnGroundingService(
      dependencies.menuRepository
    );
    this.actionOutcomes = new ActionOutcomeService(
      this.actionLedger,
      dependencies.conversationStore,
      dependencies.cartPort,
      dependencies.toolRegistry,
      this.responseRenderer,
      this.resultFactory
    );
  }

  private voiceFor(state: ConversationState, message: string): VoiceContext {
    return buildVoiceContext({
      language: state.language,
      sessionId: state.sessionId,
      turn: turnSeed(message, state.updatedAt),
      message,
      now: new Date(this.now()),
    });
  }

  async handleWaiterTurn(
    rawCommand: unknown,
    options: WaiterTurnExecutionOptions = {}
  ): Promise<WaiterTurnResult> {
    const parsed = ConversationTurnRequestSchema.safeParse(rawCommand);
    if (!parsed.success) {
      return this.resultFactory.error(
        "invalid_request",
        "Waiter turn request failed validation."
      );
    }
    const existing = await this.dependencies.conversationStore.getSession(
      parsed.data.sessionId
    );
    if (!existing) {
      return this.resultFactory.error(
        "session_not_found",
        "Dining session was not found or expired."
      );
    }

    const turnId =
      parsed.data.clientTurnId ??
      `server_${randomUUID().replaceAll("-", "")}`;
    const idempotent = await this.dependencies.turnIdempotency.execute(
      parsed.data.sessionId,
      parsed.data.clientTurnId ?? null,
      parsed.data.message,
      async () => {
        try {
          return await this.sessionCoordinator.runExclusive(
            parsed.data.sessionId,
            () => this.runTurn(parsed.data, turnId, options)
          );
        } catch (error) {
          if (error instanceof SessionTurnCapacityError) {
            return this.resultFactory.error(
              "storage_capacity_exceeded",
              "Waiter turn serialization capacity has been reached."
            );
          }
          throw error;
        }
      },
      () => this.actionOutcomes.recoverExceptional(parsed.data, turnId)
    );
    if (!idempotent.ok) {
      return this.resultFactory.error(
        idempotent.code === "turn_id_conflict"
          ? "turn_id_conflict"
          : "storage_capacity_exceeded",
        idempotent.code === "turn_id_conflict"
          ? "clientTurnId was already used for a different message."
          : "Waiter turn capacity has been reached."
      );
    }
    if (!idempotent.replayed || !idempotent.result.ok) {
      return idempotent.result;
    }
    const currentCart = await this.dependencies.cartPort.getCart(
      parsed.data.sessionId
    );
    if (!currentCart.ok) return idempotent.result;
    return WaiterTurnResultSchema.parse({
      ...idempotent.result,
      data: {
        ...idempotent.result.data,
        cart: currentCart.data.cart,
        replayed: true,
      },
    });
  }

  private async runTurn(
    command: ConversationTurnRequest,
    turnId: string,
    options: WaiterTurnExecutionOptions
  ): Promise<WaiterTurnResult> {
    const startedAt = this.now();
    const initialState =
      await this.dependencies.conversationStore.getSession(command.sessionId);
    if (!initialState) {
      return this.resultFactory.error(
        "session_not_found",
        "Dining session was not found or expired."
      );
    }
    const cartResult = await this.dependencies.cartPort.getCart(
      command.sessionId
    );
    if (!cartResult.ok) {
      return this.resultFactory.error(
        cartResult.error.code === "session_not_found"
          ? "session_not_found"
          : "internal_error",
        "The current cart could not be loaded safely."
      );
    }
    let currentCart = cartResult.data.cart;

    const extracted = extractTurnState(
      command.message,
      initialState,
      command.requestedLanguage
    );
    const extractionUpdate = this.stateReducer.reduce(
      initialState,
      extracted.delta
    );
    if (!extractionUpdate) {
      return this.resultFactory.error(
        "internal_error",
        "Conversation state extraction could not be validated."
      );
    }
    const extractionResult =
      await this.dependencies.conversationStore.applyTurnUpdate(
        command.sessionId,
        extractionUpdate,
        turnMetadata(this.now, extracted.intent, [])
      );
    if (!extractionResult.ok) {
      return this.resultFactory.error(
        "internal_error",
        "Conversation state could not be updated safely."
      );
    }
    let state = extractionResult.data;

    if (extracted.unresolvedAllergy) {
      return this.controlledResult({
        command,
        state,
        cart: currentCart,
        message: TURN_COPY[state.language].uncertainAllergy,
        status: "clarification_required",
        fallbackUsed: false,
        actionLedger: [],
      });
    }
    if (
      state.allergies.length > 0 &&
      (isFoodSafetyQuestion(command.message) || extracted.intent === "allergy")
    ) {
      return this.controlledResult({
        command,
        state,
        cart: currentCart,
        message: this.responseRenderer.allergySafety(this.voiceFor(state, command.message)),
        status: "clarification_required",
        fallbackUsed: false,
        actionLedger: [],
      });
    }
    if (
      (state.dietaryRequirements.includes("halal") ||
        state.dietaryRequirements.includes("kosher")) &&
      /\b(halal|kosher|koser)\b/iu.test(command.message)
    ) {
      return this.controlledResult({
        command,
        state,
        cart: currentCart,
        message: this.responseRenderer.certificationSafety(this.voiceFor(state, command.message)),
        status: "clarification_required",
        fallbackUsed: false,
        actionLedger: [],
      });
    }

    let context = await buildGroundedWaiterContext({
      state,
      cart: currentCart,
      customerMessage: command.message,
      clientTurnId: command.clientTurnId ?? null,
      menuRepository: this.dependencies.menuRepository,
    });
    let intent = this.actionAuthorization.parseIntent(
      this.grounding.intentContext(
        command.message,
        state,
        currentCart,
        context,
        command.selectionHint
      )
    );
    if (
      intent.actionType &&
      (intent.negated ||
        intent.hypothetical ||
        intent.futureIntent ||
        intent.thirdPartyIntent ||
        intent.informationalOnly ||
        intent.comparisonOnly ||
        intent.clarificationReason === "unsupported_modifier" ||
        (intent.ambiguous && messageUsesPriorReference(command.message)))
    ) {
      return this.controlledResult({
        command,
        state,
        cart: currentCart,
        message: this.responseRenderer.clarification(
          this.voiceFor(state, command.message),
          intent.clarificationReason
        ),
        status:
          intent.negated || intent.informationalOnly
            ? "rejected_action"
            : "clarification_required",
        fallbackUsed: false,
        actionLedger: [],
      });
    }

    const runtime: TurnRuntime = {
      startedAt,
      turnId,
      toolRounds: 0,
      totalToolCalls: 0,
      toolMs: 0,
      toolNames: [],
      seenCalls: new Set(),
      currentToolProductIds: new Set(),
      exchanges: [],
      providerLoop: new ProviderLoopRunner({
        provider: this.dependencies.provider,
        fallbackProvider: this.dependencies.fallbackProvider,
        timeoutMs: this.providerTimeoutMs,
        now: this.now,
        allowFallback: options.allowProviderFallback,
      }),
    };

    while (true) {
      const generated = await runtime.providerLoop.generate({
        context,
        exchanges: runtime.exchanges,
      });
      if (!generated.ok) {
        if (generated.fallbackAvailable) continue;
        return this.controlledResult({
          command,
          state,
          cart: currentCart,
          message: TURN_COPY[state.language].failure,
          status: "provider_failed_without_side_effect",
          fallbackUsed: runtime.providerLoop.fallbackUsed,
          actionLedger: [],
          runtime,
        });
      }
      const step = generated.step;
      const providerDelta = this.stateReducer.providerUpdateToDelta(
        state,
        step.stateUpdate,
        this.grounding.allowedProductIds(
          context,
          currentCart,
          runtime.currentToolProductIds
        )
      );
      if (!providerDelta) {
        if (runtime.providerLoop.activateFallback("invalid_state_update")) {
          continue;
        }
        return this.controlledResult({
          command,
          state,
          cart: currentCart,
          message: TURN_COPY[state.language].failure,
          status: "provider_failed_without_side_effect",
          fallbackUsed: runtime.providerLoop.fallbackUsed,
          actionLedger: [],
          runtime,
        });
      }

      if (step.kind === "tool_requests") {
        runtime.toolRounds += 1;
        runtime.totalToolCalls += step.toolCalls.length;
        if (
          runtime.toolRounds > this.maximumToolRounds ||
          runtime.totalToolCalls > this.maximumToolCalls
        ) {
          return this.controlledResult({
            command,
            state,
            cart: currentCart,
            message: TURN_COPY[state.language].limit,
            status: "clarification_required",
            fallbackUsed: runtime.providerLoop.fallbackUsed,
            actionLedger: [],
            runtime,
          });
        }

        const validated: Array<{
          call: ProviderToolCall;
          input: unknown;
          fingerprint: string;
        }> = [];
        let invalid = false;
        const allowedBeforeCalls = this.grounding.allowedProductIds(
          context,
          currentCart,
          runtime.currentToolProductIds
        );
        for (const call of step.toolCalls) {
          const parsedInput = validateProviderToolInput(
            call.toolName,
            call.input
          );
          if (!parsedInput.success) {
            invalid = true;
            break;
          }
          if (
            call.toolName === "get_product_details" &&
            !allowedBeforeCalls.has(
              (parsedInput.data as { productId: string }).productId
            )
          ) {
            invalid = true;
            break;
          }
          const fingerprint = canonicalFingerprint({
            toolName: call.toolName,
            input: parsedInput.data,
          });
          if (runtime.seenCalls.has(fingerprint)) {
            invalid = true;
            break;
          }
          validated.push({
            call,
            input: parsedInput.data,
            fingerprint,
          });
        }
        if (invalid) {
          if (runtime.providerLoop.activateFallback("invalid_tool_input")) {
            continue;
          }
          return this.controlledResult({
            command,
            state,
            cart: currentCart,
            message: TURN_COPY[state.language].limit,
            status: "clarification_required",
            fallbackUsed: runtime.providerLoop.fallbackUsed,
            actionLedger: [],
            runtime,
          });
        }

        const irreversible = validated.filter((item) =>
          ActionTypeSchema.safeParse(item.call.toolName).success
        );
        if (
          irreversible.length > 1 ||
          (irreversible.length === 1 &&
            validated.at(-1) !== irreversible[0])
        ) {
          return this.controlledResult({
            command,
            state,
            cart: currentCart,
            message: this.responseRenderer.clarification(
              this.voiceFor(state, command.message),
              "ambiguous_action"
            ),
            status: "rejected_action",
            fallbackUsed: runtime.providerLoop.fallbackUsed,
            actionLedger: [],
            runtime,
          });
        }
        if (
          irreversible.length === 1 &&
          intent.actionType !== irreversible[0].call.toolName
        ) {
          return this.controlledResult({
            command,
            state,
            cart: currentCart,
            message: this.responseRenderer.clarification(
              this.voiceFor(state, command.message),
              intent.clarificationReason ?? "action_not_authorized"
            ),
            status: "rejected_action",
            fallbackUsed: runtime.providerLoop.fallbackUsed,
            actionLedger: [],
            runtime,
          });
        }

        const readResults: ProviderToolResult[] = [];
        for (const item of validated.filter((candidate) =>
          READ_ONLY_TOOLS.has(candidate.call.toolName)
        )) {
          runtime.seenCalls.add(item.fingerprint);
          runtime.toolNames.push(item.call.toolName);
          const toolStartedAt = this.now();
          const result = await this.dependencies.toolRegistry.execute({
            sessionId: command.sessionId,
            toolName: item.call.toolName,
            input: item.input,
          });
          runtime.toolMs += this.now() - toolStartedAt;
          readResults.push({
            callId: item.call.callId,
            toolName: item.call.toolName,
            result,
          });
          for (const productId of productIdsFromToolResult(result)) {
            runtime.currentToolProductIds.add(productId);
          }
          currentCart = cartFromToolResult(result) ?? currentCart;
        }

        if (readResults.length > 0) {
          state =
            (await this.dependencies.conversationStore.getSession(
              command.sessionId
            )) ?? state;
          context = await this.grounding.rebuildWithToolProvenance(
            command,
            state,
            currentCart,
            runtime.currentToolProductIds
          );
          intent = this.actionAuthorization.parseIntent(
            this.grounding.intentContext(
              command.message,
              state,
              currentCart,
              context,
              command.selectionHint
            )
          );
        }

        if (irreversible.length === 1) {
          const item = irreversible[0];
          const toolName = ActionTypeSchema.parse(item.call.toolName);
          const decision = this.actionAuthorization.authorize(
            intent,
            toolName,
            item.input,
            currentCart
          );
          if (!decision.authorized) {
            return this.controlledResult({
              command,
              state,
              cart: currentCart,
              message: this.responseRenderer.clarification(
                this.voiceFor(state, command.message),
                decision.reason
              ),
              status: "rejected_action",
              fallbackUsed: runtime.providerLoop.fallbackUsed,
              actionLedger: [],
              runtime,
            });
          }

          const ledger = await this.actionLedger.beginAuthorizedAction({
            sessionId: command.sessionId,
            turnId,
            ordinal: 0,
            intent: decision.intent,
            toolName,
            canonicalInput: item.input,
            cartRevision: currentCart.revision,
          });
          if (!ledger) {
            return this.resultFactory.error(
              "storage_capacity_exceeded",
              "Action-ledger capacity has been reached."
            );
          }
          if (ledger.entry.status === "succeeded" && ledger.toolResult?.ok) {
            const refreshed = await this.dependencies.cartPort.getCart(
              command.sessionId
            );
            const replayCart = refreshed.ok
              ? refreshed.data.cart
              : currentCart;
            return this.actionOutcomes.renderCompleted({
              request: command,
              state,
              beforeCart: currentCart,
              currentCart: replayCart,
              ledger,
              status: "success_with_response_fallback",
              runtime,
            });
          }

          await this.actionLedger.markExecuting(ledger.entry.actionId);
          runtime.toolNames.push(toolName);
          runtime.seenCalls.add(item.fingerprint);
          const toolStartedAt = this.now();
          const result = await this.dependencies.toolRegistry.execute({
            sessionId: command.sessionId,
            toolName,
            input: attachServerOwnedActionInput({
              toolName,
              input: item.input,
              cart: currentCart,
              idempotencyKey: ledger.idempotencyKey,
            }),
          });
          runtime.toolMs += this.now() - toolStartedAt;
          const completed = await this.actionLedger.markCompleted(
            ledger.entry.actionId,
            result
          );
          if (!completed) {
            return this.resultFactory.error(
              "internal_error",
              "Action ledger could not record the tool result."
            );
          }
          if (!result.ok) {
            const staffUnavailable =
              result.error.code === "table_context_required" &&
              (toolName === "request_waiter" ||
                toolName === "request_bill");
            return this.controlledResult({
              command,
              state,
              cart: currentCart,
              message: staffUnavailable
                ? TURN_COPY[state.language].staffUnavailable
                : TURN_COPY[state.language].toolFailure,
              status: "rejected_action",
              fallbackUsed: runtime.providerLoop.fallbackUsed,
              actionLedger: [completed.entry],
              runtime,
            });
          }
          const nextCart = cartFromToolResult(result) ?? currentCart;
          const refreshedState =
            (await this.dependencies.conversationStore.getSession(
              command.sessionId
            )) ?? state;
          const stageDelta: ConversationStateDelta = {
            operations: [
              {
                kind: "set_stage",
                stage:
                  toolName === "request_waiter" ||
                  toolName === "request_bill"
                    ? "service_request"
                    : "cart_review",
              },
              {
                kind: "set_unresolved_question",
                question: null,
              },
            ],
          };
          const actionUpdate = this.stateReducer.reduce(
            refreshedState,
            stageDelta
          );
          const stateWritten =
            actionUpdate &&
            (
              await this.dependencies.conversationStore.applyTurnUpdate(
                command.sessionId,
                actionUpdate,
                turnMetadata(this.now, extracted.intent, runtime.toolNames)
              )
            ).ok;
          state =
            (await this.dependencies.conversationStore.getSession(
              command.sessionId
            )) ?? refreshedState;
          return this.actionOutcomes.renderCompleted({
            request: command,
            state,
            beforeCart: currentCart,
            currentCart: nextCart,
            ledger: completed,
            status: stateWritten
              ? "success_with_response_fallback"
              : "partial_success_state_update_failed",
            runtime,
          });
        }

        const appliedProviderState = await this.stateCommitter.apply(
          command.sessionId,
          providerDelta,
          turnMetadata(this.now, extracted.intent, runtime.toolNames)
        );
        if (!appliedProviderState) {
          return this.controlledResult({
            command,
            state,
            cart: currentCart,
            message: TURN_COPY[state.language].failure,
            status: "internal_failure_without_side_effect",
            fallbackUsed: runtime.providerLoop.fallbackUsed,
            actionLedger: [],
            runtime,
          });
        }
        state = appliedProviderState;
        runtime.exchanges.push({
          calls: step.toolCalls,
          results: readResults,
        });
        context = await this.grounding.rebuildWithToolProvenance(
          command,
          state,
          currentCart,
          runtime.currentToolProductIds
        );
        continue;
      }

      const final = await this.finalizeNonActionStep({
        command,
        step,
        state,
        currentCart,
        context,
        providerDelta,
        extractedIntent: extracted.intent,
        runtime,
      });
      if (final) return final;
      if (runtime.providerLoop.activateFallback("ungrounded_final_response")) {
        continue;
      }
      return this.controlledResult({
        command,
        state,
        cart: currentCart,
        message: TURN_COPY[state.language].failure,
        status: "provider_failed_without_side_effect",
        fallbackUsed: runtime.providerLoop.fallbackUsed,
        actionLedger: [],
        runtime,
      });
    }
  }

  private async finalizeNonActionStep(command: {
    command: ConversationTurnRequest;
    step: Exclude<ProviderStep, { kind: "tool_requests" }>;
    state: ConversationState;
    currentCart: Cart;
    context: GroundedWaiterContext;
    providerDelta: ConversationStateDelta;
    extractedIntent: string;
    runtime: TurnRuntime;
  }): Promise<WaiterTurnResult | null> {
    if (command.step.kind === "staff_escalation") {
      const stateAfter = await this.stateCommitter.apply(
        command.command.sessionId,
        {
          operations: [
            ...command.providerDelta.operations,
            { kind: "set_stage", stage: "clarifying" },
          ],
        },
        turnMetadata(
          this.now,
          command.extractedIntent,
          command.runtime.toolNames
        )
      );
      return this.controlledResult({
        command: command.command,
        state: stateAfter ?? command.state,
        cart: command.currentCart,
        message: this.responseRenderer.staffEscalation(
          this.voiceFor(command.state, command.command.message)
        ),
        status: "clarification_required",
        fallbackUsed: command.runtime.providerLoop.fallbackUsed,
        actionLedger: [],
        runtime: command.runtime,
      });
    }

    const referencedProductIds =
      command.step.kind === "final"
        ? command.step.referencedProductIds
        : command.step.unresolvedQuestion.relatedProductIds;
    const allowed = this.grounding.allowedProductIds(
      command.context,
      command.currentCart,
      command.runtime.currentToolProductIds
    );
    if (referencedProductIds.some((productId) => !allowed.has(productId))) {
      return null;
    }

    let message = sanitizeTurnText(command.step.message);
    if (
      command.state.allergies.length > 0 &&
      (isFoodSafetyQuestion(command.command.message) ||
        /\b(safe|saug\w*)\b/iu.test(message))
    ) {
      message = this.responseRenderer.allergySafety(
        this.voiceFor(command.state, command.command.message)
      );
      referencedProductIds.length = 0;
    } else if (command.step.kind === "final") {
      const claims = await this.claimValidation.validate(
        message,
        command.step.claims ?? [],
        {
          state: command.state,
          cart: command.currentCart,
          relevantProducts: command.context.relevantProducts,
          productProvenance: command.context.productProvenance,
          restaurantKnowledge: command.context.restaurantKnowledge,
          actionLedger: [],
          menuRepository: this.dependencies.menuRepository,
        }
      );
      if (!claims) return null;
      message = this.responseRenderer.renderClaims(
        message,
        claims,
        command.state
      );
    }
    if (!message) return null;

    const operations: ConversationStateDelta["operations"] = [
      ...command.providerDelta.operations,
    ];
    if (referencedProductIds.length > 0) {
      operations.push({
        kind: "update_references",
        productIds: referencedProductIds,
      });
      operations.push({
        kind: "set_ambiguity",
        ambiguity:
          referencedProductIds.length > 1
            ? {
                kind: "product",
                candidateIds: referencedProductIds,
              }
            : null,
      });
    }
    if (command.step.kind === "clarification") {
      operations.push(
        { kind: "set_stage", stage: "clarifying" },
        {
          kind: "set_unresolved_question",
          question: command.step.unresolvedQuestion,
        },
        {
          kind: "set_ambiguity",
          ambiguity: command.step.ambiguity,
        }
      );
    }
    const stateAfter = await this.stateCommitter.apply(
      command.command.sessionId,
      { operations },
      turnMetadata(
        this.now,
        command.extractedIntent,
        command.runtime.toolNames
      )
    );
    if (!stateAfter) {
      return this.controlledResult({
        command: command.command,
        state: command.state,
        cart: command.currentCart,
        message: TURN_COPY[command.state.language].failure,
        status: "internal_failure_without_side_effect",
        fallbackUsed: command.runtime.providerLoop.fallbackUsed,
        actionLedger: [],
        runtime: command.runtime,
      });
    }

    const references = await this.grounding.references(
      referencedProductIds,
      stateAfter
    );
    if (!references) return null;
    return this.resultFactory.success({
      command: command.command,
      state: stateAfter,
      cart: command.currentCart,
      message,
      references,
      actions:
        command.step.kind === "clarification"
          ? [{ type: "clarification_required", targetId: null }]
          : [],
      status:
        command.step.kind === "clarification"
          ? "clarification_required"
          : "success",
      actionLedger: [],
      fallbackUsed: command.runtime.providerLoop.fallbackUsed,
      runtime: command.runtime,
    });
  }

  private async controlledResult(command: {
    command: ConversationTurnRequest;
    state: ConversationState;
    cart: Cart;
    message: string;
    status: TurnResultStatus;
    fallbackUsed: boolean;
    actionLedger: ActionLedgerEntry[];
    runtime?: TurnRuntime;
  }): Promise<WaiterTurnResult> {
    let state = command.state;
    if (
      command.status === "clarification_required" ||
      command.status === "rejected_action"
    ) {
      state =
        (await this.stateCommitter.apply(
          command.command.sessionId,
          {
            operations: [
              { kind: "set_stage", stage: "clarifying" },
            ],
          },
          turnMetadata(
            this.now,
            command.state.lastIntent,
            command.runtime?.toolNames ?? []
          )
        )) ?? state;
    }
    return this.resultFactory.success({
      ...command,
      state,
      references: [],
      actions:
        command.status === "clarification_required" ||
        command.status === "rejected_action"
          ? [{ type: "clarification_required", targetId: null }]
          : [],
    });
  }

}
