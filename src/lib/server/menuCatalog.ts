import { products, type Product } from "../data.ts";
import type { OrderItem } from "../orderTypes.ts";
import { applyMenuOverride, applyMenuOverrides } from "../menuOverrides.ts";
import { getMenuOverrideStore } from "./menuOverrideStore.ts";

export class OrderPricingError extends Error {
  readonly code: "unknown_product" | "not_orderable" | "sold_out";
  readonly productId?: string;

  constructor(code: "unknown_product" | "not_orderable" | "sold_out", productId?: string) {
    super(code);
    this.name = "OrderPricingError";
    this.code = code;
    this.productId = productId;
  }
}

export async function listMenuOverrides() {
  const store = await getMenuOverrideStore();
  return store ? store.list() : [];
}

export async function getMergedProducts(): Promise<Product[]> {
  return applyMenuOverrides(products, await listMenuOverrides());
}

export async function getCatalogProduct(productId: string): Promise<Product | undefined> {
  const base = products.find((product) => product.id === productId);
  if (!base) return undefined;
  const store = await getMenuOverrideStore();
  const override = store ? await store.get(productId) : null;
  return applyMenuOverride(base, override);
}

/**
 * Ignore client name/price/total. Official (possibly overridden) catalog values win.
 * Sold-out dishes and products with no confirmed price are not orderable.
 */
export async function priceGuestOrderItems(
  items: Array<{ productId: string; quantity: number }>
): Promise<{ items: OrderItem[]; total: number }> {
  const priced: OrderItem[] = [];
  for (const item of items) {
    const product = await getCatalogProduct(item.productId);
    if (!product) {
      throw new OrderPricingError("unknown_product", item.productId);
    }
    if (product.soldOut) {
      throw new OrderPricingError("sold_out", item.productId);
    }
    if (!(product.price > 0)) {
      throw new OrderPricingError("not_orderable", item.productId);
    }
    priced.push({
      productId: product.id,
      name: product.name,
      price: product.price,
      quantity: item.quantity,
    });
  }
  const total = priced.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return { items: priced, total };
}
