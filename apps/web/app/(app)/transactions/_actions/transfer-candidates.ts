"use server";

/**
 * Server actions for the transfer-candidate review UI.
 *
 * Instance B builds the UI panel on the transactions page; these actions
 * are what the panel calls to list pending candidates, confirm them (flip
 * both entries to `entryable_type = 'transfer'`), or dismiss them (leave
 * the entries untouched).
 *
 * Every action runs inside `withFamilyContext` so the RLS policies in
 * migration 0004 scope all reads/writes to the session's active family.
 */

import { headers } from "next/headers";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { withFamilyContext } from "@budget-tracker/db/client";
import {
  account,
  entry,
  entryLine,
  transferCandidate,
} from "@budget-tracker/db/schema";

const LIST_LIMIT = 50;

/** Shape returned by `listPendingTransferCandidates`. Kept flat so the
 *  UI can render a row without walking nested objects. */
export interface TransferCandidateRow {
  candidateId: string;
  confidence: string;
  entryA: {
    id: string;
    description: string;
    date: string;
    amount: string;
    accountName: string;
  };
  entryB: {
    id: string;
    description: string;
    date: string;
    amount: string;
    accountName: string;
  };
}

async function getSessionContext() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not authenticated");

  const familyId = session.session.activeOrganizationId;
  if (!familyId) throw new Error("No active family selected");

  return { familyId, userId: session.user.id };
}

/**
 * List every pending transfer candidate for the active family, most
 * confident first. Limited to `LIST_LIMIT` rows — the UI paginates if
 * the backlog ever grows past that.
 */
export async function listPendingTransferCandidates(): Promise<
  TransferCandidateRow[]
> {
  const { familyId, userId } = await getSessionContext();
  const db = getDb();

  return withFamilyContext(db, familyId, userId, async (tx) => {
    const candidates = await tx
      .select({
        id: transferCandidate.id,
        confidence: transferCandidate.confidence,
        entryAId: transferCandidate.entryAId,
        entryBId: transferCandidate.entryBId,
      })
      .from(transferCandidate)
      .where(eq(transferCandidate.status, "pending"))
      .orderBy(desc(transferCandidate.confidence), desc(transferCandidate.detectedAt))
      .limit(LIST_LIMIT);

    if (candidates.length === 0) return [];

    const entryIds = candidates.flatMap((c) => [c.entryAId, c.entryBId]);
    const entryRows = await tx
      .select({
        id: entry.id,
        description: entry.description,
        entryDate: entry.entryDate,
        amount: entryLine.amount,
        accountName: account.name,
      })
      .from(entry)
      .innerJoin(
        entryLine,
        and(eq(entryLine.entryId, entry.id), sql`${entryLine.accountId} IS NOT NULL`),
      )
      .innerJoin(account, eq(account.id, entryLine.accountId))
      .where(inArray(entry.id, entryIds));

    const byId = new Map<string, (typeof entryRows)[number]>();
    for (const row of entryRows) byId.set(row.id, row);

    const result: TransferCandidateRow[] = [];
    for (const c of candidates) {
      const a = byId.get(c.entryAId);
      const b = byId.get(c.entryBId);
      if (!a || !b) continue;

      result.push({
        candidateId: c.id,
        confidence: c.confidence,
        entryA: {
          id: a.id,
          description: a.description,
          date: a.entryDate instanceof Date
            ? a.entryDate.toISOString().slice(0, 10)
            : String(a.entryDate),
          amount: a.amount,
          accountName: a.accountName,
        },
        entryB: {
          id: b.id,
          description: b.description,
          date: b.entryDate instanceof Date
            ? b.entryDate.toISOString().slice(0, 10)
            : String(b.entryDate),
          amount: b.amount,
          accountName: b.accountName,
        },
      });
    }

    return result;
  });
}

/**
 * Confirm a transfer candidate: mark both referenced entries as
 * `entryable_type = 'transfer'` and the candidate row as `confirmed`.
 * The two underlying entry rows are preserved — we deliberately keep
 * the audit trail rather than collapsing them into a single synthetic
 * parent. See the header of `packages/db/src/schema/transfer-candidate.ts`.
 */
export async function confirmTransferCandidate(
  candidateId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { familyId, userId } = await getSessionContext();
    const db = getDb();

    await withFamilyContext(db, familyId, userId, async (tx) => {
      const [candidate] = await tx
        .select({
          id: transferCandidate.id,
          entryAId: transferCandidate.entryAId,
          entryBId: transferCandidate.entryBId,
          status: transferCandidate.status,
        })
        .from(transferCandidate)
        .where(eq(transferCandidate.id, candidateId))
        .limit(1);

      if (!candidate) throw new Error(`Candidate ${candidateId} not found`);
      if (candidate.status !== "pending") {
        throw new Error(`Candidate ${candidateId} is ${candidate.status}, not pending`);
      }

      await tx
        .update(entry)
        .set({ entryableType: "transfer", updatedAt: new Date() })
        .where(inArray(entry.id, [candidate.entryAId, candidate.entryBId]));

      await tx
        .update(transferCandidate)
        .set({ status: "confirmed", resolvedAt: new Date() })
        .where(eq(transferCandidate.id, candidateId));
    });

    revalidatePath("/transactions");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Dismiss a transfer candidate: mark the candidate row as `dismissed`
 * and leave the two referenced entries untouched. The `(entry_a_id,
 * entry_b_id)` unique index keeps the detector from re-creating a
 * pending row for the same pair, so dismissed candidates stay dismissed
 * until the user manually clears them.
 */
export async function dismissTransferCandidate(
  candidateId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { familyId, userId } = await getSessionContext();
    const db = getDb();

    await withFamilyContext(db, familyId, userId, async (tx) => {
      const [candidate] = await tx
        .select({ id: transferCandidate.id, status: transferCandidate.status })
        .from(transferCandidate)
        .where(eq(transferCandidate.id, candidateId))
        .limit(1);

      if (!candidate) throw new Error(`Candidate ${candidateId} not found`);
      if (candidate.status !== "pending") {
        throw new Error(`Candidate ${candidateId} is ${candidate.status}, not pending`);
      }

      await tx
        .update(transferCandidate)
        .set({ status: "dismissed", resolvedAt: new Date() })
        .where(eq(transferCandidate.id, candidateId));
    });

    revalidatePath("/transactions");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
