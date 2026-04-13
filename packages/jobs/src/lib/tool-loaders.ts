import Decimal from 'decimal.js';
import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  sql,
} from 'drizzle-orm';
import type { DatabaseTx } from '@budget-tracker/db/client';
import {
  account,
  budget,
  category,
  entry,
  entryLine,
  recurring,
} from '@budget-tracker/db/schema';
import type { ToolLoaders } from '@budget-tracker/ai';
import type {
  ReportAccountInput,
  ReportEntryInput,
} from '@budget-tracker/core/reports';

/**
 * Build a `ToolLoaders` implementation for batch jobs (auto-cat, insights).
 *
 * Parallels `apps/web/lib/ai/tool-loaders.ts` but works within a raw
 * Drizzle transaction (no Next.js dependencies). The transaction should
 * already have RLS bypassed via `SET LOCAL row_security = off`, so all
 * queries include explicit `familyId` WHERE clauses.
 */
export function createToolLoadersForJob(
  tx: DatabaseTx,
  familyId: string,
): ToolLoaders {
  return {
    async loadEntries(window) {
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
            entryDate: r.entryDate.toISOString().split('T')[0]!,
            isTransfer: r.entryableType === 'transfer',
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
          const attributedAccountId = g.accountLines[0]!.accountId;
          for (const cl of g.categoryLines) {
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
    },

    async loadAccounts(_asOf) {
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
        accountType: r.accountType as ReportAccountInput['accountType'],
        balance: r.balance,
      }));
    },

    async loadCategoryNameMap() {
      const rows = await tx
        .select({ id: category.id, name: category.name })
        .from(category)
        .where(eq(category.familyId, familyId));

      const map = new Map<string, string>();
      for (const r of rows) {
        map.set(r.id, r.name);
      }
      return map;
    },

    async loadAccountNameMap() {
      const rows = await tx
        .select({ id: account.id, name: account.name })
        .from(account)
        .where(eq(account.familyId, familyId));

      const map = new Map<string, string>();
      for (const r of rows) {
        map.set(r.id, r.name);
      }
      return map;
    },

    async loadTransactions(params) {
      const { query, filters, limit } = params;

      const conditions: ReturnType<typeof eq>[] = [
        eq(entry.familyId, familyId),
      ];
      if (query) {
        const escaped = query.replace(/[%_]/g, '\\$&');
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
            date: row.entryDate.toISOString().split('T')[0]!,
            description: row.description,
            amount: '0',
            accountName: 'Unknown',
            categoryName: null,
          };
          grouped.set(row.entryId, g);
        }
        if (row.lineAccountId) {
          g.amount = row.lineAmount;
          g.accountName = row.accountName ?? 'Unknown';
        } else if (row.lineCategoryId && !g.categoryName) {
          g.categoryName = row.categoryName ?? null;
        }
      }

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
      const rows2 = entries.slice(0, limit).map((e) => ({
        entryId: e.entryId,
        date: e.date,
        amount: e.amount,
        description: e.description,
        categoryName: e.categoryName,
        accountName: e.accountName,
      }));

      return { rows: rows2, total };
    },

    async loadBudgetStatus(periodStart, periodEnd) {
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
            gte(
              budget.periodStart,
              new Date(`${periodStart}T00:00:00.000Z`),
            ),
            lt(
              budget.periodStart,
              new Date(`${periodEnd}T00:00:00.000Z`),
            ),
          ),
        );

      if (budgetRows.length === 0) return [];

      const spendRows = await tx
        .select({
          categoryId: entryLine.categoryId,
          totalSpend:
            sql<string>`COALESCE(-SUM(${entryLine.amount}), '0')`.as(
              'total_spend',
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
        budgetMode: b.mode as 'hard_cap' | 'forecast',
        budgetAmount: b.amount,
        actualSpend: spendByCat.get(b.categoryId) ?? '0',
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
          ? r.lastMatchedDate.toISOString().split('T')[0]!
          : null,
        nextExpectedDate: r.lastMatchedDate
          ? advanceDate(r.lastMatchedDate, r.cadence, r.cadenceInterval)
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
        visibility: r.visibility as 'household' | 'personal',
      }));
    },

    // NOTE: After Instance A merges (adding loadGoals + runReadQuery to
    // the ToolLoaders interface), rebase this branch and add:
    //   loadGoals: async () => [],
    //   runReadQuery: async () => { throw new Error('Not supported in batch context'); },
  };
}

function advanceDate(
  base: Date,
  cadence: string,
  interval: number,
): string {
  const d = new Date(base.getTime());
  switch (cadence) {
    case 'weekly':
      d.setUTCDate(d.getUTCDate() + 7 * interval);
      break;
    case 'biweekly':
      d.setUTCDate(d.getUTCDate() + 14 * interval);
      break;
    case 'monthly':
      d.setUTCMonth(d.getUTCMonth() + interval);
      break;
    case 'quarterly':
      d.setUTCMonth(d.getUTCMonth() + 3 * interval);
      break;
    case 'semiannual':
      d.setUTCMonth(d.getUTCMonth() + 6 * interval);
      break;
    case 'yearly':
      d.setUTCFullYear(d.getUTCFullYear() + interval);
      break;
  }
  return d.toISOString().split('T')[0]!;
}
