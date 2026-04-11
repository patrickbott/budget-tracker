"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { auth } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { withFamilyContext } from "@budget-tracker/db/client";
import { rule, type RuleCondition, type RuleAction } from "@budget-tracker/db/schema";

async function getSessionContext() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not authenticated");

  const familyId = session.session.activeOrganizationId;
  if (!familyId) throw new Error("No active family selected");

  return { familyId, userId: session.user.id };
}

/**
 * Inline specificity scorer. Instance A is building the canonical version
 * in packages/core — we'll swap it in later.
 *
 * Scoring: is=3, matches_regex=2, contains=1, between=2,
 * greater_than=1, less_than=1, one_of=2, is_not=2, does_not_contain=1
 */
function computeSpecificityScore(conditions: RuleCondition[]): number {
  const scores: Record<string, number> = {
    is: 3,
    is_not: 2,
    contains: 1,
    does_not_contain: 1,
    matches_regex: 2,
    one_of: 2,
    greater_than: 1,
    less_than: 1,
    between: 2,
  };
  return conditions.reduce(
    (sum, c) => sum + (scores[c.operator] ?? 0),
    0,
  );
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
