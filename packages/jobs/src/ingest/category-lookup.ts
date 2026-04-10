import { and, eq, or } from 'drizzle-orm';
import { category } from '@budget-tracker/db/schema';
import type { DatabaseTx } from '@budget-tracker/db/client';

/**
 * Look up the "Uncategorized" category for a family, creating it if it
 * doesn't exist yet.
 *
 * We match on `kind = 'expense'` AND `name = 'Uncategorized'` rather than
 * a dedicated `is_default` flag because the category table has no such
 * column and adding one just for this lookup isn't worth a schema change.
 */
export async function findOrCreateUncategorized(
  tx: DatabaseTx,
  familyId: string,
): Promise<string> {
  const existing = await tx
    .select({ id: category.id })
    .from(category)
    .where(
      and(
        eq(category.familyId, familyId),
        eq(category.kind, 'expense'),
        eq(category.name, 'Uncategorized'),
      ),
    )
    .limit(1);

  if (existing[0]) return existing[0].id;

  const inserted = await tx
    .insert(category)
    .values({
      familyId,
      name: 'Uncategorized',
      kind: 'expense',
      color: '#6b7280',
      icon: 'circle-help',
      sortOrder: 9999,
    })
    .returning({ id: category.id });

  return inserted[0]!.id;
}
