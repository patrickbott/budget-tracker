"use server";

/**
 * Server actions for the /recurring review + promote UI.
 *
 * Three actions:
 *
 *   1. `listRecurringCandidates` — runs the same
 *      `detectRecurringCandidatesForFamily` helper the sync worker calls
 *      at step 6d, inside a family-scoped tx. Candidates are ephemeral:
 *      we recompute them on every page load rather than persisting a
 *      `recurring_candidate` table.
 *   2. `listPersistedRecurring` — reads the `recurring` table for the
 *      active family. These are the rows the user has explicitly
 *      confirmed via `promoteRecurringCandidate`.
 *   3. `promoteRecurringCandidate` — inserts a `recurring` row from a
 *      candidate shape and revalidates `/recurring`.
 *
 * All three run inside `withFamilyContext` so the RLS policies scope
 * every read/write to the session's active family — matches the
 * pattern established in `transactions/_actions/transfer-candidates.ts`.
 */

import { headers } from "next/headers";
import { desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { withFamilyContext } from "@budget-tracker/db/client";
import { recurring } from "@budget-tracker/db/schema";
import { detectRecurringCandidatesForFamily } from "@budget-tracker/jobs";
import type { RecurringCandidate } from "@budget-tracker/core/recurring";

export type RecurringCadence = RecurringCandidate["cadence"];

/** Shape returned by `listPersistedRecurring`. Flat + serializable so
 *  the server component can pass it straight to the client. */
export interface PersistedRecurringRow {
  id: string;
  name: string;
  cadence: RecurringCadence;
  cadenceInterval: number;
  expectedAmount: string;
  lastMatchedDate: string | null;
}

async function getSessionContext() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not authenticated");

  const familyId = session.session.activeOrganizationId;
  if (!familyId) throw new Error("No active family selected");

  return { familyId, userId: session.user.id };
}

/**
 * Run recurring detection for the active family and return the
 * ephemeral candidate list. Confidence is already a number in the core
 * type, so no coercion needed at this boundary.
 */
export async function listRecurringCandidates(): Promise<RecurringCandidate[]> {
  const { familyId, userId } = await getSessionContext();
  const db = getDb();

  return withFamilyContext(db, familyId, userId, async (tx) => {
    const { candidates } = await detectRecurringCandidatesForFamily(
      tx,
      familyId,
    );
    return candidates;
  });
}

/**
 * List the user-confirmed recurring series for the active family,
 * most recent first.
 */
export async function listPersistedRecurring(): Promise<PersistedRecurringRow[]> {
  const { familyId, userId } = await getSessionContext();
  const db = getDb();

  return withFamilyContext(db, familyId, userId, async (tx) => {
    const rows = await tx
      .select({
        id: recurring.id,
        name: recurring.name,
        cadence: recurring.cadence,
        cadenceInterval: recurring.cadenceInterval,
        expectedAmount: recurring.expectedAmount,
        lastMatchedDate: recurring.lastMatchedDate,
      })
      .from(recurring)
      .where(eq(recurring.familyId, familyId))
      .orderBy(desc(recurring.createdAt));

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      cadence: row.cadence,
      cadenceInterval: row.cadenceInterval,
      expectedAmount: row.expectedAmount,
      lastMatchedDate:
        row.lastMatchedDate instanceof Date
          ? row.lastMatchedDate.toISOString().slice(0, 10)
          : row.lastMatchedDate,
    }));
  });
}

export interface PromoteRecurringCandidateInput {
  descriptionPattern: string;
  expectedAmount: string;
  cadence: RecurringCadence;
  cadenceInterval?: number;
  name?: string;
}

/**
 * Promote a detected candidate into the persistent `recurring` table.
 *
 * Defaults (per the R6 prompt): `cadenceInterval=1`, `name` falls back
 * to the description pattern if the caller doesn't supply one, and
 * `amountTolerancePct` is left at the schema default (0.05). The
 * optional account/category/last-match fields all default to their
 * schema values — the user can fill them in later from a per-row
 * edit screen when that lands.
 */
export async function promoteRecurringCandidate(
  input: PromoteRecurringCandidateInput,
): Promise<{ success: boolean; error?: string; id?: string }> {
  try {
    const { familyId, userId } = await getSessionContext();
    const db = getDb();

    const id = await withFamilyContext(db, familyId, userId, async (tx) => {
      const [inserted] = await tx
        .insert(recurring)
        .values({
          familyId,
          name: input.name ?? input.descriptionPattern,
          cadence: input.cadence,
          cadenceInterval: input.cadenceInterval ?? 1,
          expectedAmount: input.expectedAmount,
        })
        .returning({ id: recurring.id });

      if (!inserted) {
        throw new Error("Insert returned no row");
      }
      return inserted.id;
    });

    revalidatePath("/recurring");
    return { success: true, id };
  } catch (err) {
    // Log server-side so the stack isn't lost to the string-only
    // shape this action returns to the client.
    console.error("promoteRecurringCandidate failed", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
