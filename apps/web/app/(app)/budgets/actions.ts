"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { auth } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { withFamilyContext } from "@budget-tracker/db/client";
import { budget } from "@budget-tracker/db/schema";

async function getSessionContext() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not authenticated");

  const familyId = session.session.activeOrganizationId;
  if (!familyId) throw new Error("No active family selected");

  return { familyId, userId: session.user.id };
}

export async function createBudget(data: {
  categoryId: string;
  amount: string;
  mode: "hard_cap" | "forecast";
  period: "monthly" | "weekly" | "yearly";
  periodStart: string;
  rollover: "none" | "rollover_positive" | "rollover_all";
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { familyId, userId } = await getSessionContext();
    const db = getDb();

    await withFamilyContext(db, familyId, userId, async (tx) => {
      await tx.insert(budget).values({
        familyId,
        categoryId: data.categoryId,
        amount: data.amount,
        mode: data.mode,
        period: data.period,
        periodStart: new Date(data.periodStart),
        rollover: data.rollover,
      });
    });

    revalidatePath("/budgets");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function updateBudget(
  id: string,
  data: {
    categoryId?: string;
    amount?: string;
    mode?: "hard_cap" | "forecast";
    period?: "monthly" | "weekly" | "yearly";
    periodStart?: string;
    rollover?: "none" | "rollover_positive" | "rollover_all";
  },
): Promise<{ success: boolean; error?: string }> {
  try {
    const { familyId, userId } = await getSessionContext();
    const db = getDb();

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (data.categoryId !== undefined) updateData.categoryId = data.categoryId;
    if (data.amount !== undefined) updateData.amount = data.amount;
    if (data.mode !== undefined) updateData.mode = data.mode;
    if (data.period !== undefined) updateData.period = data.period;
    if (data.periodStart !== undefined)
      updateData.periodStart = new Date(data.periodStart);
    if (data.rollover !== undefined) updateData.rollover = data.rollover;

    await withFamilyContext(db, familyId, userId, async (tx) => {
      await tx.update(budget).set(updateData).where(eq(budget.id, id));
    });

    revalidatePath("/budgets");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function deleteBudget(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { familyId, userId } = await getSessionContext();
    const db = getDb();

    await withFamilyContext(db, familyId, userId, async (tx) => {
      await tx.delete(budget).where(eq(budget.id, id));
    });

    revalidatePath("/budgets");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
