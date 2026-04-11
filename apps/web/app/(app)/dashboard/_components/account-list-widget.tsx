import Link from "next/link";
import Decimal from "decimal.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import { ACCOUNT_TYPE_ORDER, ACCOUNT_TYPE_LABELS } from "@/lib/account-types";

interface AccountListWidgetProps {
  accounts: Array<{
    id: string;
    name: string;
    accountType: string;
    balance: string;
    currency: string;
    isClosed: boolean;
  }>;
}

export function AccountListWidget({ accounts }: AccountListWidgetProps) {
  const open = accounts.filter((a) => !a.isClosed);

  const grouped = new Map<string, typeof open>();
  for (const acct of open) {
    const group = grouped.get(acct.accountType) ?? [];
    group.push(acct);
    grouped.set(acct.accountType, group);
  }

  if (open.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No accounts yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Accounts</CardTitle>
        <Link
          href="/accounts"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          View all
        </Link>
      </CardHeader>
      <CardContent className="space-y-4">
        {ACCOUNT_TYPE_ORDER.filter((t) => grouped.has(t)).map((type) => (
          <div key={type}>
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {ACCOUNT_TYPE_LABELS[type] ?? type}
            </p>
            <div className="space-y-1">
              {grouped.get(type)!.map((acct) => {
                const isNeg = new Decimal(acct.balance).isNegative();
                return (
                  <Link
                    key={acct.id}
                    href={`/accounts/${acct.id}`}
                    className="flex items-center justify-between rounded px-2 py-1 text-sm hover:bg-muted/50"
                  >
                    <span className="truncate">{acct.name}</span>
                    <span
                      className={`font-mono tabular-nums ${
                        isNeg ? "text-red-500" : "text-green-600"
                      }`}
                    >
                      {formatCurrency(acct.balance, acct.currency)}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
