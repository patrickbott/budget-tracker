import Decimal from "decimal.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import { ASSET_TYPES, LIABILITY_TYPES } from "@/lib/account-types";

interface NetWorthCardProps {
  accounts: Array<{
    accountType: string;
    balance: string;
    isClosed: boolean;
  }>;
}

export function NetWorthCard({ accounts }: NetWorthCardProps) {
  const open = accounts.filter((a) => !a.isClosed);

  let assets = new Decimal(0);
  let liabilities = new Decimal(0);

  for (const a of open) {
    const bal = new Decimal(a.balance);
    if (ASSET_TYPES.has(a.accountType as never)) {
      assets = assets.plus(bal);
    } else if (LIABILITY_TYPES.has(a.accountType as never)) {
      liabilities = liabilities.plus(bal);
    }
  }

  const netWorth = assets.plus(liabilities);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Net Worth</CardTitle>
      </CardHeader>
      <CardContent>
        <p
          className={`text-3xl font-bold tabular-nums ${
            netWorth.isNegative() ? "text-red-500" : "text-green-600"
          }`}
        >
          {formatCurrency(netWorth.toFixed(2))}
        </p>
        <div className="mt-3 flex gap-6 text-sm">
          <div>
            <span className="text-muted-foreground">Assets</span>
            <p className="font-medium text-green-600 tabular-nums">
              {formatCurrency(assets.toFixed(2))}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Liabilities</span>
            <p className="font-medium text-red-500 tabular-nums">
              {formatCurrency(liabilities.toFixed(2))}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
