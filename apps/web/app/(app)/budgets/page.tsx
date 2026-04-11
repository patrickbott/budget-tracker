import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq, and, gte, lt, sql } from "drizzle-orm";
import { Plus } from "lucide-react";

import { auth } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { withFamilyContext } from "@budget-tracker/db/client";
import {
  budget,
  category,
  entry,
  entryLine,
} from "@budget-tracker/db/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BudgetForm } from "./_components/budget-form";
import { BudgetCard } from "./_components/budget-card";

function getPeriodEnd(start: Date, period: string): Date {
  const end = new Date(start);
  if (period === "weekly") {
    end.setDate(end.getDate() + 7);
  } else if (period === "monthly") {
    end.setMonth(end.getMonth() + 1);
  } else {
    end.setFullYear(end.getFullYear() + 1);
  }
  return end;
}

export default async function BudgetsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const familyId = session.session.activeOrganizationId;
  if (!familyId) redirect("/onboarding");

  const db = getDb();

  const { budgets, categories, spendByCategory } = await withFamilyContext(
    db,
    familyId,
    session.user.id,
    async (tx) => {
      const allBudgets = await tx
        .select()
        .from(budget)
        .orderBy(budget.periodStart);

      const allCategories = await tx
        .select({
          id: category.id,
          name: category.name,
          color: category.color,
          kind: category.kind,
        })
        .from(category)
        .where(eq(category.isArchived, false));

      // Compute actual spend per budget: for each budget, sum category-side
      // entry_line amounts within the budget's period window.
      // Category-side lines have categoryId set and accountId NULL.
      const spendMap = new Map<string, string>();

      for (const b of allBudgets) {
        const periodEnd = getPeriodEnd(b.periodStart, b.period);

        const [result] = await tx
          .select({
            total: sql<string>`COALESCE(SUM(${entryLine.amount}), '0')`,
          })
          .from(entryLine)
          .innerJoin(entry, eq(entry.id, entryLine.entryId))
          .where(
            and(
              eq(entryLine.categoryId, b.categoryId),
              gte(entry.entryDate, b.periodStart),
              lt(entry.entryDate, periodEnd),
            ),
          );

        spendMap.set(b.id, result?.total ?? "0");
      }

      return {
        budgets: allBudgets,
        categories: allCategories,
        spendByCategory: spendMap,
      };
    },
  );

  const expenseCategories = categories.filter((c) => c.kind === "expense");
  const categoryMap = new Map(categories.map((c) => [c.id, c]));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Budgets</h1>
        <BudgetForm
          mode="create"
          categories={expenseCategories}
          trigger={
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add budget
            </Button>
          }
        />
      </div>

      {budgets.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground">
            No budgets yet. Create one to start tracking your spending against
            targets.
          </p>
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Active Budgets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {budgets.map((b) => {
              const cat = categoryMap.get(b.categoryId);
              return (
                <BudgetCard
                  key={b.id}
                  budget={b}
                  categoryName={cat?.name ?? "Unknown"}
                  categoryColor={cat?.color ?? null}
                  actualSpend={spendByCategory.get(b.id) ?? "0"}
                  categories={expenseCategories}
                />
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
