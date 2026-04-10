import { eq } from 'drizzle-orm';
import { account } from '@budget-tracker/db/schema';
import type { DatabaseTx } from '@budget-tracker/db/client';

/**
 * Find an internal account id by its SimpleFIN account id.
 *
 * RLS handles family scoping — the caller must be inside a
 * `withFamilyContext` transaction.
 */
export async function findAccountBySimpleFinId(
  tx: DatabaseTx,
  simplefinId: string,
): Promise<string | null> {
  const rows = await tx
    .select({ id: account.id })
    .from(account)
    .where(eq(account.simplefinAccountId, simplefinId))
    .limit(1);
  return rows[0]?.id ?? null;
}
