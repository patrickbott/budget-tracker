import Decimal from 'decimal.js';
import { and, eq, sql } from 'drizzle-orm';
import type Anthropic from '@anthropic-ai/sdk';
import {
  aiUsage,
  family,
  insight,
  membership,
  user,
} from '@budget-tracker/db/schema';
import { createDb } from '@budget-tracker/db/client';
import {
  checkSpendCap,
  createAnthropicClient,
  estimateCost,
  TOOL_REGISTRY,
  toAnthropicToolDefinitions,
  type ToolName,
} from '@budget-tracker/ai';

import { createToolLoadersForJob } from '../lib/tool-loaders.ts';
import { sendInsightEmail } from '../lib/email.ts';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const COST_MODEL = 'claude-haiku-4-5';
const MAX_TOOL_ITERATIONS = 10;
const MAX_OUTPUT_TOKENS = 4096;

const SYSTEM_PROMPT = `You are a financial analyst generating a weekly spending report. Use the available tools to gather data about the past week, then compose a concise markdown report covering: spending summary by category, notable transactions, budget status, and any actionable observations. Keep it under 500 words.`;

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

function getWeekBounds(): { mondayIso: string; sundayIso: string; monday: Date; sunday: Date } {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0 = Sunday
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - daysSinceMonday);
  monday.setUTCHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);

  return {
    mondayIso: monday.toISOString().split('T')[0]!,
    sundayIso: sunday.toISOString().split('T')[0]!,
    monday,
    sunday,
  };
}

export interface WeeklyInsightsResult {
  familiesProcessed: number;
  familiesSkipped: number;
  emailsSent: number;
  emailsFailed: number;
  errors: string[];
}

/**
 * Weekly insights cron. Runs every Sunday and generates a markdown
 * report for each family using Haiku + the same typed tools the chat
 * uses.
 *
 * Bypasses RLS (system-level job) and scopes queries explicitly.
 */
export async function generateWeeklyInsights(): Promise<WeeklyInsightsResult> {
  const db = getDb();
  const capUsd = getSpendCapUsd();
  const { mondayIso, sundayIso, monday, sunday } = getWeekBounds();
  const toolDefs = toAnthropicToolDefinitions(TOOL_REGISTRY);

  let familiesProcessed = 0;
  let familiesSkipped = 0;
  let emailsSent = 0;
  let emailsFailed = 0;
  const errors: string[] = [];

  // Discover all families (system-level, bypasses RLS)
  const families = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL row_security = off`);
    return tx.select({ id: family.id }).from(family);
  });

  console.info(
    `[weekly-insights] Generating reports for ${families.length} family(ies), week ${mondayIso}→${sundayIso}`,
  );

  for (const fam of families) {
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL row_security = off`);

        // Dedup check: skip if insight already exists for this period
        const existing = await tx
          .select({ id: insight.id })
          .from(insight)
          .where(
            and(
              eq(insight.familyId, fam.id),
              eq(insight.period, 'weekly'),
              eq(insight.periodStart, monday),
            ),
          )
          .limit(1);

        if (existing.length > 0) {
          familiesSkipped++;
          return;
        }

        // Cost-cap check
        const now = new Date();
        const monthStart = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
        );
        const monthEnd = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
        );

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
              sql`${aiUsage.date} >= ${monthStart.toISOString().split('T')[0]}`,
              sql`${aiUsage.date} < ${monthEnd.toISOString().split('T')[0]}`,
            ),
          );

        const currentUsage = usageRows[0]?.totalCost ?? '0';
        const capCheck = checkSpendCap({ costUsd: currentUsage }, capUsd);
        if (!capCheck.allowed) {
          console.info(
            `[weekly-insights] Cost cap reached for family ${fam.id} (${capCheck.percentUsed}%), skipping`,
          );
          familiesSkipped++;
          return;
        }

        // Create ToolLoaders scoped to this family
        const loaders = createToolLoadersForJob(tx, fam.id);

        // Tool-use conversation loop
        const client = createAnthropicClient();
        const messages: Anthropic.Messages.MessageParam[] = [
          {
            role: 'user',
            content: `Generate a weekly spending report for the week of ${mondayIso} to ${sundayIso}. Use the available tools to gather data, then write the report.`,
          },
        ];

        let response = await client.messages.create({
          model: HAIKU_MODEL,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: SYSTEM_PROMPT,
          tools: toolDefs as Anthropic.Messages.Tool[],
          messages,
        });

        const allToolCalls: Array<{
          name: string;
          input: Record<string, unknown>;
          output: unknown;
        }> = [];
        let totalInputTokens = response.usage.input_tokens;
        let totalOutputTokens = response.usage.output_tokens;
        let iterations = 0;
        let runningCost = new Decimal(currentUsage);

        // Track first call cost
        const firstCost = estimateCost(
          COST_MODEL,
          response.usage.input_tokens,
          response.usage.output_tokens,
        );
        runningCost = runningCost.plus(firstCost);

        while (
          response.stop_reason === 'tool_use' &&
          iterations < MAX_TOOL_ITERATIONS
        ) {
          iterations++;

          // Re-check spend cap
          const loopCapCheck = checkSpendCap(
            { costUsd: runningCost.toFixed(6) },
            capUsd,
          );
          if (!loopCapCheck.allowed) break;

          const toolUseBlocks = response.content.filter(
            (block): block is Anthropic.Messages.ToolUseBlock =>
              block.type === 'tool_use',
          );

          const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
          for (const toolUse of toolUseBlocks) {
            const toolName = toolUse.name as ToolName;
            const registryEntry = TOOL_REGISTRY[toolName];

            let resultContent: string;
            if (!registryEntry) {
              resultContent = JSON.stringify({
                error: `Unknown tool: ${toolName}`,
              });
            } else {
              try {
                const output = await registryEntry.handler(
                  toolUse.input as never,
                  loaders,
                );
                resultContent = JSON.stringify(output);
                allToolCalls.push({
                  name: toolUse.name,
                  input: toolUse.input as Record<string, unknown>,
                  output,
                });
              } catch (err) {
                resultContent = JSON.stringify({
                  error:
                    err instanceof Error
                      ? err.message
                      : 'Tool execution failed',
                });
              }
            }

            toolResults.push({
              type: 'tool_result' as const,
              tool_use_id: toolUse.id,
              content: resultContent,
            });
          }

          messages.push({
            role: 'assistant',
            content:
              response.content as Anthropic.Messages.ContentBlockParam[],
          });
          messages.push({
            role: 'user',
            content: toolResults,
          });

          response = await client.messages.create({
            model: HAIKU_MODEL,
            max_tokens: MAX_OUTPUT_TOKENS,
            system: SYSTEM_PROMPT,
            tools: toolDefs as Anthropic.Messages.Tool[],
            messages,
          });

          totalInputTokens += response.usage.input_tokens;
          totalOutputTokens += response.usage.output_tokens;
          const iterCost = estimateCost(
            COST_MODEL,
            response.usage.input_tokens,
            response.usage.output_tokens,
          );
          runningCost = runningCost.plus(iterCost);
        }

        // Extract final text response
        const textBlocks = response.content.filter(
          (block): block is Anthropic.Messages.TextBlock =>
            block.type === 'text',
        );
        const markdownBody =
          textBlocks.map((b) => b.text).join('\n\n') ||
          '_No activity this week._';

        // Compute total cost for this insight
        const totalCostUsd = new Decimal(runningCost)
          .minus(currentUsage)
          .toFixed(6);

        // Insert insight row
        const [insertedInsight] = await tx.insert(insight).values({
          familyId: fam.id,
          period: 'weekly',
          periodStart: monday,
          periodEnd: sunday,
          markdownBody,
          toolCallsJson: allToolCalls.length > 0 ? allToolCalls : null,
          tokensUsed: String(totalInputTokens + totalOutputTokens),
          costUsd: totalCostUsd,
        }).returning({ id: insight.id });

        // Send email to family members
        const members = await tx
          .select({ email: user.email })
          .from(membership)
          .innerJoin(user, eq(user.id, membership.userId))
          .where(eq(membership.organizationId, fam.id));

        const memberEmails = members.map((m) => m.email);
        if (memberEmails.length > 0) {
          const emailResult = await sendInsightEmail({
            to: memberEmails,
            subject: `Weekly Spending Report — ${mondayIso} to ${sundayIso}`,
            markdownBody,
          });

          if (emailResult.sent) {
            emailsSent++;
            if (insertedInsight) {
              await tx
                .update(insight)
                .set({ emailedAt: new Date() })
                .where(eq(insight.id, insertedInsight.id));
            }
            console.info(
              `[weekly-insights] Email sent for family ${fam.id} (messageId: ${emailResult.messageId})`,
            );
          } else {
            emailsFailed++;
            console.warn(
              `[weekly-insights] Email failed for family ${fam.id}: ${emailResult.error}`,
            );
          }
        }

        // Upsert ai_usage
        const today = new Date().toISOString().split('T')[0]!;
        await tx
          .insert(aiUsage)
          .values({
            familyId: fam.id,
            date: new Date(`${today}T00:00:00.000Z`),
            model: HAIKU_MODEL,
            inputTokens: String(totalInputTokens),
            outputTokens: String(totalOutputTokens),
            costUsd: totalCostUsd,
          })
          .onConflictDoUpdate({
            target: [aiUsage.familyId, aiUsage.date, aiUsage.model],
            set: {
              inputTokens: sql`${aiUsage.inputTokens} + ${String(totalInputTokens)}`,
              outputTokens: sql`${aiUsage.outputTokens} + ${String(totalOutputTokens)}`,
              costUsd: sql`${aiUsage.costUsd} + ${totalCostUsd}`,
            },
          });

        familiesProcessed++;
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Unknown error';
      console.error(
        `[weekly-insights] Error generating report for family ${fam.id}: ${msg}`,
      );
      errors.push(`${fam.id}: ${msg}`);
    }
  }

  return { familiesProcessed, familiesSkipped, emailsSent, emailsFailed, errors };
}
