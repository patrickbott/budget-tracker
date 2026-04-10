import Decimal from 'decimal.js';

import { validateEntryLines } from './index.ts';

export interface BuildEntriesInput {
  /** The parsed SimpleFIN transactions to shape. Already filtered to one
   *  internal account by the caller. */
  transactions: ReadonlyArray<{
    simplefinId: string;
    posted: Date;
    transactedAt?: Date;
    amount: Decimal;
    description: string;
    pending: boolean;
  }>;
  /** Internal uuid of the depository/credit/etc account these transactions
   *  belong to. */
  accountId: string;
  /** The opaque SimpleFIN account id (used in dedupKey, scoped by connection). */
  simplefinAccountId: string;
  /** Internal uuid of the family that owns the account. */
  familyId: string;
  /** Internal uuid of the "Uncategorized" category to point the off-leg at. */
  uncategorizedCategoryId: string;
}

export interface BuiltEntry {
  entryId: string;
  dedupKey: {
    externalAccountId: string;
    externalId: string;
  };
  entry: {
    id: string;
    familyId: string;
    entryDate: Date;
    description: string;
    isPending: boolean;
    entryableType: 'transaction';
    source: 'simplefin';
  };
  lines: ReadonlyArray<{
    entryId: string;
    accountId: string | null;
    categoryId: string | null;
    amount: string;
  }>;
}

export interface BuildResult {
  built: BuiltEntry[];
  skipped: Array<{ simplefinId: string; reason: string }>;
}

/**
 * Shape parsed SimpleFIN transactions into ready-to-insert `entry` +
 * `entry_line` rows. Pure function — no I/O, no DB, no network.
 *
 * For each transaction, produces two balanced entry_lines:
 * - Account leg: same sign as the SimpleFIN amount
 * - Category leg: opposite sign (so lines sum to zero)
 *
 * Zero-amount transactions are skipped. The double-entry invariant
 * (sum = 0) is asserted for every built entry before return.
 */
export function buildEntriesForSimpleFinTransactions(
  input: BuildEntriesInput,
): BuildResult {
  const built: BuiltEntry[] = [];
  const skipped: BuildResult['skipped'] = [];

  for (const tx of input.transactions) {
    if (tx.amount.isZero()) {
      skipped.push({ simplefinId: tx.simplefinId, reason: 'zero_amount' });
      continue;
    }

    const entryId = crypto.randomUUID();
    const accountAmount = tx.amount.toFixed(4);
    const categoryAmount = tx.amount.negated().toFixed(4);

    const lines = [
      {
        entryId,
        accountId: input.accountId,
        categoryId: null,
        amount: accountAmount,
      },
      {
        entryId,
        accountId: null,
        categoryId: input.uncategorizedCategoryId,
        amount: categoryAmount,
      },
    ] as const;

    // Assert double-entry invariant — a failure here is an implementation bug
    const validation = validateEntryLines(
      lines.map((l) => ({ amount: l.amount })),
    );
    if (!validation.ok) {
      throw new Error(
        `Double-entry invariant violated for SimpleFIN transaction ` +
          `${tx.simplefinId}: lines sum to ${validation.sum}, expected 0`,
      );
    }

    built.push({
      entryId,
      dedupKey: {
        externalAccountId: input.simplefinAccountId,
        externalId: tx.simplefinId,
      },
      entry: {
        id: entryId,
        familyId: input.familyId,
        entryDate: tx.transactedAt ?? tx.posted,
        description: tx.description,
        isPending: tx.pending,
        entryableType: 'transaction',
        source: 'simplefin',
      },
      lines: [...lines],
    });
  }

  return { built, skipped };
}
