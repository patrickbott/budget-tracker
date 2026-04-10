"use client";

import Decimal from "decimal.js";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface CashflowChartProps {
  /**
   * Pre-computed monthly cashflow data from the server.
   * Each item has: month label, income (positive string), expenses (positive string).
   */
  data: Array<{
    month: string;
    income: string;
    expenses: string;
  }>;
}

export function CashflowChart({ data }: CashflowChartProps) {
  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cashflow</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No transaction data yet. Connect a bank to see your cashflow.
          </p>
        </CardContent>
      </Card>
    );
  }

  const chartData = data.map((d) => ({
    month: d.month,
    income: new Decimal(d.income).toNumber(),
    expenses: new Decimal(d.expenses).toNumber(),
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cashflow</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="month" className="text-xs" />
            <YAxis
              className="text-xs"
              tickFormatter={(v: number) =>
                new Intl.NumberFormat("en-US", {
                  style: "currency",
                  currency: "USD",
                  notation: "compact",
                  maximumFractionDigits: 0,
                }).format(v)
              }
            />
            <Tooltip
              formatter={(value, name) => [
                new Intl.NumberFormat("en-US", {
                  style: "currency",
                  currency: "USD",
                  minimumFractionDigits: 2,
                }).format(Number(value)),
                name === "income" ? "Income" : "Expenses",
              ]}
            />
            <Bar dataKey="income" fill="#22c55e" radius={[4, 4, 0, 0]} />
            <Bar dataKey="expenses" fill="#ef4444" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
