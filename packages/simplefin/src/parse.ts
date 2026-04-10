import Decimal from 'decimal.js';

import { ProtocolError } from './errors.ts';
import { AccountSetResponseSchema } from './schema.ts';
import type {
  ParsedAccount,
  ParsedAccountSet,
  ParsedConnection,
  ParsedError,
  ParsedTransaction,
} from './types.ts';

/**
 * Check whether an errlist code signals a rate-limit condition.
 * Explicit pattern — tighten as we see real codes from the Bridge.
 */
function isRateLimitCode(code: string): boolean {
  return /^RATE_LIMIT$|^QUOTA/i.test(code);
}

function parseDecimal(raw: string, context: string): Decimal {
  try {
    return new Decimal(raw);
  } catch (err) {
    throw new ProtocolError(
      `Non-numeric amount "${raw}" in ${context}`,
      { cause: err },
    );
  }
}

function unixSecondsToDate(seconds: number): Date {
  return new Date(seconds * 1000);
}

/**
 * Parse and validate a raw SimpleFIN `/accounts?version=2` JSON payload
 * into application-friendly types with proper `Decimal` amounts and `Date`
 * timestamps.
 */
export function parseAccountSet(raw: unknown): ParsedAccountSet {
  const parsed = AccountSetResponseSchema.parse(raw);

  const errors: ParsedError[] = parsed.errlist.map((e) => ({
    code: e.code,
    message: e.msg,
    connId: e.conn_id,
    accountId: e.account_id,
  }));

  const rateLimited = parsed.errlist.some((e) => isRateLimitCode(e.code));

  const connections: ParsedConnection[] = parsed.connections.map((c) => ({
    connId: c.conn_id,
    name: c.name,
    orgId: c.org_id,
    orgUrl: c.org_url,
    sfinUrl: c.sfin_url,
  }));

  const accounts: ParsedAccount[] = parsed.accounts.map((a) => {
    const transactions: ParsedTransaction[] = a.transactions.map((t) => ({
      simplefinId: t.id,
      posted: unixSecondsToDate(t.posted),
      transactedAt:
        t.transacted_at !== undefined
          ? unixSecondsToDate(t.transacted_at)
          : undefined,
      amount: parseDecimal(t.amount, `transaction ${t.id}`),
      description: t.description,
      pending: t.pending,
      extra: t.extra,
    }));

    return {
      simplefinId: a.id,
      simplefinConnId: a.conn_id,
      name: a.name,
      currency: a.currency,
      balance: parseDecimal(a.balance, `account ${a.id} balance`),
      availableBalance:
        a['available-balance'] !== undefined
          ? parseDecimal(
              a['available-balance'],
              `account ${a.id} available-balance`,
            )
          : undefined,
      balanceDate: unixSecondsToDate(a['balance-date']),
      transactions,
      extra: a.extra,
    };
  });

  return { connections, accounts, errors, rateLimited };
}
