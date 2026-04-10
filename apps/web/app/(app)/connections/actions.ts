"use server";

import { headers } from "next/headers";
import { eq } from "drizzle-orm";

import { auth } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { getBoss } from "@/lib/boss";
import { withFamilyContext } from "@budget-tracker/db/client";
import { connection } from "@budget-tracker/db/schema";
import { JOB_NAMES } from "@budget-tracker/jobs";
import { exchangeSetupToken, encryptAccessUrl } from "@budget-tracker/simplefin";

async function getSessionContext() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not authenticated");

  const familyId = session.session.activeOrganizationId;
  if (!familyId) throw new Error("No active family selected");

  return { familyId, userId: session.user.id };
}

export async function exchangeAndStoreConnection(
  setupToken: string,
  nickname: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { familyId, userId } = await getSessionContext();
    const db = getDb();

    const accessUrl = await exchangeSetupToken(setupToken);
    const encrypted = encryptAccessUrl(accessUrl);

    await withFamilyContext(db, familyId, userId, async (tx) => {
      await tx.insert(connection).values({
        familyId,
        accessUrlEncrypted: encrypted,
        nickname: nickname || null,
        status: "active",
      });
    });

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function triggerManualSync(
  connectionId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { familyId, userId } = await getSessionContext();
    const boss = await getBoss();
    await boss.send(JOB_NAMES.SYNC_CONNECTION, {
      connectionId,
      familyId,
      userId,
    });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function renameConnection(
  connectionId: string,
  newNickname: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { familyId, userId } = await getSessionContext();
    const db = getDb();

    await withFamilyContext(db, familyId, userId, async (tx) => {
      await tx
        .update(connection)
        .set({ nickname: newNickname, updatedAt: new Date() })
        .where(eq(connection.id, connectionId));
    });

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function deleteConnection(
  connectionId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { familyId, userId } = await getSessionContext();
    const db = getDb();

    await withFamilyContext(db, familyId, userId, async (tx) => {
      await tx
        .delete(connection)
        .where(eq(connection.id, connectionId));
    });

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
