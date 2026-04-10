import { and, eq, sql } from 'drizzle-orm';
import { entry, entryLine } from '@budget-tracker/db/schema';
import type { DatabaseTx } from '@budget-tracker/db/client';

/**
 * Shape that Instance A's `buildEntriesForSimpleFinTransactions` returns.
 * Defined here as a local type so we don't import from `@budget-tracker/core`
 * at the type level (the package doesn't exist in the workspace yet).
 * Once Instance A merges, this can be replaced with the real import.
 */
export interface BuiltEntry {
  entry: {
    familyId: string;
    entryDate: Date;
    entryableType: 'transaction';
    description: string;
    source: 'simplefin';
    isPending: boolean;
    externalId: string;
    externalAccountId: string;
  };
  lines: Array<{
    accountId: string | null;
    categoryId: string | null;
    amount: string;
    memo: string | null;
  }>;
}

export interface UpsertResult {
  created: number;
  updated: number;
  skipped: number;
}

/**
 * Upsert entries from a SimpleFIN sync into the database.
 *
 * For each built entry:
 * 1. Look for an existing row by (source, external_account_id, external_id).
 * 2. If found and existing is pending but new is not → flip pending to false.
 * 3. If found and no state change → skip (idempotent re-run).
 * 4. If not found → insert entry + entry_line rows.
 *
 * The deferred trigger on entry_line validates sum-to-zero at commit.
 *
 * Secondary match for pending-to-posted-with-new-id is explicitly R2.
 */
export async function upsertEntriesForSimpleFin(
  tx: DatabaseTx,
  built: readonly BuiltEntry[],
  _familyId: string,
): Promise<UpsertResult> {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const b of built) {
    const existing = await tx
      .select({
        id: entry.id,
        isPending: entry.isPending,
      })
      .from(entry)
      .where(
        and(
          eq(entry.source, 'simplefin'),
          eq(entry.externalAccountId, b.entry.externalAccountId),
          eq(entry.externalId, b.entry.externalId),
        ),
      )
      .limit(1);

    if (existing[0]) {
      // Match found — check pending→posted transition.
      if (existing[0].isPending && !b.entry.isPending) {
        await tx
          .update(entry)
          .set({
            isPending: false,
            description: b.entry.description,
            updatedAt: new Date(),
          })
          .where(eq(entry.id, existing[0].id));
        updated++;
      } else {
        skipped++;
      }
      continue;
    }

    // No match — insert new entry + lines.
    const [insertedEntry] = await tx
      .insert(entry)
      .values({
        familyId: b.entry.familyId,
        entryDate: b.entry.entryDate,
        entryableType: b.entry.entryableType,
        description: b.entry.description,
        source: b.entry.source,
        isPending: b.entry.isPending,
        externalId: b.entry.externalId,
        externalAccountId: b.entry.externalAccountId,
      })
      .returning({ id: entry.id });

    await tx.insert(entryLine).values(
      b.lines.map((line) => ({
        entryId: insertedEntry!.id,
        accountId: line.accountId,
        categoryId: line.categoryId,
        amount: line.amount,
        memo: line.memo,
      })),
    );

    created++;
  }

  return { created, updated, skipped };
}
