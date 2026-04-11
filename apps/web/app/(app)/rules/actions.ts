"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, eq, gte, isNotNull, isNull } from "drizzle-orm";

import { auth } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { withFamilyContext } from "@budget-tracker/db/client";
import {
  account,
  entry,
  entryLine,
  rule,
  type RuleCondition,
  type RuleAction,
} from "@budget-tracker/db/schema";
import {
  computeSpecificityScore,
  runRules,
  type RuleEvaluableEntry,
  type RunnableRule,
} from "@budget-tracker/core/rules";

const APPLY_TO_PAST_WINDOW_DAYS = 180;

async function getSessionContext() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not authenticated");

  const familyId = session.session.activeOrganizationId;
  if (!familyId) throw new Error("No active family selected");

  return { familyId, userId: session.user.id };
}

export async function createRule(data: {
  name: string;
  stage: "pre" | "default" | "post";
  conditionsJson: RuleCondition[];
  actionsJson: RuleAction[];
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { familyId, userId } = await getSessionContext();
    const db = getDb();

    const specificityScore = computeSpecificityScore(data.conditionsJson);

    await withFamilyContext(db, familyId, userId, async (tx) => {
      await tx.insert(rule).values({
        familyId,
        name: data.name,
        stage: data.stage,
        conditionsJson: data.conditionsJson,
        actionsJson: data.actionsJson,
        specificityScore,
        createdByUserId: userId,
        createdFrom: "manual",
      });
    });

    revalidatePath("/rules");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function updateRule(
  id: string,
  data: {
    name?: string;
    stage?: "pre" | "default" | "post";
    conditionsJson?: RuleCondition[];
    actionsJson?: RuleAction[];
  },
): Promise<{ success: boolean; error?: string }> {
  try {
    const { familyId, userId } = await getSessionContext();
    const db = getDb();

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) updateData.name = data.name;
    if (data.stage !== undefined) updateData.stage = data.stage;
    if (data.conditionsJson !== undefined) {
      updateData.conditionsJson = data.conditionsJson;
      updateData.specificityScore = computeSpecificityScore(
        data.conditionsJson,
      );
    }
    if (data.actionsJson !== undefined) updateData.actionsJson = data.actionsJson;

    await withFamilyContext(db, familyId, userId, async (tx) => {
      await tx.update(rule).set(updateData).where(eq(rule.id, id));
    });

    revalidatePath("/rules");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function deleteRule(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { familyId, userId } = await getSessionContext();
    const db = getDb();

    await withFamilyContext(db, familyId, userId, async (tx) => {
      await tx.delete(rule).where(eq(rule.id, id));
    });

    revalidatePath("/rules");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function toggleRuleEnabled(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { familyId, userId } = await getSessionContext();
    const db = getDb();

    await withFamilyContext(db, familyId, userId, async (tx) => {
      const [existing] = await tx
        .select({ enabled: rule.enabled })
        .from(rule)
        .where(eq(rule.id, id));

      if (!existing) throw new Error("Rule not found");

      await tx
        .update(rule)
        .set({ enabled: !existing.enabled, updatedAt: new Date() })
        .where(eq(rule.id, id));
    });

    revalidatePath("/rules");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Apply a single rule to the family's historical entries, updating category
 * assignments for any matches. Scoped to the last 180 days to bound the
 * working set — older history can be re-categorized by editing the rule
 * and re-running, or from a dedicated backfill tool if we ever need one.
 *
 * Runs synchronously inside the request; fine at personal-finance scale
 * (a single family rarely has more than a few thousand entries in 180 days).
 */
export async function runRulesOverPastEntries(
  ruleId: string,
): Promise<{
  success: boolean;
  matchedCount?: number;
  updatedCount?: number;
  error?: string;
}> {
  try {
    const { familyId, userId } = await getSessionContext();
    const db = getDb();

    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - APPLY_TO_PAST_WINDOW_DAYS);

    let matchedCount = 0;
    let updatedCount = 0;

    await withFamilyContext(db, familyId, userId, async (tx) => {
      const [ruleRecord] = await tx
        .select({
          id: rule.id,
          stage: rule.stage,
          specificityScore: rule.specificityScore,
          conditionsJson: rule.conditionsJson,
          actionsJson: rule.actionsJson,
        })
        .from(rule)
        .where(eq(rule.id, ruleId));

      if (!ruleRecord) throw new Error("Rule not found");

      const accountRows = await tx
        .select({
          entryId: entry.id,
          entryDate: entry.entryDate,
          description: entry.description,
          accountId: entryLine.accountId,
          amount: entryLine.amount,
          currency: account.currency,
        })
        .from(entry)
        .innerJoin(
          entryLine,
          and(eq(entryLine.entryId, entry.id), isNotNull(entryLine.accountId)),
        )
        .innerJoin(account, eq(account.id, entryLine.accountId))
        .where(
          and(eq(entry.familyId, familyId), gte(entry.entryDate, windowStart)),
        );

      const categoryRows = await tx
        .select({
          entryId: entryLine.entryId,
          categoryLineId: entryLine.id,
          currentCategoryId: entryLine.categoryId,
        })
        .from(entryLine)
        .innerJoin(entry, eq(entry.id, entryLine.entryId))
        .where(
          and(
            eq(entry.familyId, familyId),
            gte(entry.entryDate, windowStart),
            isNull(entryLine.accountId),
          ),
        );

      const categoryByEntryId = new Map(
        categoryRows.map((r) => [
          r.entryId,
          { categoryLineId: r.categoryLineId, currentCategoryId: r.currentCategoryId },
        ]),
      );

      const evaluables: RuleEvaluableEntry[] = [];
      const meta: Array<{
        entryId: string;
        categoryLineId: string;
        currentCategoryId: string | null;
      }> = [];

      for (const row of accountRows) {
        const cat = categoryByEntryId.get(row.entryId);
        if (!cat) continue; // transfer/split — skip entries without a single category leg

        evaluables.push({
          description: row.description,
          amount: row.amount,
          accountId: row.accountId,
          entryDate: row.entryDate.toISOString().split("T")[0]!,
          currency: row.currency,
        });
        meta.push({
          entryId: row.entryId,
          categoryLineId: cat.categoryLineId,
          currentCategoryId: cat.currentCategoryId,
        });
      }

      const runnable: RunnableRule = {
        ruleId: ruleRecord.id,
        stage: ruleRecord.stage,
        specificityScore: ruleRecord.specificityScore,
        conditions: ruleRecord.conditionsJson,
        actions: ruleRecord.actionsJson,
      };

      const results = runRules([runnable], evaluables);

      for (let i = 0; i < results.length; i++) {
        const result = results[i]!;
        const m = meta[i]!;

        // initResult sets categoryId to null — any non-null value means the
        // rule's set_category action fired for this entry.
        if (result.categoryId === null) continue;
        matchedCount++;

        if (result.categoryId === m.currentCategoryId) continue;

        await tx
          .update(entryLine)
          .set({ categoryId: result.categoryId })
          .where(eq(entryLine.id, m.categoryLineId));
        updatedCount++;
      }
    });

    revalidatePath("/transactions");
    revalidatePath("/rules");
    return { success: true, matchedCount, updatedCount };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
