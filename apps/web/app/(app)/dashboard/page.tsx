import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { desc, eq, and, gte, lt, sql } from "drizzle-orm";
import Decimal from "decimal.js";

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

import { NetWorthCard } from "./_components/net-worth-card";
import { AccountListWidget } from "./_components/account-list-widget";
import { CashflowChart } from "./_components/cashflow-chart";
import { RecentTransactions } from "./_components/recent-transactions";
import { BudgetStatusWidget } from "./_components/budget-status-widget";

export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const familyId = session.session.activeOrganizationId;
  if (!familyId) redirect("/onboarding");

  const db = getDb();

  const { accounts, recentEntries, cashflowData, budgetItems } =
    await withFamilyContext(db, familyId, session.user.id, async (tx) => {
      // Fetch all accounts
      const accts = await tx.select().from(account);

      // Recent 10 entries with their account-side line + category
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

      // Cashflow: monthly income vs expenses for the last 6 months.
      // Simplified v1: sum positive account-side amounts as income,
      // negative as expenses, grouped by month.
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      sixMonthsAgo.setDate(1);

      const monthlyRaw = await tx
        .select({
          month: sql<string>`to_char(${entry.entryDate}, 'YYYY-MM')`,
          amount: entryLine.amount,
        })
        .from(entry)
        .innerJoin(entryLine, eq(entryLine.entryId, entry.id))
        .where(
          sql`${entryLine.accountId} IS NOT NULL AND ${entry.entryDate} >= ${sixMonthsAgo.toISOString().split("T")[0]}`,
        );

      // Aggregate in TypeScript with decimal.js (safe)
      const monthlyMap = new Map<
        string,
        { income: Decimal; expenses: Decimal }
      >();

      for (const row of monthlyRaw) {
        const m = row.month;
        if (!monthlyMap.has(m)) {
          monthlyMap.set(m, {
            income: new Decimal(0),
            expenses: new Decimal(0),
          });
        }
        const bucket = monthlyMap.get(m)!;
        const amt = new Decimal(row.amount);
        if (amt.isPositive()) {
          bucket.income = bucket.income.plus(amt);
        } else {
          bucket.expenses = bucket.expenses.plus(amt.abs());
        }
      }

      // Sort by month and format
      const cashflow = Array.from(monthlyMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([m, data]) => {
          const [year, month] = m.split("-");
          const label = new Date(
            Number(year),
            Number(month) - 1,
          ).toLocaleString("en-US", { month: "short" });
          return {
            month: label,
            income: data.income.toFixed(2),
            expenses: data.expenses.toFixed(2),
          };
        });

      // Budget status for current month
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

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
            gte(budget.periodStart, monthStart),
            lt(budget.periodStart, monthEnd),
          ),
        );

      // If no monthly budgets match this exact period start, also check for
      // any monthly budget with the most recent period start <= now (the user
      // may have created a budget with a past start date that's still active).
      let activeBudgets = monthlyBudgets;
      if (activeBudgets.length === 0) {
        activeBudgets = await tx
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
          .where(eq(budget.period, "monthly"));
      }

      const budgetStatusItems = [];
      for (const b of activeBudgets) {
        const [result] = await tx
          .select({
            total: sql<string>`COALESCE(SUM(${entryLine.amount}), '0')`,
          })
          .from(entryLine)
          .innerJoin(entry, eq(entry.id, entryLine.entryId))
          .where(
            and(
              eq(entryLine.categoryId, b.categoryId),
              gte(entry.entryDate, monthStart),
              lt(entry.entryDate, monthEnd),
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
        cashflowData: cashflow,
        budgetItems: budgetStatusItems,
      };
    });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left column */}
        <div className="space-y-6">
          <NetWorthCard accounts={accounts} />
          <AccountListWidget accounts={accounts} />
        </div>

        {/* Right column */}
        <div className="space-y-6">
          <CashflowChart data={cashflowData} />
          <BudgetStatusWidget budgets={budgetItems} />
          <RecentTransactions entries={recentEntries} />
        </div>
      </div>
    </div>
  );
}
