import Decimal from "decimal.js";
import { and, desc, eq, gte, ilike, inArray, isNotNull, lt, sql } from "drizzle-orm";

import type { DatabaseTx } from "@budget-tracker/db/client";
import type { ToolLoaders } from "@budget-tracker/ai";
import {
  account,
  budget,
  category,
  entry,
  entryLine,
  recurring,
} from "@budget-tracker/db/schema";
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
      for (const [id, e] of lookup) {
        map.set(id, e.name);
      }
      return map;
    },

    loadAccountNameMap() {
      return loadAccountNameMap(tx, familyId);
    },

    async loadTransactions(params) {
      const { query, filters, limit } = params;

      // SQL-level filters on the entry table
      const conditions: ReturnType<typeof eq>[] = [
        eq(entry.familyId, familyId),
      ];
      if (query) {
        // Escape SQL wildcards so user input is treated as literal text
        const escaped = query.replace(/[%_]/g, "\\$&");
        conditions.push(ilike(entry.description, `%${escaped}%`));
      }
      if (filters?.startDate) {
        conditions.push(
          gte(entry.entryDate, new Date(`${filters.startDate}T00:00:00.000Z`)),
        );
      }
      if (filters?.endDate) {
        conditions.push(
          lt(entry.entryDate, new Date(`${filters.endDate}T00:00:00.000Z`)),
        );
      }
      // Subquery filters: entries that touch a specific account or category
      if (filters?.accountId) {
        conditions.push(
          inArray(
            entry.id,
            tx
              .select({ id: entryLine.entryId })
              .from(entryLine)
              .where(eq(entryLine.accountId, filters.accountId)),
          ),
        );
      }
      if (filters?.categoryId) {
        conditions.push(
          inArray(
            entry.id,
            tx
              .select({ id: entryLine.entryId })
              .from(entryLine)
              .where(eq(entryLine.categoryId, filters.categoryId)),
          ),
        );
      }

      // Fetch raw joined rows
      const rawRows = await tx
        .select({
          entryId: entry.id,
          entryDate: entry.entryDate,
          description: entry.description,
          lineAccountId: entryLine.accountId,
          lineCategoryId: entryLine.categoryId,
          lineAmount: entryLine.amount,
          accountName: account.name,
          categoryName: category.name,
        })
        .from(entry)
        .innerJoin(entryLine, eq(entryLine.entryId, entry.id))
        .leftJoin(account, eq(account.id, entryLine.accountId))
        .leftJoin(category, eq(category.id, entryLine.categoryId))
        .where(and(...conditions))
        .orderBy(desc(entry.entryDate));

      // Group by entry: pick account-side line + first category-side line
      interface Grouped {
        entryId: string;
        date: string;
        description: string;
        amount: string;
        accountName: string;
        categoryName: string | null;
      }
      const grouped = new Map<string, Grouped>();

      for (const row of rawRows) {
        let g = grouped.get(row.entryId);
        if (!g) {
          g = {
            entryId: row.entryId,
            date: row.entryDate.toISOString().split("T")[0]!,
            description: row.description,
            amount: "0",
            accountName: "Unknown",
            categoryName: null,
          };
          grouped.set(row.entryId, g);
        }
        if (row.lineAccountId) {
          g.amount = row.lineAmount;
          g.accountName = row.accountName ?? "Unknown";
        } else if (row.lineCategoryId && !g.categoryName) {
          g.categoryName = row.categoryName ?? null;
        }
      }

      // Apply amount filters in JS (account-side amount)
      let entries = Array.from(grouped.values());
      if (filters?.minAmount) {
        const min = new Decimal(filters.minAmount);
        entries = entries.filter((e) => new Decimal(e.amount).abs().gte(min));
      }
      if (filters?.maxAmount) {
        const max = new Decimal(filters.maxAmount);
        entries = entries.filter((e) => new Decimal(e.amount).abs().lte(max));
      }

      const total = entries.length;
      const rows = entries.slice(0, limit).map((e) => ({
        entryId: e.entryId,
        date: e.date,
        amount: e.amount,
        description: e.description,
        categoryName: e.categoryName,
        accountName: e.accountName,
      }));

      return { rows, total };
    },

    async loadBudgetStatus(periodStart, periodEnd) {
      // Fetch budget rows for this period
      const budgetRows = await tx
        .select({
          categoryId: budget.categoryId,
          categoryName: category.name,
          mode: budget.mode,
          amount: budget.amount,
        })
        .from(budget)
        .innerJoin(category, eq(category.id, budget.categoryId))
        .where(
          and(
            eq(budget.familyId, familyId),
            gte(budget.periodStart, new Date(`${periodStart}T00:00:00.000Z`)),
            lt(budget.periodStart, new Date(`${periodEnd}T00:00:00.000Z`)),
          ),
        );

      if (budgetRows.length === 0) return [];

      // Compute actual spend per category in the period.
      // Category-side lines have negative amounts for expenses; negate
      // so the result is positive for spending.
      const spendRows = await tx
        .select({
          categoryId: entryLine.categoryId,
          totalSpend:
            sql<string>`COALESCE(-SUM(${entryLine.amount}), '0')`.as(
              "total_spend",
            ),
        })
        .from(entryLine)
        .innerJoin(entry, eq(entry.id, entryLine.entryId))
        .where(
          and(
            eq(entry.familyId, familyId),
            isNotNull(entryLine.categoryId),
            gte(
              entry.entryDate,
              new Date(`${periodStart}T00:00:00.000Z`),
            ),
            lt(
              entry.entryDate,
              new Date(`${periodEnd}T00:00:00.000Z`),
            ),
          ),
        )
        .groupBy(entryLine.categoryId);

      const spendByCat = new Map<string, string>();
      for (const r of spendRows) {
        if (r.categoryId) spendByCat.set(r.categoryId, r.totalSpend);
      }

      return budgetRows.map((b) => ({
        categoryName: b.categoryName,
        budgetMode: b.mode as "hard_cap" | "forecast",
        budgetAmount: b.amount,
        actualSpend: spendByCat.get(b.categoryId) ?? "0",
      }));
    },

    async loadRecurringStatus() {
      const rows = await tx
        .select({
          name: recurring.name,
          expectedAmount: recurring.expectedAmount,
          cadence: recurring.cadence,
          cadenceInterval: recurring.cadenceInterval,
          lastMatchedDate: recurring.lastMatchedDate,
          missingDates: recurring.missingDates,
        })
        .from(recurring)
        .where(eq(recurring.familyId, familyId));

      return rows.map((r) => ({
        title: r.name,
        amount: r.expectedAmount,
        cadence: r.cadence,
        lastSeenDate: r.lastMatchedDate
          ? r.lastMatchedDate.toISOString().split("T")[0]!
          : null,
        nextExpectedDate: r.lastMatchedDate
          ? advanceDate(
              r.lastMatchedDate,
              r.cadence,
              r.cadenceInterval,
            )
          : null,
        missingDates: r.missingDates,
      }));
    },

    async loadCategories() {
      const rows = await tx
        .select({
          id: category.id,
          name: category.name,
          parentId: category.parentId,
        })
        .from(category)
        .where(
          and(
            eq(category.familyId, familyId),
            eq(category.isArchived, false),
          ),
        );

      // Parent lookup in JS — categories are a small set
      const nameById = new Map<string, string>();
      for (const r of rows) {
        nameById.set(r.id, r.name);
      }

      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        parentName: r.parentId ? (nameById.get(r.parentId) ?? null) : null,
      }));
    },

    async loadAccountsList() {
      const rows = await tx
        .select({
          id: account.id,
          name: account.name,
          accountType: account.accountType,
          visibility: account.visibility,
        })
        .from(account)
        .where(
          and(
            eq(account.familyId, familyId),
            eq(account.isClosed, false),
          ),
        );

      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        accountType: r.accountType,
        visibility: r.visibility as "household" | "personal",
      }));
    },
  };
}

/**
 * Advance a date by one cadence interval. Mirrors the `advance`
 * function in `packages/core/recurring/index.ts`.
 */
function advanceDate(
  base: Date,
  cadence: string,
  interval: number,
): string {
  const d = new Date(base.getTime());
  switch (cadence) {
    case "weekly":
      d.setUTCDate(d.getUTCDate() + 7 * interval);
      break;
    case "biweekly":
      d.setUTCDate(d.getUTCDate() + 14 * interval);
      break;
    case "monthly":
      d.setUTCMonth(d.getUTCMonth() + interval);
      break;
    case "quarterly":
      d.setUTCMonth(d.getUTCMonth() + 3 * interval);
      break;
    case "semiannual":
      d.setUTCMonth(d.getUTCMonth() + 6 * interval);
      break;
    case "yearly":
      d.setUTCFullYear(d.getUTCFullYear() + interval);
      break;
  }
  return d.toISOString().split("T")[0]!;
}
