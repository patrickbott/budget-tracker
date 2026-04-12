/**
 * `@budget-tracker/ai` — public barrel.
 *
 * Consumers import from `@budget-tracker/ai` directly; the deep-import
 * paths exposed in `package.json` (`./tools`, `./pii-stripper`) exist
 * so `apps/web` can pull in narrower slices when it wants to avoid
 * loading the full Anthropic SDK at build time.
 */

export { stripPII } from './pii-stripper.ts';

export type { ToolAdapter, ToolLoaders } from './tools/types.ts';

export {
  TOOL_REGISTRY,
  toAnthropicToolDefinitions,
  type AnthropicToolDefinition,
  type ToolName,
  type ToolRegistryEntry,
} from './tools/index.ts';

export {
  getSpendingByCategoryArgs,
  getSpendingByCategoryOutput,
  getSpendingByCategoryTool,
  type GetSpendingByCategoryArgs,
  type GetSpendingByCategoryOutput,
} from './tools/get-spending-by-category.ts';

export {
  getCashflowArgs,
  getCashflowOutput,
  getCashflowTool,
  type GetCashflowArgs,
  type GetCashflowOutput,
} from './tools/get-cashflow.ts';

export {
  getNetWorthArgs,
  getNetWorthOutput,
  getNetWorthTool,
  type GetNetWorthArgs,
  type GetNetWorthOutput,
} from './tools/get-net-worth.ts';

export {
  comparePeriodsArgs,
  comparePeriodsOutput,
  comparePeriodsTool,
  type ComparePeriodsArgs,
  type ComparePeriodsOutput,
} from './tools/compare-periods.ts';

export {
  findTransactionsArgs,
  findTransactionsOutput,
  findTransactionsTool,
  type FindTransactionsArgs,
  type FindTransactionsOutput,
} from './tools/find-transactions.ts';

export {
  budgetStatusArgs,
  budgetStatusOutput,
  budgetStatusTool,
  type BudgetStatusArgs,
  type BudgetStatusOutput,
} from './tools/budget-status.ts';

export {
  recurringStatusArgs,
  recurringStatusOutput,
  recurringStatusTool,
  type RecurringStatusArgs,
  type RecurringStatusOutput,
} from './tools/recurring-status.ts';

export {
  listCategoriesArgs,
  listCategoriesOutput,
  listCategoriesTool,
  type ListCategoriesArgs,
  type ListCategoriesOutput,
} from './tools/list-categories.ts';

export {
  listAccountsArgs,
  listAccountsOutput,
  listAccountsTool,
  type ListAccountsArgs,
  type ListAccountsOutput,
} from './tools/list-accounts.ts';

export {
  checkSpendCap,
  estimateCost,
  type SpendCapResult,
} from './cost-cap.ts';

export { createAnthropicClient } from './client.ts';
