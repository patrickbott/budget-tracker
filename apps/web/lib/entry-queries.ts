import { desc, eq, and } from "drizzle-orm";
import type { DatabaseTx } from "@budget-tracker/db/client";
import {
  entry,
  entryLine,
  account,
  category,
} from "@budget-tracker/db/schema";
import type { TransactionRow, CategoryOption } from "@/app/(app)/transactions/_components/transaction-table";

/**
 * Raw row shape returned by the entry + entry_line + account + category join.
 */
interface RawEntryRow {
  entryId: string;
  entryDate: Date;
  description: string;
  isPending: boolean;
  lineId: string;
  lineAccountId: string | null;
  lineCategoryId: string | null;
  lineAmount: string;
  accountName: string | null;
  categoryName: string | null;
  categoryColor: string | null;
}

/**
 * Fetch raw entry rows joined with entry_line, account, and category
 * for a family. Returns all entries; use `groupEntryRows` with a
 * `forAccountId` to filter to a specific account.
 */
export async function fetchRawEntries(
  tx: DatabaseTx,
  familyId: string,
): Promise<RawEntryRow[]> {
  return tx
    .select({
      entryId: entry.id,
      entryDate: entry.entryDate,
      description: entry.description,
      isPending: entry.isPending,
      lineId: entryLine.id,
      lineAccountId: entryLine.accountId,
      lineCategoryId: entryLine.categoryId,
      lineAmount: entryLine.amount,
      accountName: account.name,
      categoryName: category.name,
      categoryColor: category.color,
    })
    .from(entry)
    .innerJoin(entryLine, eq(entryLine.entryId, entry.id))
    .leftJoin(account, eq(account.id, entryLine.accountId))
    .leftJoin(category, eq(category.id, entryLine.categoryId))
    .where(eq(entry.familyId, familyId))
    .orderBy(desc(entry.entryDate));
}

/**
 * Group raw entry rows (which have one row per entry_line) into
 * `TransactionRow[]` suitable for the TransactionTable component.
 *
 * When `forAccountId` is provided, only entries with an account-side
 * line touching that account are included.
 */
export function groupEntryRows(
  rawEntries: RawEntryRow[],
  forAccountId?: string,
): TransactionRow[] {
  const entryMap = new Map<
    string,
    {
      entryId: string;
      entryDate: Date;
      description: string;
      isPending: boolean;
      accountLine?: {
        lineId: string;
        accountId: string;
        accountName: string;
        amount: string;
      };
      categoryLine?: {
        lineId: string;
        categoryId: string | null;
        categoryName: string | null;
        categoryColor: string | null;
      };
      touchesTarget: boolean;
    }
  >();

  for (const row of rawEntries) {
    if (!entryMap.has(row.entryId)) {
      entryMap.set(row.entryId, {
        entryId: row.entryId,
        entryDate: row.entryDate,
        description: row.description,
        isPending: row.isPending,
        touchesTarget: false,
      });
    }

    const e = entryMap.get(row.entryId)!;

    if (row.lineAccountId) {
      if (!forAccountId || row.lineAccountId === forAccountId) {
        e.touchesTarget = true;
      }
      e.accountLine = {
        lineId: row.lineId,
        accountId: row.lineAccountId,
        accountName: row.accountName ?? "Unknown",
        amount: row.lineAmount,
      };
    } else {
      e.categoryLine = {
        lineId: row.lineId,
        categoryId: row.lineCategoryId,
        categoryName: row.categoryName,
        categoryColor: row.categoryColor,
      };
    }
  }

  const rows: TransactionRow[] = [];
  for (const e of entryMap.values()) {
    if (!e.accountLine) continue;
    if (forAccountId && !e.touchesTarget) continue;

    rows.push({
      entryId: e.entryId,
      entryDate: e.entryDate.toISOString().split("T")[0]!,
      description: e.description,
      isPending: e.isPending,
      accountLineId: e.accountLine.lineId,
      accountId: e.accountLine.accountId,
      accountName: e.accountLine.accountName,
      amount: e.accountLine.amount,
      categoryLineId: e.categoryLine?.lineId ?? e.accountLine.lineId,
      categoryId: e.categoryLine?.categoryId ?? null,
      categoryName: e.categoryLine?.categoryName ?? null,
      categoryColor: e.categoryLine?.categoryColor ?? null,
    });
  }

  return rows;
}

/**
 * Fetch active (non-archived) categories for a family.
 */
export async function fetchCategories(
  tx: DatabaseTx,
  familyId: string,
): Promise<CategoryOption[]> {
  return tx
    .select({
      id: category.id,
      name: category.name,
      color: category.color,
    })
    .from(category)
    .where(
      and(eq(category.familyId, familyId), eq(category.isArchived, false)),
    ) as Promise<CategoryOption[]>;
}
