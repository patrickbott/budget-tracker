import { headers } from "next/headers";
import { desc, eq, and } from "drizzle-orm";

import { auth } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { withFamilyContext } from "@budget-tracker/db/client";
import {
  entry,
  entryLine,
  account,
  category,
} from "@budget-tracker/db/schema";

import {
  TransactionTable,
  type TransactionRow,
  type CategoryOption,
} from "./_components/transaction-table";

export default async function TransactionsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  const familyId = session.session.activeOrganizationId;
  if (!familyId) return null;

  const db = getDb();

  const { rows, categories, accounts } = await withFamilyContext(
    db,
    familyId,
    session.user.id,
    async (tx) => {
      // Fetch entries with their account-side and category-side lines.
      // Each SimpleFIN entry has exactly 2 lines: one account-side (accountId != null)
      // and one category-side (categoryId may or may not be null).
      const rawEntries = await tx
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

      // Group lines by entry to build TransactionRow objects.
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
        }
      >();

      for (const row of rawEntries) {
        if (!entryMap.has(row.entryId)) {
          entryMap.set(row.entryId, {
            entryId: row.entryId,
            entryDate: row.entryDate,
            description: row.description,
            isPending: row.isPending,
          });
        }

        const e = entryMap.get(row.entryId)!;

        if (row.lineAccountId) {
          // Account-side line
          e.accountLine = {
            lineId: row.lineId,
            accountId: row.lineAccountId,
            accountName: row.accountName ?? "Unknown",
            amount: row.lineAmount,
          };
        } else {
          // Category-side line
          e.categoryLine = {
            lineId: row.lineId,
            categoryId: row.lineCategoryId,
            categoryName: row.categoryName,
            categoryColor: row.categoryColor,
          };
        }
      }

      const transactionRows: TransactionRow[] = [];
      for (const e of entryMap.values()) {
        if (!e.accountLine) continue;
        transactionRows.push({
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

      // Fetch categories for the dropdown.
      const allCategories = await tx
        .select({
          id: category.id,
          name: category.name,
          color: category.color,
        })
        .from(category)
        .where(
          and(eq(category.familyId, familyId), eq(category.isArchived, false)),
        );

      // Fetch accounts for the filter dropdown.
      const allAccounts = await tx
        .select({
          id: account.id,
          name: account.name,
        })
        .from(account)
        .where(
          and(
            eq(account.familyId, familyId),
            eq(account.isClosed, false),
          ),
        );

      return {
        rows: transactionRows,
        categories: allCategories as CategoryOption[],
        accounts: allAccounts,
      };
    },
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
      <TransactionTable
        data={rows}
        categories={categories}
        accounts={accounts}
      />
    </div>
  );
}
