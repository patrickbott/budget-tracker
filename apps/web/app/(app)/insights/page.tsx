import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";

import { auth } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { withFamilyContext } from "@budget-tracker/db/client";
import { insight } from "@budget-tracker/db/schema";

import { InsightList, type InsightRow } from "./_components/insight-list";

function isoDate(d: Date): string {
  return d.toISOString().split("T")[0]!;
}

export default async function InsightsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const familyId = session.session.activeOrganizationId;
  if (!familyId) redirect("/onboarding");

  const db = getDb();

  const rows = await withFamilyContext(
    db,
    familyId,
    session.user.id,
    async (tx) => {
      return tx
        .select({
          id: insight.id,
          periodStart: insight.periodStart,
          periodEnd: insight.periodEnd,
          generatedAt: insight.generatedAt,
          markdownBody: insight.markdownBody,
          tokensUsed: insight.tokensUsed,
          costUsd: insight.costUsd,
          emailedAt: insight.emailedAt,
        })
        .from(insight)
        .where(eq(insight.familyId, familyId))
        .orderBy(desc(insight.periodStart))
        .limit(20);
    },
  );

  const insights: InsightRow[] = rows.map((r) => ({
    id: r.id,
    periodStart: isoDate(r.periodStart),
    periodEnd: isoDate(r.periodEnd),
    generatedAt: r.generatedAt.toISOString(),
    markdownBody: r.markdownBody,
    tokensUsed: r.tokensUsed,
    costUsd: r.costUsd,
    emailedAt: r.emailedAt?.toISOString() ?? null,
  }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
        <p className="text-sm text-muted-foreground">
          AI-generated weekly spending reports
        </p>
      </div>
      <InsightList insights={insights} />
    </div>
  );
}
