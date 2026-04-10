"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export interface BalanceDataPoint {
  date: string;
  balance: number;
}

interface BalanceChartProps {
  data: BalanceDataPoint[];
}

export function BalanceChart({ data }: BalanceChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        No balance history available.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="balanceGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="date"
          className="text-xs"
          tickFormatter={(v: string) => {
            const d = new Date(v);
            return d.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            });
          }}
        />
        <YAxis
          className="text-xs"
          tickFormatter={(v: number) =>
            v.toLocaleString(undefined, {
              style: "currency",
              currency: "USD",
              minimumFractionDigits: 0,
              maximumFractionDigits: 0,
            })
          }
        />
        <Tooltip
          formatter={(value) => {
            const num = Number(value);
            return num.toLocaleString(undefined, {
              style: "currency",
              currency: "USD",
              minimumFractionDigits: 2,
            });
          }}
          labelFormatter={(label) => {
            const d = new Date(String(label));
            return d.toLocaleDateString(undefined, {
              month: "long",
              day: "numeric",
              year: "numeric",
            });
          }}
        />
        <Area
          type="monotone"
          dataKey="balance"
          stroke="hsl(var(--primary))"
          fill="url(#balanceGradient)"
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
