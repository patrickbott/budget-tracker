import Decimal from 'decimal.js';
import { and, eq, lt, gte, sql } from 'drizzle-orm';
import type Anthropic from '@anthropic-ai/sdk';
import {
  aiUsage,
  coachingAlert,
  family,
} from '@budget-tracker/db/schema';
import { createDb } from '@budget-tracker/db/client';
import {
  checkSpendCap,
  createAnthropicClient,
  estimateCost,
} from '@budget-tracker/ai';

import { createToolLoadersForJob } from '../lib/tool-loaders.ts';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const COST_MODEL = 'claude-haiku-4-5';
const MAX_OUTPUT_TOKENS = 2048;

const SYSTEM_PROMPT = `You are a financial coach analyzing budget and recurring payment data. Given the structured data below, generate 0-3 actionable coaching alerts. Each alert must have:
- type: one of "budget_pace", "recurring_late", "goal_risk", "general"
- severity: one of "info", "warning", "critical"
- title: under 80 characters, specific and actionable
- body: 1-3 sentences explaining the issue and what the user can do

Guidelines:
- "budget_pace" with "warning" or "critical": a budgeted category is on pace to exceed by >10% based on current spend vs days remaining in the month
- "recurring_late": a recurring payment has a missing date in the past 7 days
- "general" with "info": a positive observation (spending down, goal progress) — max 1 per batch
- Return an empty JSON array [] if nothing warrants an alert
- Be specific with dollar amounts and category names
- Do not generate alerts for trivial variances (<10% over budget)

Respond with ONLY a valid JSON array of alert objects, no markdown, no explanation.`;

interface CoachingAlertResponse {
  type: 'budget_pace' | 'recurring_late' | 'goal_risk' | 'general';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string;
}

const VALID_TYPES = new Set(['budget_pace', 'recurring_late', 'goal_risk', 'general']);
const VALID_SEVERITIES = new Set(['info', 'warning', 'critical']);

function isValidAlert(a: unknown): a is CoachingAlertResponse {
  if (typeof a !== 'object' || a === null) return false;
  const obj = a as Record<string, unknown>;
  return (
    typeof obj.type === 'string' &&
    VALID_TYPES.has(obj.type) &&
    typeof obj.severity === 'string' &&
    VALID_SEVERITIES.has(obj.severity) &&
    typeof obj.title === 'string' &&
    obj.title.length > 0 &&
    obj.title.length <= 200 &&
    typeof obj.body === 'string' &&
    obj.body.length > 0
  );
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

export interface CoachingResult {
  familiesProcessed: number;
  familiesSkipped: number;
  alertsGenerated: number;
  errors: string[];
}

/**
 * Nightly coaching alert generator. Discovers all families, gathers
 * budget status + recurring status via ToolLoaders, feeds structured
 * data to a single Haiku call, and persists 0-3 actionable alerts.
 *
 * Unlike weekly-insights this is NOT a tool-use conversation loop —
 * the data gathering happens via direct ToolLoaders calls, and Haiku
 * only does the analysis + alert composition.
 *
 * Bypasses RLS (system-level job) and scopes queries explicitly.
 */
export async function generateCoachingAlerts(): Promise<CoachingResult> {
  const db = getDb();
  const capUsd = getSpendCapUsd();

  let familiesProcessed = 0;
  let familiesSkipped = 0;
  let alertsGenerated = 0;
  const errors: string[] = [];

  // Discover all families (system-level, bypasses RLS)
  const families = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL row_security = off`);
    return tx.select({ id: family.id }).from(family);
  });

  console.info(
    `[coaching] Generating alerts for ${families.length} family(ies)`,
  );

  const now = new Date();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const nextMonthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  const monthStartIso = monthStart.toISOString().split('T')[0]!;
  const nextMonthStartIso = nextMonthStart.toISOString().split('T')[0]!;
  const todayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );

  for (const fam of families) {
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL row_security = off`);

        // Delete expired alerts for this family
        await tx
          .delete(coachingAlert)
          .where(
            and(
              eq(coachingAlert.familyId, fam.id),
              lt(coachingAlert.expiresAt, now),
            ),
          );

        // Dedup: skip if already generated non-dismissed alerts today
        const existingToday = await tx
          .select({ id: coachingAlert.id })
          .from(coachingAlert)
          .where(
            and(
              eq(coachingAlert.familyId, fam.id),
              eq(coachingAlert.dismissed, false),
              gte(coachingAlert.generatedAt, todayStart),
            ),
          )
          .limit(1);

        if (existingToday.length > 0) {
          familiesSkipped++;
          return;
        }

        // Cost-cap check
        const usageRows = await tx
          .select({
            totalCost:
              sql<string>`COALESCE(SUM(${aiUsage.costUsd}), '0')`.as(
                'total_cost',
              ),
          })
          .from(aiUsage)
          .where(
            and(
              eq(aiUsage.familyId, fam.id),
              sql`${aiUsage.date} >= ${monthStartIso}`,
              sql`${aiUsage.date} < ${nextMonthStartIso}`,
            ),
          );

        const currentUsage = usageRows[0]?.totalCost ?? '0';
        const capCheck = checkSpendCap({ costUsd: currentUsage }, capUsd);
        if (!capCheck.allowed) {
          console.info(
            `[coaching] Cost cap reached for family ${fam.id} (${capCheck.percentUsed}%), skipping`,
          );
          familiesSkipped++;
          return;
        }

        // Gather structured data via ToolLoaders
        const loaders = createToolLoadersForJob(tx, fam.id);
        const budgetStatus = await loaders.loadBudgetStatus(
          monthStartIso,
          nextMonthStartIso,
        );
        const recurringStatus = await loaders.loadRecurringStatus();

        // If there's nothing to analyze, skip the API call
        if (budgetStatus.length === 0 && recurringStatus.length === 0) {
          familiesSkipped++;
          return;
        }

        // Build the user prompt with structured data
        const daysInMonth = Math.round(
          (nextMonthStart.getTime() - monthStart.getTime()) / (1000 * 60 * 60 * 24),
        );
        const dayOfMonth = now.getUTCDate();

        const userMessage = [
          `Today is ${now.toISOString().split('T')[0]}. Day ${dayOfMonth} of ${daysInMonth} in this month.`,
          '',
          '## Budget Status',
          budgetStatus.length > 0
            ? JSON.stringify(budgetStatus, null, 2)
            : 'No budgets configured.',
          '',
          '## Recurring Payments Status',
          recurringStatus.length > 0
            ? JSON.stringify(recurringStatus, null, 2)
            : 'No recurring payments tracked.',
        ].join('\n');

        // Single Haiku call
        const client = createAnthropicClient();
        const response = await client.messages.create({
          model: HAIKU_MODEL,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userMessage }],
        });

        const totalInputTokens = response.usage.input_tokens;
        const totalOutputTokens = response.usage.output_tokens;
        const cost = estimateCost(
          COST_MODEL,
          totalInputTokens,
          totalOutputTokens,
        );

        // Parse JSON response
        const textBlocks = response.content.filter(
          (block): block is Anthropic.Messages.TextBlock =>
            block.type === 'text',
        );
        const rawText = textBlocks.map((b) => b.text).join('');

        let alerts: CoachingAlertResponse[] = [];
        try {
          const parsed = JSON.parse(rawText);
          if (Array.isArray(parsed)) {
            alerts = parsed.filter(isValidAlert).slice(0, 3);
          }
        } catch {
          console.warn(
            `[coaching] Malformed JSON from Haiku for family ${fam.id}: ${rawText.slice(0, 200)}`,
          );
        }

        // Insert alert rows
        if (alerts.length > 0) {
          const costPerAlert = new Decimal(cost)
            .div(alerts.length)
            .toFixed(6);
          const tokensPerAlert = String(
            Math.ceil((totalInputTokens + totalOutputTokens) / alerts.length),
          );

          for (const alert of alerts) {
            // Budget alerts expire at end of month; recurring/general expire in 7 days
            const expiresAt =
              alert.type === 'budget_pace'
                ? nextMonthStart
                : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

            await tx.insert(coachingAlert).values({
              familyId: fam.id,
              alertType: alert.type,
              severity: alert.severity,
              title: alert.title,
              body: alert.body,
              expiresAt,
              tokensUsed: tokensPerAlert,
              costUsd: costPerAlert,
            });
          }
          alertsGenerated += alerts.length;
        }

        // Upsert ai_usage
        const today = now.toISOString().split('T')[0]!;
        await tx
          .insert(aiUsage)
          .values({
            familyId: fam.id,
            date: new Date(`${today}T00:00:00.000Z`),
            model: HAIKU_MODEL,
            inputTokens: String(totalInputTokens),
            outputTokens: String(totalOutputTokens),
            costUsd: cost,
          })
          .onConflictDoUpdate({
            target: [aiUsage.familyId, aiUsage.date, aiUsage.model],
            set: {
              inputTokens: sql`${aiUsage.inputTokens} + ${String(totalInputTokens)}`,
              outputTokens: sql`${aiUsage.outputTokens} + ${String(totalOutputTokens)}`,
              costUsd: sql`${aiUsage.costUsd} + ${cost}`,
            },
          });

        familiesProcessed++;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error(
        `[coaching] Error generating alerts for family ${fam.id}: ${msg}`,
      );
      errors.push(`${fam.id}: ${msg}`);
    }
  }

  return { familiesProcessed, familiesSkipped, alertsGenerated, errors };
}
