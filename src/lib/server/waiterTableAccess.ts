import "server-only";

import { getRestaurantTableStore } from "./restaurantTableStore";

/**
 * Table numbers a given waiter account may see: their assigned tables, plus
 * any table nobody has been assigned to yet (visible to every waiter until
 * an admin picks an owner — see restaurantTableStore.ts's waiterId field).
 */
export async function visibleTableNumbersForWaiter(accountId: string): Promise<Set<string>> {
  const store = await getRestaurantTableStore();
  const tables = store ? await store.list() : [];
  return new Set(
    tables.filter((table) => table.waiterId === null || table.waiterId === accountId).map((table) => table.tableNumber)
  );
}
