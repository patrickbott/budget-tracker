import type { DatabaseTx } from "@budget-tracker/db/client";
import type { ToolLoaders } from "@budget-tracker/ai";
import {
  loadEntriesInWindow,
  loadAccountsForNetWorth,
  loadAccountNameMap,
  loadCategoryLookup,
} from "@/lib/reports";

/**
 * Build a concrete `ToolLoaders` implementation scoped to a family.
 *
 * The returned object satisfies the `packages/ai` contract by delegating
 * to the existing report DB helpers. It is constructed once per chat
 * request inside `withFamilyContext`, so `tx` already carries the RLS
 * session variables.
 */
export function createToolLoaders(
  tx: DatabaseTx,
  familyId: string,
): ToolLoaders {
  return {
    loadEntries(window) {
      return loadEntriesInWindow(tx, familyId, window);
    },

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    loadAccounts(_asOf) {
      // Current impl returns latest balances from the account table.
      // A future enhancement can compute point-in-time balances from
      // entry_line rollups keyed on `asOf`.
      return loadAccountsForNetWorth(tx, familyId);
    },

    async loadCategoryNameMap() {
      const lookup = await loadCategoryLookup(tx, familyId);
      const map = new Map<string, string>();
      for (const [id, entry] of lookup) {
        map.set(id, entry.name);
      }
      return map;
    },

    loadAccountNameMap() {
      return loadAccountNameMap(tx, familyId);
    },
  };
}
