import { and, eq } from "drizzle-orm";

import type { DatabaseTx } from "@budget-tracker/db/client";
import { account } from "@budget-tracker/db/schema";
import type { ReportAccountInput } from "@budget-tracker/core/reports";

/**
 * Fetch open (non-archived/non-closed) accounts for a family in the shape
 * `core.netWorth` consumes. Closed accounts are excluded to match the
 * existing NetWorthCard semantics.
 *
 * Enum mismatch (flagged for a follow-up core fix): the DB's
 * `account_type` enum includes `other_asset` and `other_liability`, but
 * `@budget-tracker/core/reports`'s `ReportAccountInput['accountType']`
 * union only has `'other'`. We map:
 *   - `other_asset`     → `'other'`   (core treats `other` as an asset)
 *   - `other_liability` → `'loan'`    (core's LIABILITY_TYPES only has
 *                                      `credit_card` and `loan`, so we
 *                                      route to the closest liability
 *                                      bucket to keep the asset/liability
 *                                      split correct in net-worth math)
 *
 * TODO(followup): extend `ReportAccountInput['accountType']` in core to
 * include `other_asset` and `other_liability`, then drop the mapping.
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
    accountType: mapAccountType(r.accountType),
    balance: r.balance,
  }));
}

function mapAccountType(
  dbType: string,
): ReportAccountInput["accountType"] {
  if (dbType === "other_asset") return "other";
  if (dbType === "other_liability") return "loan";
  return dbType as ReportAccountInput["accountType"];
}
