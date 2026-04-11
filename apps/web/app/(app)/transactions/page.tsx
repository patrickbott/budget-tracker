import { headers } from "next/headers";
import { eq, and } from "drizzle-orm";

import { auth } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { withFamilyContext } from "@budget-tracker/db/client";
import { account } from "@budget-tracker/db/schema";
import {
  fetchRawEntries,
  groupEntryRows,
  fetchCategories,
} from "@/lib/entry-queries";

import { TransactionTable } from "./_components/transaction-table";

export default async function TransactionsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  const familyId = session.session.activeOrganizationId;
  if (!familyId) return null;

  const db = getDb();

  const { rows, categories, accounts } = await withFamilyContext(
    db,
    familyId,
    session.user.id,
    async (tx) => {
      const rawEntries = await fetchRawEntries(tx, familyId);
      const transactionRows = groupEntryRows(rawEntries);
      const allCategories = await fetchCategories(tx, familyId);

      const allAccounts = await tx
        .select({
          id: account.id,
          name: account.name,
        })
        .from(account)
        .where(
          and(
            eq(account.familyId, familyId),
            eq(account.isClosed, false),
          ),
        );

      return {
        rows: transactionRows,
        categories: allCategories,
        accounts: allAccounts,
      };
    },
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
      <TransactionTable
        data={rows}
        categories={categories}
        accounts={accounts}
      />
    </div>
  );
}
