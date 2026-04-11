/**
 * Post-ingest rules application.
 *
 * After `upsertEntriesForSimpleFin` creates new entry rows, the sync worker
 * calls `applyRulesToEntries` so any user-authored rules that match the new
 * entries run automatically. This is the canonical integration point: it is
 * the only place where freshly-ingested transactions get their categories
 * updated from the default `Uncategorized` to whatever the rules engine
 * resolves.
 *
 * Design:
 *   1. Load every enabled rule for the family and reshape into the
 *      `RunnableRule` shape the core runner expects.
 *   2. Load the target entries joined with their account-side entry_line
 *      row (the leg with a non-null `account_id`). The account-side leg
 *      carries the signed amount and the account id; the category-side
 *      leg is what we rewrite on match.
 *   3. Call `runRules` — a pure function from `@budget-tracker/core/rules`.
 *   4. For each result where a `set_category` action produced a non-null
 *      `categoryId`, UPDATE the category-side entry_line of that entry.
 *
 * Splits caveat: SimpleFIN-ingested entries today always have exactly two
 * legs (one account-side, one category-side). If/when the app grows
 * user-authored splits, a single rule-driven `set_category` on a split
 * becomes ambiguous — which category-side leg to rewrite? For now the
 * UPDATE targets every leg with `account_id IS NULL`, which is correct for
 * the two-leg case and degrades to "reassign all category legs" for
 * multi-leg splits. Re-evaluate when splits land.
 *
 * Transactionality: this helper does not open its own DB connection; the
 * caller (sync-connection worker) has already opened one inside
 * `withFamilyContext`, which sets the Postgres session variables that the
 * RLS policies depend on. Doing the work inside the caller's tx means
 * every query in this file is family-scoped by default.
 */
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { account, entry, entryLine, rule } from '@budget-tracker/db/schema';
import type { DatabaseTx } from '@budget-tracker/db/client';
import {
  runRules,
  type RuleEvaluableEntry,
  type RunnableRule,
} from '@budget-tracker/core/rules';

export interface ApplyRulesResult {
  entriesUpdated: number;
  rulesMatched: number;
}

/**
 * Serialize a JS `Date` (or already-stringified date) into the ISO
 * `YYYY-MM-DD` form the rules engine date operators expect.
 */
function toIsoDate(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

/**
 * Apply the family's enabled rules to the given entries.
 *
 * No-op for empty rule sets or empty entry lists. Callers should pass
 * only entry ids that were freshly created (or freshly updated) by the
 * ingest path; running this over unrelated entries will produce correct
 * results but waste queries.
 */
export async function applyRulesToEntries(
  tx: DatabaseTx,
  familyId: string,
  entryIds: readonly string[],
): Promise<ApplyRulesResult> {
  if (entryIds.length === 0) return { entriesUpdated: 0, rulesMatched: 0 };

  const dbRules = await tx
    .select({
      id: rule.id,
      stage: rule.stage,
      specificityScore: rule.specificityScore,
      conditionsJson: rule.conditionsJson,
      actionsJson: rule.actionsJson,
    })
    .from(rule)
    .where(and(eq(rule.familyId, familyId), eq(rule.enabled, true)));

  if (dbRules.length === 0) return { entriesUpdated: 0, rulesMatched: 0 };

  const runnableRules: RunnableRule[] = dbRules.map((r) => ({
    ruleId: r.id,
    stage: r.stage,
    specificityScore: r.specificityScore,
    conditions: r.conditionsJson,
    actions: r.actionsJson,
  }));

  const accountSideRows = await tx
    .select({
      entryId: entry.id,
      description: entry.description,
      entryDate: entry.entryDate,
      amount: entryLine.amount,
      accountId: entryLine.accountId,
      currency: account.currency,
    })
    .from(entry)
    .innerJoin(
      entryLine,
      and(eq(entryLine.entryId, entry.id), isNotNull(entryLine.accountId)),
    )
    .innerJoin(account, eq(account.id, entryLine.accountId))
    .where(inArray(entry.id, [...entryIds]));

  if (accountSideRows.length === 0) {
    return { entriesUpdated: 0, rulesMatched: 0 };
  }

  const evaluable: RuleEvaluableEntry[] = [];
  const orderedEntryIds: string[] = [];
  for (const row of accountSideRows) {
    if (row.accountId === null) continue;
    orderedEntryIds.push(row.entryId);
    evaluable.push({
      description: row.description,
      amount: row.amount,
      accountId: row.accountId,
      entryDate: toIsoDate(row.entryDate),
      currency: row.currency,
    });
  }

  const results = runRules(runnableRules, evaluable);

  let entriesUpdated = 0;
  let rulesMatched = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    if (result.categoryId === null) continue;

    rulesMatched++;

    await tx
      .update(entryLine)
      .set({ categoryId: result.categoryId })
      .where(
        and(
          eq(entryLine.entryId, orderedEntryIds[i]!),
          isNull(entryLine.accountId),
        ),
      );

    entriesUpdated++;
  }

  return { entriesUpdated, rulesMatched };
}
