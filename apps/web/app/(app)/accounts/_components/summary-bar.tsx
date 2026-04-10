import Decimal from "decimal.js";
import { Card, CardContent } from "@/components/ui/card";

const ASSET_TYPES = new Set([
  "depository",
  "investment",
  "property",
  "crypto",
  "other_asset",
]);
const LIABILITY_TYPES = new Set(["credit_card", "loan", "other_liability"]);

interface SummaryBarProps {
  accounts: Array<{
    accountType: string;
    balance: string;
    isClosed: boolean;
  }>;
}

function formatUsd(d: Decimal): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(d.toNumber());
}

export function SummaryBar({ accounts }: SummaryBarProps) {
  const open = accounts.filter((a) => !a.isClosed);

  let assets = new Decimal(0);
  let liabilities = new Decimal(0);

  for (const a of open) {
    const bal = new Decimal(a.balance);
    if (ASSET_TYPES.has(a.accountType)) {
      assets = assets.plus(bal);
    } else if (LIABILITY_TYPES.has(a.accountType)) {
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
            {formatUsd(assets)}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">Total Liabilities</p>
          <p className="text-xl font-semibold text-red-500 tabular-nums">
            {formatUsd(liabilities)}
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
            {formatUsd(netWorth)}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
