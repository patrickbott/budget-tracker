/**
 * `TOOL_REGISTRY` — the canonical mapping from tool name (as exposed to
 * the Anthropic `tool_use` API) to its Zod schemas and handler. Chat,
 * batch insights, and auto-categorization all share this registry, so
 * adding a tool in one place lights it up everywhere.
 *
 * Phase 3 R2 covers the first four report-backed tools. The full
 * inventory in `docs/ai-tools.md` (16 tools) lands in R3/R4.
 *
 * `toAnthropicToolDefinitions` converts the registry into the exact
 * shape the Anthropic SDK expects in `messages.create({ tools })`,
 * using `zod-to-json-schema` to translate each input schema into
 * JSON-Schema-for-tool-use.
 */

import { z, type ZodType } from 'zod';

import {
  budgetStatusArgs,
  budgetStatusOutput,
  budgetStatusTool,
} from './budget-status.ts';
import {
  comparePeriodsArgs,
  comparePeriodsOutput,
  comparePeriodsTool,
} from './compare-periods.ts';
import {
  findTransactionsArgs,
  findTransactionsOutput,
  findTransactionsTool,
} from './find-transactions.ts';
import {
  getCashflowArgs,
  getCashflowOutput,
  getCashflowTool,
} from './get-cashflow.ts';
import {
  getNetWorthArgs,
  getNetWorthOutput,
  getNetWorthTool,
} from './get-net-worth.ts';
import {
  getSpendingByCategoryArgs,
  getSpendingByCategoryOutput,
  getSpendingByCategoryTool,
} from './get-spending-by-category.ts';
import {
  listAccountsArgs,
  listAccountsOutput,
  listAccountsTool,
} from './list-accounts.ts';
import {
  listCategoriesArgs,
  listCategoriesOutput,
  listCategoriesTool,
} from './list-categories.ts';
import {
  recurringStatusArgs,
  recurringStatusOutput,
  recurringStatusTool,
} from './recurring-status.ts';
import type { ToolAdapter } from './types.ts';

export interface ToolRegistryEntry<TArgs = unknown, TOutput = unknown> {
  description: string;
  inputSchema: ZodType<TArgs>;
  outputSchema: ZodType<TOutput>;
  handler: ToolAdapter<TArgs, TOutput>;
}

export const TOOL_REGISTRY = {
  get_spending_by_category: {
    description:
      'Total outflow per category within a half-open ISO date window. Excludes transfers and uncategorized entries. Returns rows sorted by total DESC, each row tagged with its display category name.',
    inputSchema: getSpendingByCategoryArgs,
    outputSchema: getSpendingByCategoryOutput,
    handler: getSpendingByCategoryTool,
  } satisfies ToolRegistryEntry<
    import('./get-spending-by-category.ts').GetSpendingByCategoryArgs,
    import('./get-spending-by-category.ts').GetSpendingByCategoryOutput
  >,
  get_cashflow: {
    description:
      'Income, expense, and net cashflow bucketed by day/week/month over a half-open ISO date window. Transfers excluded. Weeks are ISO Monday UTC, months are day-1 UTC.',
    inputSchema: getCashflowArgs,
    outputSchema: getCashflowOutput,
    handler: getCashflowTool,
  } satisfies ToolRegistryEntry<
    import('./get-cashflow.ts').GetCashflowArgs,
    import('./get-cashflow.ts').GetCashflowOutput
  >,
  get_net_worth: {
    description:
      'Assets − liabilities at a point in time, broken out by account type. Credit cards and loans count as liabilities; everything else as assets.',
    inputSchema: getNetWorthArgs,
    outputSchema: getNetWorthOutput,
    handler: getNetWorthTool,
  } satisfies ToolRegistryEntry<
    import('./get-net-worth.ts').GetNetWorthArgs,
    import('./get-net-worth.ts').GetNetWorthOutput
  >,
  compare_periods: {
    description:
      'Per-category or per-account spending across two windows, with signed deltas. Sorted by |delta| DESC (biggest movers first, regardless of direction), with alphabetic tiebreak for determinism.',
    inputSchema: comparePeriodsArgs,
    outputSchema: comparePeriodsOutput,
    handler: comparePeriodsTool,
  } satisfies ToolRegistryEntry<
    import('./compare-periods.ts').ComparePeriodsArgs,
    import('./compare-periods.ts').ComparePeriodsOutput
  >,
  find_transactions: {
    description:
      'Search transactions by text query and/or structured filters (account, category, date range, amount range). Hard-limited to 50 results.',
    inputSchema: findTransactionsArgs,
    outputSchema: findTransactionsOutput,
    handler: findTransactionsTool,
  } satisfies ToolRegistryEntry<
    import('./find-transactions.ts').FindTransactionsArgs,
    import('./find-transactions.ts').FindTransactionsOutput
  >,
  budget_status: {
    description:
      'Per-category budget vs actual spend for a date range. Returns budget mode, amounts, remaining balance, percent used, and a traffic-light status (on_track / warning / over_budget).',
    inputSchema: budgetStatusArgs,
    outputSchema: budgetStatusOutput,
    handler: budgetStatusTool,
  } satisfies ToolRegistryEntry<
    import('./budget-status.ts').BudgetStatusArgs,
    import('./budget-status.ts').BudgetStatusOutput
  >,
  recurring_status: {
    description:
      'All active recurring transaction series with expected/missing date analysis. Status: on_time (no missing), late (one missing), missing (multiple missing).',
    inputSchema: recurringStatusArgs,
    outputSchema: recurringStatusOutput,
    handler: recurringStatusTool,
  } satisfies ToolRegistryEntry<
    import('./recurring-status.ts').RecurringStatusArgs,
    import('./recurring-status.ts').RecurringStatusOutput
  >,
  list_categories: {
    description:
      'Directory lookup of all categories for the family. Returns ID, name, and parent name. Use to resolve natural-language category names to IDs before calling other tools.',
    inputSchema: listCategoriesArgs,
    outputSchema: listCategoriesOutput,
    handler: listCategoriesTool,
  } satisfies ToolRegistryEntry<
    import('./list-categories.ts').ListCategoriesArgs,
    import('./list-categories.ts').ListCategoriesOutput
  >,
  list_accounts: {
    description:
      'Directory lookup of all accounts for the family. Returns ID, name, account type, and visibility. Use to resolve natural-language account names to IDs before calling other tools.',
    inputSchema: listAccountsArgs,
    outputSchema: listAccountsOutput,
    handler: listAccountsTool,
  } satisfies ToolRegistryEntry<
    import('./list-accounts.ts').ListAccountsArgs,
    import('./list-accounts.ts').ListAccountsOutput
  >,
} as const;

export type ToolName = keyof typeof TOOL_REGISTRY;

export interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/**
 * Convert `TOOL_REGISTRY` into the exact shape Anthropic's
 * `messages.create({ tools })` expects. One entry per tool, with the
 * Zod input schema translated to a JSON Schema object. We strip the
 * `$schema` key the library adds so the output is compact and doesn't
 * confuse the model with a meta-schema reference it can't use.
 */
/**
 * Zod v4 ships with `z.toJSONSchema` built-in — we use that rather than
 * `zod-to-json-schema`, which still targets Zod v3 internals and
 * returns an empty envelope for Zod v4 schemas. The `$schema` meta
 * reference is stripped so the model doesn't see a dangling URL it
 * can't use.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toAnthropicToolDefinitions(
  registry: Record<string, ToolRegistryEntry<any, any>>,
): AnthropicToolDefinition[] {
  return Object.entries(registry).map(([name, tool]) => {
    const jsonSchema = z.toJSONSchema(tool.inputSchema) as Record<
      string,
      unknown
    >;
    delete jsonSchema.$schema;

    return {
      name,
      description: tool.description,
      input_schema: jsonSchema,
    };
  });
}

export type { ToolAdapter, ToolLoaders } from './types.ts';
