import type Decimal from 'decimal.js';

export interface ParsedAccountSet {
  connections: ParsedConnection[];
  accounts: ParsedAccount[];
  errors: ParsedError[];
  /** True if errlist contained any rate-limit code. */
  rateLimited: boolean;
}

export interface ParsedConnection {
  connId: string;
  name: string;
  orgId: string;
  orgUrl?: string;
  sfinUrl: string;
}

export interface ParsedAccount {
  /** Opaque SimpleFIN account id — NOT stable across re-link. */
  simplefinId: string;
  simplefinConnId: string;
  name: string;
  currency: string;
  /** Parsed from string via `new Decimal(...)`. */
  balance: Decimal;
  availableBalance?: Decimal;
  /** Converted from unix seconds. */
  balanceDate: Date;
  transactions: ParsedTransaction[];
  extra?: Record<string, unknown>;
}

export interface ParsedTransaction {
  /** Opaque SimpleFIN transaction id — unique only per-account. */
  simplefinId: string;
  /** Converted from unix seconds. */
  posted: Date;
  transactedAt?: Date;
  /** Parsed from string — never parseFloat'd. */
  amount: Decimal;
  /** May be truncated to ~32 chars by SimpleFIN Bridge. */
  description: string;
  pending: boolean;
  extra?: Record<string, unknown>;
}

export interface ParsedError {
  code: string;
  message: string;
  connId?: string;
  accountId?: string;
}
