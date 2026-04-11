import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { desc, asc, eq } from "drizzle-orm";
import { Plus } from "lucide-react";

import { auth } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { withFamilyContext } from "@budget-tracker/db/client";
import { rule, category } from "@budget-tracker/db/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RuleForm } from "./_components/rule-form";
import { RuleRow } from "./_components/rule-row";

const STAGE_LABELS = {
  pre: "Pre (preprocessing)",
  default: "Default",
  post: "Post (catch-all)",
} as const;

export default async function RulesPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const familyId = session.session.activeOrganizationId;
  if (!familyId) redirect("/onboarding");

  const db = getDb();

  const { rules, categories } = await withFamilyContext(
    db,
    familyId,
    session.user.id,
    async (tx) => {
      const allRules = await tx
        .select()
        .from(rule)
        .orderBy(asc(rule.stage), desc(rule.specificityScore));

      const allCategories = await tx
        .select({
          id: category.id,
          name: category.name,
          color: category.color,
        })
        .from(category)
        .where(eq(category.isArchived, false));

      return { rules: allRules, categories: allCategories };
    },
  );

  const rulesByStage = new Map<string, typeof rules>();
  for (const r of rules) {
    const stage = r.stage;
    if (!rulesByStage.has(stage)) rulesByStage.set(stage, []);
    rulesByStage.get(stage)!.push(r);
  }

  const stages = (["pre", "default", "post"] as const).filter((s) =>
    rulesByStage.has(s),
  );

  const categoryMap = new Map(categories.map((c) => [c.id, c]));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Rules</h1>
        <RuleForm
          mode="create"
          categories={categories}
          trigger={
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add rule
            </Button>
          }
        />
      </div>

      {rules.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground">
            No rules yet. Create one to automatically categorize your
            transactions.
          </p>
        </div>
      ) : (
        stages.map((stage) => (
          <Card key={stage}>
            <CardHeader>
              <CardTitle className="text-lg">{STAGE_LABELS[stage]}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {rulesByStage.get(stage)!.map((r) => (
                <RuleRow
                  key={r.id}
                  rule={r}
                  categories={categories}
                  categoryMap={categoryMap}
                />
              ))}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
