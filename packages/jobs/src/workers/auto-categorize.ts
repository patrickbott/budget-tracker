import Decimal from 'decimal.js';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  aiUsage,
  category,
  entry,
  entryLine,
  account,
  rule,
} from '@budget-tracker/db/schema';
import { createDb } from '@budget-tracker/db/client';
import {
  checkSpendCap,
  createAnthropicClient,
  estimateCost,
} from '@budget-tracker/ai';

import type { AutoCategorizePayload } from '../job-names.ts';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const COST_MODEL = 'claude-haiku-4-5';
const BATCH_SIZE = 20;

export interface AutoCategorizeResult {
  categorized: number;
  rulesProposed: number;
  skippedLowConfidence: number;
}

const SYSTEM_PROMPT = `You are a transaction categorizer. Given transaction descriptions and a list of categories, assign each transaction to the most appropriate category. Also propose a reusable categorization rule if you see a pattern. Respond using the provided tool.`;

const CATEGORIZE_TOOL = {
  name: 'categorize_transactions',
  description:
    'Assign categories to transactions and optionally propose reusable rules.',
  input_schema: {
    type: 'object' as const,
    properties: {
      assignments: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            entryId: { type: 'string' as const },
            categoryId: { type: 'string' as const },
            confidence: {
              type: 'string' as const,
              enum: ['low', 'medium', 'high'],
            },
            ruleSuggestion: {
              type: 'object' as const,
              properties: {
                merchantPattern: { type: 'string' as const },
                conditions: {
                  type: 'array' as const,
                  items: {
                    type: 'object' as const,
                    properties: {
                      field: { type: 'string' as const },
                      operator: { type: 'string' as const },
                      value: {},
                    },
                    required: ['field', 'operator', 'value'],
                  },
                },
              },
              required: ['merchantPattern', 'conditions'],
            },
          },
          required: ['entryId', 'categoryId', 'confidence'],
        },
      },
    },
    required: ['assignments'],
  },
};

interface Assignment {
  entryId: string;
  categoryId: string;
  confidence: 'low' | 'medium' | 'high';
  ruleSuggestion?: {
    merchantPattern: string;
    conditions: Array<{
      field: string;
      operator: string;
      value: unknown;
    }>;
  };
}

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return url;
}

let _db: ReturnType<typeof createDb> | undefined;
function getDb() {
  if (!_db) _db = createDb(getDatabaseUrl());
  return _db.db;
}

function getSpendCapUsd(): number {
  const envVal = process.env.AI_MONTHLY_SPEND_CAP_USD;
  if (envVal) {
    const parsed = Number(envVal);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return 10;
}

async function getCurrentMonthUsage(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  familyId: string,
): Promise<string> {
  const now = new Date();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const monthEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );

  const rows = await tx
    .select({
      totalCost:
        sql<string>`COALESCE(SUM(${aiUsage.costUsd}), '0')`.as('total_cost'),
    })
    .from(aiUsage)
    .where(
      and(
        eq(aiUsage.familyId, familyId),
        sql`${aiUsage.date} >= ${monthStart.toISOString().split('T')[0]}`,
        sql`${aiUsage.date} < ${monthEnd.toISOString().split('T')[0]}`,
      ),
    );

  return rows[0]?.totalCost ?? '0';
}

async function upsertAiUsage(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  familyId: string,
  inputTokens: number,
  outputTokens: number,
  costUsd: string,
): Promise<void> {
  const today = new Date().toISOString().split('T')[0]!;

  await tx
    .insert(aiUsage)
    .values({
      familyId,
      date: new Date(`${today}T00:00:00.000Z`),
      model: HAIKU_MODEL,
      inputTokens: String(inputTokens),
      outputTokens: String(outputTokens),
      costUsd,
    })
    .onConflictDoUpdate({
      target: [aiUsage.familyId, aiUsage.date, aiUsage.model],
      set: {
        inputTokens: sql`${aiUsage.inputTokens} + ${String(inputTokens)}`,
        outputTokens: sql`${aiUsage.outputTokens} + ${String(outputTokens)}`,
        costUsd: sql`${aiUsage.costUsd} + ${costUsd}`,
      },
    });
}

/**
 * Auto-categorize worker. Runs after a SimpleFIN sync on entries that
 * remain uncategorized after the rules engine pass.
 *
 * Uses Haiku to classify entries and optionally propose induced rules.
 * Respects the family's monthly AI spend cap.
 *
 * Bypasses RLS (system-level background job) and scopes queries with
 * explicit `family_id` WHERE clauses, same approach as `syncAllFamilies`.
 */
export async function autoCategorize(
  payload: AutoCategorizePayload,
): Promise<AutoCategorizeResult> {
  const { familyId, entryIds } = payload;

  if (entryIds.length === 0) {
    return { categorized: 0, rulesProposed: 0, skippedLowConfidence: 0 };
  }

  const db = getDb();
  const capUsd = getSpendCapUsd();

  return db.transaction(async (tx) => {
    // Bypass RLS — this is a system-level background job. All queries
    // are explicitly scoped by familyId.
    await tx.execute(sql`SET LOCAL row_security = off`);

    // Cost-cap check before any API calls
    const currentUsage = await getCurrentMonthUsage(tx, familyId);
    const capCheck = checkSpendCap({ costUsd: currentUsage }, capUsd);
    if (!capCheck.allowed) {
      console.info(
        `[auto-categorize] Cost cap reached for family ${familyId} (${capCheck.percentUsed}%), skipping`,
      );
      return { categorized: 0, rulesProposed: 0, skippedLowConfidence: 0 };
    }

    // Load the uncategorized entries (account-side lines joined for
    // the account name; filter to the category-side NULL lines to
    // confirm they're uncategorized)
    const entryRows = await tx
      .select({
        entryId: entry.id,
        description: entry.description,
        entryDate: entry.entryDate,
        amount: entryLine.amount,
        accountName: account.name,
      })
      .from(entry)
      .innerJoin(entryLine, eq(entryLine.entryId, entry.id))
      .leftJoin(account, eq(account.id, entryLine.accountId))
      .where(
        and(
          eq(entry.familyId, familyId),
          inArray(entry.id, entryIds),
          // Account-side lines (have accountId, used for display)
          sql`${entryLine.accountId} IS NOT NULL`,
        ),
      );

    if (entryRows.length === 0) {
      return { categorized: 0, rulesProposed: 0, skippedLowConfidence: 0 };
    }

    // Load the family's categories
    const categoryRows = await tx
      .select({ id: category.id, name: category.name })
      .from(category)
      .where(
        and(eq(category.familyId, familyId), eq(category.isArchived, false)),
      );

    if (categoryRows.length === 0) {
      return { categorized: 0, rulesProposed: 0, skippedLowConfidence: 0 };
    }

    const categoryList = categoryRows
      .map((c) => `${c.id}: ${c.name}`)
      .join('\n');

    // Batch entries into groups of BATCH_SIZE
    const batches: typeof entryRows[] = [];
    for (let i = 0; i < entryRows.length; i += BATCH_SIZE) {
      batches.push(entryRows.slice(i, i + BATCH_SIZE));
    }

    let totalCategorized = 0;
    let totalRulesProposed = 0;
    let totalSkippedLowConfidence = 0;
    let runningCost = new Decimal(currentUsage);

    const client = createAnthropicClient();

    for (const batch of batches) {
      // Re-check cost cap before each batch
      const batchCapCheck = checkSpendCap(
        { costUsd: runningCost.toFixed(6) },
        capUsd,
      );
      if (!batchCapCheck.allowed) {
        console.info(
          `[auto-categorize] Cost cap reached mid-batch for family ${familyId}, stopping`,
        );
        break;
      }

      const entrySummary = batch
        .map(
          (e) =>
            `- ${e.entryId}: "${e.description}" | ${e.amount} | ${e.entryDate instanceof Date ? e.entryDate.toISOString().split('T')[0] : e.entryDate} | Account: ${e.accountName ?? 'Unknown'}`,
        )
        .join('\n');

      const userMessage = `Categorize these transactions:\n\n${entrySummary}\n\nAvailable categories:\n${categoryList}`;

      let response;
      try {
        response = await client.messages.create({
          model: HAIKU_MODEL,
          max_tokens: 2048,
          system: SYSTEM_PROMPT,
          tools: [CATEGORIZE_TOOL],
          tool_choice: { type: 'tool', name: 'categorize_transactions' },
          messages: [{ role: 'user', content: userMessage }],
        });
      } catch (err) {
        console.error(
          `[auto-categorize] Anthropic API error for family ${familyId}:`,
          err instanceof Error ? err.message : err,
        );
        continue;
      }

      // Track cost
      const cost = estimateCost(
        COST_MODEL,
        response.usage.input_tokens,
        response.usage.output_tokens,
      );
      await upsertAiUsage(
        tx,
        familyId,
        response.usage.input_tokens,
        response.usage.output_tokens,
        cost,
      );
      runningCost = runningCost.plus(cost);

      // Parse tool_use response
      const toolUseBlock = response.content.find(
        (block) => block.type === 'tool_use',
      );
      if (!toolUseBlock || toolUseBlock.type !== 'tool_use') continue;

      const toolInput = toolUseBlock.input as {
        assignments?: Assignment[];
      };
      if (!toolInput.assignments) continue;

      // Valid category IDs for validation
      const validCategoryIds = new Set(categoryRows.map((c) => c.id));
      const validEntryIds = new Set(batch.map((e) => e.entryId));

      for (const assignment of toolInput.assignments) {
        // Validate the assignment references real IDs
        if (
          !validEntryIds.has(assignment.entryId) ||
          !validCategoryIds.has(assignment.categoryId)
        ) {
          continue;
        }

        if (assignment.confidence === 'low') {
          totalSkippedLowConfidence++;
          continue;
        }

        // Update category on the category-side entry_line (the line
        // without an accountId, or the one with a NULL categoryId).
        await tx
          .update(entryLine)
          .set({ categoryId: assignment.categoryId })
          .where(
            and(
              eq(entryLine.entryId, assignment.entryId),
              isNull(entryLine.accountId),
            ),
          );
        totalCategorized++;

        // Create induced rule if suggested
        if (assignment.ruleSuggestion) {
          const conditions = assignment.ruleSuggestion.conditions.map((c) => ({
            field: c.field as 'description' | 'amount',
            operator: c.operator as 'contains',
            value: c.value as string,
          }));

          // Ensure at least one condition references the description
          if (
            conditions.length === 0 ||
            !conditions.some((c) => c.field === 'description')
          ) {
            conditions.unshift({
              field: 'description',
              operator: 'contains',
              value: assignment.ruleSuggestion.merchantPattern,
            });
          }

          await tx.insert(rule).values({
            familyId,
            name: `Auto: ${assignment.ruleSuggestion.merchantPattern}`,
            stage: 'default',
            enabled: false, // review inbox — never auto-enable
            createdFrom: 'induced',
            specificityScore: conditions.length * 5,
            conditionsJson: conditions,
            actionsJson: [
              { type: 'set_category', value: assignment.categoryId },
            ],
          });
          totalRulesProposed++;
        }
      }
    }

    return {
      categorized: totalCategorized,
      rulesProposed: totalRulesProposed,
      skippedLowConfidence: totalSkippedLowConfidence,
    };
  });
}
