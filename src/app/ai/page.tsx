"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { Send, ChefHat, RotateCcw, ArrowLeft, ShoppingCart, Check } from "lucide-react";
import { useCartStore } from "@/lib/store";
import { useT } from "@/lib/i18n";
import { products } from "@/lib/data";
import {
  WaiterContext,
  emptyContext,
  updateContext,
  generateReply,
} from "@/lib/ai-engine";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  time: string;
}

function timestamp() {
  return new Date().toLocaleTimeString("lt-LT", { hour: "2-digit", minute: "2-digit" });
}

// Strip [ADD:id] tokens from visible text
function stripAddTags(text: string): string {
  return text.replace(/\[ADD:[^\]]+\]/g, "").trim();
}

function extractAddIds(text: string): string[] {
  return [...text.matchAll(/\[ADD:([^\]]+)\]/g)].map((m) => m[1]);
}

// ── Render bold (**text**) ────────────────────────────────────────────────────

function renderContent(text: string): React.ReactNode {
  // Split on **...** for bold, keep bullets
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    // Render line breaks
    return part.split("\n").map((line, j, arr) => (
      <span key={`${i}-${j}`}>
        {line}
        {j < arr.length - 1 && <br />}
      </span>
    ));
  });
}

// ── Suggestion chips ──────────────────────────────────────────────────────────

const SUGGESTIONS: Record<string, string[]> = {
  lt: ["Ką rekomenduojate?", "Noriu sočiai pavalgyti", "Ką valgyti prie alaus?", "Esu vegetaras", "Turiu €25 biudžetą", "Tik užkandžiams"],
  en: ["What do you recommend?", "I want something filling", "What goes with beer?", "I'm vegetarian", "Budget is €25", "Just a snack"],
  ru: ["Что порекомендуете?", "Хочу что-то сытное", "Что идёт с пивом?", "Я вегетарианец", "Бюджет €25", "Только закуску"],
};

const GREETING: Record<string, string> = {
  lt: "Sveiki! Ko norėtumėte šiandien — ko nors sočaus, lengvo, gal aštraus?",
  en: "Welcome! What are you in the mood for — something hearty, light, or a little spicy?",
  ru: "Добро пожаловать! Что вам по настроению — сытное, лёгкое или острое?",
};

// ── Add-to-cart chip ──────────────────────────────────────────────────────────

function AddCartButton({ productId, onAdded }: { productId: string; onAdded: () => void }) {
  const addItem = useCartStore((s) => s.addItem);
  const [done, setDone] = useState(false);
  const product = products.find((p) => p.id === productId);
  if (!product) return null;

  const handle = () => {
    addItem(product);
    setDone(true);
    onAdded();
  };

  return (
    <button
      onClick={handle}
      disabled={done}
      className={`mt-2 flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
        done
          ? "bg-green-500/20 text-green-600 dark:text-green-400 cursor-default"
          : "bg-primary/10 text-primary hover:bg-primary/20 active:scale-95"
      }`}
    >
      {done ? <Check size={13} /> : <ShoppingCart size={13} />}
      {done ? "Pridėta ✓" : product.name.length > 38 ? product.name.slice(0, 38) + "…" : product.name}
      {!done && product.price > 0 && (
        <span className="ml-auto font-bold">{product.price.toFixed(2)} €</span>
      )}
    </button>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({
  msg,
  onCartAdd,
}: {
  msg: Message;
  onCartAdd: () => void;
}) {
  const isUser = msg.role === "user";
  const visibleText = stripAddTags(msg.content);
  const addIds = extractAddIds(msg.content);

  return (
    <div className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      {!isUser && (
        <div className="w-8 h-8 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0 mt-1">
          <ChefHat size={15} className="text-primary" />
        </div>
      )}
      <div className="max-w-[80%] flex flex-col">
        <div
          className={`px-4 py-3 rounded-3xl text-sm leading-relaxed ${
            isUser
              ? "bg-primary text-primary-foreground rounded-tr-lg"
              : "bg-card border border-border/50 text-foreground rounded-tl-lg shadow-sm"
          }`}
        >
          <p className="whitespace-pre-wrap">{renderContent(visibleText)}</p>
          <p
            className={`text-[10px] mt-1.5 ${
              isUser ? "text-primary-foreground/60 text-right" : "text-muted-foreground"
            }`}
          >
            {msg.time}
          </p>
        </div>
        {!isUser && addIds.length > 0 && (
          <div className="mt-1 px-1 flex flex-col gap-1">
            {addIds.map((id) => (
              <AddCartButton key={id} productId={id} onAdded={onCartAdd} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Typing dots ───────────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <div className="flex gap-2.5">
      <div className="w-8 h-8 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
        <ChefHat size={15} className="text-primary" />
      </div>
      <div className="bg-card border border-border/50 rounded-3xl rounded-tl-lg px-4 py-3 shadow-sm">
        <div className="flex gap-1 items-center h-5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Session persistence (survives SPA navigation, resets on tab close) ────────

const CHAT_MESSAGES_KEY = "dzukai-chat-messages";
const CHAT_STATE_KEY    = "dzukai-chat-state";

function saveChat(msgs: Message[], ctx: WaiterContext) {
  try {
    sessionStorage.setItem(CHAT_MESSAGES_KEY, JSON.stringify(msgs));
    // Omit cartItems (rebuilt each turn from cart store) and pendingActions
    const { cartItems: _ci, pendingActions: _pa, ...persistable } = ctx;
    sessionStorage.setItem(CHAT_STATE_KEY, JSON.stringify(persistable));
  } catch { /* storage full or SSR */ }
}

function loadChat(): { msgs: Message[] | null; ctx: Partial<WaiterContext> | null } {
  try {
    const rawMsgs = sessionStorage.getItem(CHAT_MESSAGES_KEY);
    const rawCtx  = sessionStorage.getItem(CHAT_STATE_KEY);
    return {
      msgs: rawMsgs ? (JSON.parse(rawMsgs) as Message[]) : null,
      ctx:  rawCtx  ? (JSON.parse(rawCtx)  as Partial<WaiterContext>) : null,
    };
  } catch { return { msgs: null, ctx: null }; }
}

function clearChat() {
  try {
    sessionStorage.removeItem(CHAT_MESSAGES_KEY);
    sessionStorage.removeItem(CHAT_STATE_KEY);
  } catch { /* ignore */ }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AIPage() {
  const lang = useCartStore((s) => s.lang);
  const addItem = useCartStore((s) => s.addItem);
  const removeItem = useCartStore((s) => s.removeItem);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const clearCartStore = useCartStore((s) => s.clearCart);
  const tr = useT(lang);

  const makeGreeting = (l = lang): Message => ({
    id: "greeting-" + l,
    role: "assistant",
    content: GREETING[l] ?? GREETING.lt,
    time: timestamp(),
  });

  // Restore chat from sessionStorage on first mount
  const [messages, setMessages] = useState<Message[]>(() => {
    const { msgs } = loadChat();
    return msgs ?? [makeGreeting()];
  });
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [cartCount, setCartCount] = useState(0);

  // Restore conversation state from sessionStorage, falling back to fresh state.
  // useState with lazy initializer so sessionStorage is only read once on mount.
  const [initialCtx] = useState<WaiterContext>(() => {
    const { ctx } = loadChat();
    const fresh = emptyContext();
    return ctx ? { ...fresh, ...ctx } : fresh;
  });
  const ctxRef = useRef<WaiterContext>(initialCtx);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // When language changes, only reset if the chat was in a different language
  useEffect(() => {
    const savedLang = ctxRef.current.currentLanguage;
    if (savedLang && savedLang !== lang) {
      ctxRef.current = emptyContext(lang);
      const greeting = makeGreeting(lang);
      setMessages([greeting]);
      clearChat();
      setInput("");
    }
  }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || typing) return;

      const userMsg: Message = {
        id: Date.now().toString(),
        role: "user",
        content: trimmed,
        time: timestamp(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setTyping(true);

      updateContext(ctxRef.current, trimmed);

      const delay = 600 + Math.random() * 300;
      setTimeout(() => {
        // Sync cart into context before each reply
        ctxRef.current.cartItems = useCartStore.getState().items.map((i) => ({
          productId: i.product.id,
          quantity: i.quantity,
          name: i.product.name,
          price: i.product.price,
        }));

        const { text: reply, actions } = generateReply(trimmed, ctxRef.current, lang);

        // Execute cart actions returned by the assistant
        let cartDelta = 0;
        for (const action of actions ?? []) {
          if (action.type === "ADD_TO_CART") {
            const product = products.find((p) => p.id === action.productId);
            if (product) { addItem(product, action.quantity); cartDelta++; }
          } else if (action.type === "REMOVE_FROM_CART") {
            removeItem(action.productId);
            cartDelta--;
          } else if (action.type === "DECREASE_QUANTITY") {
            const current = useCartStore.getState().items.find(
              (i) => i.product.id === action.productId
            );
            if (current) {
              if (current.quantity > 1) updateQuantity(action.productId, current.quantity - 1);
              else { removeItem(action.productId); cartDelta--; }
            }
          } else if (action.type === "CLEAR_CART") {
            clearCartStore();
            cartDelta = -useCartStore.getState().items.length;
          }
        }
        if (cartDelta > 0) setCartCount((c) => c + cartDelta);
        else if (cartDelta < 0) setCartCount((c) => Math.max(0, c + cartDelta));

        const assistantMsg: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: reply,
          time: timestamp(),
        };
        setTyping(false);
        setMessages((prev) => {
          const next = [...prev, assistantMsg];
          saveChat(next, ctxRef.current);
          return next;
        });
        setTimeout(() => inputRef.current?.focus(), 50);
      }, delay);
    },
    [typing, lang, addItem, removeItem, updateQuantity, clearCartStore]
  );

  const reset = () => {
    ctxRef.current = emptyContext(lang);
    const greeting = makeGreeting();
    setMessages([greeting]);
    clearChat();
    setInput("");
  };

  const suggestions = SUGGESTIONS[lang] ?? SUGGESTIONS.lt;
  const showSuggestions = messages.length <= 2;

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <header className="px-4 pt-12 pb-3 border-b border-border/50 bg-background/95 backdrop-blur sticky top-0 z-10">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <Link href="/menu">
            <button className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center shrink-0 active:scale-95 transition-transform">
              <ArrowLeft size={16} />
            </button>
          </Link>
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-md shrink-0">
            <ChefHat size={20} className="text-primary-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-base leading-tight">{tr.nav_ai}</h1>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
              <span className="text-xs text-muted-foreground">
                {lang === "lt" ? "Padavėjas" : lang === "en" ? "Waiter" : "Официант"}
              </span>
            </div>
          </div>
          {cartCount > 0 && (
            <Link href="/cart">
              <div className="relative">
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                  <ShoppingCart size={16} className="text-primary" />
                </div>
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-primary text-primary-foreground text-[9px] font-bold rounded-full flex items-center justify-center">
                  {cartCount}
                </span>
              </div>
            </Link>
          )}
          <button
            onClick={reset}
            className="p-2 rounded-full hover:bg-secondary transition-colors active:scale-95"
          >
            <RotateCcw size={15} className="text-muted-foreground" />
          </button>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-lg mx-auto space-y-4">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} onCartAdd={() => setCartCount((c) => c + 1)} />
          ))}
          {typing && <TypingDots />}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Suggestion chips */}
      {showSuggestions && (
        <div className="px-4 pb-2">
          <div className="max-w-lg mx-auto flex gap-2 overflow-x-auto no-scrollbar">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => sendMessage(s)}
                disabled={typing}
                className="px-3 py-2 bg-secondary rounded-full text-xs font-medium whitespace-nowrap border border-border/50 active:bg-primary/10 active:border-primary/30 transition-colors shrink-0 disabled:opacity-40"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="px-4 pb-6 pt-2 border-t border-border/30">
        <div className="max-w-lg mx-auto flex gap-2 items-center">
          <div className="flex-1 bg-secondary rounded-2xl px-4 py-3 flex items-center gap-2 min-h-12">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(input);
                }
              }}
              placeholder={tr.ai_placeholder}
              className="bg-transparent text-sm flex-1 outline-none placeholder:text-muted-foreground"
              disabled={typing}
            />
          </div>
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || typing}
            className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            <Send size={17} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
}
