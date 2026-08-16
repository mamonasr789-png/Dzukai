import test from "node:test";
import assert from "node:assert/strict";

import { products, type Product } from "../../data.ts";
import {
  CartOutputSchema,
  ProductDetailsOutputSchema,
  RecommendProductsOutputSchema,
  StaffRequestOutputSchema,
  type ConversationState,
  type DiningSessionId,
  type ProductDetails,
  type SupportedLanguage,
  type ToolErrorCode,
} from "../schemas.ts";
import { StandaloneVaiseCartAdapter } from "../server/cartPort.ts";
import { InMemoryConversationStateStore } from "../server/conversationStateStore.ts";
import {
  readLimitedJson,
} from "../server/http.ts";
import {
  StaticMenuRepository,
  type MenuRepository,
  type ProductSearchOptions,
  type RecommendationCandidateOptions,
} from "../server/menuRepository.ts";
import { InMemoryRateLimitAdapter } from "../server/rateLimitPort.ts";
import {
  conversationStateStore,
  getAiWaiterRuntimeAvailability,
  isProductionInMemoryDemoOverride,
  resetDevelopmentRuntime,
} from "../server/runtime.ts";
import { InMemoryStaffTaskAdapter } from "../server/staffTaskPort.ts";
import {
  createDevelopmentTableToken,
  getTableTokenSecret,
  signTableToken,
  verifyTableToken,
} from "../server/tableToken.ts";
import {
  SafeToolRegistry,
  type ToolExecutionResponse,
} from "../server/toolRegistry.ts";
import {
  DELETE as sessionDelete,
  GET as sessionGet,
  OPTIONS as sessionOptions,
  POST as sessionPost,
} from "../../../app/api/ai/session/route.ts";
import {
  GET as toolsGet,
  POST as toolsPost,
} from "../../../app/api/ai/tools/route.ts";

function fixedSessionId(counter: number): DiningSessionId {
  return `ds_${counter.toString(16).padStart(32, "0")}`;
}

class MutableMenuRepository implements MenuRepository {
  private readonly base = new StaticMenuRepository();
  readonly priceOverrides = new Map<string, number>();
  readonly missingProducts = new Set<string>();
  readonly modifierOverrides = new Map<
    string,
    ProductDetails["supportedModifiers"]
  >();
  readonly orderabilityOverrides = new Map<
    string,
    ProductDetails["orderability"]
  >();

  async searchProducts(
    query: string,
    options: ProductSearchOptions,
    language?: SupportedLanguage
  ): Promise<ProductDetails[]> {
    const found = await this.base.searchProducts(query, options, language);
    return this.applyMany(found);
  }

  getProductById(productId: string): Promise<Product | null> {
    if (this.missingProducts.has(productId)) return Promise.resolve(null);
    return this.base.getProductById(productId);
  }

  async getProductsByIds(productIds: string[]): Promise<Product[]> {
    return (await this.base.getProductsByIds(productIds)).filter(
      (product) => !this.missingProducts.has(product.id)
    );
  }

  async getProductDetails(
    productId: string,
    language?: SupportedLanguage
  ): Promise<ProductDetails | null> {
    if (this.missingProducts.has(productId)) return null;
    const product = await this.base.getProductDetails(productId, language);
    return product ? this.apply(product) : null;
  }

  async getOfficialPrice(productId: string): Promise<number | null> {
    return (await this.getProductDetails(productId))?.officialUnitPrice ?? null;
  }

  async getAllergenStatus(
    productId: string
  ): Promise<ProductDetails["allergenStatus"] | null> {
    return (await this.getProductDetails(productId))?.allergenStatus ?? null;
  }

  async getSupportedModifiers(
    productId: string
  ): Promise<ProductDetails["supportedModifiers"] | null> {
    return (await this.getProductDetails(productId))?.supportedModifiers ?? null;
  }

  async getRecommendationCandidates(
    options: RecommendationCandidateOptions,
    language?: SupportedLanguage
  ): Promise<ProductDetails[]> {
    const found = await this.base.getRecommendationCandidates(options, language);
    return this.applyMany(found);
  }

  private apply(product: ProductDetails): ProductDetails {
    return {
      ...structuredClone(product),
      officialUnitPrice:
        this.priceOverrides.get(product.productId) ??
        product.officialUnitPrice,
      supportedModifiers:
        this.modifierOverrides.get(product.productId) ??
        structuredClone(product.supportedModifiers),
      orderability:
        this.orderabilityOverrides.get(product.productId) ??
        structuredClone(product.orderability),
    };
  }

  private applyMany(found: ProductDetails[]): ProductDetails[] {
    return found
      .filter((product) => !this.missingProducts.has(product.productId))
      .map((product) => this.apply(product));
  }
}

async function createHarness(
  input: {
    tableContext?: boolean;
    now?: () => number;
    ttlMs?: number;
    idempotencyTtlMs?: number;
    maximumSessions?: number;
    maximumCarts?: number;
    maximumStaffRequests?: number;
    staffTaskTtlMs?: number;
    menu?: MenuRepository;
    sessionToolLimit?: number;
    staffActionLimit?: number;
  } = {}
) {
  let sessionCounter = 0;
  let lineCounter = 0;
  let operationCounter = 0;
  let staffCounter = 0;
  const store = new InMemoryConversationStateStore({
    ttlMs: input.ttlMs,
    now: input.now,
    maximumSessions: input.maximumSessions,
    createId: () => fixedSessionId(++sessionCounter),
  });
  const menu = input.menu ?? new MutableMenuRepository();
  const cart = new StandaloneVaiseCartAdapter(menu, store, {
    now: input.now,
    maximumCarts: input.maximumCarts,
    idempotencyTtlMs: input.idempotencyTtlMs,
    createLineId: () =>
      `line_${(++lineCounter).toString(16).padStart(32, "0")}`,
    createOperationId: () =>
      `op_${(++operationCounter).toString(16).padStart(32, "0")}`,
  });
  const staff = new InMemoryStaffTaskAdapter(store, {
    now: input.now,
    maximumRequests: input.maximumStaffRequests,
    staffTaskTtlMs: input.staffTaskTtlMs,
    createRequestId: () =>
      `staff_${(++staffCounter).toString(16).padStart(32, "0")}`,
  });
  const rateLimits = new InMemoryRateLimitAdapter({ now: input.now });
  store.registerSessionCleanup((sessionId) => cart.cleanupSession(sessionId));
  store.registerSessionCleanup((sessionId) => staff.cleanupSession(sessionId));
  const registry = new SafeToolRegistry(
    store,
    menu,
    cart,
    staff,
    rateLimits,
    {
      sessionToolLimit: input.sessionToolLimit ?? 500,
      staffActionLimit: input.staffActionLimit ?? 20,
    }
  );
  const created = await store.createSession({
    language: "lt",
    tableContext:
      input.tableContext === false
        ? null
        : {
            restaurantId: "dzuku_ainiai",
            tableNumber: "5",
            tableTokenId: "qr_test_001",
          },
  });
  if (!created.ok) throw new Error(created.error.message);
  return {
    store,
    menu,
    cart,
    staff,
    rateLimits,
    registry,
    state: created.data,
  };
}

function assertError(
  response:
    | ToolExecutionResponse
    | {
        ok: true;
      }
    | {
        ok: false;
        error: { code: ToolErrorCode; message: string };
      },
  code: ToolErrorCode
): void {
  assert.equal(response.ok, false);
  if (response.ok) return;
  assert.equal(response.error.code, code);
}

function parseCartResponse(response: ToolExecutionResponse) {
  if (!response.ok) throw new Error(response.error.message);
  return CartOutputSchema.parse(response.data);
}

async function addProduct(
  harness: Awaited<ReturnType<typeof createHarness>>,
  input: {
    productId?: string;
    expectedRevision: number;
    idempotencyKey: string;
    customerNote?: string | null;
    quantity?: number;
    modifiers?: { modifierId: string; optionId: string }[];
  }
) {
  return harness.registry.execute({
    sessionId: harness.state.sessionId,
    toolName: "add_to_cart",
    input: {
      productId: input.productId ?? "p1",
      quantity: input.quantity ?? 1,
      modifiers: input.modifiers ?? [],
      customerNote: input.customerNote ?? null,
      expectedRevision: input.expectedRevision,
      idempotencyKey: input.idempotencyKey,
    },
  });
}

function jsonRequest(
  url: string,
  body: unknown,
  contentType = "application/json"
): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": contentType,
      "x-forwarded-for": "203.0.113.15",
      "user-agent": "phase2a-tests",
    },
    body: JSON.stringify(body),
  });
}

test("storage, menu, cart, and staff ports expose asynchronous operations", async () => {
  const harness = await createHarness();
  const stateOperation = harness.store.getSession(harness.state.sessionId);
  const menuOperation = harness.menu.getProductDetails("p1");
  const cartOperation = harness.cart.getCart(harness.state.sessionId);
  const staffOperation = harness.staff.requestWaiter(harness.state.sessionId, {
    idempotencyKey: "async_staff_001",
  });
  assert.equal(stateOperation instanceof Promise, true);
  assert.equal(menuOperation instanceof Promise, true);
  assert.equal(cartOperation instanceof Promise, true);
  assert.equal(staffOperation instanceof Promise, true);
  const [state, product, cart, staff] = await Promise.all([
    stateOperation,
    menuOperation,
    cartOperation,
    staffOperation,
  ]);
  assert.notEqual(state, null);
  assert.notEqual(product, null);
  assert.equal(cart.ok, true);
  assert.equal(staff.ok, true);
});

test("browser-provided prices cannot enter a cart tool input", async () => {
  const harness = await createHarness();
  const response = await harness.registry.execute({
    sessionId: harness.state.sessionId,
    toolName: "add_to_cart",
    input: {
      productId: "p1",
      quantity: 1,
      modifiers: [],
      customerNote: null,
      expectedRevision: 0,
      idempotencyKey: "price_test_001",
      price: 0.01,
    },
  });
  assertError(response, "invalid_tool_input");
});

test("cart uses the current official repository price", async () => {
  const harness = await createHarness();
  const officialPrice = await harness.menu.getOfficialPrice("p1");
  const result = parseCartResponse(
    await addProduct(harness, {
      expectedRevision: 0,
      idempotencyKey: "official_price_001",
    })
  );
  assert.equal(result.cart.lines[0].product.officialUnitPrice, officialPrice);
  assert.equal(result.cart.total, officialPrice);
});

test("nonexistent products and invalid quantities are rejected", async () => {
  const missingHarness = await createHarness();
  assertError(
    await addProduct(missingHarness, {
      productId: "ghost",
      expectedRevision: 0,
      idempotencyKey: "missing_product_001",
    }),
    "product_not_found"
  );
  for (const quantity of [0, 21, 1.5]) {
    const harness = await createHarness();
    assertError(
      await addProduct(harness, {
        expectedRevision: 0,
        idempotencyKey: `bad_quantity_${String(quantity).replace(".", "_")}`,
        quantity,
      }),
      "invalid_tool_input"
    );
  }
});

test("same idempotency key replays without adding a duplicate", async () => {
  const harness = await createHarness();
  const command = {
    expectedRevision: 0,
    idempotencyKey: "duplicate_add_001",
  };
  const first = parseCartResponse(await addProduct(harness, command));
  const replay = parseCartResponse(await addProduct(harness, command));
  assert.equal(replay.cart.lines.length, 1);
  assert.equal(replay.replayed, true);
  assert.equal(replay.operationId, first.operationId);
  assert.equal(replay.affectedLineId, first.affectedLineId);
});

test("idempotent replay returns a freshly reconciled current cart", async () => {
  const harness = await createHarness();
  const originalCommand = {
    expectedRevision: 0,
    idempotencyKey: "replay_current_001",
  };
  const first = parseCartResponse(await addProduct(harness, originalCommand));
  parseCartResponse(
    await addProduct(harness, {
      productId: "p2",
      expectedRevision: 1,
      idempotencyKey: "replay_current_002",
    })
  );
  const replay = parseCartResponse(
    await addProduct(harness, originalCommand)
  );
  assert.equal(replay.cart.revision, 2);
  assert.equal(replay.cart.lines.length, 2);
  assert.equal(replay.operationId, first.operationId);
  assert.equal(replay.replayed, true);
});

test("same idempotency key with different input is rejected", async () => {
  const harness = await createHarness();
  parseCartResponse(
    await addProduct(harness, {
      expectedRevision: 0,
      idempotencyKey: "conflicting_key_001",
    })
  );
  assertError(
    await addProduct(harness, {
      productId: "p2",
      expectedRevision: 1,
      idempotencyKey: "conflicting_key_001",
    }),
    "idempotency_conflict"
  );
});

test("failed operations do not consume idempotency keys", async () => {
  const harness = await createHarness();
  assertError(
    await addProduct(harness, {
      productId: "ghost",
      expectedRevision: 0,
      idempotencyKey: "retry_failed_001",
    }),
    "product_not_found"
  );
  const retried = parseCartResponse(
    await addProduct(harness, {
      expectedRevision: 0,
      idempotencyKey: "retry_failed_001",
    })
  );
  assert.equal(retried.cart.lines.length, 1);
});

test("expired idempotency keys can be used for a new operation", async () => {
  let now = 1_800_000_000_000;
  const harness = await createHarness({
    now: () => now,
    idempotencyTtlMs: 10,
  });
  parseCartResponse(
    await addProduct(harness, {
      expectedRevision: 0,
      idempotencyKey: "expired_key_001",
    })
  );
  now += 11;
  const second = parseCartResponse(
    await addProduct(harness, {
      expectedRevision: 1,
      idempotencyKey: "expired_key_001",
    })
  );
  assert.equal(second.replayed, false);
  assert.equal(second.cart.lines.length, 2);
});

test("same product can exist as separate note lines", async () => {
  const harness = await createHarness();
  parseCartResponse(
    await addProduct(harness, {
      expectedRevision: 0,
      idempotencyKey: "note_line_001",
      customerNote: "Be svogūnų, jei virtuvė gali patvirtinti",
    })
  );
  const second = parseCartResponse(
    await addProduct(harness, {
      expectedRevision: 1,
      idempotencyKey: "note_line_002",
      customerNote: "Papildomas sūris tik patvirtinus virtuvei",
    })
  );
  assert.equal(second.cart.lines.length, 2);
  assert.notEqual(second.cart.lines[0].lineId, second.cart.lines[1].lineId);
  assert.equal(second.cart.lines.every((line) => line.requiresStaffConfirmation), true);
});

test("update and remove target the exact lineId", async () => {
  const harness = await createHarness();
  const first = parseCartResponse(
    await addProduct(harness, {
      expectedRevision: 0,
      idempotencyKey: "line_target_001",
    })
  );
  const second = parseCartResponse(
    await addProduct(harness, {
      expectedRevision: 1,
      idempotencyKey: "line_target_002",
    })
  );
  const updated = parseCartResponse(
    await harness.registry.execute({
      sessionId: harness.state.sessionId,
      toolName: "update_cart_item",
      input: {
        lineId: second.affectedLineId,
        quantity: 3,
        expectedRevision: 2,
      },
    })
  );
  assert.equal(
    updated.cart.lines.find((line) => line.lineId === first.affectedLineId)
      ?.quantity,
    1
  );
  assert.equal(
    updated.cart.lines.find((line) => line.lineId === second.affectedLineId)
      ?.quantity,
    3
  );
  const removed = parseCartResponse(
    await harness.registry.execute({
      sessionId: harness.state.sessionId,
      toolName: "remove_from_cart",
      input: {
        lineId: first.affectedLineId,
        expectedRevision: 3,
      },
    })
  );
  assert.deepEqual(
    removed.cart.lines.map((line) => line.lineId),
    [second.affectedLineId]
  );
});

test("concurrent mutations use atomic revision compare-and-swap", async () => {
  const harness = await createHarness();
  const [first, second] = await Promise.all([
    addProduct(harness, {
      expectedRevision: 0,
      idempotencyKey: "concurrent_add_001",
    }),
    addProduct(harness, {
      productId: "p2",
      expectedRevision: 0,
      idempotencyKey: "concurrent_add_002",
    }),
  ]);
  assert.equal([first, second].filter((result) => result.ok).length, 1);
  const failed = [first, second].find((result) => !result.ok);
  if (!failed) throw new Error("Expected one concurrent mutation to fail.");
  assertError(failed, "revision_conflict");
  const current = parseCartResponse(
    await harness.registry.execute({
      sessionId: harness.state.sessionId,
      toolName: "view_cart",
      input: {},
    })
  );
  assert.equal(current.cart.lines.length, 1);
  assert.equal(current.cart.revision, 1);
});

test("unsupported modifiers remain unconfirmed", async () => {
  const harness = await createHarness();
  assertError(
    await addProduct(harness, {
      expectedRevision: 0,
      idempotencyKey: "modifier_test_001",
      modifiers: [{ modifierId: "topping", optionId: "extra_cheese" }],
    }),
    "unsupported_modifier"
  );
});

test("required modifier rules cover empty, too few, too many, unknown, incompatible, and valid selections", async () => {
  const menu = new MutableMenuRepository();
  menu.modifierOverrides.set("p1", [
    {
      modifierId: "size",
      name: "Dydis",
      minimumSelections: 1,
      maximumSelections: 1,
      options: [
        {
          optionId: "small",
          name: "Mažas",
          officialPriceDeltaCents: 0,
          incompatibleOptionIds: [],
        },
        {
          optionId: "large",
          name: "Didelis",
          officialPriceDeltaCents: 125,
          incompatibleOptionIds: ["spicy"],
        },
        {
          optionId: "spicy",
          name: "Aštrus",
          officialPriceDeltaCents: 50,
          incompatibleOptionIds: ["large"],
        },
      ],
    },
  ]);

  for (const [name, modifiers] of [
    ["empty", []],
    [
      "too_many",
      [
        { modifierId: "size", optionId: "small" },
        { modifierId: "size", optionId: "large" },
      ],
    ],
    ["unknown", [{ modifierId: "size", optionId: "ghost" }]],
    [
      "incompatible",
      [
        { modifierId: "size", optionId: "large" },
        { modifierId: "size", optionId: "spicy" },
      ],
    ],
  ] as const) {
    const harness = await createHarness({ menu });
    assertError(
      await addProduct(harness, {
        expectedRevision: 0,
        idempotencyKey: `modifier_${name}_001`,
        modifiers: [...modifiers],
      }),
      "unsupported_modifier"
    );
  }

  menu.modifierOverrides.set("p1", [
    {
      modifierId: "extras",
      name: "Priedai",
      minimumSelections: 2,
      maximumSelections: 2,
      options: [
        {
          optionId: "one",
          name: "Vienas",
          officialPriceDeltaCents: 25,
          incompatibleOptionIds: [],
        },
        {
          optionId: "two",
          name: "Du",
          officialPriceDeltaCents: 50,
          incompatibleOptionIds: [],
        },
      ],
    },
  ]);
  const tooFewHarness = await createHarness({ menu });
  assertError(
    await addProduct(tooFewHarness, {
      expectedRevision: 0,
      idempotencyKey: "modifier_too_few_001",
      modifiers: [{ modifierId: "extras", optionId: "one" }],
    }),
    "unsupported_modifier"
  );

  const validHarness = await createHarness({ menu });
  const valid = parseCartResponse(
    await addProduct(validHarness, {
      expectedRevision: 0,
      idempotencyKey: "modifier_valid_001",
      quantity: 3,
      modifiers: [
        { modifierId: "extras", optionId: "one" },
        { modifierId: "extras", optionId: "two" },
      ],
    })
  );
  assert.equal(valid.cart.lines[0].product.officialUnitPrice, 9.75);
  assert.equal(valid.cart.total, 29.25);
});

test("price changes reconcile existing lines and totals using cents", async () => {
  const menu = new MutableMenuRepository();
  const harness = await createHarness({ menu });
  parseCartResponse(
    await addProduct(harness, {
      expectedRevision: 0,
      idempotencyKey: "price_change_001",
    })
  );
  menu.priceOverrides.set("p1", 10.25);
  const viewed = parseCartResponse(
    await harness.registry.execute({
      sessionId: harness.state.sessionId,
      toolName: "view_cart",
      input: {},
    })
  );
  assert.equal(viewed.cart.lines[0].product.officialUnitPrice, 10.25);
  assert.equal(viewed.cart.total, 10.25);
  assert.equal(viewed.cart.revision, 2);
});

test("lines added before and after a price change use one current price", async () => {
  const menu = new MutableMenuRepository();
  const harness = await createHarness({ menu });
  parseCartResponse(
    await addProduct(harness, {
      expectedRevision: 0,
      idempotencyKey: "two_price_001",
    })
  );
  menu.priceOverrides.set("p1", 10.01);
  const second = parseCartResponse(
    await addProduct(harness, {
      expectedRevision: 1,
      idempotencyKey: "two_price_002",
    })
  );
  assert.deepEqual(
    second.cart.lines.map((line) => line.product.officialUnitPrice),
    [10.01, 10.01]
  );
  assert.equal(second.cart.total, 20.02);
});

test("update, remove, and clear responses preserve current-price reconciliation", async () => {
  const menu = new MutableMenuRepository();
  const harness = await createHarness({ menu });
  const first = parseCartResponse(
    await addProduct(harness, {
      expectedRevision: 0,
      idempotencyKey: "mutation_price_001",
    })
  );
  const second = parseCartResponse(
    await addProduct(harness, {
      productId: "p2",
      expectedRevision: 1,
      idempotencyKey: "mutation_price_002",
    })
  );
  menu.priceOverrides.set("p1", 10.25);
  const updated = parseCartResponse(
    await harness.registry.execute({
      sessionId: harness.state.sessionId,
      toolName: "update_cart_item",
      input: {
        lineId: second.affectedLineId,
        quantity: 2,
        expectedRevision: 2,
      },
    })
  );
  assert.equal(updated.cart.lines[0].product.officialUnitPrice, 10.25);
  assert.equal(updated.cart.total, 33.25);

  menu.priceOverrides.set("p1", 10.5);
  const removed = parseCartResponse(
    await harness.registry.execute({
      sessionId: harness.state.sessionId,
      toolName: "remove_from_cart",
      input: {
        lineId: second.affectedLineId,
        expectedRevision: 3,
      },
    })
  );
  assert.equal(removed.cart.lines[0].lineId, first.affectedLineId);
  assert.equal(removed.cart.lines[0].product.officialUnitPrice, 10.5);
  assert.equal(removed.cart.total, 10.5);

  const cleared = parseCartResponse(
    await harness.registry.execute({
      sessionId: harness.state.sessionId,
      toolName: "clear_cart",
      input: { expectedRevision: 4 },
    })
  );
  assert.equal(cleared.cart.lines.length, 0);
  assert.equal(cleared.cart.total, 0);
});

test("unavailable, missing, or non-orderable products return reconciliation errors", async () => {
  for (const mode of ["unavailable", "missing", "non_orderable"] as const) {
    const menu = new MutableMenuRepository();
    const harness = await createHarness({ menu });
    parseCartResponse(
      await addProduct(harness, {
        expectedRevision: 0,
        idempotencyKey: `reconcile_${mode}_001`,
      })
    );
    if (mode === "unavailable") menu.priceOverrides.set("p1", 0);
    else if (mode === "missing") menu.missingProducts.add("p1");
    else {
      menu.orderabilityOverrides.set("p1", {
        status: "requires_variant",
        reason: "variant_data_missing",
      });
    }
    assertError(
      await harness.registry.execute({
        sessionId: harness.state.sessionId,
        toolName: "view_cart",
        input: {},
      }),
      "cart_reconciliation_failed"
    );
  }
});

test("every current priceNote product requires an authoritative variant", async () => {
  const variantProducts = products.filter((product) => product.priceNote);
  assert.ok(variantProducts.length > 0);
  const categories = new Set(variantProducts.map((product) => product.category));
  assert.ok(categories.size >= 5);
  for (const product of variantProducts) {
    const harness = await createHarness();
    assertError(
      await addProduct(harness, {
        productId: product.id,
        expectedRevision: 0,
        idempotencyKey: `variant_${product.id}_001`,
      }),
      "required_variant_missing"
    );
  }
});

test("halal and kosher recommendations are conservative and unverified", async () => {
  for (const requirement of ["halal", "kosher"] as const) {
    const harness = await createHarness();
    const response = await harness.registry.execute({
      sessionId: harness.state.sessionId,
      toolName: "recommend_products",
      input: {
        dietaryRequirements: [requirement],
        allergies: [],
        excludeProductIds: [],
        limit: 10,
      },
    });
    if (!response.ok) throw new Error(response.error.message);
    const output = RecommendProductsOutputSchema.parse(response.data);
    assert.deepEqual(output.products, []);
    assert.equal(output.certificationStatus, "unknown");
    assert.equal(output.requiresStaffConfirmation, true);
    assert.equal(output.allergySafetyConfirmed, false);
  }
});

test("empty allergen arrays are represented as unknown", async () => {
  const harness = await createHarness();
  const response = await harness.registry.execute({
    sessionId: harness.state.sessionId,
    toolName: "get_product_details",
    input: { productId: "sr2" },
  });
  if (!response.ok) throw new Error(response.error.message);
  const details = ProductDetailsOutputSchema.parse(response.data);
  assert.equal(details.product.allergenStatus.certainty, "unknown");
});

test("strict tool validation rejects malformed input and unknown tools", async () => {
  const harness = await createHarness();
  assertError(
    await harness.registry.execute({
      sessionId: harness.state.sessionId,
      toolName: "clear_cart",
      input: { expectedRevision: 0, arbitraryAction: "add_to_cart" },
    }),
    "invalid_tool_input"
  );
  assertError(
    await harness.registry.execute({
      sessionId: harness.state.sessionId,
      toolName: "run_arbitrary_code",
      input: {},
    }),
    "unknown_tool"
  );
});

test("server-owned state fields cannot be changed through preference updates", async () => {
  const harness = await createHarness();
  const maliciousUpdate = {
    budget: 50,
    sessionId: fixedSessionId(99),
    restaurantId: "attacker",
    tableNumber: "99",
    tableTokenId: "attacker_token",
    cartRevision: 999,
    createdAt: new Date(0).toISOString(),
  };
  const updated = await harness.store.updatePreferences(
    harness.state.sessionId,
    maliciousUpdate
  );
  assert.equal(updated.ok, true);
  if (!updated.ok) return;
  assert.equal(updated.data.budget, 50);
  assert.equal(updated.data.sessionId, harness.state.sessionId);
  assert.equal(updated.data.restaurantId, harness.state.restaurantId);
  assert.equal(updated.data.tableNumber, harness.state.tableNumber);
  assert.equal(updated.data.tableTokenId, harness.state.tableTokenId);
  assert.equal(updated.data.cartRevision, 0);
  assert.equal(updated.data.createdAt, harness.state.createdAt);
});

test("global session sweep reclaims dependent cart and staff storage", async () => {
  let now = 1_800_000_000_000;
  const harness = await createHarness({
    now: () => now,
    ttlMs: 10,
    maximumSessions: 1,
    maximumCarts: 1,
    maximumStaffRequests: 1,
  });
  parseCartResponse(
    await addProduct(harness, {
      expectedRevision: 0,
      idempotencyKey: "cleanup_cart_001",
    })
  );
  const staffResult = await harness.staff.requestWaiter(
    harness.state.sessionId,
    { idempotencyKey: "cleanup_staff_001" }
  );
  assert.equal(staffResult.ok, true);
  now += 11;
  const replacement = await harness.store.createSession({
    language: "lt",
    tableContext: {
      restaurantId: "dzuku_ainiai",
      tableNumber: "6",
      tableTokenId: "qr_test_002",
    },
  });
  assert.equal(replacement.ok, true);
  assert.equal(await harness.store.getSession(harness.state.sessionId), null);
  assertError(
    await harness.cart.getCart(harness.state.sessionId),
    "session_not_found"
  );
  assertError(
    await harness.staff.requestWaiter(harness.state.sessionId, {
      idempotencyKey: "cleanup_staff_002",
    }),
    "session_not_found"
  );
});

test("explicit session deletion removes associated cart and staff records", async () => {
  const harness = await createHarness();
  parseCartResponse(
    await addProduct(harness, {
      expectedRevision: 0,
      idempotencyKey: "delete_cleanup_001",
    })
  );
  assert.equal(
    (
      await harness.staff.requestBill(harness.state.sessionId, {
        idempotencyKey: "delete_cleanup_002",
      })
    ).ok,
    true
  );
  assert.equal(await harness.store.deleteSession(harness.state.sessionId), true);
  assertError(
    await harness.cart.getCart(harness.state.sessionId),
    "session_not_found"
  );
  assertError(
    await harness.staff.requestBill(harness.state.sessionId, {
      idempotencyKey: "delete_cleanup_003",
    }),
    "session_not_found"
  );
});

test("staff requests require verified context, replay safely, and avoid duplicates", async () => {
  const harness = await createHarness();
  const first = await harness.registry.execute({
    sessionId: harness.state.sessionId,
    toolName: "request_waiter",
    input: { idempotencyKey: "waiter_request_001" },
  });
  if (!first.ok) throw new Error(first.error.message);
  const firstOutput = StaffRequestOutputSchema.parse(first.data);
  assert.equal(firstOutput.restaurantId, "dzuku_ainiai");
  assert.equal(firstOutput.tableNumber, "5");

  const replay = await harness.registry.execute({
    sessionId: harness.state.sessionId,
    toolName: "request_waiter",
    input: { idempotencyKey: "waiter_request_001" },
  });
  if (!replay.ok) throw new Error(replay.error.message);
  const replayOutput = StaffRequestOutputSchema.parse(replay.data);
  assert.equal(replayOutput.requestId, firstOutput.requestId);
  assert.equal(replayOutput.replayed, true);

  const duplicateDifferentKey = await harness.registry.execute({
    sessionId: harness.state.sessionId,
    toolName: "request_waiter",
    input: { idempotencyKey: "waiter_request_002" },
  });
  if (!duplicateDifferentKey.ok) {
    throw new Error(duplicateDifferentKey.error.message);
  }
  assert.equal(
    StaffRequestOutputSchema.parse(duplicateDifferentKey.data).requestId,
    firstOutput.requestId
  );

  const noTable = await createHarness({ tableContext: false });
  const anonymousDemo = await noTable.registry.execute({
    sessionId: noTable.state.sessionId,
    toolName: "request_bill",
    input: { idempotencyKey: "bill_request_001" },
  });
  assert.equal(anonymousDemo.ok, true);

  const partialContextStore = {
    getSession: async () => ({
      ...noTable.state,
      restaurantId: "dzuku_ainiai",
      tableNumber: null,
      tableTokenId: null,
    }),
  } as unknown as InMemoryConversationStateStore;
  const partial = await new InMemoryStaffTaskAdapter(
    partialContextStore
  ).requestWaiter(noTable.state.sessionId, {
    idempotencyKey: "partial_context_001",
  });
  assert.equal(partial.ok, false);
  if (!partial.ok) assert.equal(partial.error.code, "table_context_required");
});

test("staff idempotency conflicts and staff action rate limits are enforced", async () => {
  const harness = await createHarness({ staffActionLimit: 2 });
  const first = await harness.registry.execute({
    sessionId: harness.state.sessionId,
    toolName: "request_bill",
    input: { idempotencyKey: "bill_conflict_001", note: "Prašau" },
  });
  assert.equal(first.ok, true);
  assertError(
    await harness.registry.execute({
      sessionId: harness.state.sessionId,
      toolName: "request_bill",
      input: { idempotencyKey: "bill_conflict_001", note: "Kita pastaba" },
    }),
    "idempotency_conflict"
  );
  assertError(
    await harness.registry.execute({
      sessionId: harness.state.sessionId,
      toolName: "request_bill",
      input: { idempotencyKey: "bill_conflict_002" },
    }),
    "rate_limited"
  );
});

test("staff tasks expire independently and can be recreated while the session lives", async () => {
  let now = 1_800_000_000_000;
  const harness = await createHarness({
    now: () => now,
    ttlMs: 1_000,
    staffTaskTtlMs: 10,
  });
  const first = await harness.staff.requestWaiter(harness.state.sessionId, {
    idempotencyKey: "staff_expiry_001",
  });
  if (!first.ok) throw new Error(first.error.message);
  now += 11;
  const second = await harness.staff.requestWaiter(harness.state.sessionId, {
    idempotencyKey: "staff_expiry_002",
  });
  if (!second.ok) throw new Error(second.error.message);
  assert.notEqual(second.data.requestId, first.data.requestId);
  assert.equal(second.data.replayed, false);
});

test("general tool execution is rate limited by session", async () => {
  const harness = await createHarness({ sessionToolLimit: 1 });
  const first = await harness.registry.execute({
    sessionId: harness.state.sessionId,
    toolName: "view_cart",
    input: {},
  });
  assert.equal(first.ok, true);
  assertError(
    await harness.registry.execute({
      sessionId: harness.state.sessionId,
      toolName: "view_cart",
      input: {},
    }),
    "rate_limited"
  );
});

test("cart capacity returns a domain error at line 101", async () => {
  const harness = await createHarness();
  for (let index = 0; index < 100; index += 1) {
    const result = await addProduct(harness, {
      expectedRevision: index,
      idempotencyKey: `capacity_${index.toString().padStart(3, "0")}`,
    });
    assert.equal(result.ok, true);
  }
  assertError(
    await addProduct(harness, {
      expectedRevision: 100,
      idempotencyKey: "capacity_101",
    }),
    "cart_capacity_exceeded"
  );
});

test("signed table tokens verify expiry, tampering, and wrong secrets", () => {
  const now = () => 1_800_000_000_000;
  const secret = "a".repeat(64);
  const payload = {
    version: 1 as const,
    restaurantId: "dzuku_ainiai",
    tableNumber: "12-A",
    expiresAt: Math.floor(now() / 1_000) + 60,
    tokenId: "qr_signed_001",
  };
  const token = signTableToken(payload, secret);
  const verified = verifyTableToken(token, secret, now);
  assert.equal(verified.ok, true);
  if (verified.ok) assert.deepEqual(verified.payload, payload);
  assert.equal(verifyTableToken(`${token}x`, secret, now).ok, false);
  assert.equal(verifyTableToken(token, "b".repeat(64), now).ok, false);
  assert.equal(
    verifyTableToken(token, secret, () => now() + 61_000).ok,
    false
  );
});

test("development token helper is local-only and production secret fails closed", () => {
  const token = createDevelopmentTableToken(
    {
      restaurantId: "dzuku_ainiai",
      tableNumber: "7",
      tokenId: "qr_development_001",
    },
    () => 1_800_000_000_000
  );
  const secret = getTableTokenSecret("development");
  assert.notEqual(secret, null);
  if (secret) {
    assert.equal(
      verifyTableToken(token, secret, () => 1_800_000_000_000).ok,
      true
    );
  }
  const priorSecret = process.env.AI_WAITER_TABLE_TOKEN_SECRET;
  delete process.env.AI_WAITER_TABLE_TOKEN_SECRET;
  assert.equal(getTableTokenSecret("production"), null);
  if (priorSecret) process.env.AI_WAITER_TABLE_TOKEN_SECRET = priorSecret;
});

test("in-memory rate limiting expires windows and enforces capacity", async () => {
  let now = 1_800_000_000_000;
  const limiter = new InMemoryRateLimitAdapter({
    now: () => now,
    maximumBuckets: 1,
  });
  assert.equal(
    (await limiter.consume({ key: "one", limit: 1, windowMs: 10 })).allowed,
    true
  );
  assert.equal(
    (await limiter.consume({ key: "one", limit: 1, windowMs: 10 })).allowed,
    false
  );
  assert.equal(
    (await limiter.consume({ key: "two", limit: 1, windowMs: 10 })).allowed,
    false
  );
  now += 11;
  assert.equal(
    (await limiter.consume({ key: "two", limit: 1, windowMs: 10 })).allowed,
    true
  );
});

test("HTTP parser accepts exact JSON media type and rejects malformed input", async () => {
  const valid = await readLimitedJson(
    new Request("http://test", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: '{"ok":true}',
    }),
    100
  );
  assert.deepEqual(valid, { ok: true, value: { ok: true } });

  for (const [contentType, body, expectedCode] of [
    ["text/application/json", "{}", "unsupported_media_type"],
    ["application/json", "{", "invalid_json"],
    ["application/json", "", "invalid_json"],
  ] as const) {
    const result = await readLimitedJson(
      new Request("http://test", {
        method: "POST",
        headers: { "content-type": contentType },
        body,
      }),
      100
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, expectedCode);
  }
});

test("HTTP parser rejects declared and streamed oversized bodies early", async () => {
  const declared = await readLimitedJson(
    new Request("http://test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "1000",
      },
      body: "{}",
    }),
    8
  );
  assert.equal(declared.ok, false);
  if (!declared.ok) assert.equal(declared.code, "payload_too_large");

  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"value":"'));
      controller.enqueue(new TextEncoder().encode('far too large"}'));
    },
    cancel() {
      cancelled = true;
    },
  });
  const streamed = await readLimitedJson(
    new Request("http://test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" }),
    8
  );
  assert.equal(streamed.ok, false);
  if (!streamed.ok) assert.equal(streamed.code, "payload_too_large");
  assert.equal(cancelled, true);
});

test("route methods, signed session creation, and table override rejection", async () => {
  await resetDevelopmentRuntime();
  const token = createDevelopmentTableToken({
    restaurantId: "dzuku_ainiai",
    tableNumber: "12-A",
    tokenId: "qr_route_001",
  });
  const created = await sessionPost(
    jsonRequest("http://test/api/ai/session", {
      action: "create_table_session",
      language: "lt",
      tableToken: token,
    })
  );
  assert.equal(created.status, 201);
  assert.equal(created.headers.get("cache-control"), "no-store");
  const createdBody = (await created.json()) as {
    state: ConversationState;
  };
  assert.equal(createdBody.state.tableNumber, "12-A");
  assert.equal(createdBody.state.restaurantId, "dzuku_ainiai");

  const tampered = await sessionPost(
    jsonRequest("http://test/api/ai/session", {
      action: "create_table_session",
      language: "lt",
      tableToken: `${token}x`,
    })
  );
  assert.equal(tampered.status, 401);

  const override = await sessionPost(
    jsonRequest("http://test/api/ai/session", {
      action: "create_table_session",
      language: "lt",
      tableToken: token,
      tableNumber: "99",
    })
  );
  assert.equal(override.status, 400);
  const restored = await sessionPost(
    jsonRequest("http://test/api/ai/session", {
      action: "restore_session",
      sessionId: createdBody.state.sessionId,
    })
  );
  assert.equal(restored.status, 200);
  const restoredBody = (await restored.json()) as {
    state: ConversationState;
    cart: { lines: unknown[] };
    capabilities: { staffRequestsAvailable: boolean };
  };
  assert.equal(restoredBody.state.sessionId, createdBody.state.sessionId);
  assert.deepEqual(restoredBody.cart.lines, []);
  assert.equal(restoredBody.capabilities.staffRequestsAvailable, true);
  const invalidRestore = await sessionPost(
    jsonRequest("http://test/api/ai/session", {
      action: "restore_session",
      sessionId: "invalid",
    })
  );
  assert.equal(invalidRestore.status, 400);
  assert.equal(sessionGet().status, 405);
  assert.equal(sessionDelete().status, 405);
  assert.equal(
    sessionDelete().headers.get("allow"),
    "OPTIONS, POST"
  );
  assert.equal(sessionOptions().status, 204);
  assert.equal(toolsGet().status, 405);
});

test("route-level tool execution and malformed HTTP responses are structured", async () => {
  await resetDevelopmentRuntime();
  const session = await sessionPost(
    jsonRequest("http://test/api/ai/session", {
      action: "create_demo_session",
      language: "lt",
    })
  );
  const sessionBody = (await session.json()) as {
    state: ConversationState;
  };
  const unknown = await toolsPost(
    jsonRequest("http://test/api/ai/tools", {
      sessionId: sessionBody.state.sessionId,
      toolName: "run_arbitrary_code",
      input: {},
    })
  );
  assert.equal(unknown.status, 400);
  assert.equal(unknown.headers.get("cache-control"), "no-store");

  const wrongMedia = await sessionPost(
    jsonRequest(
      "http://test/api/ai/session",
      { action: "create_demo_session", language: "lt" },
      "text/application/json"
    )
  );
  assert.equal(wrongMedia.status, 415);
  const malformed = await sessionPost(
    new Request("http://test/api/ai/session", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.16",
      },
      body: "{",
    })
  );
  assert.equal(malformed.status, 400);
});

test("session route enforces charset JSON, empty, declared, and chunked body rules", async () => {
  await resetDevelopmentRuntime();
  const charset = await sessionPost(
    jsonRequest(
      "http://test/api/ai/session",
      { action: "create_demo_session", language: "lt" },
      "application/json; charset=utf-8"
    )
  );
  assert.equal(charset.status, 201);

  const empty = await sessionPost(
    new Request("http://test/api/ai/session", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.21",
      },
      body: "",
    })
  );
  assert.equal(empty.status, 400);

  const declared = await sessionPost(
    new Request("http://test/api/ai/session", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "9999",
        "x-forwarded-for": "203.0.113.22",
      },
      body: "{}",
    })
  );
  assert.equal(declared.status, 413);

  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(1_500));
      controller.enqueue(new Uint8Array(1_500));
    },
    cancel() {
      cancelled = true;
    },
  });
  const chunked = await sessionPost(
    new Request("http://test/api/ai/session", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.23",
      },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" })
  );
  assert.equal(chunked.status, 413);
  assert.equal(cancelled, true);
});

test("session creation route returns 429 after the development limit", async () => {
  await resetDevelopmentRuntime();
  let lastStatus = 0;
  for (let index = 0; index < 21; index += 1) {
    const response = await sessionPost(
      jsonRequest("http://test/api/ai/session", {
        action: "create_demo_session",
        language: "lt",
      })
    );
    lastStatus = response.status;
  }
  assert.equal(lastStatus, 429);
});

test("production guard returns an explicit 503 and cannot use memory", async () => {
  const environment = process.env as Record<string, string | undefined>;
  const previousNodeEnvironment = environment.NODE_ENV;
  const previousDemoOverride = environment.AI_WAITER_DEMO_ALLOW_IN_MEMORY;
  delete environment.AI_WAITER_DEMO_ALLOW_IN_MEMORY;
  assert.deepEqual(getAiWaiterRuntimeAvailability("production"), {
    available: false,
    code: "storage_not_configured",
    message:
      "AI waiter persistent storage and shared production adapters are not configured.",
  });
  assert.equal(isProductionInMemoryDemoOverride("production", "TRUE"), false);
  assert.equal(
    getAiWaiterRuntimeAvailability(
      "production",
      "sqlite",
      "TRUE"
    ).available,
    false
  );
  environment.NODE_ENV = "production";
  try {
    const response = await sessionPost(
      jsonRequest("http://test/api/ai/session", {
        action: "create_demo_session",
        language: "lt",
      })
    );
    assert.equal(response.status, 503);
    const body = (await response.json()) as {
      error: { code: string };
    };
    assert.equal(body.error.code, "storage_not_configured");
    const toolsResponse = await toolsPost(
      jsonRequest("http://test/api/ai/tools", {})
    );
    assert.equal(toolsResponse.status, 503);
  } finally {
    if (previousNodeEnvironment === undefined) delete environment.NODE_ENV;
    else environment.NODE_ENV = previousNodeEnvironment;
    if (previousDemoOverride === undefined) {
      delete environment.AI_WAITER_DEMO_ALLOW_IN_MEMORY;
    } else {
      environment.AI_WAITER_DEMO_ALLOW_IN_MEMORY = previousDemoOverride;
    }
  }
});

test("exact production demo override allows only non-persistent demo sessions", async () => {
  const environment = process.env as Record<string, string | undefined>;
  const previousNodeEnvironment = environment.NODE_ENV;
  const previousDemoOverride = environment.AI_WAITER_DEMO_ALLOW_IN_MEMORY;
  environment.NODE_ENV = "test";
  delete environment.AI_WAITER_DEMO_ALLOW_IN_MEMORY;
  await resetDevelopmentRuntime();

  const signedTable = await conversationStateStore.createSession({
    language: "lt",
    tableContext: {
      restaurantId: "dzuku_ainiai",
      tableNumber: "12-A",
      tableTokenId: "qr_demo_override_blocked",
    },
  });
  assert.equal(signedTable.ok, true);
  if (!signedTable.ok) return;

  environment.NODE_ENV = "production";
  environment.AI_WAITER_DEMO_ALLOW_IN_MEMORY = "true";
  try {
    assert.deepEqual(getAiWaiterRuntimeAvailability(), { available: true });
    assert.equal(isProductionInMemoryDemoOverride(), true);

    const tableCreation = await sessionPost(
      jsonRequest("http://test/api/ai/session", {
        action: "create_table_session",
        language: "lt",
        tableToken: "payload_payload.signature_signature",
      })
    );
    assert.equal(tableCreation.status, 401);

    const tableRestore = await sessionPost(
      jsonRequest("http://test/api/ai/session", {
        action: "restore_session",
        sessionId: signedTable.data.sessionId,
      })
    );
    assert.equal(tableRestore.status, 404);

    const demo = await sessionPost(
      jsonRequest("http://test/api/ai/session", {
        action: "create_demo_session",
        language: "lt",
      })
    );
    assert.equal(demo.status, 201);
    const demoBody = (await demo.json()) as {
      state: ConversationState;
      capabilities: {
        mode: string;
        staffRequestsAvailable: boolean;
        persistent: boolean;
      };
    };
    assert.deepEqual(demoBody.capabilities, {
      mode: "demo",
      staffRequestsAvailable: true,
      persistent: false,
    });

    const viewCart = await toolsPost(
      jsonRequest("http://test/api/ai/tools", {
        sessionId: demoBody.state.sessionId,
        toolName: "view_cart",
        input: {},
      })
    );
    assert.equal(viewCart.status, 200);

    for (const toolName of ["request_waiter", "request_bill"] as const) {
      const staffAction = await toolsPost(
        jsonRequest("http://test/api/ai/tools", {
          sessionId: demoBody.state.sessionId,
          toolName,
          input: { idempotencyKey: `demo_${toolName}_allowed` },
        })
      );
      assert.equal(staffAction.status, 200);
      const staffBody = (await staffAction.json()) as {
        ok: boolean;
        data: { tableNumber: string };
      };
      assert.equal(staffBody.ok, true);
      assert.equal(staffBody.data.tableNumber, "demo");
    }

    const tableTool = await toolsPost(
      jsonRequest("http://test/api/ai/tools", {
        sessionId: signedTable.data.sessionId,
        toolName: "view_cart",
        input: {},
      })
    );
    assert.equal(tableTool.status, 404);
  } finally {
    environment.NODE_ENV = "test";
    await resetDevelopmentRuntime();
    if (previousNodeEnvironment === undefined) delete environment.NODE_ENV;
    else environment.NODE_ENV = previousNodeEnvironment;
    if (previousDemoOverride === undefined) {
      delete environment.AI_WAITER_DEMO_ALLOW_IN_MEMORY;
    } else {
      environment.AI_WAITER_DEMO_ALLOW_IN_MEMORY = previousDemoOverride;
    }
  }
});
