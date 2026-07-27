import "server-only";

import type {
  Cart,
  ConversationState,
  ConversationTurnRequest,
  WaiterReference,
} from "../schemas.ts";
import type { ActionIntentContext } from "./actionAuthorizationPolicy.ts";
import type {
  GroundedProductProvenance,
  GroundedWaiterContext,
} from "./aiProvider.ts";
import { buildGroundedWaiterContext } from "./grounding.ts";
import type { MenuRepository } from "./menuRepository.ts";

export class TurnGroundingService {
  private readonly menuRepository: MenuRepository;

  constructor(menuRepository: MenuRepository) {
    this.menuRepository = menuRepository;
  }

  intentContext(
    message: string,
    state: ConversationState,
    cart: Cart,
    context: GroundedWaiterContext
  ): ActionIntentContext {
    return {
      message,
      state,
      cart,
      products: context.relevantProducts,
      productProvenance: context.productProvenance,
    };
  }

  allowedProductIds(
    context: GroundedWaiterContext,
    cart: Cart,
    currentToolProductIds: ReadonlySet<string>
  ): Set<string> {
    return new Set([
      ...context.productProvenance.map((item) => item.productId),
      ...cart.lines.map((line) => line.productId),
      ...currentToolProductIds,
    ]);
  }

  async rebuildWithToolProvenance(
    command: ConversationTurnRequest,
    state: ConversationState,
    cart: Cart,
    currentToolProductIds: ReadonlySet<string>
  ): Promise<GroundedWaiterContext> {
    const context = await buildGroundedWaiterContext({
      state,
      cart,
      customerMessage: command.message,
      clientTurnId: command.clientTurnId ?? null,
      menuRepository: this.menuRepository,
    });
    const details = await Promise.all(
      [...currentToolProductIds].map((productId) =>
        this.menuRepository.getProductDetails(productId, state.language)
      )
    );
    const products = new Map(
      context.relevantProducts.map((product) => [
        product.productId,
        product,
      ])
    );
    for (const product of details) {
      if (product) products.set(product.productId, product);
    }
    const provenance = new Map(
      context.productProvenance.map((item) => [
        item.productId,
        item.provenance,
      ])
    );
    for (const productId of currentToolProductIds) {
      provenance.set(productId, "current_tool_result");
    }
    const relevantProducts = [...products.values()].slice(0, 8);
    return {
      ...context,
      relevantProducts,
      productProvenance: relevantProducts.map((product) => ({
        productId: product.productId,
        provenance:
          provenance.get(product.productId) ?? "current_tool_result",
      })) as GroundedProductProvenance[],
    };
  }

  async references(
    productIds: string[],
    state: ConversationState
  ): Promise<WaiterReference[] | null> {
    const details = await Promise.all(
      productIds.map((productId) =>
        this.menuRepository.getProductDetails(productId, state.language)
      )
    );
    if (details.some((product) => product === null)) return null;
    return details.flatMap((product) =>
      product
        ? [
            {
              productId: product.productId,
              name: product.name,
              officialUnitPrice: product.officialUnitPrice,
              currency: product.currency,
            },
          ]
        : []
    );
  }
}
