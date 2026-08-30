import type { Product } from "./data.ts";

export interface MenuOverride {
  productId: string;
  soldOut?: boolean;
  price?: number;
  name?: string;
}

export function applyMenuOverride(product: Product, override?: MenuOverride | null): Product {
  if (!override) return product;
  return {
    ...product,
    soldOut: override.soldOut === true,
    price: typeof override.price === "number" ? override.price : product.price,
    name: typeof override.name === "string" && override.name.trim() ? override.name.trim() : product.name,
  };
}

export function applyMenuOverrides(
  catalog: Product[],
  overrides: Iterable<MenuOverride>
): Product[] {
  const byId = new Map<string, MenuOverride>();
  for (const override of overrides) byId.set(override.productId, override);
  return catalog.map((product) => applyMenuOverride(product, byId.get(product.id)));
}
