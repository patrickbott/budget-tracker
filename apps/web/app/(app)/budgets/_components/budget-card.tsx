"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import Decimal from "decimal.js";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/format";
import { deleteBudget } from "../actions";
import { BudgetForm } from "./budget-form";

interface BudgetCardProps {
  budget: {
    id: string;
    categoryId: string;
    amount: string;
    mode: "hard_cap" | "forecast";
    period: "monthly" | "weekly" | "yearly";
    periodStart: Date;
    rollover: "none" | "rollover_positive" | "rollover_all";
  };
  categoryName: string;
  categoryColor: string | null;
  actualSpend: string;
  categories: Array<{ id: string; name: string; color: string | null }>;
}

function getProgressColor(
  mode: "hard_cap" | "forecast",
  pct: number,
): string {
  if (mode === "hard_cap") {
    if (pct > 100) return "bg-red-500";
    if (pct >= 80) return "bg-amber-500";
    return "bg-green-500";
  }
  // forecast: green within 10% over, amber 10-30% over, red 30%+ over
  if (pct >= 130) return "bg-red-500";
  if (pct >= 110) return "bg-amber-500";
  return "bg-green-500";
}

export function BudgetCard({
  budget: b,
  categoryName,
  categoryColor,
  actualSpend,
  categories,
}: BudgetCardProps) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = new Decimal(b.amount);
  const actual = new Decimal(actualSpend);
  const remaining = target.minus(actual);
  const pct = target.isZero() ? 0 : actual.div(target).times(100).toNumber();
  const barWidth = Math.min(pct, 100);

  async function handleDelete() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    const result = await deleteBudget(b.id);
    if (!result.success) {
      setError(result.error ?? "Failed to delete");
      setConfirming(false);
    }
  }

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: categoryColor ?? "#9ca3af" }}
          />
          <span className="font-medium">{categoryName}</span>
          <Badge variant="outline" className="text-xs">
            {b.mode === "hard_cap" ? "Hard Cap" : "Forecast"}
          </Badge>
          <Badge variant="secondary" className="text-xs">
            {b.period}
          </Badge>
        </div>

        <div className="flex items-center gap-1">
          <BudgetForm
            mode="edit"
            budget={b}
            categories={categories}
            trigger={
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Pencil className="h-4 w-4" />
              </Button>
            }
          />
          <Button
            variant={confirming ? "destructive" : "ghost"}
            size="icon"
            className="h-8 w-8"
            onClick={handleDelete}
            onBlur={() => setConfirming(false)}
            title={confirming ? "Click again to confirm" : "Delete"}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="h-2.5 w-full rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-all ${getProgressColor(b.mode, pct)}`}
            style={{ width: `${barWidth}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {formatCurrency(actual.toFixed(2))} of{" "}
            {formatCurrency(target.toFixed(2))}
          </span>
          <span
            className={
              remaining.isNegative() ? "font-medium text-red-500" : ""
            }
          >
            {remaining.isNegative()
              ? `${formatCurrency(remaining.abs().toFixed(2))} over`
              : `${formatCurrency(remaining.toFixed(2))} left`}
          </span>
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
