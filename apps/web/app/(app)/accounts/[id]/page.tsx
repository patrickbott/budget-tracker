import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import Decimal from "decimal.js";
import { eq, and } from "drizzle-orm";

import { auth } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { formatCurrency } from "@/lib/format";
import { ACCOUNT_TYPE_LABELS } from "@/lib/account-types";
import { withFamilyContext } from "@budget-tracker/db/client";
import { account, connection } from "@budget-tracker/db/schema";
import {
  fetchRawEntries,
  groupEntryRows,
  fetchCategories,
} from "@/lib/entry-queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { TransactionTable } from "../../transactions/_components/transaction-table";
import {
  BalanceChart,
  type BalanceDataPoint,
} from "./_components/balance-chart";

interface AccountDetailPageProps {
  params: Promise<{ id: string }>;
}


export default async function AccountDetailPage({
  params,
}: AccountDetailPageProps) {
  const { id: accountId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  const familyId = session.session.activeOrganizationId;
  if (!familyId) return null;

  const db = getDb();

  const result = await withFamilyContext(
    db,
    familyId,
    session.user.id,
    async (tx) => {
      // Load the account.
      const [acc] = await tx
        .select({
          id: account.id,
          name: account.name,
          accountType: account.accountType,
          balance: account.balance,
          balanceAsOf: account.balanceAsOf,
          connectionId: account.connectionId,
          currency: account.currency,
        })
        .from(account)
        .where(
          and(eq(account.id, accountId), eq(account.familyId, familyId)),
        )
        .limit(1);

      if (!acc) return null;

      // Load connection name if SimpleFIN-linked.
      let connectionName: string | null = null;
      if (acc.connectionId) {
        const [conn] = await tx
          .select({ nickname: connection.nickname })
          .from(connection)
          .where(eq(connection.id, acc.connectionId))
          .limit(1);
        connectionName = conn?.nickname ?? null;
      }

      // Fetch entries and group into transaction rows for this account.
      const rawEntries = await fetchRawEntries(tx, familyId);
      const transactionRows = groupEntryRows(rawEntries, accountId);

      // Build balance history from the transaction rows.
      const accountAmounts = transactionRows
        .filter((r) => r.accountId === accountId)
        .map((r) => ({
          date: new Date(r.entryDate),
          amount: new Decimal(r.amount),
        }));

      accountAmounts.sort(
        (a, b) => b.date.getTime() - a.date.getTime(),
      );
      const balanceHistory: BalanceDataPoint[] = [];
      let runningBalance = new Decimal(acc.balance);

      balanceHistory.push({
        date: new Date().toISOString().split("T")[0]!,
        balance: runningBalance.toNumber(),
      });

      for (const item of accountAmounts) {
        runningBalance = runningBalance.minus(item.amount);
        balanceHistory.push({
          date: item.date.toISOString().split("T")[0]!,
          balance: runningBalance.toNumber(),
        });
      }

      balanceHistory.reverse();

      const allCategories = await fetchCategories(tx, familyId);

      return {
        account: acc,
        connectionName,
        transactions: transactionRows,
        balanceHistory,
        categories: allCategories,
      };
    },
  );

  if (!result) notFound();

  const { account: acc, connectionName, transactions, balanceHistory, categories } =
    result;

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link href="/accounts">
        <Button variant="ghost" size="sm">
          ← Back to accounts
        </Button>
      </Link>

      {/* Account header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <CardTitle className="text-2xl">{acc.name}</CardTitle>
            <Badge variant="outline">
              {ACCOUNT_TYPE_LABELS[acc.accountType] ?? acc.accountType}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-6">
            <div>
              <p className="text-sm text-muted-foreground">Current Balance</p>
              <p className="text-2xl font-semibold">
                {formatCurrency(acc.balance)}
              </p>
            </div>
            {acc.balanceAsOf && (
              <div>
                <p className="text-sm text-muted-foreground">Balance As Of</p>
                <p className="text-sm">
                  {acc.balanceAsOf.toLocaleDateString()}
                </p>
              </div>
            )}
            {connectionName && (
              <div>
                <p className="text-sm text-muted-foreground">Connection</p>
                <p className="text-sm">{connectionName}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Balance history chart */}
      <Card>
        <CardHeader>
          <CardTitle>Balance History</CardTitle>
        </CardHeader>
        <CardContent>
          <BalanceChart data={balanceHistory} />
        </CardContent>
      </Card>

      {/* Transactions for this account */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Recent Transactions</h2>
        <TransactionTable
          data={transactions}
          categories={categories}
          accounts={[{ id: acc.id, name: acc.name }]}
          filterAccountId={acc.id}
        />
      </div>
    </div>
  );
}
