"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChefHat,
  RotateCcw,
  Send,
  ShoppingCart,
  X,
} from "lucide-react";
import {
  LIVE_WAITER_SESSION_KEY,
  LiveWaiterClient,
  TurnSubmissionGate,
  cartItemCount,
  establishDiningSession,
  readDevelopmentProviderMode,
  readStoredSessionId,
  reconcileServerCart,
  retryModeForTurnResult,
  storeDevelopmentProviderMode,
  tableTokenFromUrl,
  type DiningSessionSnapshot,
  type LiveWaiterTurnResult,
  type SessionStoragePort,
  type TurnAttempt,
} from "@/lib/ai-waiter/client/liveWaiterClient";
import {
  clearDisplayTranscript,
  clearDisplayTranscriptsForSession,
  clearPendingTurn,
  loadDisplayTranscript,
  readPendingTurn,
  saveDisplayTranscript,
  storePendingTurn,
  type StoredDisplayMessage,
} from "@/lib/ai-waiter/client/liveWaiterStorage";
import {
  friendlyClientError,
  liveWaiterCopy,
  turnPresentation,
  type TurnNoticeTone,
} from "@/lib/ai-waiter/client/liveWaiterUi";
import type {
  Cart,
  DevelopmentProviderMode,
  DevelopmentProviderPath,
  SupportedLanguage,
  WaiterReference,
} from "@/lib/ai-waiter/schemas";
import { useCartStore } from "@/lib/store";
import { useT } from "@/lib/i18n";

type Message = StoredDisplayMessage;

type SessionStatus = "initializing" | "ready" | "unavailable";
type DevelopmentProviderStatus =
  | DevelopmentProviderPath
  | "anthropic_not_configured"
  | null;

function developmentProviderControlsEnabled(): boolean {
  return process.env.NODE_ENV === "development";
}

function developmentProviderStatusText(
  copy: ReturnType<typeof liveWaiterCopy>,
  mode: DevelopmentProviderMode,
  status: DevelopmentProviderStatus
): string {
  switch (status) {
    case "deterministic":
      return copy.providerUsedDeterministic;
    case "anthropic":
      return copy.providerUsedAnthropic;
    case "not_used":
      return copy.providerNotUsed;
    case "anthropic_not_configured":
      return copy.providerNotConfigured;
    default:
      return mode === "deterministic"
        ? copy.providerSelectedDeterministic
        : mode === "anthropic"
          ? copy.providerSelectedAnthropic
          : copy.providerSelectedAuto;
  }
}

function timestamp(language: SupportedLanguage): string {
  const locale =
    language === "lt" ? "lt-LT" : language === "ru" ? "ru-RU" : "en-GB";
  return new Date().toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function makeGreeting(language: SupportedLanguage): Message {
  return {
    id: `greeting-${language}`,
    role: "assistant",
    content: liveWaiterCopy(language).greeting,
    time: timestamp(language),
  };
}

function safeSessionStorage(): SessionStoragePort {
  return {
    getItem(key) {
      return sessionStorage.getItem(key);
    },
    setItem(key, value) {
      sessionStorage.setItem(key, value);
    },
    removeItem(key) {
      sessionStorage.removeItem(key);
    },
  };
}

interface BroadcastChannelPort {
  postMessage(message: unknown): void;
  close(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
}

export interface AIPageClientProps {
  client?: LiveWaiterClient;
  storage?: SessionStoragePort;
  createBroadcastChannel?: (name: string) => BroadcastChannelPort | null;
}

function renderContent(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return part.split("\n").map((line, lineIndex, lines) => (
      <span key={`${index}-${lineIndex}`}>
        {line}
        {lineIndex < lines.length - 1 && <br />}
      </span>
    ));
  });
}

function formatPrice(
  amount: number,
  language: SupportedLanguage
): string {
  const locale =
    language === "lt" ? "lt-LT" : language === "ru" ? "ru-RU" : "en-GB";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

function noticeClasses(tone: TurnNoticeTone): string {
  switch (tone) {
    case "success":
      return "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300";
    case "warning":
      return "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300";
    case "error":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    case "info":
      return "border-primary/25 bg-primary/5 text-muted-foreground";
  }
}

function ProductReferenceRow({
  reference,
  language,
  disabled,
  onAsk,
  onAdd,
}: {
  reference: WaiterReference;
  language: SupportedLanguage;
  disabled: boolean;
  onAsk: (reference: WaiterReference) => void;
  onAdd: (reference: WaiterReference) => void;
}) {
  const copy = liveWaiterCopy(language);
  return (
    <div
      data-testid={`product-reference-${reference.productId}`}
      className="rounded-2xl border border-border/60 bg-card px-3 py-3 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/product/${encodeURIComponent(reference.productId)}`}
          className="min-w-0 flex-1"
        >
          <p className="text-sm font-semibold leading-snug">{reference.name}</p>
          <p className="mt-1 text-xs font-bold text-primary">
            {formatPrice(reference.officialUnitPrice, language)}
          </p>
        </Link>
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            onClick={() => onAsk(reference)}
            disabled={disabled}
            aria-label={`${copy.ask}: ${reference.name}`}
            className="rounded-full bg-secondary px-2.5 py-1.5 text-[11px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40"
          >
            {copy.ask}
          </button>
          <button
            type="button"
            onClick={() => onAdd(reference)}
            disabled={
              disabled ||
              reference.referenceSetId === undefined ||
              reference.ordinal === undefined
            }
            aria-label={`${copy.add}: ${reference.name}`}
            className="rounded-full bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-primary-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40"
          >
            {copy.add}
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  language,
  disabled,
  onAsk,
  onAdd,
}: {
  message: Message;
  language: SupportedLanguage;
  disabled: boolean;
  onAsk: (reference: WaiterReference) => void;
  onAdd: (reference: WaiterReference) => void;
}) {
  const isUser = message.role === "user";
  return (
    <div
      data-testid={`message-${message.role}`}
      className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : "flex-row"}`}
    >
      {!isUser && (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
          <ChefHat size={15} className="text-primary" />
        </div>
      )}
      <div className="flex max-w-[84%] flex-col">
        <div
          className={`rounded-3xl px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? "rounded-tr-lg bg-primary text-primary-foreground"
              : "rounded-tl-lg border border-border/50 bg-card text-foreground shadow-sm"
          }`}
        >
          <p className="whitespace-pre-wrap">{renderContent(message.content)}</p>
          <p
            className={`mt-1.5 text-[10px] ${
              isUser
                ? "text-right text-primary-foreground/60"
                : "text-muted-foreground"
            }`}
          >
            {message.time}
          </p>
        </div>
        {!isUser && message.notice && (
          <div
            data-testid="turn-notice"
            role={message.noticeTone === "error" ? "alert" : "status"}
            className={`mt-1.5 rounded-xl border px-3 py-2 text-[11px] leading-relaxed ${noticeClasses(
              message.noticeTone ?? "info"
            )}`}
          >
            {message.notice}
          </div>
        )}
        {!isUser && message.references && message.references.length > 0 && (
          <div className="mt-2 flex flex-col gap-2">
            {message.references.map((reference) => (
              <ProductReferenceRow
                key={reference.productId}
                reference={reference}
                language={language}
                disabled={disabled}
                onAsk={onAsk}
                onAdd={onAdd}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TypingDots({ label }: { label: string }) {
  return (
    <div
      data-testid="waiter-typing"
      role="status"
      aria-label={label}
      className="flex gap-2.5"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
        <ChefHat size={15} className="text-primary" />
      </div>
      <div className="rounded-3xl rounded-tl-lg border border-border/50 bg-card px-4 py-3 shadow-sm">
        <div className="flex h-5 items-center gap-1">
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/40"
              style={{ animationDelay: `${index * 0.15}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function CartPanel({
  cart,
  language,
  onClose,
}: {
  cart: Cart;
  language: SupportedLanguage;
  onClose: () => void;
}) {
  const copy = liveWaiterCopy(language);
  return (
    <div
      data-testid="server-cart"
      className="absolute inset-x-0 top-full z-20 border-b border-border bg-background/98 px-4 py-4 shadow-xl backdrop-blur"
    >
      <div className="mx-auto max-w-lg">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">{copy.cart}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 hover:bg-secondary"
            aria-label={copy.closeCart}
          >
            <X size={16} />
          </button>
        </div>
        {cart.lines.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">
            {copy.cartEmpty}
          </p>
        ) : (
          <div className="max-h-[45vh] space-y-2 overflow-y-auto">
            {cart.lines.map((line) => (
              <div
                key={line.lineId}
                data-testid={`cart-line-${line.lineId}`}
                className="rounded-2xl border border-border/60 bg-card p-3"
              >
                <div className="flex justify-between gap-3 text-sm">
                  <div>
                    <p className="font-semibold">{line.product.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {line.quantity} ×{" "}
                      {formatPrice(
                        line.product.officialUnitPrice,
                        language
                      )}
                    </p>
                  </div>
                  <p className="shrink-0 font-bold">
                    {formatPrice(
                      line.product.officialUnitPrice * line.quantity,
                      language
                    )}
                  </p>
                </div>
                {line.customerNote && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {copy.note}: {line.customerNote}
                  </p>
                )}
                {line.requiresStaffConfirmation && (
                  <p className="mt-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                    {copy.staffConfirmation}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="mt-3 flex justify-between border-t border-border pt-3 text-sm font-bold">
          <span>{copy.total}</span>
          <span>{formatPrice(cart.total, language)}</span>
        </div>
      </div>
    </div>
  );
}

export function AIPageClient({
  client,
  storage,
  createBroadcastChannel,
}: AIPageClientProps = {}) {
  const language = useCartStore((state) => state.lang);
  const tr = useT(language);
  const copy = liveWaiterCopy(language);
  const developmentProviderControls =
    developmentProviderControlsEnabled();
  const clientRef = useRef(client ?? new LiveWaiterClient());
  const storageRef = useRef(storage ?? safeSessionStorage());
  const gateRef = useRef(new TurnSubmissionGate());
  const sessionRef = useRef<DiningSessionSnapshot | null>(null);
  const tableTokenRef = useRef<string | null | undefined>(undefined);
  const initializationRef = useRef<
    ReturnType<typeof establishDiningSession> | undefined
  >(undefined);
  const initialLanguageRef = useRef<SupportedLanguage>(language);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recoveryNoticeRef = useRef<HTMLDivElement>(null);
  const persistenceErrorRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const activeRequestAbortRef = useRef<AbortController | null>(null);
  const transcriptIdentityRef = useRef<{
    sessionId: DiningSessionSnapshot["state"]["sessionId"];
    restaurantId: string | null;
  } | null>(null);
  const retryModeRef = useRef<"same_id" | "new_id" | null>(null);
  const freshRetryAttemptRef = useRef<TurnAttempt | null>(null);
  const requestSequenceRef = useRef(0);
  const acceptedResponseSequenceRef = useRef(0);
  const broadcastRef = useRef<BroadcastChannelPort | null>(null);
  const developmentProviderModeRef =
    useRef<DevelopmentProviderMode>("deterministic");

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [sessionStatus, setSessionStatus] =
    useState<SessionStatus>("initializing");
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [cart, setCart] = useState<Cart | null>(null);
  const [staffRequestsAvailable, setStaffRequestsAvailable] =
    useState(false);
  const [retryMessageId, setRetryMessageId] = useState<string | null>(null);
  const [retryModeDisplay, setRetryModeDisplay] = useState<
    "same_id" | "new_id" | null
  >(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [transcriptReady, setTranscriptReady] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [developmentProviderMode, setDevelopmentProviderMode] =
    useState<DevelopmentProviderMode>("deterministic");
  const [developmentProviderStatus, setDevelopmentProviderStatus] =
    useState<DevelopmentProviderStatus>(null);

  const updateRetryMode = useCallback(
    (mode: "same_id" | "new_id" | null) => {
      retryModeRef.current = mode;
      if (mountedRef.current) setRetryModeDisplay(mode);
    },
    []
  );

  const changeDevelopmentProviderMode = useCallback(
    (mode: DevelopmentProviderMode) => {
      if (!developmentProviderControls) return;
      developmentProviderModeRef.current = mode;
      storeDevelopmentProviderMode(storageRef.current, mode);
      setDevelopmentProviderMode(mode);
      setDevelopmentProviderStatus(null);
    },
    [developmentProviderControls]
  );

  const applySnapshot = useCallback(
    (snapshot: DiningSessionSnapshot): boolean => {
      const current = sessionRef.current;
      let authoritativeCart: Cart;
      try {
        authoritativeCart = reconcileServerCart(snapshot.cart, {
          expectedSessionId: snapshot.state.sessionId,
          ...(current?.state.sessionId === snapshot.state.sessionId
            ? { minimumRevision: current.cart.revision }
            : {}),
        });
      } catch {
        return false;
      }
      sessionRef.current = { ...snapshot, cart: authoritativeCart };
      if (!mountedRef.current) return true;
      setCart(authoritativeCart);
      setActiveSessionId(snapshot.state.sessionId);
      setStaffRequestsAvailable(
        snapshot.capabilities.staffRequestsAvailable
      );
      setSessionStatus("ready");
      return true;
    },
    []
  );

  const initializeSession = useCallback(
    async (force = false) => {
      if (mountedRef.current) {
        setSessionStatus("initializing");
        setSessionNotice(null);
        setPersistenceError(null);
        setTranscriptReady(false);
      }
      if (force) initializationRef.current = undefined;
      if (tableTokenRef.current === undefined) {
        const token = tableTokenFromUrl(window.location.href);
        tableTokenRef.current = token.tableToken;
        window.history.replaceState(window.history.state, "", token.cleanedUrl);
      }
      const priorStoredSessionId = readStoredSessionId(storageRef.current);
      initializationRef.current ??= establishDiningSession({
        client: clientRef.current,
        storage: storageRef.current,
        language: initialLanguageRef.current,
        tableToken: tableTokenRef.current,
      });
      const established = await initializationRef.current;
      if (!mountedRef.current) return;
      if (!established.ok) {
        setSessionStatus("unavailable");
        setMessages([makeGreeting(initialLanguageRef.current)]);
        setSessionNotice(
          friendlyClientError(
            established.error.code,
            initialLanguageRef.current
          )
        );
        return;
      }

      const snapshot = established.data.snapshot;
      if (
        priorStoredSessionId &&
        priorStoredSessionId !== snapshot.state.sessionId
      ) {
        clearDisplayTranscriptsForSession(
          storageRef.current,
          priorStoredSessionId
        );
        clearPendingTurn(storageRef.current, priorStoredSessionId);
      }
      if (!applySnapshot(snapshot)) {
        setSessionStatus("unavailable");
        setSessionNotice(
          liveWaiterCopy(initialLanguageRef.current).cartRefreshFailed
        );
        setMessages([makeGreeting(initialLanguageRef.current)]);
        return;
      }
      tableTokenRef.current = null;
      const restoredLanguage = snapshot.state.language;
      if (
        established.data.source === "restored" &&
        useCartStore.getState().lang !== restoredLanguage
      ) {
        useCartStore.setState({ lang: restoredLanguage });
      }
      const identity = {
        sessionId: snapshot.state.sessionId,
        restaurantId: snapshot.state.restaurantId,
      };
      transcriptIdentityRef.current = identity;
      const storedMessages =
        established.data.source === "restored"
          ? loadDisplayTranscript(storageRef.current, identity)
          : null;
      let nextMessages =
        storedMessages && storedMessages.length > 0
          ? storedMessages
          : [makeGreeting(restoredLanguage)];
      const pendingResult = readPendingTurn(
        storageRef.current,
        snapshot.state.sessionId
      );
      if (pendingResult.found) {
        const pending = pendingResult.pending;
        storePendingTurn(storageRef.current, {
          ...pending,
          transportState: "outcome_unknown",
        });
        gateRef.current.recover({
          message: pending.message,
          clientTurnId: pending.clientTurnId,
          ...(pending.selectionHint
            ? { selectionHint: pending.selectionHint }
            : {}),
        });
        const userMessageId = `user-${pending.clientTurnId}`;
        if (!nextMessages.some((message) => message.id === userMessageId)) {
          nextMessages = [
            ...nextMessages,
            {
              id: userMessageId,
              role: "user",
              content: pending.message,
              time: timestamp(restoredLanguage),
            },
          ];
        }
        updateRetryMode("same_id");
        setRetryMessageId(userMessageId);
      } else if (
        pendingResult.status === "storage_unavailable" ||
        pendingResult.status === "invalid_record"
      ) {
        setPersistenceError(
          liveWaiterCopy(restoredLanguage).retryProtectionUnavailable
        );
      }
      setMessages(nextMessages);
      setTranscriptReady(true);
      if (established.data.warningCode === "invalid_table_token") {
        setSessionNotice(
          liveWaiterCopy(restoredLanguage).invalidTable
        );
      } else if (established.data.source === "recovered_expired") {
        setSessionNotice(
          liveWaiterCopy(restoredLanguage).preferencesReset
        );
      }
    },
    [applySnapshot, updateRetryMode]
  );

  useEffect(() => {
    if (!developmentProviderControls) return;
    const storedMode = readDevelopmentProviderMode(storageRef.current);
    developmentProviderModeRef.current = storedMode;
    setDevelopmentProviderMode(storedMode);
  }, [developmentProviderControls]);

  useEffect(() => {
    mountedRef.current = true;
    let timer: number | null = null;
    const start = () => {
      initialLanguageRef.current = useCartStore.getState().lang;
      timer = window.setTimeout(() => {
        void initializeSession();
      }, 0);
    };
    let unsubscribe: (() => void) | undefined;
    if (useCartStore.persist.hasHydrated()) {
      start();
    } else {
      unsubscribe = useCartStore.persist.onFinishHydration(start);
    }
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      unsubscribe?.();
      mountedRef.current = false;
      activeRequestAbortRef.current?.abort();
    };
  }, [initializeSession]);

  useEffect(() => {
    if (transcriptReady && transcriptIdentityRef.current) {
      saveDisplayTranscript(
        storageRef.current,
        transcriptIdentityRef.current,
        messages
      );
    }
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, transcriptReady, typing]);

  useEffect(() => {
    if (persistenceError) {
      window.setTimeout(() => persistenceErrorRef.current?.focus(), 0);
    } else if (retryModeDisplay === "same_id") {
      window.setTimeout(() => recoveryNoticeRef.current?.focus(), 0);
    }
  }, [persistenceError, retryModeDisplay]);

  const recoverExpiredSession = useCallback(async () => {
    const priorIdentity = transcriptIdentityRef.current;
    if (priorIdentity) {
      clearDisplayTranscript(storageRef.current, priorIdentity);
      clearPendingTurn(storageRef.current, priorIdentity.sessionId);
    }
    try {
      storageRef.current.removeItem(LIVE_WAITER_SESSION_KEY);
    } catch {
      // The replacement session still proceeds without browser restoration.
    }
    initializationRef.current = undefined;
    const established = await establishDiningSession({
      client: clientRef.current,
      storage: storageRef.current,
      language,
      tableToken: tableTokenRef.current ?? null,
    });
    if (!mountedRef.current) return false;
    if (!established.ok || !applySnapshot(established.data.snapshot)) {
      setSessionStatus("unavailable");
      setSessionNotice(
        established.ok
          ? copy.cartRefreshFailed
          : friendlyClientError(established.error.code, language)
      );
      return false;
    }
    const snapshot = established.data.snapshot;
    tableTokenRef.current = null;
    transcriptIdentityRef.current = {
      sessionId: snapshot.state.sessionId,
      restaurantId: snapshot.state.restaurantId,
    };
    setMessages([makeGreeting(snapshot.state.language)]);
    setTranscriptReady(true);
    setSessionNotice(copy.preferencesReset);
    return true;
  }, [
    applySnapshot,
    copy.cartRefreshFailed,
    copy.preferencesReset,
    language,
  ]);

  const refreshAuthoritativeSession = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return false;
    const restored = await clientRef.current.restoreSession(
      current.state.sessionId
    );
    if (!restored.ok || !mountedRef.current) return false;
    if (!applySnapshot(restored.data)) {
      setSessionNotice(
        liveWaiterCopy(restored.data.state.language).cartRefreshFailed
      );
      return false;
    }
    return true;
  }, [applySnapshot]);

  useEffect(() => {
    if (!activeSessionId) return;
    const factory =
      createBroadcastChannel ??
      ((name: string) =>
        typeof BroadcastChannel === "undefined"
          ? null
          : new BroadcastChannel(name));
    const channel = factory(`vaise-ai-waiter-cart:${activeSessionId}`);
    broadcastRef.current = channel;
    if (channel) {
      channel.onmessage = (event) => {
        const message = event.data as {
          type?: unknown;
          sessionId?: unknown;
          revision?: unknown;
        };
        if (
          message.type !== "cart-invalidated" ||
          message.sessionId !== activeSessionId ||
          typeof message.revision !== "number" ||
          message.revision <= (sessionRef.current?.cart.revision ?? -1)
        ) {
          return;
        }
        void refreshAuthoritativeSession();
      };
    }
    const onFocus = () => {
      void refreshAuthoritativeSession();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      if (channel) channel.onmessage = null;
      channel?.close();
      if (broadcastRef.current === channel) broadcastRef.current = null;
    };
  }, [
    activeSessionId,
    createBroadcastChannel,
    refreshAuthoritativeSession,
  ]);

  const executeAttempt = useCallback(
    async (attempt: TurnAttempt, appendUserMessage: boolean) => {
      const session = sessionRef.current;
      if (!session) {
        gateRef.current.cancel();
        return;
      }
      let gateSettled = false;
      const pending = {
        version: 1 as const,
        sessionId: session.state.sessionId,
        clientTurnId: attempt.clientTurnId,
        message: attempt.message,
        ...(attempt.selectionHint
          ? { selectionHint: attempt.selectionHint }
          : {}),
        createdAt: Date.now(),
        transportState: "sending" as const,
        lastAttemptAt: Date.now(),
      };
      const persisted = storePendingTurn(storageRef.current, pending);
      if (!persisted.persisted) {
        gateRef.current.cancel();
        if (mountedRef.current) {
          setTyping(false);
          setPersistenceError(copy.retryProtectionUnavailable);
        }
        return;
      }
      const durablePending = persisted.pending;
      const sequence = ++requestSequenceRef.current;
      const abortController = new AbortController();
      activeRequestAbortRef.current = abortController;
      setPersistenceError(null);
      if (appendUserMessage) {
        setMessages((previous) => [
          ...previous,
          {
            id: `user-${attempt.clientTurnId}`,
            role: "user",
            content: attempt.message,
            time: timestamp(language),
          },
        ]);
      }
      setRetryMessageId(null);
      setInput("");
      setTyping(true);

      try {
        const result: LiveWaiterTurnResult =
          await clientRef.current.sendTurn(
            {
          sessionId: session.state.sessionId,
          message: attempt.message,
          clientTurnId: attempt.clientTurnId,
          requestedLanguage: language,
          ...(attempt.selectionHint
            ? { selectionHint: attempt.selectionHint }
            : {}),
            },
            {
              signal: abortController.signal,
              ...(developmentProviderControls
                ? {
                    developmentProviderMode:
                      developmentProviderModeRef.current,
                  }
                : {}),
            }
          );

        const retryMode = retryModeForTurnResult(result);
        if (!result.ok) {
          if (retryMode === "same_id") {
            storePendingTurn(storageRef.current, {
              ...durablePending,
              transportState: "outcome_unknown",
            });
            gateRef.current.complete(attempt, true);
          } else {
            clearPendingTurn(storageRef.current, session.state.sessionId);
            gateRef.current.complete(attempt, false);
          }
          gateSettled = true;
          if (!mountedRef.current) return;
          if (result.error.code === "session_not_found") {
            const recovered = await recoverExpiredSession();
            updateRetryMode(null);
            freshRetryAttemptRef.current = null;
            setRetryMessageId(null);
            if (recovered) return;
          }
          updateRetryMode(retryMode);
          freshRetryAttemptRef.current =
            retryMode === "new_id" ? attempt : null;
          if (
            developmentProviderControls &&
            result.error.code === "provider_not_configured"
          ) {
            setDevelopmentProviderStatus("anthropic_not_configured");
          }
          const errorMessage: Message = {
            id: `assistant-error-${attempt.clientTurnId}-${Date.now()}`,
            role: "assistant",
            content: friendlyClientError(result.error.code, language),
            time: timestamp(language),
            notice:
              retryMode === "same_id"
                ? result.error.code === "invalid_response"
                  ? `${copy.cartRefreshFailed} ${copy.unknownOutcome}`
                  : copy.unknownOutcome
                : retryMode === "new_id"
                  ? copy.noSideEffect
                  : null,
            noticeTone: "error",
          };
          setMessages((previous) => [...previous, errorMessage]);
          if (retryMode) setRetryMessageId(errorMessage.id);
          return;
        }

        clearPendingTurn(storageRef.current, session.state.sessionId);
        const presentation = turnPresentation(
          result.data,
          result.data.language
        );
        const retryModeForSuccess = retryModeForTurnResult(result);
        gateRef.current.complete(attempt, false);
        gateSettled = true;
        updateRetryMode(retryModeForSuccess);
        freshRetryAttemptRef.current =
          retryModeForSuccess === "new_id" ? attempt : null;
        if (
          sequence < acceptedResponseSequenceRef.current ||
          !mountedRef.current
        ) {
          return;
        }
        acceptedResponseSequenceRef.current = sequence;
        if (developmentProviderControls) {
          setDevelopmentProviderStatus(
            result.data.developmentProviderPath ??
              (result.data.fallbackUsed ? "deterministic" : "not_used")
          );
        }

        let authoritativeCart: Cart | null = null;
        try {
          authoritativeCart = reconcileServerCart(result.data.cart, {
            expectedSessionId: session.state.sessionId,
            minimumRevision:
              sessionRef.current?.state.sessionId === session.state.sessionId
                ? sessionRef.current.cart.revision
                : 0,
          });
        } catch {
          setSessionNotice(copy.cartRefreshFailed);
        }
        if (authoritativeCart) {
          setCart(authoritativeCart);
          sessionRef.current = {
            ...session,
            cart: authoritativeCart,
            state: {
              ...session.state,
              language: result.data.language,
              stage: result.data.stage,
              cartRevision: authoritativeCart.revision,
            },
          };
        }
        const assistantMessage: Message = {
          id: `assistant-${attempt.clientTurnId}-${Date.now()}`,
          role: "assistant",
          content: result.data.message,
          time: timestamp(result.data.language),
          references: result.data.references,
          notice: authoritativeCart
            ? presentation.notice
            : copy.cartRefreshFailed,
          noticeTone: authoritativeCart ? presentation.tone : "error",
        };
        setMessages((previous) => [...previous, assistantMessage]);
        if (retryModeForSuccess === "new_id") {
          setRetryMessageId(assistantMessage.id);
        }
        if (
          authoritativeCart &&
          result.data.actions.some((action) => action.type === "cart_updated")
        ) {
          broadcastRef.current?.postMessage({
            type: "cart-invalidated",
            sessionId: session.state.sessionId,
            revision: authoritativeCart.revision,
          });
        }
      } catch {
        storePendingTurn(storageRef.current, {
          ...durablePending,
          transportState: "outcome_unknown",
        });
        gateRef.current.complete(attempt, true);
        gateSettled = true;
        updateRetryMode("same_id");
        if (mountedRef.current) {
          const errorMessage: Message = {
            id: `assistant-error-${attempt.clientTurnId}-${Date.now()}`,
            role: "assistant",
            content: copy.genericError,
            time: timestamp(language),
            notice: copy.unknownOutcome,
            noticeTone: "error",
          };
          setMessages((previous) => [...previous, errorMessage]);
          setRetryMessageId(errorMessage.id);
        }
      } finally {
        if (!gateSettled) gateRef.current.cancel();
        if (activeRequestAbortRef.current === abortController) {
          activeRequestAbortRef.current = null;
        }
        if (mountedRef.current) {
          setTyping(false);
          window.setTimeout(() => inputRef.current?.focus(), 50);
        }
      }
    },
    [
      copy.cartRefreshFailed,
      copy.genericError,
      copy.noSideEffect,
      copy.retryProtectionUnavailable,
      copy.unknownOutcome,
      developmentProviderControls,
      language,
      recoverExpiredSession,
      updateRetryMode,
    ]
  );

  const sendMessage = useCallback(
    (rawText: string, selectionHint?: TurnAttempt["selectionHint"]) => {
      const text = rawText.trim();
      if (
        !text ||
        sessionStatus !== "ready" ||
        retryModeRef.current === "same_id"
      ) {
        return;
      }
      const attempt = gateRef.current.beginNew(text, selectionHint);
      if (!attempt) return;
      void executeAttempt(attempt, true);
    },
    [executeAttempt, sessionStatus]
  );

  const retryLastTurn = useCallback(() => {
    const retryMode = retryModeRef.current;
    const prior = freshRetryAttemptRef.current;
    const attempt =
      retryMode === "same_id"
        ? gateRef.current.beginRetry()
        : retryMode === "new_id" && prior
          ? gateRef.current.beginNew(prior.message, prior.selectionHint)
          : null;
    if (!attempt || sessionStatus !== "ready") return;
    updateRetryMode(null);
    freshRetryAttemptRef.current = null;
    void executeAttempt(attempt, false);
  }, [executeAttempt, sessionStatus, updateRetryMode]);

  const askAbout = useCallback(
    (reference: WaiterReference) => {
      const prompt =
        language === "lt"
          ? `Papasakokite apie „${reference.name}“.`
          : language === "ru"
            ? `Расскажите о «${reference.name}».`
            : `Tell me about “${reference.name}”.`;
      setInput(prompt);
      setTimeout(() => inputRef.current?.focus(), 0);
    },
    [language]
  );

  const addReference = useCallback(
    (reference: WaiterReference) => {
      if (
        reference.referenceSetId === undefined ||
        reference.ordinal === undefined
      ) {
        return;
      }
      const ordinal = reference.ordinal + 1;
      const prompt =
        language === "lt"
          ? `Pridėk ${ordinal} pasiūlymą.`
          : language === "ru"
            ? `Добавь ${ordinal} предложение.`
            : `Add recommendation ${ordinal}.`;
      sendMessage(prompt, {
        actionType: "add_to_cart",
        referenceSetId: reference.referenceSetId,
        productId: reference.productId,
        ordinal: reference.ordinal,
      });
    },
    [language, sendMessage]
  );

  const clearDisplayedConversation = useCallback(() => {
    if (retryModeRef.current === "same_id") return;
    const next = [makeGreeting(language)];
    setMessages(next);
    if (transcriptIdentityRef.current) {
      clearDisplayTranscript(
        storageRef.current,
        transcriptIdentityRef.current
      );
    }
    setRetryMessageId(null);
    setInput("");
  }, [language]);

  const totalItems = cart ? cartItemCount(cart) : 0;
  const showSuggestions = messages.length <= 2;
  const busy = typing || sessionStatus !== "ready";
  const newTurnBlocked = retryModeDisplay === "same_id";
  const modeLabel = staffRequestsAvailable
    ? copy.tableMode
    : copy.demoMode;
  const modeDot = staffRequestsAvailable ? "bg-green-500" : "bg-amber-500";
  const suggestions = useMemo(() => [...copy.suggestions], [copy.suggestions]);
  const developmentProviderMessage = developmentProviderStatusText(
    copy,
    developmentProviderMode,
    developmentProviderStatus
  );

  return (
    <div className="relative flex h-screen flex-col bg-background">
      <header className="sticky top-0 z-10 border-b border-border/50 bg-background/95 px-4 pb-3 pt-12 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center gap-3">
          <Link
            href="/menu"
            aria-label={copy.back}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary transition-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary active:scale-95"
          >
            <ArrowLeft size={16} />
          </Link>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 shadow-md">
            <ChefHat size={20} className="text-primary-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-bold leading-tight">{tr.nav_ai}</h1>
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${modeDot}`} />
              <span data-testid="session-mode" className="text-xs text-muted-foreground">
                {copy.waiter} · {modeLabel}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCartOpen((open) => !open)}
            className="relative flex h-9 w-9 items-center justify-center rounded-full bg-primary/10"
            aria-label={copy.cart}
          >
            <ShoppingCart size={16} className="text-primary" />
            {totalItems > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                {totalItems}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={clearDisplayedConversation}
            title={copy.clearDisplay}
            aria-label={copy.clearDisplay}
            disabled={retryModeDisplay === "same_id"}
            className="rounded-full p-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary hover:bg-secondary active:scale-95 disabled:opacity-40"
          >
            <RotateCcw size={15} className="text-muted-foreground" />
          </button>
        </div>
        {cartOpen && cart && (
          <CartPanel
            cart={cart}
            language={language}
            onClose={() => setCartOpen(false)}
          />
        )}
      </header>

      {developmentProviderControls && (
        <div
          data-testid="development-provider-controls"
          className="border-b border-sky-500/20 bg-sky-500/5 px-4 py-2"
        >
          <div className="mx-auto flex max-w-lg flex-wrap items-center gap-x-3 gap-y-1">
            <label
              htmlFor="development-provider-mode"
              className="shrink-0 text-[11px] font-semibold text-sky-800 dark:text-sky-300"
            >
              {copy.developmentProvider}
              <span className="ml-1 font-normal opacity-70">
                ({copy.developmentOnly})
              </span>
            </label>
            <select
              id="development-provider-mode"
              data-testid="development-provider-mode"
              value={developmentProviderMode}
              disabled={busy || newTurnBlocked}
              onChange={(event) => {
                const mode = event.target.value;
                if (
                  mode === "deterministic" ||
                  mode === "anthropic" ||
                  mode === "auto"
                ) {
                  changeDevelopmentProviderMode(mode);
                }
              }}
              className="min-w-0 rounded-lg border border-sky-500/30 bg-background px-2 py-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40"
            >
              <option value="deterministic">
                {copy.providerDeterministic}
              </option>
              <option value="anthropic">{copy.providerAnthropic}</option>
              <option value="auto">{copy.providerAuto}</option>
            </select>
            <p
              data-testid="development-provider-status"
              role={
                developmentProviderStatus === "anthropic_not_configured"
                  ? "alert"
                  : "status"
              }
              className="basis-full text-[11px] leading-snug text-muted-foreground"
            >
              {developmentProviderMessage}
            </p>
          </div>
        </div>
      )}

      {(sessionNotice || !staffRequestsAvailable) && (
        <div className="border-b border-border/40 px-4 py-2">
          <div
            data-testid="session-notice"
            role={sessionStatus === "unavailable" ? "alert" : "status"}
            className="mx-auto max-w-lg text-xs leading-relaxed text-muted-foreground"
          >
            {sessionNotice ?? copy.demoNotice}
          </div>
        </div>
      )}

      {newTurnBlocked && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2">
          <div
            ref={recoveryNoticeRef}
            data-testid="pending-turn-recovery"
            role="alert"
            tabIndex={-1}
            className="mx-auto max-w-lg text-xs leading-relaxed text-amber-800 outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-amber-300"
          >
            {copy.unknownOutcome} {copy.resolveUnknownFirst}
          </div>
        </div>
      )}

      {persistenceError && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2">
          <div
            ref={persistenceErrorRef}
            data-testid="pending-storage-error"
            role="alert"
            tabIndex={-1}
            className="mx-auto max-w-lg text-xs leading-relaxed text-destructive outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {persistenceError}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div
          className="mx-auto max-w-lg space-y-4"
          aria-live="polite"
          aria-relevant="additions text"
        >
          {messages.map((message) => (
            <div key={message.id}>
              <MessageBubble
                message={message}
                language={language}
                disabled={busy || newTurnBlocked}
                onAsk={askAbout}
                onAdd={addReference}
              />
              {retryMessageId === message.id && (
                <button
                  type="button"
                  data-testid="retry-turn"
                  onClick={retryLastTurn}
                  disabled={busy}
                  aria-label={`${copy.retry}: ${message.content}`}
                  className="ml-11 mt-2 rounded-full border border-border bg-card px-3 py-2 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40"
                >
                  {copy.retry}
                </button>
              )}
            </div>
          ))}
          {typing && <TypingDots label={copy.preparing} />}
          {sessionStatus === "initializing" && (
            <p
              data-testid="session-loading"
              role="status"
              className="text-center text-xs text-muted-foreground"
            >
              {copy.initializing}
            </p>
          )}
          {sessionStatus === "unavailable" && (
            <div
              data-testid="foundation-unavailable"
              role="alert"
              className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm"
            >
              <p>{sessionNotice ?? copy.unavailable}</p>
              <button
                type="button"
                onClick={() => void initializeSession(true)}
                className="mt-3 rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                {copy.retry}
              </button>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {showSuggestions && (
        <div className="px-4 pb-2">
          <div className="no-scrollbar mx-auto flex max-w-lg gap-2 overflow-x-auto">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => sendMessage(suggestion)}
                disabled={busy || newTurnBlocked}
                className="shrink-0 whitespace-nowrap rounded-full border border-border/50 bg-secondary px-3 py-2 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary active:border-primary/30 active:bg-primary/10 disabled:opacity-40"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-border/30 px-4 pb-6 pt-2">
        <div className="mx-auto flex max-w-lg items-center gap-2">
          <div className="flex min-h-12 flex-1 items-center gap-2 rounded-2xl bg-secondary px-4 py-3">
            <input
              ref={inputRef}
              data-testid="waiter-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  sendMessage(input);
                }
              }}
              placeholder={copy.placeholder}
              aria-label={copy.placeholder}
              className="flex-1 bg-transparent text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary placeholder:text-muted-foreground"
              disabled={busy || newTurnBlocked}
            />
          </div>
          <button
            type="button"
            data-testid="send-turn"
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || busy || newTurnBlocked}
            aria-label={copy.send}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send size={17} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AIPage() {
  return <AIPageClient />;
}
