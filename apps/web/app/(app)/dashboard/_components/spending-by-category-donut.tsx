"use client";

import Decimal from "decimal.js";
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";

export interface SpendingDisplayRow {
  categoryId: string;
  /** Total spend for this category as a 2-decimal string. */
  total: string;
  name: string;
  color: string | null;
}

interface SpendingByCategoryDonutProps {
  /**
   * Rows from `core.spendingByCategory` already joined with category
   * display info (name, color). Pre-sorted by total DESC.
   */
  rows: SpendingDisplayRow[];
}

const TOP_N = 6;
const OTHER_COLOR = "#9ca3af";
const FALLBACK_COLOR = "#9ca3af";

interface ChartSlice {
  key: string;
  name: string;
  value: number;
  color: string;
}

function buildChartData(rows: SpendingDisplayRow[]): ChartSlice[] {
  if (rows.length <= TOP_N) {
    return rows.map((r) => ({
      key: r.categoryId,
      name: r.name,
      value: new Decimal(r.total).toNumber(),
      color: r.color ?? FALLBACK_COLOR,
    }));
  }

  const top = rows.slice(0, TOP_N).map((r) => ({
    key: r.categoryId,
    name: r.name,
    value: new Decimal(r.total).toNumber(),
    color: r.color ?? FALLBACK_COLOR,
  }));

  let otherTotal = new Decimal(0);
  for (const r of rows.slice(TOP_N)) {
    otherTotal = otherTotal.plus(r.total);
  }

  top.push({
    key: "__other__",
    name: "Other",
    value: otherTotal.toNumber(),
    color: OTHER_COLOR,
  });

  return top;
}

export function SpendingByCategoryDonut({ rows }: SpendingByCategoryDonutProps) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Spending by Category</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No spending this month yet. Categorize a few transactions to see the
            breakdown.
          </p>
        </CardContent>
      </Card>
    );
  }

  const chartData = buildChartData(rows);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Spending by Category</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={90}
              paddingAngle={1}
              stroke="none"
            >
              {chartData.map((slice) => (
                <Cell key={slice.key} fill={slice.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => [formatCurrency(Number(value)), "Spent"]}
            />
            <Legend
              verticalAlign="bottom"
              height={36}
              iconType="circle"
              wrapperStyle={{ fontSize: "0.75rem" }}
            />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
