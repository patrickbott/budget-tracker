import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";

import { auth } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { withFamilyContext } from "@budget-tracker/db/client";
import { connection } from "@budget-tracker/db/schema";
import { Button } from "@/components/ui/button";
import { ConnectionCard } from "@/components/domain/connection-card";

export default async function ConnectionsPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) redirect("/login");

  const familyId = session.session.activeOrganizationId;
  if (!familyId) redirect("/onboarding");

  const db = getDb();
  const connections = await withFamilyContext(
    db,
    familyId,
    session.user.id,
    async (tx) => {
      return tx.select().from(connection);
    },
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Connections</h1>
        <Button asChild>
          <Link href="/connections/new">
            <Plus className="mr-2 h-4 w-4" />
            Add connection
          </Link>
        </Button>
      </div>

      {connections.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground">
            No SimpleFIN connections yet. Add one to start syncing your bank
            transactions.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {connections.map((conn) => (
            <ConnectionCard key={conn.id} connection={conn} />
          ))}
        </div>
      )}
    </div>
  );
}
