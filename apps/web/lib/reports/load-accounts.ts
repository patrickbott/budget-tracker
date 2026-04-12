import { and, eq } from "drizzle-orm";

import type { DatabaseTx } from "@budget-tracker/db/client";
import { account } from "@budget-tracker/db/schema";
import type { ReportAccountInput } from "@budget-tracker/core/reports";

/**
 * Fetch open (non-closed) accounts for a family in the shape
 * `core.netWorth` consumes. Closed accounts are excluded to match the
 * existing NetWorthCard semantics.
 *
 * The DB enum values (`other_asset`, `other_liability`) now match the
 * core `ReportAccountInput['accountType']` union directly — no mapping
 * hack needed.
 */
export async function loadAccountsForNetWorth(
  tx: DatabaseTx,
  familyId: string,
): Promise<ReportAccountInput[]> {
  const rows = await tx
    .select({
      id: account.id,
      accountType: account.accountType,
      balance: account.balance,
    })
    .from(account)
    .where(
      and(eq(account.familyId, familyId), eq(account.isClosed, false)),
    );

  return rows.map((r) => ({
    accountId: r.id,
    accountType: r.accountType as ReportAccountInput["accountType"],
    balance: r.balance,
  }));
}
