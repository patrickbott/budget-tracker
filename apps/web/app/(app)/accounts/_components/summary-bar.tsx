import Decimal from "decimal.js";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import { ASSET_TYPES, LIABILITY_TYPES } from "@/lib/account-types";

interface SummaryBarProps {
  accounts: Array<{
    accountType: string;
    balance: string;
    isClosed: boolean;
  }>;
}

export function SummaryBar({ accounts }: SummaryBarProps) {
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
    <div className="grid gap-4 sm:grid-cols-3">
      <Card>
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">Total Assets</p>
          <p className="text-xl font-semibold text-green-600 tabular-nums">
            {formatCurrency(assets.toFixed(2))}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">Total Liabilities</p>
          <p className="text-xl font-semibold text-red-500 tabular-nums">
            {formatCurrency(liabilities.toFixed(2))}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">Net Worth</p>
          <p
            className={`text-xl font-semibold tabular-nums ${
              netWorth.isNegative() ? "text-red-500" : "text-green-600"
            }`}
          >
            {formatCurrency(netWorth.toFixed(2))}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
