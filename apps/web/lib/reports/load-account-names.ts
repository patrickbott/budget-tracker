import { eq } from "drizzle-orm";

import type { DatabaseTx } from "@budget-tracker/db/client";
import { account } from "@budget-tracker/db/schema";

/**
 * Fetch `accountId → displayName` for a family. Used by the
 * `ToolLoaders.loadAccountNameMap()` contract so AI tool output says
 * "Chase Checking" instead of a raw UUID.
 */
export async function loadAccountNameMap(
  tx: DatabaseTx,
  familyId: string,
): Promise<Map<string, string>> {
  const rows = await tx
    .select({
      id: account.id,
      name: account.name,
    })
    .from(account)
    .where(eq(account.familyId, familyId));

  const map = new Map<string, string>();
  for (const r of rows) {
    map.set(r.id, r.name);
  }
  return map;
}
