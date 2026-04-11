import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { desc, eq, and, gte, lt, sql } from "drizzle-orm";

import { auth } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { withFamilyContext } from "@budget-tracker/db/client";
import {
  account,
  budget,
  entry,
  entryLine,
  category,
} from "@budget-tracker/db/schema";
import {
  cashflow,
  netWorth,
  spendingByCategory,
  type ReportWindow,
} from "@budget-tracker/core/reports";

import {
  loadAccountsForNetWorth,
  loadCategoryLookup,
  loadEntriesInWindow,
} from "@/lib/reports";
import type { SpendingDisplayRow } from "./_components/spending-by-category-donut";

import { NetWorthCard } from "./_components/net-worth-card";
import { AccountListWidget } from "./_components/account-list-widget";
import { CashflowChart } from "./_components/cashflow-chart";
import { RecentTransactions } from "./_components/recent-transactions";
import { BudgetStatusWidget } from "./_components/budget-status-widget";
import { SpendingByCategoryDonut } from "./_components/spending-by-category-donut";

function isoDate(d: Date): string {
  return d.toISOString().split("T")[0]!;
}

export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const familyId = session.session.activeOrganizationId;
  if (!familyId) redirect("/onboarding");

  const db = getDb();

  // Windows: cashflow spans the current month back six months; the
  // spending donut filters down to just the current month. We pre-load
  // entries across the wider window once and hand them to both core
  // reports — each applies its own half-open window internally.
  // TODO(r3): expose a period picker for both widgets.
  const now = new Date();
  const currentMonthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const nextMonthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  const sixMonthsAgoStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1),
  );

  const cashflowWindow: ReportWindow = {
    start: isoDate(sixMonthsAgoStart),
    end: isoDate(nextMonthStart),
  };
  const spendingWindow: ReportWindow = {
    start: isoDate(currentMonthStart),
    end: isoDate(nextMonthStart),
  };

  const {
    accounts,
    recentEntries,
    cashflowRows,
    spendingDisplayRows,
    netWorthResult,
    budgetItems,
  } = await withFamilyContext(db, familyId, session.user.id, async (tx) => {
    const accts = await tx.select().from(account);

    // Recent 10 entries with their account-side line + category.
    const recent = await tx
      .select({
        id: entry.id,
        entryDate: entry.entryDate,
        description: entry.description,
        amount: entryLine.amount,
        categoryName: category.name,
        categoryColor: category.color,
      })
      .from(entry)
      .innerJoin(entryLine, eq(entryLine.entryId, entry.id))
      .leftJoin(category, eq(entryLine.categoryId, category.id))
      .where(sql`${entryLine.accountId} IS NOT NULL`)
      .orderBy(desc(entry.entryDate), desc(entry.createdAt))
      .limit(10);

    const entries = await loadEntriesInWindow(tx, familyId, cashflowWindow);
    const cashflowCore = cashflow({
      entries,
      window: cashflowWindow,
      granularity: "month",
    });
    const spendingCore = spendingByCategory({
      entries,
      window: spendingWindow,
    });

    const acctInputs = await loadAccountsForNetWorth(tx, familyId);
    const netWorthCore = netWorth({ accounts: acctInputs });

    const catLookup = await loadCategoryLookup(tx, familyId);
    const spendingDisplay: SpendingDisplayRow[] = spendingCore.map((r) => {
      const info = catLookup.get(r.categoryId);
      return {
        categoryId: r.categoryId,
        total: r.total,
        name: info?.name ?? "Uncategorized",
        color: info?.color ?? null,
      };
    });

    // Budget status for the current month.
    const monthlyBudgets = await tx
      .select({
        id: budget.id,
        categoryId: budget.categoryId,
        amount: budget.amount,
        mode: budget.mode,
        categoryName: category.name,
        categoryColor: category.color,
      })
      .from(budget)
      .innerJoin(category, eq(category.id, budget.categoryId))
      .where(
        and(
          eq(budget.period, "monthly"),
          gte(budget.periodStart, currentMonthStart),
          lt(budget.periodStart, nextMonthStart),
        ),
      );

    const budgetStatusItems = [];
    for (const b of monthlyBudgets) {
      const [result] = await tx
        .select({
          total: sql<string>`COALESCE(SUM(${entryLine.amount}), '0')`,
        })
        .from(entryLine)
        .innerJoin(entry, eq(entry.id, entryLine.entryId))
        .where(
          and(
            eq(entryLine.categoryId, b.categoryId),
            gte(entry.entryDate, currentMonthStart),
            lt(entry.entryDate, nextMonthStart),
          ),
        );

      budgetStatusItems.push({
        id: b.id,
        categoryName: b.categoryName,
        categoryColor: b.categoryColor,
        mode: b.mode,
        amount: b.amount,
        actualSpend: result?.total ?? "0",
      });
    }

    return {
      accounts: accts,
      recentEntries: recent,
      cashflowRows: cashflowCore,
      spendingDisplayRows: spendingDisplay,
      netWorthResult: netWorthCore,
      budgetItems: budgetStatusItems,
    };
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left column */}
        <div className="space-y-6">
          <NetWorthCard
            asset={netWorthResult.asset}
            liability={netWorthResult.liability}
            net={netWorthResult.net}
          />
          <AccountListWidget accounts={accounts} />
        </div>

        {/* Right column */}
        <div className="space-y-6">
          <CashflowChart data={cashflowRows} />
          <SpendingByCategoryDonut rows={spendingDisplayRows} />
          <BudgetStatusWidget budgets={budgetItems} />
          <RecentTransactions entries={recentEntries} />
        </div>
      </div>
    </div>
  );
}
