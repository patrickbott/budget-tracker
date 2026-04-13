"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import { auth } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { withFamilyContext } from "@budget-tracker/db/client";
import { coachingAlert } from "@budget-tracker/db/schema";

export async function dismissCoachingAlert(alertId: string): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not authenticated");

  const familyId = session.session.activeOrganizationId;
  if (!familyId) throw new Error("No active family selected");

  const db = getDb();

  await withFamilyContext(db, familyId, session.user.id, async (tx) => {
    await tx
      .update(coachingAlert)
      .set({ dismissed: true })
      .where(
        and(
          eq(coachingAlert.id, alertId),
          eq(coachingAlert.familyId, familyId),
        ),
      );
  });

  revalidatePath("/dashboard");
}
