/**
 * `@budget-tracker/core` — package entrypoint.
 *
 * Framework-agnostic business logic for Budget Tracker. Nothing in this
 * package imports Next.js, React, the database client, the SimpleFIN
 * client, the Anthropic SDK, or any other framework. It is pure
 * TypeScript that operates on plain objects.
 *
 * This is intentional: the most important invariants (double-entry,
 * rules, budget math, transfer detection) must be unit-testable without
 * spinning up a database or a browser. If you find yourself reaching for
 * a runtime dependency here, put the dependency in `packages/db` or
 * `apps/web` and pass plain data through core.
 *
 * Each submodule is also exposed as a subpath export (see package.json
 * `exports`), so consumers can tree-shake aggressively:
 *
 *   import { validateEntryLines } from '@budget-tracker/core/entries';
 */
export * from './entries/index.ts';
export * from './rules/index.ts';
export * from './budgets/index.ts';
export * from './transfers/index.ts';
export * from './recurring/index.ts';
export * from './reports/index.ts';
export * from './types/index.ts';
