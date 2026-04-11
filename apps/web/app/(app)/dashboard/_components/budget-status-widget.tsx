"use client";

import Link from "next/link";
import Decimal from "decimal.js";
import { Target } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";

interface BudgetStatusItem {
  id: string;
  categoryName: string;
  categoryColor: string | null;
  mode: "hard_cap" | "forecast";
  amount: string;
  actualSpend: string;
}

interface BudgetStatusWidgetProps {
  budgets: BudgetStatusItem[];
}

function getBarColor(mode: "hard_cap" | "forecast", pct: number): string {
  if (mode === "hard_cap") {
    if (pct > 100) return "bg-red-500";
    if (pct >= 80) return "bg-amber-500";
    return "bg-green-500";
  }
  if (pct >= 130) return "bg-red-500";
  if (pct >= 110) return "bg-amber-500";
  return "bg-green-500";
}

export function BudgetStatusWidget({ budgets }: BudgetStatusWidgetProps) {
  if (budgets.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Budgets
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No budgets set up yet.{" "}
            <Link
              href="/budgets"
              className="text-primary underline-offset-4 hover:underline"
            >
              Set up your first budget
            </Link>
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Budgets
          </CardTitle>
          <Link
            href="/budgets"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            View all
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {budgets.map((b) => {
          const target = new Decimal(b.amount);
          const actual = new Decimal(b.actualSpend);
          const pct = target.isZero()
            ? 0
            : actual.div(target).times(100).toNumber();
          const barWidth = Math.min(pct, 100);

          return (
            <div key={b.id} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{
                      backgroundColor: b.categoryColor ?? "#9ca3af",
                    }}
                  />
                  <span className="font-medium">{b.categoryName}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatCurrency(actual.toFixed(2))} /{" "}
                  {formatCurrency(target.toFixed(2))}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted">
                <div
                  className={`h-full rounded-full transition-all ${getBarColor(b.mode, pct)}`}
                  style={{ width: `${barWidth}%` }}
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
