import Link from "next/link";
import Decimal from "decimal.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface RecentTransactionsProps {
  entries: Array<{
    id: string;
    entryDate: Date;
    description: string;
    /** The account-side line amount (positive = money in, negative = money out). */
    amount: string;
    categoryName: string | null;
    categoryColor: string | null;
  }>;
}

function formatCurrency(amount: string): string {
  const d = new Decimal(amount);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(d.toNumber());
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

export function RecentTransactions({ entries }: RecentTransactionsProps) {
  if (entries.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent Transactions</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No transactions yet. Sync your bank to see activity here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Recent Transactions</CardTitle>
        <Link
          href="/transactions"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          View all
        </Link>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {entries.map((e) => {
            const isNeg = new Decimal(e.amount).isNegative();
            return (
              <div
                key={e.id}
                className="flex items-center gap-3 rounded px-2 py-1.5 text-sm hover:bg-muted/50"
              >
                <span className="w-14 shrink-0 text-xs text-muted-foreground">
                  {formatDate(e.entryDate)}
                </span>

                <div className="flex min-w-0 flex-1 items-center gap-2">
                  {e.categoryColor && (
                    <div
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: e.categoryColor }}
                    />
                  )}
                  <span className="truncate">{e.description}</span>
                  {e.categoryName && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {e.categoryName}
                    </span>
                  )}
                </div>

                <span
                  className={`shrink-0 font-mono tabular-nums ${
                    isNeg ? "text-red-500" : "text-green-600"
                  }`}
                >
                  {formatCurrency(e.amount)}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
