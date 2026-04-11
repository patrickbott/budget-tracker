import { and, eq } from 'drizzle-orm';
import { entry, entryLine } from '@budget-tracker/db/schema';
import type { DatabaseTx } from '@budget-tracker/db/client';
import type { BuiltEntry } from '@budget-tracker/core/entries';

// Re-export so existing consumers (sync-connection.ts) don't break.
// Core's BuiltEntry includes pre-generated `entryId` / `entry.id` /
// `lines[].entryId` fields — the upsert intentionally ignores those
// and lets the DB generate real IDs during INSERT.
export type { BuiltEntry };

export interface UpsertResult {
  created: number;
  updated: number;
  skipped: number;
  /** IDs of entries freshly INSERTed by this call. Used by the sync
   *  worker to scope post-ingest rules application to just the new
   *  rows rather than re-processing the whole family on every pull. */
  createdEntryIds: string[];
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
): Promise<UpsertResult> {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const createdEntryIds: string[] = [];

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
          eq(entry.externalAccountId, b.dedupKey.externalAccountId),
          eq(entry.externalId, b.dedupKey.externalId),
        ),
      )
      .limit(1);

    if (existing[0]) {
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

    const [insertedEntry] = await tx
      .insert(entry)
      .values({
        familyId: b.entry.familyId,
        entryDate: b.entry.entryDate,
        entryableType: b.entry.entryableType,
        description: b.entry.description,
        source: b.entry.source,
        isPending: b.entry.isPending,
        externalId: b.dedupKey.externalId,
        externalAccountId: b.dedupKey.externalAccountId,
      })
      .returning({ id: entry.id });

    await tx.insert(entryLine).values(
      b.lines.map((line) => ({
        entryId: insertedEntry!.id,
        accountId: line.accountId,
        categoryId: line.categoryId,
        amount: line.amount,
      })),
    );

    created++;
    createdEntryIds.push(insertedEntry!.id);
  }

  return { created, updated, skipped, createdEntryIds };
}
