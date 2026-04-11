import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";

interface NetWorthCardProps {
  /** Pre-computed net-worth result from `core.netWorth`. */
  asset: string;
  liability: string;
  net: string;
}

export function NetWorthCard({ asset, liability, net }: NetWorthCardProps) {
  const isNegative = net.startsWith("-");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Net Worth</CardTitle>
      </CardHeader>
      <CardContent>
        <p
          className={`text-3xl font-bold tabular-nums ${
            isNegative ? "text-red-500" : "text-green-600"
          }`}
        >
          {formatCurrency(net)}
        </p>
        <div className="mt-3 flex gap-6 text-sm">
          <div>
            <span className="text-muted-foreground">Assets</span>
            <p className="font-medium text-green-600 tabular-nums">
              {formatCurrency(asset)}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Liabilities</span>
            <p className="font-medium text-red-500 tabular-nums">
              {formatCurrency(liability)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
