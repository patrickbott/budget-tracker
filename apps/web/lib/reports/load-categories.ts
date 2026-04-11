import { eq } from "drizzle-orm";

import type { DatabaseTx } from "@budget-tracker/db/client";
import { category } from "@budget-tracker/db/schema";

export interface CategoryLookupEntry {
  name: string;
  color: string | null;
}

/**
 * Fetch `categoryId → { name, color }` for a family. Used by the
 * spending-by-category donut to render human-readable category names
 * next to the pure-math results from `core.spendingByCategory` (which
 * only returns ids + totals).
 *
 * Small by definition — a family has at most a few dozen categories —
 * so we return a `Map` rather than paging.
 */
export async function loadCategoryLookup(
  tx: DatabaseTx,
  familyId: string,
): Promise<Map<string, CategoryLookupEntry>> {
  const rows = await tx
    .select({
      id: category.id,
      name: category.name,
      color: category.color,
    })
    .from(category)
    .where(eq(category.familyId, familyId));

  const lookup = new Map<string, CategoryLookupEntry>();
  for (const r of rows) {
    lookup.set(r.id, { name: r.name, color: r.color });
  }
  return lookup;
}
