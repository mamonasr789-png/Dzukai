import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import type { ReactNode } from "react";

import {
  LiveWaiterClient,
  storeSessionId,
  type DiningSessionSnapshot,
  type SessionStoragePort,
} from "../client/liveWaiterClient.ts";
import {
  loadDisplayTranscript,
  readPendingTurn,
  saveDisplayTranscript,
  storePendingTurn,
} from "../client/liveWaiterStorage.ts";
import type {
  Cart,
  DiningSessionId,
  WaiterTurnData,
} from "../schemas.ts";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://ui.test/ai",
  pretendToBeVisual: true,
});
Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  self: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  MutationObserver: {
    configurable: true,
    value: dom.window.MutationObserver,
  },
  CustomEvent: { configurable: true, value: dom.window.CustomEvent },
  localStorage: { configurable: true, value: dom.window.localStorage },
  sessionStorage: { configurable: true, value: dom.window.sessionStorage },
  IS_REACT_ACT_ENVIRONMENT: {
    configurable: true,
    writable: true,
    value: true,
  },
});
dom.window.HTMLElement.prototype.scrollIntoView = () => undefined;

const React = await import("react");
const {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} = await import("@testing-library/react");
const { AIPageClient } = await import("../../../app/ai/page.tsx");
const { useCartStore } = await import("../../store.ts");
const { products } = await import("../../data.ts");

class MemorySessionStorage implements SessionStoragePort {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const SESSION_A = "ds_000000000000000000000000000000a1" as const;
const SESSION_B = "ds_000000000000000000000000000000b2" as const;
const NOW = "2026-07-27T12:00:00.000Z";

function emptyCart(
  sessionId: DiningSessionId = SESSION_A,
  revision = 0
): Cart {
  return {
    sessionId,
    revision,
    lines: [],
    total: 0,
    currency: "EUR",
    updatedAt: NOW,
  };
}

function cartWithLine(
  sessionId: DiningSessionId = SESSION_A,
  revision = 1,
  quantity = 1,
  productId = "u2"
): Cart {
  return {
    sessionId,
    revision,
    lines: [
      {
        lineId: "line_00000000000000000000000000000001",
        productId,
        product: {
          productId,
          name: productId === "u2" ? "Second official dish" : "Official dish",
          category: "jautiena",
          officialUnitPrice: 10,
          currency: "EUR",
          priceNote: null,
        },
        quantity,
        modifiers: [],
        customerNote: null,
        requiresStaffConfirmation: false,
        lineRevision: revision || 1,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    total: 10 * quantity,
    currency: "EUR",
    updatedAt: NOW,
  };
}

function snapshot(
  options: {
    sessionId?: typeof SESSION_A | typeof SESSION_B;
    language?: "lt" | "en" | "ru";
    cart?: Cart;
    restaurantId?: string | null;
    table?: boolean;
  } = {}
): DiningSessionSnapshot {
  const sessionId = options.sessionId ?? SESSION_A;
  const cart = options.cart ?? emptyCart(sessionId);
  const table = options.table ?? false;
  return {
    state: {
      schemaVersion: 1,
      sessionId,
      restaurantId: table
        ? "dzuku_ainiai"
        : options.restaurantId ?? null,
      tableNumber: table ? "12" : null,
      tableTokenId: table ? "rendered_table_token_id" : null,
      language: options.language ?? "en",
      stage: "greeting",
      preferences: {
        preferredProductIds: [],
        preferredCategories: [],
        preferredProteins: [],
        preferredDrinks: [],
      },
      temporaryPreferences: {
        preferredProductIds: [],
        preferredCategories: [],
        preferredProteins: [],
        preferredDrinks: [],
      },
      dislikedIngredients: [],
      dietaryRequirements: [],
      allergies: [],
      budget: null,
      budgetScope: null,
      hungerLevel: null,
      latestReferencedProductIds: [],
      unresolvedQuestion: null,
      ambiguity: null,
      cartRevision: cart.revision,
      lastIntent: null,
      lastToolNames: [],
      lastInteractionAt: null,
      createdAt: NOW,
      updatedAt: NOW,
      expiresAt: "2026-07-27T13:00:00.000Z",
    },
    cart,
    capabilities: {
      mode: table ? "table" : "demo",
      staffRequestsAvailable: table,
    },
  };
}

function turnData(
  cart: Cart,
  overrides: Partial<WaiterTurnData> = {}
): WaiterTurnData {
  return {
    message: "Safe rendered response.",
    language: "en",
    stage: "recommending",
    references: [],
    cart,
    actions: [],
    status: "success",
    actionLedger: [],
    fallbackUsed: true,
    replayed: false,
    ...overrides,
  };
}

function jsonSnapshot(value: DiningSessionSnapshot, status = 200): Response {
  return Response.json({ ok: true, ...value }, { status });
}

function renderPage(
  client: LiveWaiterClient,
  storage: MemorySessionStorage,
  extra: {
    strict?: boolean;
    createBroadcastChannel?: (
      name: string
    ) => {
      postMessage(message: unknown): void;
      close(): void;
      onmessage: ((event: MessageEvent<unknown>) => void) | null;
    } | null;
  } = {}
) {
  const content: ReactNode = (
    <AIPageClient
      client={client}
      storage={storage}
      createBroadcastChannel={extra.createBroadcastChannel}
    />
  );
  return render(
    extra.strict ? <React.StrictMode>{content}</React.StrictMode> : content
  );
}

function setLanguage(language: "lt" | "en" | "ru") {
  useCartStore.setState({ lang: language, items: [], tableNumber: null });
}

test.afterEach(() => {
  cleanup();
  dom.reconfigure({ url: "http://ui.test/ai" });
  localStorage.clear();
  sessionStorage.clear();
  setLanguage("en");
});

test("Strict Mode initializes once after language hydration and restores the scoped transcript", async () => {
  setLanguage("ru");
  const storage = new MemorySessionStorage();
  const restored = snapshot({ language: "ru" });
  storeSessionId(storage, SESSION_A);
  saveDisplayTranscript(storage, {
    sessionId: SESSION_A,
    restaurantId: null,
  }, [
    {
      id: "stored-assistant",
      role: "assistant",
      content: "Сохранённая история",
      time: "12:00",
    },
  ]);
  let sessionCalls = 0;
  const client = new LiveWaiterClient({
    fetchImplementation: (async (_input, init) => {
      sessionCalls += 1;
      assert.deepEqual(JSON.parse(String(init?.body)), {
        action: "restore_session",
        sessionId: SESSION_A,
      });
      return jsonSnapshot(restored);
    }) as typeof fetch,
  });

  renderPage(client, storage, { strict: true });
  assert.ok(screen.getByTestId("session-loading"));
  await screen.findByText("Сохранённая история");
  assert.equal(sessionCalls, 1);
  assert.equal(
    screen.queryByText(/Sveiki! Ko norėtumėte/iu),
    null
  );
  assert.ok(screen.getByLabelText("Отправить сообщение"));
  assert.ok(document.querySelector("[aria-live='polite']"));
});

test("refresh recovery keeps a pending turn, does not auto-send, and retries the exact same ID once", async () => {
  const storage = new MemorySessionStorage();
  storeSessionId(storage, SESSION_A);
  saveDisplayTranscript(
    storage,
    { sessionId: SESSION_A, restaurantId: null },
    [
      {
        id: "prior-assistant",
        role: "assistant",
        content: "Prior safe message",
        time: "12:00",
      },
    ]
  );
  storePendingTurn(storage, {
    version: 1,
    sessionId: SESSION_A,
    clientTurnId: "render_pending_001",
    message: "Add the exact previous item",
    selectionHint: {
      actionType: "add_to_cart",
      referenceSetId: "refs_222222222222222222222222",
      productId: "u2",
      ordinal: 1,
    },
    createdAt: Date.now(),
    transportState: "sending",
  });
  const turnBodies: Array<Record<string, unknown>> = [];
  const client = new LiveWaiterClient({
    fetchImplementation: (async (input, init) => {
      const path = String(input);
      if (path.endsWith("/session")) return jsonSnapshot(snapshot());
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      turnBodies.push(body);
      return Response.json({
        ok: true,
        data: turnData(emptyCart()),
      });
    }) as typeof fetch,
  });

  renderPage(client, storage);
  await screen.findByText(/previous request outcome is unknown/iu);
  assert.equal(turnBodies.length, 0);
  fireEvent.click(screen.getByTestId("retry-turn"));
  await screen.findByText("Safe rendered response.");
  assert.equal(turnBodies.length, 1);
  assert.equal(turnBodies[0].clientTurnId, "render_pending_001");
  assert.equal(turnBodies[0].message, "Add the exact previous item");
  assert.deepEqual(turnBodies[0].selectionHint, {
    actionType: "add_to_cart",
    referenceSetId: "refs_222222222222222222222222",
    productId: "u2",
    ordinal: 1,
  });
  assert.equal(
    screen.getAllByText("Add the exact previous item").length,
    1
  );
  assert.equal(readPendingTurn(storage, SESSION_A), null);
});

test("confirmed no-side-effect retry uses a new turn ID without duplicating the user transcript", async () => {
  const storage = new MemorySessionStorage();
  const turnBodies: Array<Record<string, unknown>> = [];
  const client = new LiveWaiterClient({
    fetchImplementation: (async (input, init) => {
      if (String(input).endsWith("/session")) {
        return jsonSnapshot(snapshot(), 201);
      }
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      turnBodies.push(body);
      return Response.json({
        ok: true,
        data: turnData(emptyCart(), {
          message:
            turnBodies.length === 1
              ? "Provider did not start an action."
              : "Fresh retry completed.",
          status:
            turnBodies.length === 1
              ? "provider_failed_without_side_effect"
              : "success",
        }),
      });
    }) as typeof fetch,
  });

  renderPage(client, storage);
  const input = await screen.findByTestId("waiter-input");
  fireEvent.change(input, { target: { value: "Recommend dinner" } });
  fireEvent.click(screen.getByTestId("send-turn"));
  await screen.findByText("Provider did not start an action.");
  fireEvent.click(screen.getByTestId("retry-turn"));
  await screen.findByText("Fresh retry completed.");
  assert.equal(turnBodies.length, 2);
  assert.notEqual(turnBodies[0].clientTurnId, turnBodies[1].clientTurnId);
  assert.equal(turnBodies[0].message, turnBodies[1].message);
  assert.equal(screen.getAllByText("Recommend dinner").length, 1);
});

test("rendered product-card Add sends and applies the exact clicked server reference", async () => {
  setLanguage("en");
  const storage = new MemorySessionStorage();
  const turnBodies: Array<Record<string, unknown>> = [];
  const broadcastMessages: unknown[] = [];
  const channel = {
    onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
    postMessage(message: unknown) {
      broadcastMessages.push(message);
    },
    close() {},
  };
  useCartStore.setState({
    items: [{ product: products[0], quantity: 7 }],
  });
  const references = [
    {
      productId: "u1",
      name: "Shared official dish",
      officialUnitPrice: 9,
      currency: "EUR" as const,
      referenceSetId: "refs_111111111111111111111111",
      ordinal: 0,
    },
    {
      productId: "u2",
      name: "Shared official dish deluxe",
      officialUnitPrice: 10,
      currency: "EUR" as const,
      referenceSetId: "refs_111111111111111111111111",
      ordinal: 1,
    },
  ];
  const client = new LiveWaiterClient({
    fetchImplementation: (async (input, init) => {
      if (String(input).endsWith("/session")) return jsonSnapshot(snapshot(), 201);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      turnBodies.push(body);
      const isAdd = turnBodies.length === 2;
      return Response.json({
        ok: true,
        data: turnData(
          isAdd ? cartWithLine() : emptyCart(),
          isAdd
            ? {
                message: "Exact second card added.",
                actions: [
                  {
                    type: "cart_updated",
                    toolName: "add_to_cart",
                    targetId:
                      "line_00000000000000000000000000000001",
                  },
                ],
              }
            : {
                message: "Two grounded choices.",
                references,
              }
        ),
      });
    }) as typeof fetch,
  });

  renderPage(client, storage, {
    createBroadcastChannel: () => channel,
  });
  const readyInput = await screen.findByTestId("waiter-input");
  await waitFor(() =>
    assert.equal((readyInput as HTMLInputElement).disabled, false)
  );
  fireEvent.click(screen.getByText("What do you recommend?"));
  await screen.findByText("Two grounded choices.");
  const secondCard = screen.getByTestId("product-reference-u2");
  fireEvent.click(
    within(secondCard).getByRole("button", {
      name: "Add: Shared official dish deluxe",
    })
  );
  await screen.findByText("Exact second card added.");
  assert.deepEqual(turnBodies[1].selectionHint, {
    actionType: "add_to_cart",
    referenceSetId: "refs_111111111111111111111111",
    productId: "u2",
    ordinal: 1,
  });
  assert.match(String(turnBodies[1].message), /recommendation 2/iu);
  fireEvent.click(screen.getByLabelText("Cart"));
  assert.ok(screen.getByText("Second official dish"));
  assert.deepEqual(broadcastMessages, [
    {
      type: "cart-invalidated",
      sessionId: SESSION_A,
      revision: 1,
    },
  ]);
  assert.equal(
    Object.hasOwn(
      broadcastMessages[0] as Record<string, unknown>,
      "cart"
    ),
    false
  );
  assert.equal(useCartStore.getState().items[0]?.quantity, 7);
});

test("a newer cross-tab restore wins over a late older response and only invalidation is broadcast", async () => {
  const storage = new MemorySessionStorage();
  let currentSnapshot = snapshot();
  let resolveTurn: (response: Response) => void = () => {
    throw new Error("The rendered turn has not started.");
  };
  let turnStarted = false;
  const sentMessages: unknown[] = [];
  const channel = {
    onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
    postMessage(message: unknown) {
      sentMessages.push(message);
    },
    close() {},
  };
  const client = new LiveWaiterClient({
    fetchImplementation: (async (input) => {
      if (String(input).endsWith("/session")) {
        return jsonSnapshot(currentSnapshot);
      }
      turnStarted = true;
      return new Promise<Response>((resolve) => {
        resolveTurn = resolve;
      });
    }) as typeof fetch,
    requestTimeoutMs: 2_000,
  });

  renderPage(client, storage, {
    createBroadcastChannel: () => channel,
  });
  const input = await screen.findByTestId("waiter-input");
  fireEvent.change(input, { target: { value: "Add a dish" } });
  fireEvent.click(screen.getByTestId("send-turn"));
  await waitFor(() => assert.equal(turnStarted, true));

  currentSnapshot = snapshot({
    cart: cartWithLine(SESSION_A, 2, 2),
  });
  channel.onmessage?.({
    data: {
      type: "cart-invalidated",
      sessionId: SESSION_A,
      revision: 2,
    },
  } as MessageEvent<unknown>);
  await waitFor(() =>
    assert.match(screen.getByLabelText("Cart").textContent ?? "", /2/u)
  );

  resolveTurn(
    Response.json({
      ok: true,
      data: turnData(cartWithLine(SESSION_A, 1, 1), {
        message: "Late older response.",
        actions: [
          {
            type: "cart_updated",
            toolName: "add_to_cart",
            targetId: "line_00000000000000000000000000000001",
          },
        ],
      }),
    })
  );
  await screen.findByText("Late older response.");
  assert.ok(
    screen.getAllByText(/cart could not be refreshed safely/iu).length >= 1
  );
  assert.match(screen.getByLabelText("Cart").textContent ?? "", /2/u);
  assert.deepEqual(sentMessages, []);
});

test("unmount abort retains the pending identity without leaking UI updates", async () => {
  const storage = new MemorySessionStorage();
  let abortObserved = false;
  let turnBody: Record<string, unknown> | null = null;
  const client = new LiveWaiterClient({
    fetchImplementation: (async (input, init) => {
      if (String(input).endsWith("/session")) {
        return jsonSnapshot(
          snapshot({ cart: cartWithLine(SESSION_A, 1, 1) }),
          201
        );
      }
      turnBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            abortObserved = true;
            reject(new DOMException("hidden internal abort", "AbortError"));
          },
          { once: true }
        );
      });
    }) as typeof fetch,
    requestTimeoutMs: 2_000,
  });

  const rendered = renderPage(client, storage);
  const input = await screen.findByTestId("waiter-input");
  fireEvent.change(input, { target: { value: "Potential mutation" } });
  fireEvent.click(screen.getByTestId("send-turn"));
  await waitFor(() => assert.ok(turnBody));
  rendered.unmount();
  await waitFor(() => assert.equal(abortObserved, true));
  assert.ok(turnBody);
  assert.ok(readPendingTurn(storage, SESSION_A));
  assert.equal(document.body.textContent, "");
});

test("a malformed duplicate-line cart preserves the last good cart and the same-ID recovery record", async () => {
  const storage = new MemorySessionStorage();
  let capturedTurnId = "";
  const goodCart = cartWithLine(SESSION_A, 1, 1);
  const client = new LiveWaiterClient({
    fetchImplementation: (async (input, init) => {
      if (String(input).endsWith("/session")) {
        return jsonSnapshot(snapshot({ cart: goodCart }), 201);
      }
      const body = JSON.parse(String(init?.body)) as {
        clientTurnId: string;
      };
      capturedTurnId = body.clientTurnId;
      return Response.json({
        ok: true,
        data: turnData(
          {
            ...goodCart,
            revision: 2,
            lines: [goodCart.lines[0], structuredClone(goodCart.lines[0])],
            total: 20,
          },
          {
            message: "This malformed response must not be trusted.",
            actions: [
              {
                type: "cart_updated",
                toolName: "add_to_cart",
                targetId:
                  "line_00000000000000000000000000000001",
              },
            ],
          }
        ),
      });
    }) as typeof fetch,
  });

  renderPage(client, storage);
  const input = await screen.findByTestId("waiter-input");
  fireEvent.change(input, { target: { value: "Mutate once" } });
  fireEvent.click(screen.getByTestId("send-turn"));
  await screen.findByText(/cart could not be refreshed safely/iu);
  assert.ok(screen.getByTestId("retry-turn"));
  assert.equal(
    readPendingTurn(storage, SESSION_A)?.clientTurnId,
    capturedTurnId
  );
  fireEvent.click(screen.getByLabelText("Cart"));
  assert.equal(screen.getAllByText("Second official dish").length, 1);
});

test("rendered timeout settles typing and preserves manual same-ID retry state", async () => {
  const storage = new MemorySessionStorage();
  const client = new LiveWaiterClient({
    fetchImplementation: (async (input, init) => {
      if (String(input).endsWith("/session")) {
        return jsonSnapshot(snapshot(), 201);
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("timeout", "AbortError")),
          { once: true }
        );
      });
    }) as typeof fetch,
    requestTimeoutMs: 5,
  });

  renderPage(client, storage);
  const input = await screen.findByTestId("waiter-input");
  fireEvent.change(input, { target: { value: "Timeout mutation" } });
  fireEvent.click(screen.getByTestId("send-turn"));
  await screen.findByText(/previous request outcome is unknown/iu);
  assert.equal(screen.queryByTestId("waiter-typing"), null);
  assert.ok(screen.getByTestId("retry-turn"));
  assert.equal(
    readPendingTurn(storage, SESSION_A)?.message,
    "Timeout mutation"
  );
});

test("fragment table capability is cleaned and exchanged only in POST JSON while Russian UI stays actionable", async () => {
  setLanguage("ru");
  dom.reconfigure({
    url: "http://ui.test/ai#tableToken=payload_payload.signature_signature&source=qr",
  });
  const storage = new MemorySessionStorage();
  const requestUrls: string[] = [];
  const requestBodies: Array<Record<string, unknown>> = [];
  const client = new LiveWaiterClient({
    fetchImplementation: (async (input, init) => {
      requestUrls.push(String(input));
      requestBodies.push(
        JSON.parse(String(init?.body)) as Record<string, unknown>
      );
      return jsonSnapshot(snapshot({ language: "ru", table: true }), 201);
    }) as typeof fetch,
  });

  renderPage(client, storage);
  await screen.findByText(/Официант · Режим стола/iu);
  assert.equal(window.location.hash, "#source=qr");
  assert.deepEqual(requestUrls, ["/api/ai/session"]);
  assert.equal(
    requestUrls.some((url) => url.includes("payload_payload")),
    false
  );
  assert.equal(requestBodies[0].action, "create_table_session");
  assert.equal(
    requestBodies[0].tableToken,
    "payload_payload.signature_signature"
  );
  assert.ok(screen.getByLabelText("Отправить сообщение"));
  assert.ok(screen.getByLabelText("Вернуться в меню"));
});

test("invalid or expired table capability is rejected before an explicit demo fallback", async () => {
  dom.reconfigure({
    url: "http://ui.test/ai#tableToken=expired_payload.expired_signature",
  });
  const storage = new MemorySessionStorage();
  const bodies: Array<Record<string, unknown>> = [];
  const client = new LiveWaiterClient({
    fetchImplementation: (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      if (body.action === "create_table_session") {
        return Response.json(
          {
            ok: false,
            error: {
              code: "invalid_table_token",
              message: "Expired token.",
            },
          },
          { status: 401 }
        );
      }
      return jsonSnapshot(snapshot(), 201);
    }) as typeof fetch,
  });

  renderPage(client, storage);
  await screen.findByText(/table link could not be verified/iu);
  assert.deepEqual(
    bodies.map((body) => body.action),
    ["create_table_session", "create_demo_session"]
  );
  assert.equal(window.location.hash, "");
  assert.match(screen.getByTestId("session-mode").textContent ?? "", /Demo mode/u);
});

test("expired session replacement clears the old safety-sensitive transcript namespace", async () => {
  const storage = new MemorySessionStorage();
  storeSessionId(storage, SESSION_A);
  saveDisplayTranscript(
    storage,
    { sessionId: SESSION_A, restaurantId: null },
    [
      {
        id: "old-allergy",
        role: "user",
        content: "I am allergic to nuts",
        time: "12:00",
      },
    ]
  );
  const client = new LiveWaiterClient({
    fetchImplementation: (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        action: string;
      };
      if (body.action === "restore_session") {
        return Response.json(
          {
            ok: false,
            error: {
              code: "session_not_found",
              message: "Expired.",
            },
          },
          { status: 404 }
        );
      }
      return jsonSnapshot(
        snapshot({ sessionId: SESSION_B, language: "en" }),
        201
      );
    }) as typeof fetch,
  });

  renderPage(client, storage);
  await screen.findByText(/previous allergies and preferences are no longer active/iu);
  assert.equal(screen.queryByText("I am allergic to nuts"), null);
  assert.equal(
    loadDisplayTranscript(storage, {
      sessionId: SESSION_A,
      restaurantId: null,
    }),
    null
  );
});
