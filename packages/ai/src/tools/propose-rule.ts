/**
 * `propose_rule` — drafts a categorization rule from an example
 * transaction. Extracts merchant patterns from the description,
 * optionally adds an amount range condition, then tests the proposed
 * rule against recent transactions to estimate confidence.
 *
 * The AI calls this when a user wants to categorize a transaction and
 * apply it as an ongoing rule. The output is a rule spec for user
 * acceptance — the AI never writes rules directly.
 */

import Decimal from 'decimal.js';
import { z } from 'zod';

import { stripPII } from '../pii-stripper.ts';
import type { ToolAdapter } from './types.ts';

export const proposeRuleArgs = z.object({
  example_entry_id: z
    .string()
    .describe('Entry UUID of the example transaction to build a rule from.'),
  target_category_id: z
    .string()
    .describe('Category UUID to assign when this rule matches.'),
});

export const proposeRuleOutput = z.object({
  rule: z.object({
    conditions: z.array(
      z.object({
        field: z.string(),
        operator: z.string(),
        value: z.string(),
      }),
    ),
    actions: z.array(
      z.object({
        type: z.string(),
        value: z.string(),
      }),
    ),
    confidence: z.enum(['low', 'medium', 'high']),
    explanation: z.string(),
    matching_count: z.number(),
  }),
});

export type ProposeRuleArgs = z.infer<typeof proposeRuleArgs>;
export type ProposeRuleOutput = z.infer<typeof proposeRuleOutput>;

/**
 * Extract the core merchant name from a transaction description by
 * stripping trailing dates, reference numbers, amounts, and common
 * suffixes. Returns a pattern suitable for a "contains" match.
 */
function extractMerchantPattern(description: string): string {
  let pattern = description
    .trim()
    // Strip trailing reference numbers (#1234, ref:ABC123)
    .replace(/\s*(?:#|ref[:\s]*)\S+\s*$/gi, '')
    // Strip trailing dates (MM/DD, MM/DD/YY, YYYY-MM-DD)
    .replace(/\s*\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s*$/g, '')
    .replace(/\s*\d{4}-\d{2}-\d{2}\s*$/g, '')
    // Strip trailing dollar amounts ($12.34)
    .replace(/\s*\$?\d+\.\d{2}\s*$/g, '')
    // Strip trailing long digit sequences (card numbers, IDs)
    .replace(/\s*\d{4,}\s*$/g, '')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();

  // If stripping removed everything, fall back to first 2 words
  if (pattern.length === 0) {
    const words = description.trim().split(/\s+/);
    pattern = words.slice(0, 2).join(' ');
  }

  return pattern;
}

export const proposeRuleTool: ToolAdapter<
  ProposeRuleArgs,
  ProposeRuleOutput
> = async (args, loaders) => {
  const parsed = proposeRuleArgs.parse(args);
  const { example_entry_id, target_category_id } = parsed;

  const categoryNames = await loaders.loadCategoryNameMap();
  const catName = categoryNames.get(target_category_id) ?? target_category_id;

  // Step 1: Find the entry via loadEntries (searches by ID across 90 days).
  // loadTransactions doesn't support entryId filtering, so we use loadEntries
  // to locate the entry's date/category, then do a targeted loadTransactions
  // call to get the description.
  const today = new Date();
  const lookbackStart = new Date(today);
  lookbackStart.setDate(lookbackStart.getDate() - 90);
  const windowStart = lookbackStart.toISOString().slice(0, 10);
  const windowEnd = new Date(today.getTime() + 86400000)
    .toISOString()
    .slice(0, 10);

  const entries = await loaders.loadEntries({
    start: windowStart,
    end: windowEnd,
  });
  const entryMatch = entries.find((e) => e.entryId === example_entry_id);

  if (!entryMatch) {
    return proposeRuleOutput.parse(
      stripPII({
        rule: {
          conditions: [],
          actions: [{ type: 'set_category', value: target_category_id }],
          confidence: 'low',
          explanation: `Could not find transaction ${example_entry_id} in the last 90 days.`,
          matching_count: 0,
        },
      }),
    );
  }

  // Step 2: Targeted loadTransactions filtered by the entry's date to get the description.
  const txResult = await loaders.loadTransactions({
    filters: {
      startDate: entryMatch.entryDate,
      endDate: new Date(
        new Date(entryMatch.entryDate + 'T00:00:00Z').getTime() + 86400000,
      )
        .toISOString()
        .slice(0, 10),
      categoryId: entryMatch.categoryId ?? undefined,
    },
    limit: 50,
  });

  const example = txResult.rows.find((r) => r.entryId === example_entry_id);

  if (!example) {
    // Entry exists in entries but not in transactions — degrade gracefully
    return proposeRuleOutput.parse(
      stripPII({
        rule: {
          conditions: [],
          actions: [{ type: 'set_category', value: target_category_id }],
          confidence: 'low',
          explanation: `Found entry ${example_entry_id} but could not retrieve its description.`,
          matching_count: 0,
        },
      }),
    );
  }

  // Extract merchant pattern
  const merchantPattern = extractMerchantPattern(example.description);
  const conditions: Array<{ field: string; operator: string; value: string }> =
    [];

  // Primary condition: description contains merchant pattern
  conditions.push({
    field: 'description',
    operator: 'contains',
    value: merchantPattern,
  });

  // Optional: amount range if the amount is distinctive (±20%)
  const exampleAmount = new Decimal(example.amount).abs();
  if (exampleAmount.gt(0)) {
    const margin = exampleAmount.times('0.20');
    const min = exampleAmount.minus(margin);
    const max = exampleAmount.plus(margin);
    conditions.push({
      field: 'amount',
      operator: 'between',
      value: `${min.toFixed(2)}:${max.toFixed(2)}`,
    });
  }

  // Test the rule: search for transactions matching the merchant pattern
  const matchResult = await loaders.loadTransactions({
    query: merchantPattern,
    limit: 50,
  });

  // Count matches that actually contain the pattern (case-insensitive)
  const patternLower = merchantPattern.toLowerCase();
  const matchingRows = matchResult.rows.filter((r) =>
    r.description.toLowerCase().includes(patternLower),
  );
  const matchingCount = matchingRows.length;

  // Confidence: high if >3 matches, medium if 1-3, low if only the example
  let confidence: 'low' | 'medium' | 'high';
  if (matchingCount > 3) {
    confidence = 'high';
  } else if (matchingCount >= 1) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  const explanation =
    `Rule to categorize "${merchantPattern}" transactions as ${catName}. ` +
    `Found ${matchingCount} matching transaction${matchingCount !== 1 ? 's' : ''} in history.`;

  const result = {
    rule: {
      conditions,
      actions: [{ type: 'set_category', value: target_category_id }],
      confidence,
      explanation,
      matching_count: matchingCount,
    },
  };

  return proposeRuleOutput.parse(stripPII(result));
};
