"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { eq, count } from "drizzle-orm";

import { auth } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { withFamilyContext } from "@budget-tracker/db/client";
import { category, entryLine } from "@budget-tracker/db/schema";

async function getSessionContext() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not authenticated");

  const familyId = session.session.activeOrganizationId;
  if (!familyId) throw new Error("No active family selected");

  return { familyId, userId: session.user.id };
}

export async function createCategory(data: {
  name: string;
  kind: "income" | "expense";
  color?: string;
  icon?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { familyId, userId } = await getSessionContext();
    const db = getDb();

    await withFamilyContext(db, familyId, userId, async (tx) => {
      await tx.insert(category).values({
        familyId,
        name: data.name,
        kind: data.kind,
        color: data.color || null,
        icon: data.icon || null,
      });
    });

    revalidatePath("/categories");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function updateCategory(
  id: string,
  data: {
    name?: string;
    kind?: "income" | "expense";
    color?: string;
    icon?: string;
  },
): Promise<{ success: boolean; error?: string }> {
  try {
    const { familyId, userId } = await getSessionContext();
    const db = getDb();

    await withFamilyContext(db, familyId, userId, async (tx) => {
      await tx
        .update(category)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(category.id, id));
    });

    revalidatePath("/categories");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function deleteCategory(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { familyId, userId } = await getSessionContext();
    const db = getDb();

    const result = await withFamilyContext(db, familyId, userId, async (tx) => {
      // Check if any entry_lines reference this category
      const [usage] = await tx
        .select({ total: count() })
        .from(entryLine)
        .where(eq(entryLine.categoryId, id));

      if (usage && usage.total > 0) {
        return {
          canDelete: false,
          count: usage.total,
        };
      }

      await tx.delete(category).where(eq(category.id, id));
      return { canDelete: true };
    });

    if (!result.canDelete) {
      return {
        success: false,
        error: `Cannot delete: ${result.count} transaction(s) use this category. Archive it instead.`,
      };
    }

    revalidatePath("/categories");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function toggleArchiveCategory(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { familyId, userId } = await getSessionContext();
    const db = getDb();

    await withFamilyContext(db, familyId, userId, async (tx) => {
      const [existing] = await tx
        .select({ isArchived: category.isArchived })
        .from(category)
        .where(eq(category.id, id));

      if (!existing) throw new Error("Category not found");

      await tx
        .update(category)
        .set({ isArchived: !existing.isArchived, updatedAt: new Date() })
        .where(eq(category.id, id));
    });

    revalidatePath("/categories");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
