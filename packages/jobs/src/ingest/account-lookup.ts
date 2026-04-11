import { eq } from 'drizzle-orm';
import Decimal from 'decimal.js';
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

export interface AutoCreateAccountInput {
  simplefinId: string;
  name: string;
  currency: string;
  balance: Decimal;
  balanceDate: Date;
  familyId: string;
  connectionId: string;
}

/**
 * Find an internal account by SimpleFIN id, or auto-create it if not found.
 *
 * When SimpleFIN returns an account we haven't seen before, we create a
 * `depository` account mapped to this connection. The user can change the
 * type later in the UI.
 */
export async function findOrCreateAccountBySimpleFinId(
  tx: DatabaseTx,
  input: AutoCreateAccountInput,
): Promise<string> {
  const existing = await findAccountBySimpleFinId(tx, input.simplefinId);
  if (existing) return existing;

  const [created] = await tx
    .insert(account)
    .values({
      familyId: input.familyId,
      name: input.name,
      accountType: 'depository',
      currency: input.currency,
      balance: input.balance.toFixed(4),
      balanceAsOf: input.balanceDate,
      isManual: false,
      visibility: 'household',
      simplefinAccountId: input.simplefinId,
      connectionId: input.connectionId,
    })
    .returning({ id: account.id });

  return created!.id;
}
