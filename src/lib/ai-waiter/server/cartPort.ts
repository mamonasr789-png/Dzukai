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
          "A cart product now requires an unconfigured variant selection."
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
