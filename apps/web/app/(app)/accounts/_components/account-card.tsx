import Link from "next/link";
import Decimal from "decimal.js";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

interface AccountCardProps {
  account: {
    id: string;
    name: string;
    accountType: string;
    balance: string;
    currency: string;
    isClosed: boolean;
    connectionId: string | null;
  };
  connectionNickname?: string | null;
}

function formatCurrency(balance: string, currency: string): string {
  const d = new Decimal(balance);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(d.toNumber());
}

export function AccountCard({ account, connectionNickname }: AccountCardProps) {
  const bal = new Decimal(account.balance);
  const isNegative = bal.isNegative();

  return (
    <Link href={`/accounts/${account.id}`}>
      <Card className="transition-colors hover:bg-muted/50">
        <CardContent className="flex items-center justify-between py-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="min-w-0">
              <p className={`truncate font-medium ${account.isClosed ? "text-muted-foreground line-through" : ""}`}>
                {account.name}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                {account.connectionId ? (
                  <span className="text-xs text-muted-foreground">
                    {connectionNickname || "SimpleFIN"}
                  </span>
                ) : (
                  <Badge variant="outline" className="text-xs px-1.5 py-0">
                    Manual
                  </Badge>
                )}
              </div>
            </div>
          </div>

          <span
            className={`font-mono text-sm font-medium tabular-nums ${
              isNegative ? "text-red-500" : "text-green-600"
            }`}
          >
            {formatCurrency(account.balance, account.currency)}
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}
