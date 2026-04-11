import { and, eq, gte, lt } from "drizzle-orm";
import Decimal from "decimal.js";

import type { DatabaseTx } from "@budget-tracker/db/client";
import { entry, entryLine } from "@budget-tracker/db/schema";
import type {
  ReportEntryInput,
  ReportWindow,
} from "@budget-tracker/core/reports";

/**
 * Fetch every entry_line in `[window.start, window.end)` for a family and
 * expand it into `ReportEntryInput[]` — the shape every core reports
 * function consumes.
 *
 * Data-model nuance: a normal transaction has one account-side line
 * (`accountId` set, `categoryId` null) plus one or more category-side
 * lines (`accountId` null, `categoryId` set). A split entry has one
 * account-side line and multiple category-side lines. Transfers have
 * two account-side lines and no category-side lines.
 *
 * We emit one `ReportEntryInput` per category-side line, flipping the
 * sign so the result matches the "positive = money INTO the account"
 * convention the reports package expects. For pure transfers (no
 * category-side lines at all) we emit one row per account-side line so
 * cashflow/reporting can see them if they ever want to — `isTransfer`
 * is set so core report functions skip them automatically today.
 */
export async function loadEntriesInWindow(
  tx: DatabaseTx,
  familyId: string,
  window: ReportWindow,
): Promise<ReportEntryInput[]> {
  const rows = await tx
    .select({
      entryId: entry.id,
      entryDate: entry.entryDate,
      entryableType: entry.entryableType,
      lineAccountId: entryLine.accountId,
      lineCategoryId: entryLine.categoryId,
      lineAmount: entryLine.amount,
    })
    .from(entry)
    .innerJoin(entryLine, eq(entryLine.entryId, entry.id))
    .where(
      and(
        eq(entry.familyId, familyId),
        gte(entry.entryDate, new Date(`${window.start}T00:00:00.000Z`)),
        lt(entry.entryDate, new Date(`${window.end}T00:00:00.000Z`)),
      ),
    );

  interface Grouped {
    entryId: string;
    entryDate: string;
    isTransfer: boolean;
    accountLines: Array<{ accountId: string; amount: string }>;
    categoryLines: Array<{ categoryId: string | null; amount: string }>;
  }

  const byEntry = new Map<string, Grouped>();
  for (const r of rows) {
    let g = byEntry.get(r.entryId);
    if (!g) {
      g = {
        entryId: r.entryId,
        entryDate: r.entryDate.toISOString().split("T")[0]!,
        isTransfer: r.entryableType === "transfer",
        accountLines: [],
        categoryLines: [],
      };
      byEntry.set(r.entryId, g);
    }
    if (r.lineAccountId !== null) {
      g.accountLines.push({
        accountId: r.lineAccountId,
        amount: r.lineAmount,
      });
    } else {
      g.categoryLines.push({
        categoryId: r.lineCategoryId,
        amount: r.lineAmount,
      });
    }
  }

  const result: ReportEntryInput[] = [];
  for (const g of byEntry.values()) {
    if (g.accountLines.length === 0) continue;

    if (g.categoryLines.length > 0) {
      // Pick the first account-side line for attribution. For splits with
      // one account the choice is trivial; multi-account splits are rare
      // and the current report set does not aggregate by accountId anyway.
      const attributedAccountId = g.accountLines[0]!.accountId;
      for (const cl of g.categoryLines) {
        // Category-side lines store the opposite sign from the account
        // perspective (see packages/db/src/schema/entry-line.ts). Negate
        // so `amountSigned` matches the ReportEntryInput convention.
        const signed = new Decimal(cl.amount).negated().toFixed();
        result.push({
          entryId: g.entryId,
          entryDate: g.entryDate,
          amountSigned: signed,
          accountId: attributedAccountId,
          categoryId: cl.categoryId,
          isTransfer: g.isTransfer,
        });
      }
    } else {
      for (const al of g.accountLines) {
        result.push({
          entryId: g.entryId,
          entryDate: g.entryDate,
          amountSigned: al.amount,
          accountId: al.accountId,
          categoryId: null,
          isTransfer: g.isTransfer,
        });
      }
    }
  }

  return result;
}
