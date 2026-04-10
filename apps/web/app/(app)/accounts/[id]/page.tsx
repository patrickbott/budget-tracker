import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import Decimal from "decimal.js";
import { eq, and, desc } from "drizzle-orm";

import { auth } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { withFamilyContext } from "@budget-tracker/db/client";
import {
  account,
  entry,
  entryLine,
  category,
  connection,
} from "@budget-tracker/db/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import {
  TransactionTable,
  type TransactionRow,
  type CategoryOption,
} from "../../transactions/_components/transaction-table";
import {
  BalanceChart,
  type BalanceDataPoint,
} from "./_components/balance-chart";

interface AccountDetailPageProps {
  params: Promise<{ id: string }>;
}

function formatCurrency(amount: string): string {
  const d = new Decimal(amount);
  return d.toNumber().toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  depository: "Depository",
  credit_card: "Credit Card",
  investment: "Investment",
  loan: "Loan",
  property: "Property",
  crypto: "Crypto",
  other: "Other",
};

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

      // Fetch entry lines for this account to build balance history + transactions.
      const rawEntries = await tx
        .select({
          entryId: entry.id,
          entryDate: entry.entryDate,
          description: entry.description,
          isPending: entry.isPending,
          lineId: entryLine.id,
          lineAccountId: entryLine.accountId,
          lineCategoryId: entryLine.categoryId,
          lineAmount: entryLine.amount,
          accountName: account.name,
          categoryName: category.name,
          categoryColor: category.color,
        })
        .from(entry)
        .innerJoin(entryLine, eq(entryLine.entryId, entry.id))
        .leftJoin(account, eq(account.id, entryLine.accountId))
        .leftJoin(category, eq(category.id, entryLine.categoryId))
        .where(eq(entry.familyId, familyId))
        .orderBy(desc(entry.entryDate));

      // Group lines by entry — only include entries that have a line touching this account.
      const entryMap = new Map<
        string,
        {
          entryId: string;
          entryDate: Date;
          description: string;
          isPending: boolean;
          accountLine?: {
            lineId: string;
            accountId: string;
            accountName: string;
            amount: string;
          };
          categoryLine?: {
            lineId: string;
            categoryId: string | null;
            categoryName: string | null;
            categoryColor: string | null;
          };
          touchesThisAccount: boolean;
        }
      >();

      for (const row of rawEntries) {
        if (!entryMap.has(row.entryId)) {
          entryMap.set(row.entryId, {
            entryId: row.entryId,
            entryDate: row.entryDate,
            description: row.description,
            isPending: row.isPending,
            touchesThisAccount: false,
          });
        }

        const e = entryMap.get(row.entryId)!;

        if (row.lineAccountId) {
          if (row.lineAccountId === accountId) {
            e.touchesThisAccount = true;
          }
          e.accountLine = {
            lineId: row.lineId,
            accountId: row.lineAccountId,
            accountName: row.accountName ?? "Unknown",
            amount: row.lineAmount,
          };
        } else {
          e.categoryLine = {
            lineId: row.lineId,
            categoryId: row.lineCategoryId,
            categoryName: row.categoryName,
            categoryColor: row.categoryColor,
          };
        }
      }

      // Build transaction rows for this account only.
      const transactionRows: TransactionRow[] = [];
      // Collect account-side amounts for balance history (sorted chronologically).
      const accountAmounts: { date: Date; amount: Decimal }[] = [];

      for (const e of entryMap.values()) {
        if (!e.touchesThisAccount || !e.accountLine) continue;

        transactionRows.push({
          entryId: e.entryId,
          entryDate: e.entryDate.toISOString().split("T")[0]!,
          description: e.description,
          isPending: e.isPending,
          accountLineId: e.accountLine.lineId,
          accountId: e.accountLine.accountId,
          accountName: e.accountLine.accountName,
          amount: e.accountLine.amount,
          categoryLineId: e.categoryLine?.lineId ?? e.accountLine.lineId,
          categoryId: e.categoryLine?.categoryId ?? null,
          categoryName: e.categoryLine?.categoryName ?? null,
          categoryColor: e.categoryLine?.categoryColor ?? null,
        });

        if (e.accountLine.accountId === accountId) {
          accountAmounts.push({
            date: e.entryDate,
            amount: new Decimal(e.accountLine.amount),
          });
        }
      }

      // Build balance history: walk backwards from current balance.
      accountAmounts.sort(
        (a, b) => b.date.getTime() - a.date.getTime(),
      );
      const balanceHistory: BalanceDataPoint[] = [];
      let runningBalance = new Decimal(acc.balance);

      // Current balance is the first data point.
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

      // Reverse so oldest is first for the chart.
      balanceHistory.reverse();

      // Fetch categories for the dropdown.
      const allCategories = await tx
        .select({
          id: category.id,
          name: category.name,
          color: category.color,
        })
        .from(category)
        .where(
          and(eq(category.familyId, familyId), eq(category.isArchived, false)),
        );

      return {
        account: acc,
        connectionName,
        transactions: transactionRows,
        balanceHistory,
        categories: allCategories as CategoryOption[],
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
