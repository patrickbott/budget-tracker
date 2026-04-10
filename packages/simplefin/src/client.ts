import {
  AuthError,
  NetworkError,
  ProtocolError,
  RateLimitError,
} from './errors.ts';
import { parseAccountSet } from './parse.ts';
import { AccountSetResponseSchema } from './schema.ts';
import type { ParsedAccountSet } from './types.ts';

export interface FetchAccountSetOptions {
  startDate: Date;
  endDate: Date;
  /** Whether to include pending transactions. Defaults to true. */
  pending?: boolean;
}

const MAX_WINDOW_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Split a date range into chunks of at most `MAX_WINDOW_DAYS` days.
 * Returns an array of `[start, end]` pairs.
 */
function chunkDateRange(
  start: Date,
  end: Date,
): Array<[Date, Date]> {
  const chunks: Array<[Date, Date]> = [];
  let chunkStart = new Date(start.getTime());
  while (chunkStart.getTime() < end.getTime()) {
    const chunkEnd = new Date(
      Math.min(
        chunkStart.getTime() + MAX_WINDOW_DAYS * MS_PER_DAY,
        end.getTime(),
      ),
    );
    chunks.push([chunkStart, chunkEnd]);
    chunkStart = chunkEnd;
  }
  return chunks;
}

/**
 * Fetch a single chunk from the SimpleFIN Bridge `/accounts` endpoint.
 */
async function fetchChunk(
  accessUrl: string,
  start: Date,
  end: Date,
  pending: boolean,
): Promise<ParsedAccountSet> {
  const startUnix = Math.floor(start.getTime() / 1000);
  const endUnix = Math.floor(end.getTime() / 1000);
  const pendingParam = pending ? '1' : '0';
  const url = `${accessUrl}/accounts?version=2&start-date=${startUnix}&end-date=${endUnix}&pending=${pendingParam}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    throw new NetworkError('SimpleFIN fetch failed', { cause: err });
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new AuthError(
        `SimpleFIN returned HTTP ${response.status}: credentials rejected`,
      );
    }
    if (response.status === 429) {
      throw new RateLimitError(
        `SimpleFIN returned HTTP 429: rate limit exceeded`,
      );
    }
    throw new NetworkError(
      `SimpleFIN returned HTTP ${response.status}`,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    throw new NetworkError('SimpleFIN response is not valid JSON', {
      cause: err,
    });
  }

  try {
    AccountSetResponseSchema.parse(body);
  } catch (err) {
    throw new ProtocolError(
      'SimpleFIN response does not match expected schema',
      { cause: err },
    );
  }

  return parseAccountSet(body);
}

/**
 * Merge multiple `ParsedAccountSet` chunks into a single result.
 * - Transactions are concatenated per account (matched by `simplefinId`).
 * - The newest balance snapshot wins (latest `balanceDate`).
 * - Errors are unioned.
 * - `rateLimited` is true if any chunk signalled it.
 */
function mergeChunks(chunks: ParsedAccountSet[]): ParsedAccountSet {
  if (chunks.length === 1) return chunks[0]!;

  const accountMap = new Map<
    string,
    ParsedAccountSet['accounts'][number]
  >();
  const allErrors: ParsedAccountSet['errors'] = [];
  const allConnections = new Map<
    string,
    ParsedAccountSet['connections'][number]
  >();
  let rateLimited = false;

  for (const chunk of chunks) {
    rateLimited = rateLimited || chunk.rateLimited;
    allErrors.push(...chunk.errors);

    for (const conn of chunk.connections) {
      allConnections.set(conn.connId, conn);
    }

    for (const account of chunk.accounts) {
      const existing = accountMap.get(account.simplefinId);
      if (!existing) {
        // Clone so we can mutate transactions
        accountMap.set(account.simplefinId, {
          ...account,
          transactions: [...account.transactions],
        });
      } else {
        // Append transactions
        existing.transactions.push(...account.transactions);
        // Keep the newest balance snapshot
        if (account.balanceDate > existing.balanceDate) {
          existing.balance = account.balance;
          existing.availableBalance = account.availableBalance;
          existing.balanceDate = account.balanceDate;
        }
      }
    }
  }

  return {
    connections: [...allConnections.values()],
    accounts: [...accountMap.values()],
    errors: allErrors,
    rateLimited,
  };
}

/**
 * Fetch the SimpleFIN `/accounts` endpoint for the given date range.
 *
 * If the range exceeds 90 days, it is automatically split into chunks
 * and the results are merged. This handles SimpleFIN's per-request
 * date-range limit transparently.
 */
export async function fetchAccountSet(
  accessUrl: string,
  options: FetchAccountSetOptions,
): Promise<ParsedAccountSet> {
  const { startDate, endDate, pending = true } = options;
  const chunks = chunkDateRange(startDate, endDate);
  const results = await Promise.all(
    chunks.map(([start, end]) => fetchChunk(accessUrl, start, end, pending)),
  );
  return mergeChunks(results);
}
