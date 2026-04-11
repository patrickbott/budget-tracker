"use client";

import { useState } from "react";
import Decimal from "decimal.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createBudget, updateBudget } from "../actions";

interface BudgetFormProps {
  mode: "create" | "edit";
  budget?: {
    id: string;
    categoryId: string;
    amount: string;
    mode: "hard_cap" | "forecast";
    period: "monthly" | "weekly" | "yearly";
    periodStart: Date;
    rollover: "none" | "rollover_positive" | "rollover_all";
  };
  categories: Array<{ id: string; name: string; color: string | null }>;
  trigger: React.ReactNode;
}

function formatDateForInput(d: Date): string {
  return d.toISOString().split("T")[0] ?? "";
}

function getDefaultPeriodStart(): string {
  const now = new Date();
  return formatDateForInput(new Date(now.getFullYear(), now.getMonth(), 1));
}

export function BudgetForm({
  mode,
  budget: b,
  categories,
  trigger,
}: BudgetFormProps) {
  const [open, setOpen] = useState(false);
  const [categoryId, setCategoryId] = useState(b?.categoryId ?? "");
  const [amount, setAmount] = useState(b?.amount ?? "");
  const [budgetMode, setBudgetMode] = useState<"hard_cap" | "forecast">(
    b?.mode ?? "hard_cap",
  );
  const [period, setPeriod] = useState<"monthly" | "weekly" | "yearly">(
    b?.period ?? "monthly",
  );
  const [periodStart, setPeriodStart] = useState(
    b ? formatDateForInput(b.periodStart) : getDefaultPeriodStart(),
  );
  const [rollover, setRollover] = useState<
    "none" | "rollover_positive" | "rollover_all"
  >(b?.rollover ?? "none");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function validateAmount(val: string): boolean {
    try {
      const d = new Decimal(val);
      return d.isPositive() && d.isFinite();
    } catch {
      return false;
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!categoryId) {
      setError("Category is required");
      return;
    }
    if (!amount || !validateAmount(amount)) {
      setError("Amount must be a valid positive number");
      return;
    }
    if (!periodStart) {
      setError("Period start date is required");
      return;
    }

    setPending(true);
    setError(null);

    const normalizedAmount = new Decimal(amount).toFixed(4);

    const result =
      mode === "create"
        ? await createBudget({
            categoryId,
            amount: normalizedAmount,
            mode: budgetMode,
            period,
            periodStart,
            rollover,
          })
        : await updateBudget(b!.id, {
            categoryId,
            amount: normalizedAmount,
            mode: budgetMode,
            period,
            periodStart,
            rollover,
          });

    setPending(false);

    if (!result.success) {
      setError(result.error ?? "Something went wrong");
      return;
    }

    setOpen(false);
    if (mode === "create") {
      setCategoryId("");
      setAmount("");
      setBudgetMode("hard_cap");
      setPeriod("monthly");
      setPeriodStart(getDefaultPeriodStart());
      setRollover("none");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Create Budget" : "Edit Budget"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="budget-category">Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger id="budget-category">
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{
                          backgroundColor: c.color ?? "#9ca3af",
                        }}
                      />
                      {c.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="budget-amount">Amount</Label>
            <Input
              id="budget-amount"
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 500.00"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="budget-mode">Mode</Label>
            <Select
              value={budgetMode}
              onValueChange={(v) => setBudgetMode(v as "hard_cap" | "forecast")}
            >
              <SelectTrigger id="budget-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hard_cap">Hard Cap (do not exceed)</SelectItem>
                <SelectItem value="forecast">
                  Forecast (expected baseline)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="budget-period">Period</Label>
            <Select
              value={period}
              onValueChange={(v) =>
                setPeriod(v as "monthly" | "weekly" | "yearly")
              }
            >
              <SelectTrigger id="budget-period">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="yearly">Yearly</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="budget-period-start">Period Start</Label>
            <Input
              id="budget-period-start"
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="budget-rollover">Rollover</Label>
            <Select
              value={rollover}
              onValueChange={(v) =>
                setRollover(
                  v as "none" | "rollover_positive" | "rollover_all",
                )
              }
            >
              <SelectTrigger id="budget-rollover">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None (reset each period)</SelectItem>
                <SelectItem value="rollover_positive">
                  Rollover unspent
                </SelectItem>
                <SelectItem value="rollover_all">
                  Rollover all (positive + negative)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving..." : mode === "create" ? "Create" : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
