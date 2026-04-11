import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { withFamilyContext } from "@budget-tracker/db/client";
import { account, connection } from "@budget-tracker/db/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SummaryBar } from "./_components/summary-bar";
import { AccountCard } from "./_components/account-card";
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPE_ORDER } from "@/lib/account-types";

export default async function AccountsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const familyId = session.session.activeOrganizationId;
  if (!familyId) redirect("/onboarding");

  const db = getDb();

  const [accounts, connections] = await withFamilyContext(
    db,
    familyId,
    session.user.id,
    async (tx) => {
      const accts = await tx.select().from(account);
      const conns = await tx.select().from(connection);
      return [accts, conns] as const;
    },
  );

  const connectionMap = new Map(
    connections.map((c) => [c.id, c.nickname]),
  );

  // Group by account type
  const grouped = new Map<string, typeof accounts>();
  for (const acct of accounts) {
    const group = grouped.get(acct.accountType) ?? [];
    group.push(acct);
    grouped.set(acct.accountType, group);
  }

  const closedAccounts = accounts.filter((a) => a.isClosed);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Accounts</h1>

      {accounts.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground">
            No accounts yet. Connect a bank via SimpleFIN to get started.
          </p>
        </div>
      ) : (
        <>
          <SummaryBar accounts={accounts} />

          {ACCOUNT_TYPE_ORDER.filter((type) => {
            const group = grouped.get(type);
            return group && group.some((a) => !a.isClosed);
          }).map((type) => {
            const group = grouped.get(type)!.filter((a) => !a.isClosed);
            return (
              <Card key={type}>
                <CardHeader>
                  <CardTitle className="text-lg">
                    {ACCOUNT_TYPE_LABELS[type] ?? type}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {group.map((acct) => (
                    <AccountCard
                      key={acct.id}
                      account={acct}
                      connectionNickname={
                        acct.connectionId
                          ? connectionMap.get(acct.connectionId)
                          : null
                      }
                    />
                  ))}
                </CardContent>
              </Card>
            );
          })}

          {closedAccounts.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
                Closed accounts ({closedAccounts.length})
              </summary>
              <div className="mt-3 space-y-2">
                {closedAccounts.map((acct) => (
                  <AccountCard
                    key={acct.id}
                    account={acct}
                    connectionNickname={
                      acct.connectionId
                        ? connectionMap.get(acct.connectionId)
                        : null
                    }
                  />
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
