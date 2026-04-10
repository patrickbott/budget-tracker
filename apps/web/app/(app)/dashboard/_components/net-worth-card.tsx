import Decimal from "decimal.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ASSET_TYPES = new Set([
  "depository",
  "investment",
  "property",
  "crypto",
  "other_asset",
]);
const LIABILITY_TYPES = new Set(["credit_card", "loan", "other_liability"]);

interface NetWorthCardProps {
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

export function NetWorthCard({ accounts }: NetWorthCardProps) {
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
          {formatUsd(netWorth)}
        </p>
        <div className="mt-3 flex gap-6 text-sm">
          <div>
            <span className="text-muted-foreground">Assets</span>
            <p className="font-medium text-green-600 tabular-nums">
              {formatUsd(assets)}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Liabilities</span>
            <p className="font-medium text-red-500 tabular-nums">
              {formatUsd(liabilities)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
