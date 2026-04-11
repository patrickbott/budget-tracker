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

export { createAnthropicClient } from './client.ts';
