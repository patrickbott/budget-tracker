/**
 * Canonical account-type constants.
 *
 * Source of truth for enum values: packages/db/src/schema/enums.ts → accountTypeEnum.
 */

export const ASSET_TYPES = new Set([
  "depository",
  "investment",
  "property",
  "crypto",
  "other_asset",
] as const);

export const LIABILITY_TYPES = new Set([
  "credit_card",
  "loan",
  "other_liability",
] as const);

export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  depository: "Depository",
  credit_card: "Credit Card",
  investment: "Investment",
  loan: "Loan",
  property: "Property",
  crypto: "Crypto",
  other_asset: "Other Asset",
  other_liability: "Other Liability",
};

/** Display ordering — assets first, then liabilities. */
export const ACCOUNT_TYPE_ORDER = [
  "depository",
  "credit_card",
  "investment",
  "loan",
  "property",
  "crypto",
  "other_asset",
  "other_liability",
] as const;

export function isAssetType(type: string): boolean {
  return ASSET_TYPES.has(type as never);
}

export function isLiabilityType(type: string): boolean {
  return LIABILITY_TYPES.has(type as never);
}
