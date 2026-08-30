import "server-only";

import { randomUUID } from "node:crypto";
import {
  CartSchema,
  type AddCartItemInput,
  type Cart,
  type ClearCartInput,
  type DiningSessionId,
  type ModifierSelection,
  type ProductDetails,
  type RemoveCartItemInput,
  type UpdateCartItemInput,
} from "../schemas.ts";
import type {
  ConversationStateStore,
  VerifiedTableContext,
} from "./conversationStateStore.ts";
import type { MenuRepository } from "./menuRepository.ts";
import {
  operationError,
  type SafeOperationResult,
} from "./operationResult.ts";
import { logStorageCapacityReached } from "./safeLogger.ts";
import {
  getAiWaiterBackend,
  type PostgresSql,
  type SqliteDatabase,
} from "./aiWaiterDb.ts";

const MAXIMUM_CART_LINES = 100;

interface StoredProductSnapshot {
  productId: string;
  name: string;
  category: string;
  officialUnitPriceCents: number;
  currency: "EUR";
  priceNote: string | null;
}

interface StoredCartLine {
  lineId: string;
  productId: string;
  product: StoredProductSnapshot;
  quantity: number;
  modifiers: ModifierSelection[];
  customerNote: string | null;
  requiresStaffConfirmation: boolean;
  lineRevision: number;
  createdAt: string;
  updatedAt: string;
}

interface StoredCart {
  sessionId: DiningSessionId;
  revision: number;
  lines: StoredCartLine[];
  totalCents: number;
  currency: "EUR";
  updatedAt: string;
}

interface CartRecord {
  cart: StoredCart;
  expiresAt: number;
}

interface IdempotencyRecord {
  fingerprint: string;
  operationId: string;
  affectedLineId: string;
  expiresAt: number;
}

export interface CartMutationData {
  cart: Cart;
  affectedLineId: string | null;
  operationId: string | null;
  replayed: boolean;
}

/**
 * Adapter guarantee:
 *
 * Every mutation implementation must atomically perform the expected-revision
 * compare-and-swap, idempotency decision, cart persistence, and conversation
 * cart-revision synchronization. A remote adapter must implement those actions
 * as one transaction or equivalent atomic operation.
 */
export interface CartPort {
  getCart(
    sessionId: DiningSessionId
  ): Promise<SafeOperationResult<CartMutationData>>;
  addCartItem(
    sessionId: DiningSessionId,
    command: AddCartItemInput
  ): Promise<SafeOperationResult<CartMutationData>>;
  updateCartItem(
    sessionId: DiningSessionId,
    command: UpdateCartItemInput
  ): Promise<SafeOperationResult<CartMutationData>>;
  removeCartItem(
    sessionId: DiningSessionId,
    command: RemoveCartItemInput
  ): Promise<SafeOperationResult<CartMutationData>>;
  clearCart(
    sessionId: DiningSessionId,
    command: ClearCartInput
  ): Promise<SafeOperationResult<CartMutationData>>;
  cleanupSession(sessionId: DiningSessionId): Promise<void>;
  sweepExpired(): Promise<number>;
  reset(): Promise<void>;
}

export interface StandaloneVaiseCartAdapterOptions {
  now?: () => number;
  createLineId?: () => string;
  createOperationId?: () => string;
  maximumCarts?: number;
  maximumIdempotencyRecords?: number;
  idempotencyTtlMs?: number;
}

const DEFAULT_MAXIMUM_CARTS = 10_000;
const DEFAULT_MAXIMUM_IDEMPOTENCY_RECORDS = 50_000;
const DEFAULT_IDEMPOTENCY_TTL_MS = 30 * 60 * 1_000;

function cloneStoredCart(cart: StoredCart): StoredCart {
  return structuredClone(cart);
}

function eurosFromCents(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

function centsFromEuros(euros: number): number | null {
  if (!Number.isFinite(euros) || euros <= 0) return null;
  const cents = Math.round(euros * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(euros * 100 - cents) > 1e-7) {
    return null;
  }
  return cents;
}

export class StandaloneVaiseCartAdapter implements CartPort {
  private readonly carts = new Map<DiningSessionId, CartRecord>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private readonly mutationTails = new Map<DiningSessionId, Promise<void>>();
  private readonly now: () => number;
  private readonly createLineId: () => string;
  private readonly createOperationId: () => string;
  private readonly maximumCarts: number;
  private readonly maximumIdempotencyRecords: number;
  private readonly idempotencyTtlMs: number;
  private readonly menuRepository: MenuRepository;
  private readonly conversationStore: ConversationStateStore;

  constructor(
    menuRepository: MenuRepository,
    conversationStore: ConversationStateStore,
    options: StandaloneVaiseCartAdapterOptions = {}
  ) {
    this.menuRepository = menuRepository;
    this.conversationStore = conversationStore;
    this.now = options.now ?? Date.now;
    this.createLineId =
      options.createLineId ??
      (() => `line_${randomUUID().replaceAll("-", "")}`);
    this.createOperationId =
      options.createOperationId ??
      (() => `op_${randomUUID().replaceAll("-", "")}`);
    this.maximumCarts = options.maximumCarts ?? DEFAULT_MAXIMUM_CARTS;
    this.maximumIdempotencyRecords =
      options.maximumIdempotencyRecords ??
      DEFAULT_MAXIMUM_IDEMPOTENCY_RECORDS;
    this.idempotencyTtlMs =
      options.idempotencyTtlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS;
  }

  async getCart(
    sessionId: DiningSessionId
  ): Promise<SafeOperationResult<CartMutationData>> {
    return this.withSessionLock(sessionId, async () => {
      const loaded = await this.loadCart(sessionId);
      if (!loaded.ok) return loaded;
      const reconciled = await this.reconcileCart(loaded.data.cart);
      if (!reconciled.ok) return reconciled;
      let cart = reconciled.data.cart;
      if (reconciled.data.changed) {
        cart = this.withNextRevision(cart, cart.lines);
        const saved = await this.persistCart(loaded.data.session.expiresAt, cart);
        if (!saved.ok) return saved;
      } else {
        this.refreshCartExpiry(sessionId, loaded.data.session.expiresAt);
      }
      return this.success(cart, null, null, false);
    });
  }

  async addCartItem(
    sessionId: DiningSessionId,
    command: AddCartItemInput
  ): Promise<SafeOperationResult<CartMutationData>> {
    return this.withSessionLock(sessionId, async () => {
      const loaded = await this.loadCart(sessionId);
      if (!loaded.ok) return loaded;
      const fingerprint = JSON.stringify(command);
      const scopedKey = `${sessionId}:add_to_cart:${command.idempotencyKey}`;
      const existing = this.idempotency.get(scopedKey);
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          return operationError(
            "idempotency_conflict",
            "The idempotency key was already used for different add-to-cart data."
          );
        }
        const reconciled = await this.reconcileCart(loaded.data.cart);
        if (!reconciled.ok) return reconciled;
        let current = reconciled.data.cart;
        if (reconciled.data.changed) {
          current = this.withNextRevision(current, current.lines);
          const saved = await this.persistCart(
            loaded.data.session.expiresAt,
            current
          );
          if (!saved.ok) return saved;
        }
        return this.success(
          current,
          existing.affectedLineId,
          existing.operationId,
          true
        );
      }

      const revisionError = this.checkRevision(
        loaded.data.cart,
        command.expectedRevision
      );
      if (revisionError) return revisionError;
      if (loaded.data.cart.lines.length >= MAXIMUM_CART_LINES) {
        return operationError(
          "cart_capacity_exceeded",
          `A cart cannot contain more than ${MAXIMUM_CART_LINES} lines.`
        );
      }
      if (this.idempotency.size >= this.maximumIdempotencyRecords) {
        logStorageCapacityReached(
          "cart_idempotency",
          this.maximumIdempotencyRecords
        );
        return operationError(
          "storage_capacity_exceeded",
          "Cart idempotency capacity has been reached."
        );
      }

      const reconciled = await this.reconcileCart(loaded.data.cart);
      if (!reconciled.ok) return reconciled;
      const product = await this.menuRepository.getProductDetails(command.productId);
      const productResult = this.validateOrderableProduct(product);
      if (!productResult.ok) return productResult;
      const modifiers = this.validateModifiers(
        productResult.data,
        command.modifiers
      );
      if (!modifiers.ok) return modifiers;

      const timestamp = new Date(this.now()).toISOString();
      const lineIdResult = this.createUniqueLineId(reconciled.data.cart);
      if (!lineIdResult.ok) return lineIdResult;
      const snapshot = this.toStoredSnapshot(productResult.data, modifiers.data);
      if (!snapshot.ok) return snapshot;
      const line: StoredCartLine = {
        lineId: lineIdResult.data,
        productId: productResult.data.productId,
        product: snapshot.data,
        quantity: command.quantity,
        modifiers: structuredClone(modifiers.data),
        customerNote: command.customerNote,
        requiresStaffConfirmation: command.customerNote !== null,
        lineRevision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const nextCart = this.withNextRevision(reconciled.data.cart, [
        ...reconciled.data.cart.lines,
        line,
      ]);
      const saved = await this.persistCart(
        loaded.data.session.expiresAt,
        nextCart
      );
      if (!saved.ok) return saved;

      const operationId = this.createOperationId();
      this.idempotency.set(scopedKey, {
        fingerprint,
        operationId,
        affectedLineId: line.lineId,
        expiresAt: Math.min(
          Date.parse(saved.data.expiresAt),
          this.now() + this.idempotencyTtlMs
        ),
      });
      return this.success(nextCart, line.lineId, operationId, false);
    });
  }

  async updateCartItem(
    sessionId: DiningSessionId,
    command: UpdateCartItemInput
  ): Promise<SafeOperationResult<CartMutationData>> {
    return this.withSessionLock(sessionId, async () => {
      const loaded = await this.loadCart(sessionId);
      if (!loaded.ok) return loaded;
      const revisionError = this.checkRevision(
        loaded.data.cart,
        command.expectedRevision
      );
      if (revisionError) return revisionError;

      const reconciled = await this.reconcileCart(loaded.data.cart);
      if (!reconciled.ok) return reconciled;
      const lineIndex = reconciled.data.cart.lines.findIndex(
        (line) => line.lineId === command.lineId
      );
      if (lineIndex < 0) {
        return operationError(
          "cart_line_not_found",
          "The requested cart line does not exist."
        );
      }
      const currentLine = reconciled.data.cart.lines[lineIndex];
      const product = await this.menuRepository.getProductDetails(
        currentLine.productId
      );
      const productResult = this.validateOrderableProduct(product);
      if (!productResult.ok) return productResult;
      const modifiers = this.validateModifiers(
        productResult.data,
        command.modifiers ?? currentLine.modifiers
      );
      if (!modifiers.ok) return modifiers;
      const snapshot = this.toStoredSnapshot(productResult.data, modifiers.data);
      if (!snapshot.ok) return snapshot;

      const customerNote =
        command.customerNote === undefined
          ? currentLine.customerNote
          : command.customerNote;
      const updatedLine: StoredCartLine = {
        ...currentLine,
        product: snapshot.data,
        quantity: command.quantity ?? currentLine.quantity,
        modifiers: structuredClone(modifiers.data),
        customerNote,
        requiresStaffConfirmation: customerNote !== null,
        lineRevision: currentLine.lineRevision + 1,
        updatedAt: new Date(this.now()).toISOString(),
      };
      const lines = [...reconciled.data.cart.lines];
      lines[lineIndex] = updatedLine;
      const nextCart = this.withNextRevision(reconciled.data.cart, lines);
      const saved = await this.persistCart(
        loaded.data.session.expiresAt,
        nextCart
      );
      if (!saved.ok) return saved;
      return this.success(nextCart, updatedLine.lineId, null, false);
    });
  }

  async removeCartItem(
    sessionId: DiningSessionId,
    command: RemoveCartItemInput
  ): Promise<SafeOperationResult<CartMutationData>> {
    return this.withSessionLock(sessionId, async () => {
      const loaded = await this.loadCart(sessionId);
      if (!loaded.ok) return loaded;
      const revisionError = this.checkRevision(
        loaded.data.cart,
        command.expectedRevision
      );
      if (revisionError) return revisionError;
      if (!loaded.data.cart.lines.some((line) => line.lineId === command.lineId)) {
        return operationError(
          "cart_line_not_found",
          "The requested cart line does not exist."
        );
      }

      const remaining = {
        ...loaded.data.cart,
        lines: loaded.data.cart.lines.filter(
          (line) => line.lineId !== command.lineId
        ),
      };
      const reconciled = await this.reconcileCart(remaining);
      if (!reconciled.ok) return reconciled;
      const nextCart = this.withNextRevision(
        loaded.data.cart,
        reconciled.data.cart.lines
      );
      const saved = await this.persistCart(
        loaded.data.session.expiresAt,
        nextCart
      );
      if (!saved.ok) return saved;
      return this.success(nextCart, command.lineId, null, false);
    });
  }

  async clearCart(
    sessionId: DiningSessionId,
    command: ClearCartInput
  ): Promise<SafeOperationResult<CartMutationData>> {
    return this.withSessionLock(sessionId, async () => {
      const loaded = await this.loadCart(sessionId);
      if (!loaded.ok) return loaded;
      const revisionError = this.checkRevision(
        loaded.data.cart,
        command.expectedRevision
      );
      if (revisionError) return revisionError;
      const nextCart = this.withNextRevision(loaded.data.cart, []);
      const saved = await this.persistCart(
        loaded.data.session.expiresAt,
        nextCart
      );
      if (!saved.ok) return saved;
      return this.success(nextCart, null, null, false);
    });
  }

  async cleanupSession(sessionId: DiningSessionId): Promise<void> {
    this.carts.delete(sessionId);
    for (const key of this.idempotency.keys()) {
      if (key.startsWith(`${sessionId}:`)) this.idempotency.delete(key);
    }
  }

  async sweepExpired(): Promise<number> {
    const now = this.now();
    let removed = 0;
    for (const [sessionId, record] of this.carts) {
      if (record.expiresAt <= now) {
        const session = await this.conversationStore.getSession(sessionId);
        if (session) {
          record.expiresAt = Date.parse(session.expiresAt);
        } else if (this.carts.delete(sessionId)) {
          removed += 1;
        }
      }
    }
    for (const [key, record] of this.idempotency) {
      if (record.expiresAt <= now) {
        this.idempotency.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  async reset(): Promise<void> {
    this.carts.clear();
    this.idempotency.clear();
    this.mutationTails.clear();
  }

  private async loadCart(
    sessionId: DiningSessionId
  ): Promise<
    SafeOperationResult<{
      cart: StoredCart;
      session: {
        expiresAt: string;
        tableContext: VerifiedTableContext | null;
      };
    }>
  > {
    await this.sweepExpired();
    const state = await this.conversationStore.getSession(sessionId);
    if (!state) {
      await this.cleanupSession(sessionId);
      return operationError(
        "session_not_found",
        "Dining session was not found or expired."
      );
    }
    const session = {
      expiresAt: state.expiresAt,
      tableContext:
        state.restaurantId && state.tableNumber && state.tableTokenId
          ? {
              restaurantId: state.restaurantId,
              tableNumber: state.tableNumber,
              tableTokenId: state.tableTokenId,
            }
          : null,
    };
    const existing = this.carts.get(sessionId);
    if (existing) {
      existing.expiresAt = Date.parse(state.expiresAt);
      return {
        ok: true,
        data: { cart: cloneStoredCart(existing.cart), session },
      };
    }
    if (this.carts.size >= this.maximumCarts) {
      logStorageCapacityReached("carts", this.maximumCarts);
      return operationError(
        "storage_capacity_exceeded",
        "Cart storage capacity has been reached."
      );
    }
    const timestamp = state.createdAt;
    const cart: StoredCart = {
      sessionId,
      revision: state.cartRevision,
      lines: [],
      totalCents: 0,
      currency: "EUR",
      updatedAt: timestamp,
    };
    this.carts.set(sessionId, {
      cart: cloneStoredCart(cart),
      expiresAt: Date.parse(state.expiresAt),
    });
    return { ok: true, data: { cart, session } };
  }

  private checkRevision(
    cart: StoredCart,
    expectedRevision: number
  ): SafeOperationResult<never> | null {
    return cart.revision === expectedRevision
      ? null
      : operationError(
          "revision_conflict",
          "Cart changed since it was last read. Reload the cart and retry."
        );
  }

  private withNextRevision(
    cart: StoredCart,
    lines: StoredCartLine[]
  ): StoredCart {
    const totalCents = lines.reduce(
      (total, line) =>
        total + line.product.officialUnitPriceCents * line.quantity,
      0
    );
    if (!Number.isSafeInteger(totalCents) || totalCents < 0) {
      throw new Error("Cart total exceeded the supported integer range.");
    }
    return {
      ...cart,
      lines: structuredClone(lines),
      revision: cart.revision + 1,
      totalCents,
      updatedAt: new Date(this.now()).toISOString(),
    };
  }

  private async persistCart(
    priorExpiresAt: string,
    cart: StoredCart
  ): Promise<
    SafeOperationResult<{ expiresAt: string }>
  > {
    const stateResult = await this.conversationStore.updateCartRevision(
      cart.sessionId,
      cart.revision
    );
    if (!stateResult.ok) {
      return operationError(
        stateResult.error.code,
        stateResult.error.message
      );
    }
    const expiresAt = stateResult.data.expiresAt || priorExpiresAt;
    this.carts.set(cart.sessionId, {
      cart: cloneStoredCart(cart),
      expiresAt: Date.parse(expiresAt),
    });
    return { ok: true, data: { expiresAt } };
  }

  private async reconcileCart(
    cart: StoredCart
  ): Promise<
    SafeOperationResult<{ cart: StoredCart; changed: boolean }>
  > {
    const lines: StoredCartLine[] = [];
    let changed = false;
    for (const line of cart.lines) {
      const product = await this.menuRepository.getProductDetails(line.productId);
      if (!product) {
        return operationError(
          "cart_reconciliation_failed",
          "A cart product no longer exists in the official menu."
        );
      }
      if (product.orderability.status !== "orderable") {
        return operationError(
          "cart_reconciliation_failed",
          product.orderability.status === "unavailable"
            ? "A cart product is no longer available."
            : "A cart product now requires an unconfigured variant selection."
        );
      }
      const modifiers = this.validateModifiers(product, line.modifiers);
      if (!modifiers.ok) {
        return operationError(
          "cart_reconciliation_failed",
          "A cart modifier is no longer supported by the official menu."
        );
      }
      const snapshot = this.toStoredSnapshot(product, modifiers.data);
      if (!snapshot.ok) {
        return operationError(
          "cart_reconciliation_failed",
          "A cart product no longer has a valid official price."
        );
      }
      const snapshotChanged =
        JSON.stringify(snapshot.data) !== JSON.stringify(line.product);
      changed ||= snapshotChanged;
      lines.push({
        ...line,
        product: snapshot.data,
        updatedAt: snapshotChanged
          ? new Date(this.now()).toISOString()
          : line.updatedAt,
        lineRevision: snapshotChanged
          ? line.lineRevision + 1
          : line.lineRevision,
      });
    }
    const totalCents = lines.reduce(
      (total, line) =>
        total + line.product.officialUnitPriceCents * line.quantity,
      0
    );
    changed ||= totalCents !== cart.totalCents;
    return {
      ok: true,
      data: {
        changed,
        cart: {
          ...cart,
          lines,
          totalCents,
        },
      },
    };
  }

  private validateOrderableProduct(
    product: ProductDetails | null
  ): SafeOperationResult<ProductDetails> {
    if (!product) {
      return operationError(
        "product_not_found",
        "Product does not exist in the official menu."
      );
    }
    if (product.orderability.status === "unavailable") {
      return operationError(
        "sold_out",
        "This product is currently sold out."
      );
    }
    if (product.orderability.status === "requires_variant") {
      return operationError(
        "required_variant_missing",
        "This product requires a variant choice that is not configured for safe ordering."
      );
    }
    if (centsFromEuros(product.officialUnitPrice) === null) {
      return operationError(
        "price_unavailable",
        "This product does not have a confirmed orderable price."
      );
    }
    return { ok: true, data: product };
  }

  private validateModifiers(
    product: ProductDetails,
    selections: ModifierSelection[]
  ): SafeOperationResult<ModifierSelection[]> {
    if (product.supportedModifiers.length === 0 && selections.length > 0) {
      return operationError(
        "unsupported_modifier",
        "This product has no confirmed supported modifiers. Ask staff to confirm the request."
      );
    }

    const seen = new Set<string>();
    const selectedOptions = new Set<string>();
    for (const selection of selections) {
      const key = `${selection.modifierId}:${selection.optionId}`;
      if (seen.has(key)) {
        return operationError(
          "unsupported_modifier",
          "Duplicate modifier selections are not supported."
        );
      }
      seen.add(key);
      selectedOptions.add(selection.optionId);
      const group = product.supportedModifiers.find(
        (modifier) => modifier.modifierId === selection.modifierId
      );
      const option = group?.options.find(
        (candidate) => candidate.optionId === selection.optionId
      );
      if (!group || !option) {
        return operationError(
          "unsupported_modifier",
          "The requested modifier is not supported by the official menu."
        );
      }
    }

    for (const group of product.supportedModifiers) {
      const groupSelections = selections.filter(
        (selection) => selection.modifierId === group.modifierId
      );
      if (
        groupSelections.length < group.minimumSelections ||
        groupSelections.length > group.maximumSelections
      ) {
        return operationError(
          "unsupported_modifier",
          "Modifier selection count does not match the official menu rules."
        );
      }
      for (const selection of groupSelections) {
        const option = group.options.find(
          (candidate) => candidate.optionId === selection.optionId
        );
        if (
          option?.incompatibleOptionIds.some((optionId) =>
            selectedOptions.has(optionId)
          )
        ) {
          return operationError(
            "unsupported_modifier",
            "The requested modifier combination is incompatible."
          );
        }
      }
    }
    return { ok: true, data: structuredClone(selections) };
  }

  private toStoredSnapshot(
    product: ProductDetails,
    selections: ModifierSelection[]
  ): SafeOperationResult<StoredProductSnapshot> {
    const basePriceCents = centsFromEuros(product.officialUnitPrice);
    if (basePriceCents === null) {
      return operationError(
        "price_unavailable",
        "This product does not have a confirmed orderable price."
      );
    }
    const modifierPriceCents = selections.reduce((total, selection) => {
      const group = product.supportedModifiers.find(
        (modifier) => modifier.modifierId === selection.modifierId
      );
      const option = group?.options.find(
        (candidate) => candidate.optionId === selection.optionId
      );
      return total + (option?.officialPriceDeltaCents ?? 0);
    }, 0);
    const officialUnitPriceCents = basePriceCents + modifierPriceCents;
    if (!Number.isSafeInteger(officialUnitPriceCents)) {
      return operationError(
        "price_unavailable",
        "This product price exceeds the supported range."
      );
    }
    return {
      ok: true,
      data: {
        productId: product.productId,
        name: product.name,
        category: product.category,
        officialUnitPriceCents,
        currency: "EUR",
        priceNote: product.priceNote,
      },
    };
  }

  private createUniqueLineId(
    cart: StoredCart
  ): SafeOperationResult<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const lineId = this.createLineId();
      if (!cart.lines.some((line) => line.lineId === lineId)) {
        return { ok: true, data: lineId };
      }
    }
    return operationError(
      "internal_error",
      "A unique cart-line identifier could not be created."
    );
  }

  private publicCart(cart: StoredCart): Cart {
    return CartSchema.parse({
      sessionId: cart.sessionId,
      revision: cart.revision,
      lines: cart.lines.map((line) => ({
        lineId: line.lineId,
        productId: line.productId,
        product: {
          productId: line.product.productId,
          name: line.product.name,
          category: line.product.category,
          officialUnitPrice: eurosFromCents(
            line.product.officialUnitPriceCents
          ),
          currency: line.product.currency,
          priceNote: line.product.priceNote,
        },
        quantity: line.quantity,
        modifiers: structuredClone(line.modifiers),
        customerNote: line.customerNote,
        requiresStaffConfirmation: line.requiresStaffConfirmation,
        lineRevision: line.lineRevision,
        createdAt: line.createdAt,
        updatedAt: line.updatedAt,
      })),
      total: eurosFromCents(cart.totalCents),
      currency: cart.currency,
      updatedAt: cart.updatedAt,
    });
  }

  private success(
    cart: StoredCart,
    affectedLineId: string | null,
    operationId: string | null,
    replayed: boolean
  ): SafeOperationResult<CartMutationData> {
    return {
      ok: true,
      data: {
        cart: this.publicCart(cart),
        affectedLineId,
        operationId,
        replayed,
      },
    };
  }

  private refreshCartExpiry(
    sessionId: DiningSessionId,
    expiresAt: string
  ): void {
    const record = this.carts.get(sessionId);
    if (record) record.expiresAt = Date.parse(expiresAt);
  }

  private async withSessionLock<T>(
    sessionId: DiningSessionId,
    operation: () => Promise<T>
  ): Promise<T> {
    const previous = this.mutationTails.get(sessionId) ?? Promise.resolve();
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.mutationTails.set(sessionId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.mutationTails.get(sessionId) === tail) {
        this.mutationTails.delete(sessionId);
      }
    }
  }
}

// ── Durable (Postgres / SQLite) ─────────────────────────────────────────────

const SWEEP_THROTTLE_MS = 5 * 60 * 1_000;
const SWEEP_BATCH_LIMIT = 500;

/**
 * Durable cart adapter. The within-process `mutationTails` lock still
 * serializes concurrent calls for the same session inside one instance (as
 * before); the cross-instance safety net is the compare-and-swap on write —
 * persistCart's UPDATE only applies `WHERE revision = <the revision this
 * mutation read>`, matching the atomic expected-revision guarantee already
 * documented on CartPort. A losing writer gets `revision_conflict`, same as
 * a client racing with a stale expectedRevision.
 */
abstract class DurableVaiseCartAdapter implements CartPort {
  private readonly mutationTails = new Map<DiningSessionId, Promise<void>>();
  private readonly now: () => number;
  private readonly createLineId: () => string;
  private readonly createOperationId: () => string;
  private readonly maximumCarts: number;
  private readonly maximumIdempotencyRecords: number;
  private readonly idempotencyTtlMs: number;
  private readonly menuRepository: MenuRepository;
  private readonly conversationStore: ConversationStateStore;
  private lastSweepAt = 0;

  constructor(
    menuRepository: MenuRepository,
    conversationStore: ConversationStateStore,
    options: StandaloneVaiseCartAdapterOptions = {}
  ) {
    this.menuRepository = menuRepository;
    this.conversationStore = conversationStore;
    this.now = options.now ?? Date.now;
    this.createLineId =
      options.createLineId ?? (() => `line_${randomUUID().replaceAll("-", "")}`);
    this.createOperationId =
      options.createOperationId ?? (() => `op_${randomUUID().replaceAll("-", "")}`);
    this.maximumCarts = options.maximumCarts ?? DEFAULT_MAXIMUM_CARTS;
    this.maximumIdempotencyRecords =
      options.maximumIdempotencyRecords ?? DEFAULT_MAXIMUM_IDEMPOTENCY_RECORDS;
    this.idempotencyTtlMs = options.idempotencyTtlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS;
  }

  protected abstract ensureSchema(): Promise<void>;
  protected abstract countCarts(): Promise<number>;
  protected abstract countIdempotency(): Promise<number>;
  protected abstract getCartRow(
    sessionId: DiningSessionId
  ): Promise<{ cart: StoredCart; expiresAtMs: number } | null>;
  protected abstract insertCartRow(
    cart: StoredCart,
    expiresAtMs: number
  ): Promise<void>;
  protected abstract casUpdateCartRow(
    cart: StoredCart,
    expiresAtMs: number,
    priorRevision: number
  ): Promise<boolean>;
  protected abstract touchCartExpiry(
    sessionId: DiningSessionId,
    expiresAtMs: number
  ): Promise<void>;
  protected abstract deleteCartRow(sessionId: DiningSessionId): Promise<void>;
  protected abstract getIdempotencyRow(
    scopedKey: string
  ): Promise<IdempotencyRecord | null>;
  protected abstract insertIdempotencyRow(
    scopedKey: string,
    sessionId: DiningSessionId,
    record: IdempotencyRecord
  ): Promise<void>;
  protected abstract deleteCartRowsForSession(
    sessionId: DiningSessionId
  ): Promise<void>;
  protected abstract deleteIdempotencyRowsForSession(
    sessionId: DiningSessionId
  ): Promise<void>;
  protected abstract expiredCartSessionIds(
    nowMs: number,
    limit: number
  ): Promise<DiningSessionId[]>;
  protected abstract expiredIdempotencyKeys(
    nowMs: number,
    limit: number
  ): Promise<string[]>;
  protected abstract deleteIdempotencyKeys(keys: string[]): Promise<void>;
  protected abstract clearAll(): Promise<void>;

  async getCart(
    sessionId: DiningSessionId
  ): Promise<SafeOperationResult<CartMutationData>> {
    await this.ensureSchema();
    return this.withSessionLock(sessionId, async () => {
      const loaded = await this.loadCart(sessionId);
      if (!loaded.ok) return loaded;
      const reconciled = await this.reconcileCart(loaded.data.cart);
      if (!reconciled.ok) return reconciled;
      let cart = reconciled.data.cart;
      if (reconciled.data.changed) {
        cart = this.withNextRevision(cart, cart.lines);
        const saved = await this.persistCart(loaded.data.session.expiresAt, cart);
        if (!saved.ok) return saved;
      } else {
        await this.touchCartExpiry(sessionId, Date.parse(loaded.data.session.expiresAt));
      }
      return this.success(cart, null, null, false);
    });
  }

  async addCartItem(
    sessionId: DiningSessionId,
    command: AddCartItemInput
  ): Promise<SafeOperationResult<CartMutationData>> {
    await this.ensureSchema();
    return this.withSessionLock(sessionId, async () => {
      const loaded = await this.loadCart(sessionId);
      if (!loaded.ok) return loaded;
      const fingerprint = JSON.stringify(command);
      const scopedKey = `${sessionId}:add_to_cart:${command.idempotencyKey}`;
      const existing = await this.getIdempotencyRow(scopedKey);
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          return operationError(
            "idempotency_conflict",
            "The idempotency key was already used for different add-to-cart data."
          );
        }
        const reconciled = await this.reconcileCart(loaded.data.cart);
        if (!reconciled.ok) return reconciled;
        let current = reconciled.data.cart;
        if (reconciled.data.changed) {
          current = this.withNextRevision(current, current.lines);
          const saved = await this.persistCart(loaded.data.session.expiresAt, current);
          if (!saved.ok) return saved;
        }
        return this.success(
          current,
          existing.affectedLineId,
          existing.operationId,
          true
        );
      }

      const revisionError = this.checkRevision(loaded.data.cart, command.expectedRevision);
      if (revisionError) return revisionError;
      if (loaded.data.cart.lines.length >= MAXIMUM_CART_LINES) {
        return operationError(
          "cart_capacity_exceeded",
          `A cart cannot contain more than ${MAXIMUM_CART_LINES} lines.`
        );
      }
      if ((await this.countIdempotency()) >= this.maximumIdempotencyRecords) {
        logStorageCapacityReached("cart_idempotency", this.maximumIdempotencyRecords);
        return operationError(
          "storage_capacity_exceeded",
          "Cart idempotency capacity has been reached."
        );
      }

      const reconciled = await this.reconcileCart(loaded.data.cart);
      if (!reconciled.ok) return reconciled;
      const product = await this.menuRepository.getProductDetails(command.productId);
      const productResult = this.validateOrderableProduct(product);
      if (!productResult.ok) return productResult;
      const modifiers = this.validateModifiers(productResult.data, command.modifiers);
      if (!modifiers.ok) return modifiers;

      const timestamp = new Date(this.now()).toISOString();
      const lineIdResult = this.createUniqueLineId(reconciled.data.cart);
      if (!lineIdResult.ok) return lineIdResult;
      const snapshot = this.toStoredSnapshot(productResult.data, modifiers.data);
      if (!snapshot.ok) return snapshot;
      const line: StoredCartLine = {
        lineId: lineIdResult.data,
        productId: productResult.data.productId,
        product: snapshot.data,
        quantity: command.quantity,
        modifiers: structuredClone(modifiers.data),
        customerNote: command.customerNote,
        requiresStaffConfirmation: command.customerNote !== null,
        lineRevision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const nextCart = this.withNextRevision(reconciled.data.cart, [
        ...reconciled.data.cart.lines,
        line,
      ]);
      const saved = await this.persistCart(loaded.data.session.expiresAt, nextCart);
      if (!saved.ok) return saved;

      const operationId = this.createOperationId();
      await this.insertIdempotencyRow(scopedKey, sessionId, {
        fingerprint,
        operationId,
        affectedLineId: line.lineId,
        expiresAt: Math.min(
          Date.parse(saved.data.expiresAt),
          this.now() + this.idempotencyTtlMs
        ),
      });
      return this.success(nextCart, line.lineId, operationId, false);
    });
  }

  async updateCartItem(
    sessionId: DiningSessionId,
    command: UpdateCartItemInput
  ): Promise<SafeOperationResult<CartMutationData>> {
    await this.ensureSchema();
    return this.withSessionLock(sessionId, async () => {
      const loaded = await this.loadCart(sessionId);
      if (!loaded.ok) return loaded;
      const revisionError = this.checkRevision(loaded.data.cart, command.expectedRevision);
      if (revisionError) return revisionError;

      const reconciled = await this.reconcileCart(loaded.data.cart);
      if (!reconciled.ok) return reconciled;
      const lineIndex = reconciled.data.cart.lines.findIndex(
        (line) => line.lineId === command.lineId
      );
      if (lineIndex < 0) {
        return operationError("cart_line_not_found", "The requested cart line does not exist.");
      }
      const currentLine = reconciled.data.cart.lines[lineIndex];
      const product = await this.menuRepository.getProductDetails(currentLine.productId);
      const productResult = this.validateOrderableProduct(product);
      if (!productResult.ok) return productResult;
      const modifiers = this.validateModifiers(
        productResult.data,
        command.modifiers ?? currentLine.modifiers
      );
      if (!modifiers.ok) return modifiers;
      const snapshot = this.toStoredSnapshot(productResult.data, modifiers.data);
      if (!snapshot.ok) return snapshot;

      const customerNote =
        command.customerNote === undefined ? currentLine.customerNote : command.customerNote;
      const updatedLine: StoredCartLine = {
        ...currentLine,
        product: snapshot.data,
        quantity: command.quantity ?? currentLine.quantity,
        modifiers: structuredClone(modifiers.data),
        customerNote,
        requiresStaffConfirmation: customerNote !== null,
        lineRevision: currentLine.lineRevision + 1,
        updatedAt: new Date(this.now()).toISOString(),
      };
      const lines = [...reconciled.data.cart.lines];
      lines[lineIndex] = updatedLine;
      const nextCart = this.withNextRevision(reconciled.data.cart, lines);
      const saved = await this.persistCart(loaded.data.session.expiresAt, nextCart);
      if (!saved.ok) return saved;
      return this.success(nextCart, updatedLine.lineId, null, false);
    });
  }

  async removeCartItem(
    sessionId: DiningSessionId,
    command: RemoveCartItemInput
  ): Promise<SafeOperationResult<CartMutationData>> {
    await this.ensureSchema();
    return this.withSessionLock(sessionId, async () => {
      const loaded = await this.loadCart(sessionId);
      if (!loaded.ok) return loaded;
      const revisionError = this.checkRevision(loaded.data.cart, command.expectedRevision);
      if (revisionError) return revisionError;
      if (!loaded.data.cart.lines.some((line) => line.lineId === command.lineId)) {
        return operationError("cart_line_not_found", "The requested cart line does not exist.");
      }

      const remaining = {
        ...loaded.data.cart,
        lines: loaded.data.cart.lines.filter((line) => line.lineId !== command.lineId),
      };
      const reconciled = await this.reconcileCart(remaining);
      if (!reconciled.ok) return reconciled;
      const nextCart = this.withNextRevision(loaded.data.cart, reconciled.data.cart.lines);
      const saved = await this.persistCart(loaded.data.session.expiresAt, nextCart);
      if (!saved.ok) return saved;
      return this.success(nextCart, command.lineId, null, false);
    });
  }

  async clearCart(
    sessionId: DiningSessionId,
    command: ClearCartInput
  ): Promise<SafeOperationResult<CartMutationData>> {
    await this.ensureSchema();
    return this.withSessionLock(sessionId, async () => {
      const loaded = await this.loadCart(sessionId);
      if (!loaded.ok) return loaded;
      const revisionError = this.checkRevision(loaded.data.cart, command.expectedRevision);
      if (revisionError) return revisionError;
      const nextCart = this.withNextRevision(loaded.data.cart, []);
      const saved = await this.persistCart(loaded.data.session.expiresAt, nextCart);
      if (!saved.ok) return saved;
      return this.success(nextCart, null, null, false);
    });
  }

  async cleanupSession(sessionId: DiningSessionId): Promise<void> {
    await this.ensureSchema();
    await this.deleteCartRowsForSession(sessionId);
    await this.deleteIdempotencyRowsForSession(sessionId);
  }

  async sweepExpired(): Promise<number> {
    await this.ensureSchema();
    const now = this.now();
    let removed = 0;
    const expiredSessionIds = await this.expiredCartSessionIds(now, SWEEP_BATCH_LIMIT);
    for (const sessionId of expiredSessionIds) {
      const session = await this.conversationStore.getSession(sessionId);
      if (session) {
        await this.touchCartExpiry(sessionId, Date.parse(session.expiresAt));
      } else {
        await this.deleteCartRow(sessionId);
        removed += 1;
      }
    }
    const expiredKeys = await this.expiredIdempotencyKeys(now, SWEEP_BATCH_LIMIT);
    if (expiredKeys.length > 0) {
      await this.deleteIdempotencyKeys(expiredKeys);
      removed += expiredKeys.length;
    }
    return removed;
  }

  async reset(): Promise<void> {
    await this.ensureSchema();
    await this.clearAll();
    this.mutationTails.clear();
  }

  private async maybeSweep(): Promise<void> {
    const now = this.now();
    if (now - this.lastSweepAt < SWEEP_THROTTLE_MS) return;
    this.lastSweepAt = now;
    await this.sweepExpired();
  }

  private async loadCart(
    sessionId: DiningSessionId
  ): Promise<
    SafeOperationResult<{
      cart: StoredCart;
      session: { expiresAt: string; tableContext: VerifiedTableContext | null };
    }>
  > {
    await this.maybeSweep();
    const state = await this.conversationStore.getSession(sessionId);
    if (!state) {
      await this.cleanupSession(sessionId);
      return operationError("session_not_found", "Dining session was not found or expired.");
    }
    const session = {
      expiresAt: state.expiresAt,
      tableContext:
        state.restaurantId && state.tableNumber && state.tableTokenId
          ? {
              restaurantId: state.restaurantId,
              tableNumber: state.tableNumber,
              tableTokenId: state.tableTokenId,
            }
          : null,
    };
    const existing = await this.getCartRow(sessionId);
    if (existing) {
      await this.touchCartExpiry(sessionId, Date.parse(state.expiresAt));
      return { ok: true, data: { cart: cloneStoredCart(existing.cart), session } };
    }
    if ((await this.countCarts()) >= this.maximumCarts) {
      logStorageCapacityReached("carts", this.maximumCarts);
      return operationError("storage_capacity_exceeded", "Cart storage capacity has been reached.");
    }
    const timestamp = state.createdAt;
    const cart: StoredCart = {
      sessionId,
      revision: state.cartRevision,
      lines: [],
      totalCents: 0,
      currency: "EUR",
      updatedAt: timestamp,
    };
    await this.insertCartRow(cart, Date.parse(state.expiresAt));
    return { ok: true, data: { cart, session } };
  }

  private checkRevision(
    cart: StoredCart,
    expectedRevision: number
  ): SafeOperationResult<never> | null {
    return cart.revision === expectedRevision
      ? null
      : operationError(
          "revision_conflict",
          "Cart changed since it was last read. Reload the cart and retry."
        );
  }

  private withNextRevision(cart: StoredCart, lines: StoredCartLine[]): StoredCart {
    const totalCents = lines.reduce(
      (total, line) => total + line.product.officialUnitPriceCents * line.quantity,
      0
    );
    if (!Number.isSafeInteger(totalCents) || totalCents < 0) {
      throw new Error("Cart total exceeded the supported integer range.");
    }
    return {
      ...cart,
      lines: structuredClone(lines),
      revision: cart.revision + 1,
      totalCents,
      updatedAt: new Date(this.now()).toISOString(),
    };
  }

  private async persistCart(
    priorExpiresAt: string,
    cart: StoredCart
  ): Promise<SafeOperationResult<{ expiresAt: string }>> {
    const stateResult = await this.conversationStore.updateCartRevision(
      cart.sessionId,
      cart.revision
    );
    if (!stateResult.ok) {
      return operationError(stateResult.error.code, stateResult.error.message);
    }
    const expiresAt = stateResult.data.expiresAt || priorExpiresAt;
    const applied = await this.casUpdateCartRow(
      cart,
      Date.parse(expiresAt),
      cart.revision - 1
    );
    if (!applied) {
      return operationError(
        "revision_conflict",
        "Cart changed since it was last read. Reload the cart and retry."
      );
    }
    return { ok: true, data: { expiresAt } };
  }

  private async reconcileCart(
    cart: StoredCart
  ): Promise<SafeOperationResult<{ cart: StoredCart; changed: boolean }>> {
    const lines: StoredCartLine[] = [];
    let changed = false;
    for (const line of cart.lines) {
      const product = await this.menuRepository.getProductDetails(line.productId);
      if (!product) {
        return operationError(
          "cart_reconciliation_failed",
          "A cart product no longer exists in the official menu."
        );
      }
      if (product.orderability.status !== "orderable") {
        return operationError(
          "cart_reconciliation_failed",
          product.orderability.status === "unavailable"
            ? "A cart product is no longer available."
            : "A cart product now requires an unconfigured variant selection."
        );
      }
      const modifiers = this.validateModifiers(product, line.modifiers);
      if (!modifiers.ok) {
        return operationError(
          "cart_reconciliation_failed",
          "A cart modifier is no longer supported by the official menu."
        );
      }
      const snapshot = this.toStoredSnapshot(product, modifiers.data);
      if (!snapshot.ok) {
        return operationError(
          "cart_reconciliation_failed",
          "A cart product no longer has a valid official price."
        );
      }
      const snapshotChanged = JSON.stringify(snapshot.data) !== JSON.stringify(line.product);
      changed ||= snapshotChanged;
      lines.push({
        ...line,
        product: snapshot.data,
        updatedAt: snapshotChanged ? new Date(this.now()).toISOString() : line.updatedAt,
        lineRevision: snapshotChanged ? line.lineRevision + 1 : line.lineRevision,
      });
    }
    const totalCents = lines.reduce(
      (total, line) => total + line.product.officialUnitPriceCents * line.quantity,
      0
    );
    changed ||= totalCents !== cart.totalCents;
    return { ok: true, data: { changed, cart: { ...cart, lines, totalCents } } };
  }

  private validateOrderableProduct(
    product: ProductDetails | null
  ): SafeOperationResult<ProductDetails> {
    if (!product) {
      return operationError("product_not_found", "Product does not exist in the official menu.");
    }
    if (product.orderability.status === "unavailable") {
      return operationError("sold_out", "This product is currently sold out.");
    }
    if (product.orderability.status === "requires_variant") {
      return operationError(
        "required_variant_missing",
        "This product requires a variant choice that is not configured for safe ordering."
      );
    }
    if (centsFromEuros(product.officialUnitPrice) === null) {
      return operationError("price_unavailable", "This product does not have a confirmed orderable price.");
    }
    return { ok: true, data: product };
  }

  private validateModifiers(
    product: ProductDetails,
    selections: ModifierSelection[]
  ): SafeOperationResult<ModifierSelection[]> {
    if (product.supportedModifiers.length === 0 && selections.length > 0) {
      return operationError(
        "unsupported_modifier",
        "This product has no confirmed supported modifiers. Ask staff to confirm the request."
      );
    }

    const seen = new Set<string>();
    const selectedOptions = new Set<string>();
    for (const selection of selections) {
      const key = `${selection.modifierId}:${selection.optionId}`;
      if (seen.has(key)) {
        return operationError("unsupported_modifier", "Duplicate modifier selections are not supported.");
      }
      seen.add(key);
      selectedOptions.add(selection.optionId);
      const group = product.supportedModifiers.find(
        (modifier) => modifier.modifierId === selection.modifierId
      );
      const option = group?.options.find((candidate) => candidate.optionId === selection.optionId);
      if (!group || !option) {
        return operationError(
          "unsupported_modifier",
          "The requested modifier is not supported by the official menu."
        );
      }
    }

    for (const group of product.supportedModifiers) {
      const groupSelections = selections.filter(
        (selection) => selection.modifierId === group.modifierId
      );
      if (
        groupSelections.length < group.minimumSelections ||
        groupSelections.length > group.maximumSelections
      ) {
        return operationError(
          "unsupported_modifier",
          "Modifier selection count does not match the official menu rules."
        );
      }
      for (const selection of groupSelections) {
        const option = group.options.find((candidate) => candidate.optionId === selection.optionId);
        if (option?.incompatibleOptionIds.some((optionId) => selectedOptions.has(optionId))) {
          return operationError("unsupported_modifier", "The requested modifier combination is incompatible.");
        }
      }
    }
    return { ok: true, data: structuredClone(selections) };
  }

  private toStoredSnapshot(
    product: ProductDetails,
    selections: ModifierSelection[]
  ): SafeOperationResult<StoredProductSnapshot> {
    const basePriceCents = centsFromEuros(product.officialUnitPrice);
    if (basePriceCents === null) {
      return operationError("price_unavailable", "This product does not have a confirmed orderable price.");
    }
    const modifierPriceCents = selections.reduce((total, selection) => {
      const group = product.supportedModifiers.find(
        (modifier) => modifier.modifierId === selection.modifierId
      );
      const option = group?.options.find((candidate) => candidate.optionId === selection.optionId);
      return total + (option?.officialPriceDeltaCents ?? 0);
    }, 0);
    const officialUnitPriceCents = basePriceCents + modifierPriceCents;
    if (!Number.isSafeInteger(officialUnitPriceCents)) {
      return operationError("price_unavailable", "This product price exceeds the supported range.");
    }
    return {
      ok: true,
      data: {
        productId: product.productId,
        name: product.name,
        category: product.category,
        officialUnitPriceCents,
        currency: "EUR",
        priceNote: product.priceNote,
      },
    };
  }

  private createUniqueLineId(cart: StoredCart): SafeOperationResult<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const lineId = this.createLineId();
      if (!cart.lines.some((line) => line.lineId === lineId)) {
        return { ok: true, data: lineId };
      }
    }
    return operationError("internal_error", "A unique cart-line identifier could not be created.");
  }

  private publicCart(cart: StoredCart): Cart {
    return CartSchema.parse({
      sessionId: cart.sessionId,
      revision: cart.revision,
      lines: cart.lines.map((line) => ({
        lineId: line.lineId,
        productId: line.productId,
        product: {
          productId: line.product.productId,
          name: line.product.name,
          category: line.product.category,
          officialUnitPrice: eurosFromCents(line.product.officialUnitPriceCents),
          currency: line.product.currency,
          priceNote: line.product.priceNote,
        },
        quantity: line.quantity,
        modifiers: structuredClone(line.modifiers),
        customerNote: line.customerNote,
        requiresStaffConfirmation: line.requiresStaffConfirmation,
        lineRevision: line.lineRevision,
        createdAt: line.createdAt,
        updatedAt: line.updatedAt,
      })),
      total: eurosFromCents(cart.totalCents),
      currency: cart.currency,
      updatedAt: cart.updatedAt,
    });
  }

  private success(
    cart: StoredCart,
    affectedLineId: string | null,
    operationId: string | null,
    replayed: boolean
  ): SafeOperationResult<CartMutationData> {
    return {
      ok: true,
      data: { cart: this.publicCart(cart), affectedLineId, operationId, replayed },
    };
  }

  private async withSessionLock<T>(
    sessionId: DiningSessionId,
    operation: () => Promise<T>
  ): Promise<T> {
    const previous = this.mutationTails.get(sessionId) ?? Promise.resolve();
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.mutationTails.set(sessionId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.mutationTails.get(sessionId) === tail) {
        this.mutationTails.delete(sessionId);
      }
    }
  }
}

class PostgresVaiseCartAdapter extends DurableVaiseCartAdapter {
  private readonly sql: PostgresSql;
  private ready: Promise<void> | undefined;

  constructor(
    sql: PostgresSql,
    menuRepository: MenuRepository,
    conversationStore: ConversationStateStore,
    options: StandaloneVaiseCartAdapterOptions = {}
  ) {
    super(menuRepository, conversationStore, options);
    this.sql = sql;
  }

  protected ensureSchema(): Promise<void> {
    this.ready ??= (async () => {
      await this.sql`
        CREATE TABLE IF NOT EXISTS ai_waiter_carts (
          session_id TEXT PRIMARY KEY,
          revision INTEGER NOT NULL,
          cart_data TEXT NOT NULL,
          expires_at BIGINT NOT NULL
        )`;
      await this.sql`
        CREATE INDEX IF NOT EXISTS ai_waiter_carts_expires ON ai_waiter_carts (expires_at)`;
      await this.sql`
        CREATE TABLE IF NOT EXISTS ai_waiter_cart_idempotency (
          scoped_key TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          fingerprint TEXT NOT NULL,
          operation_id TEXT NOT NULL,
          affected_line_id TEXT NOT NULL,
          expires_at BIGINT NOT NULL
        )`;
      await this.sql`
        CREATE INDEX IF NOT EXISTS ai_waiter_cart_idempotency_session
        ON ai_waiter_cart_idempotency (session_id)`;
      await this.sql`
        CREATE INDEX IF NOT EXISTS ai_waiter_cart_idempotency_expires
        ON ai_waiter_cart_idempotency (expires_at)`;
    })();
    return this.ready;
  }

  protected async countCarts(): Promise<number> {
    const rows = (await this.sql`SELECT COUNT(*)::int AS count FROM ai_waiter_carts`) as Array<{
      count: number;
    }>;
    return rows[0]?.count ?? 0;
  }

  protected async countIdempotency(): Promise<number> {
    const rows = (await this
      .sql`SELECT COUNT(*)::int AS count FROM ai_waiter_cart_idempotency`) as Array<{
      count: number;
    }>;
    return rows[0]?.count ?? 0;
  }

  protected async getCartRow(
    sessionId: DiningSessionId
  ): Promise<{ cart: StoredCart; expiresAtMs: number } | null> {
    const rows = (await this.sql`
      SELECT cart_data, expires_at FROM ai_waiter_carts WHERE session_id = ${sessionId}`) as Array<{
      cart_data: string;
      expires_at: string | number;
    }>;
    const row = rows[0];
    if (!row) return null;
    return { cart: JSON.parse(row.cart_data), expiresAtMs: Number(row.expires_at) };
  }

  protected async insertCartRow(cart: StoredCart, expiresAtMs: number): Promise<void> {
    await this.sql`
      INSERT INTO ai_waiter_carts (session_id, revision, cart_data, expires_at)
      VALUES (${cart.sessionId}, ${cart.revision}, ${JSON.stringify(cart)}, ${expiresAtMs})
      ON CONFLICT (session_id) DO NOTHING`;
  }

  protected async casUpdateCartRow(
    cart: StoredCart,
    expiresAtMs: number,
    priorRevision: number
  ): Promise<boolean> {
    const rows = (await this.sql`
      UPDATE ai_waiter_carts
      SET revision = ${cart.revision}, cart_data = ${JSON.stringify(cart)}, expires_at = ${expiresAtMs}
      WHERE session_id = ${cart.sessionId} AND revision = ${priorRevision}
      RETURNING session_id`) as unknown[];
    return rows.length > 0;
  }

  protected async touchCartExpiry(sessionId: DiningSessionId, expiresAtMs: number): Promise<void> {
    await this.sql`
      UPDATE ai_waiter_carts SET expires_at = ${expiresAtMs} WHERE session_id = ${sessionId}`;
  }

  protected async deleteCartRow(sessionId: DiningSessionId): Promise<void> {
    await this.sql`DELETE FROM ai_waiter_carts WHERE session_id = ${sessionId}`;
  }

  protected async getIdempotencyRow(scopedKey: string): Promise<IdempotencyRecord | null> {
    const rows = (await this.sql`
      SELECT fingerprint, operation_id, affected_line_id, expires_at
      FROM ai_waiter_cart_idempotency WHERE scoped_key = ${scopedKey}`) as Array<{
      fingerprint: string;
      operation_id: string;
      affected_line_id: string;
      expires_at: string | number;
    }>;
    const row = rows[0];
    if (!row) return null;
    return {
      fingerprint: row.fingerprint,
      operationId: row.operation_id,
      affectedLineId: row.affected_line_id,
      expiresAt: Number(row.expires_at),
    };
  }

  protected async insertIdempotencyRow(
    scopedKey: string,
    sessionId: DiningSessionId,
    record: IdempotencyRecord
  ): Promise<void> {
    await this.sql`
      INSERT INTO ai_waiter_cart_idempotency
        (scoped_key, session_id, fingerprint, operation_id, affected_line_id, expires_at)
      VALUES (${scopedKey}, ${sessionId}, ${record.fingerprint}, ${record.operationId},
              ${record.affectedLineId}, ${record.expiresAt})
      ON CONFLICT (scoped_key) DO UPDATE SET
        fingerprint = EXCLUDED.fingerprint, operation_id = EXCLUDED.operation_id,
        affected_line_id = EXCLUDED.affected_line_id, expires_at = EXCLUDED.expires_at`;
  }

  protected async deleteCartRowsForSession(sessionId: DiningSessionId): Promise<void> {
    await this.sql`DELETE FROM ai_waiter_carts WHERE session_id = ${sessionId}`;
  }

  protected async deleteIdempotencyRowsForSession(sessionId: DiningSessionId): Promise<void> {
    await this.sql`DELETE FROM ai_waiter_cart_idempotency WHERE session_id = ${sessionId}`;
  }

  protected async expiredCartSessionIds(nowMs: number, limit: number): Promise<DiningSessionId[]> {
    const rows = (await this.sql`
      SELECT session_id FROM ai_waiter_carts WHERE expires_at <= ${nowMs} LIMIT ${limit}`) as Array<{
      session_id: DiningSessionId;
    }>;
    return rows.map((row) => row.session_id);
  }

  protected async expiredIdempotencyKeys(nowMs: number, limit: number): Promise<string[]> {
    const rows = (await this.sql`
      SELECT scoped_key FROM ai_waiter_cart_idempotency
      WHERE expires_at <= ${nowMs} LIMIT ${limit}`) as Array<{ scoped_key: string }>;
    return rows.map((row) => row.scoped_key);
  }

  protected async deleteIdempotencyKeys(keys: string[]): Promise<void> {
    await this.sql`DELETE FROM ai_waiter_cart_idempotency WHERE scoped_key = ANY(${keys})`;
  }

  protected async clearAll(): Promise<void> {
    await this.sql`DELETE FROM ai_waiter_carts`;
    await this.sql`DELETE FROM ai_waiter_cart_idempotency`;
  }
}

class SqliteVaiseCartAdapter extends DurableVaiseCartAdapter {
  private readonly db: SqliteDatabase;
  private schemaReady = false;

  constructor(
    db: SqliteDatabase,
    menuRepository: MenuRepository,
    conversationStore: ConversationStateStore,
    options: StandaloneVaiseCartAdapterOptions = {}
  ) {
    super(menuRepository, conversationStore, options);
    this.db = db;
  }

  protected async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ai_waiter_carts (
        session_id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        cart_data TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ai_waiter_carts_expires ON ai_waiter_carts (expires_at);
      CREATE TABLE IF NOT EXISTS ai_waiter_cart_idempotency (
        scoped_key TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        affected_line_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ai_waiter_cart_idempotency_session
      ON ai_waiter_cart_idempotency (session_id);
      CREATE INDEX IF NOT EXISTS ai_waiter_cart_idempotency_expires
      ON ai_waiter_cart_idempotency (expires_at);
    `);
    this.schemaReady = true;
  }

  protected async countCarts(): Promise<number> {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM ai_waiter_carts").get() as {
      count: number;
    };
    return row.count;
  }

  protected async countIdempotency(): Promise<number> {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM ai_waiter_cart_idempotency")
      .get() as { count: number };
    return row.count;
  }

  protected async getCartRow(
    sessionId: DiningSessionId
  ): Promise<{ cart: StoredCart; expiresAtMs: number } | null> {
    const row = this.db
      .prepare("SELECT cart_data, expires_at FROM ai_waiter_carts WHERE session_id = ?")
      .get(sessionId) as { cart_data: string; expires_at: number } | undefined;
    if (!row) return null;
    return { cart: JSON.parse(row.cart_data), expiresAtMs: row.expires_at };
  }

  protected async insertCartRow(cart: StoredCart, expiresAtMs: number): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO ai_waiter_carts (session_id, revision, cart_data, expires_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (session_id) DO NOTHING`
      )
      .run(cart.sessionId, cart.revision, JSON.stringify(cart), expiresAtMs);
  }

  protected async casUpdateCartRow(
    cart: StoredCart,
    expiresAtMs: number,
    priorRevision: number
  ): Promise<boolean> {
    const result = this.db
      .prepare(
        `UPDATE ai_waiter_carts SET revision = ?, cart_data = ?, expires_at = ?
         WHERE session_id = ? AND revision = ?`
      )
      .run(cart.revision, JSON.stringify(cart), expiresAtMs, cart.sessionId, priorRevision);
    return result.changes > 0;
  }

  protected async touchCartExpiry(sessionId: DiningSessionId, expiresAtMs: number): Promise<void> {
    this.db
      .prepare("UPDATE ai_waiter_carts SET expires_at = ? WHERE session_id = ?")
      .run(expiresAtMs, sessionId);
  }

  protected async deleteCartRow(sessionId: DiningSessionId): Promise<void> {
    this.db.prepare("DELETE FROM ai_waiter_carts WHERE session_id = ?").run(sessionId);
  }

  protected async getIdempotencyRow(scopedKey: string): Promise<IdempotencyRecord | null> {
    const row = this.db
      .prepare(
        `SELECT fingerprint, operation_id, affected_line_id, expires_at
         FROM ai_waiter_cart_idempotency WHERE scoped_key = ?`
      )
      .get(scopedKey) as
      | {
          fingerprint: string;
          operation_id: string;
          affected_line_id: string;
          expires_at: number;
        }
      | undefined;
    if (!row) return null;
    return {
      fingerprint: row.fingerprint,
      operationId: row.operation_id,
      affectedLineId: row.affected_line_id,
      expiresAt: row.expires_at,
    };
  }

  protected async insertIdempotencyRow(
    scopedKey: string,
    sessionId: DiningSessionId,
    record: IdempotencyRecord
  ): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO ai_waiter_cart_idempotency
           (scoped_key, session_id, fingerprint, operation_id, affected_line_id, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (scoped_key) DO UPDATE SET
           fingerprint = excluded.fingerprint, operation_id = excluded.operation_id,
           affected_line_id = excluded.affected_line_id, expires_at = excluded.expires_at`
      )
      .run(
        scopedKey,
        sessionId,
        record.fingerprint,
        record.operationId,
        record.affectedLineId,
        record.expiresAt
      );
  }

  protected async deleteCartRowsForSession(sessionId: DiningSessionId): Promise<void> {
    this.db.prepare("DELETE FROM ai_waiter_carts WHERE session_id = ?").run(sessionId);
  }

  protected async deleteIdempotencyRowsForSession(sessionId: DiningSessionId): Promise<void> {
    this.db
      .prepare("DELETE FROM ai_waiter_cart_idempotency WHERE session_id = ?")
      .run(sessionId);
  }

  protected async expiredCartSessionIds(nowMs: number, limit: number): Promise<DiningSessionId[]> {
    const rows = this.db
      .prepare("SELECT session_id FROM ai_waiter_carts WHERE expires_at <= ? LIMIT ?")
      .all(nowMs, limit) as Array<{ session_id: DiningSessionId }>;
    return rows.map((row) => row.session_id);
  }

  protected async expiredIdempotencyKeys(nowMs: number, limit: number): Promise<string[]> {
    const rows = this.db
      .prepare("SELECT scoped_key FROM ai_waiter_cart_idempotency WHERE expires_at <= ? LIMIT ?")
      .all(nowMs, limit) as Array<{ scoped_key: string }>;
    return rows.map((row) => row.scoped_key);
  }

  protected async deleteIdempotencyKeys(keys: string[]): Promise<void> {
    const stmt = this.db.prepare("DELETE FROM ai_waiter_cart_idempotency WHERE scoped_key = ?");
    for (const key of keys) stmt.run(key);
  }

  protected async clearAll(): Promise<void> {
    this.db.exec("DELETE FROM ai_waiter_carts; DELETE FROM ai_waiter_cart_idempotency;");
  }
}

export async function createDurableCartAdapter(
  menuRepository: MenuRepository,
  conversationStore: ConversationStateStore,
  options: StandaloneVaiseCartAdapterOptions = {}
): Promise<CartPort> {
  const backend = await getAiWaiterBackend();
  return backend.kind === "postgres"
    ? new PostgresVaiseCartAdapter(backend.sql, menuRepository, conversationStore, options)
    : new SqliteVaiseCartAdapter(backend.db, menuRepository, conversationStore, options);
}
