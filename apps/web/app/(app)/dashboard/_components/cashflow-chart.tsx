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
import { formatCurrency, formatCompact } from "@/lib/format";

interface CashflowChartProps {
  /**
   * Pre-computed cashflow rows from `core.cashflow`. `period` is the ISO
   * bucket start (YYYY-MM-DD for all granularities — `month` buckets
   * resolve to the first of the month in UTC).
   */
  data: Array<{
    period: string;
    income: string;
    expense: string;
    net: string;
  }>;
}

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function periodToMonthLabel(period: string): string {
  const [, monthStr] = period.split("-");
  const monthIdx = Number(monthStr) - 1;
  return MONTH_LABELS[monthIdx] ?? period;
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
    month: periodToMonthLabel(d.period),
    income: new Decimal(d.income).toNumber(),
    expense: new Decimal(d.expense).toNumber(),
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
              tickFormatter={(v: number) => formatCompact(v)}
            />
            <Tooltip
              formatter={(value, name) => [
                formatCurrency(Number(value)),
                name === "income" ? "Income" : "Expenses",
              ]}
            />
            <Bar dataKey="income" fill="#22c55e" radius={[4, 4, 0, 0]} />
            <Bar dataKey="expense" fill="#ef4444" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
