import Decimal from "decimal.js";

/**
 * Format an amount as a currency string using Intl.NumberFormat.
 *
 * Accepts `string` (from Decimal.toFixed / DB NUMERIC) or `number`.
 * Returns `'—'` for null / undefined / NaN.
 */
export function formatCurrency(
  amount: string | number | null | undefined,
  currency = "USD",
): string {
  if (amount == null) return "—";

  const n =
    typeof amount === "string" ? new Decimal(amount).toNumber() : amount;

  if (Number.isNaN(n)) return "—";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/**
 * Compact currency formatter for chart axis labels (e.g. `$1.2k`, `$45k`).
 */
export function formatCompact(
  amount: string | number | null | undefined,
  currency = "USD",
): string {
  if (amount == null) return "—";

  const n =
    typeof amount === "string" ? new Decimal(amount).toNumber() : amount;

  if (Number.isNaN(n)) return "—";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}
