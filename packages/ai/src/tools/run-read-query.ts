/**
 * `run_read_query` — escape-hatch read-only SQL tool. Executes a
 * validated SELECT query within the RLS-scoped transaction so results
 * are automatically restricted to the current family.
 *
 * **Security layers:**
 * 1. SQL validation: rejects DDL, DML, and dangerous statements
 * 2. RLS: Postgres session variables scope all rows to `family_id`
 * 3. PII stripping: all string values in results are scrubbed
 * 4. Row limit: hard cap at 100 rows
 *
 * The SQL validation is defense-in-depth — RLS is the primary
 * security boundary. We err on the side of rejecting valid queries
 * rather than allowing dangerous ones.
 */

import { z } from 'zod';

import { stripPII } from '../pii-stripper.ts';
import type { ToolAdapter } from './types.ts';

export const runReadQueryArgs = z.object({
  sql: z
    .string()
    .describe(
      'A read-only SQL SELECT statement. Must start with SELECT. No DDL, DML, or write operations allowed.',
    ),
});

export const runReadQueryOutput = z.object({
  columns: z.array(z.string()),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: z.array(z.record(z.string(), z.any())),
  row_count: z.number(),
  truncated: z.boolean(),
  error: z.string().optional(),
});

export type RunReadQueryArgs = z.infer<typeof runReadQueryArgs>;
export type RunReadQueryOutput = z.infer<typeof runReadQueryOutput>;

const MAX_ROWS = 100;

/**
 * Dangerous SQL keywords that must never appear in a user-submitted
 * query. Matched on word boundaries, case-insensitive. Organized by
 * threat category for clarity.
 */
const FORBIDDEN_KEYWORDS = [
  // DDL
  'CREATE',
  'DROP',
  'ALTER',
  'TRUNCATE',
  // DML
  'INSERT',
  'UPDATE',
  'DELETE',
  'MERGE',
  // Data exfiltration / privilege escalation
  'INTO',
  'GRANT',
  'REVOKE',
  'COPY',
  // Execution / side effects
  'EXECUTE',
  'CALL',
  // Session / maintenance
  'SET',
  'RESET',
  'LISTEN',
  'NOTIFY',
  'VACUUM',
  'ANALYZE',
  'CLUSTER',
  'REINDEX',
];

/**
 * Build a single RegExp that matches any forbidden keyword at a word
 * boundary. The pattern is built once at module load.
 */
const FORBIDDEN_RE = new RegExp(
  `\\b(?:${FORBIDDEN_KEYWORDS.join('|')})\\b`,
  'i',
);

/**
 * Detect CTEs (WITH clauses) that contain write operations.
 * A read-only CTE is fine: `WITH cte AS (SELECT ...)`.
 * A writable CTE is not: `WITH cte AS (INSERT ... RETURNING ...)`.
 */
const CTE_WRITE_RE =
  /\bWITH\b[\s\S]*?\bAS\b\s*\([\s\S]*?\b(?:INSERT|UPDATE|DELETE|MERGE)\b/i;

export interface SqlValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate that a SQL string is a safe read-only query.
 * Exported for direct testing.
 */
export function validateReadOnlySQL(sql: string): SqlValidationResult {
  // Strip leading whitespace and SQL comments to find the actual statement
  const stripped = sql
    .replace(/^\s+/, '')
    .replace(/^--[^\n]*\n/g, '')
    .replace(/^\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s+/, '');

  // Must start with SELECT or WITH (for CTEs)
  if (!/^(?:SELECT|WITH)\b/i.test(stripped)) {
    return {
      valid: false,
      error: 'Query must start with SELECT (or WITH for CTEs). No DDL, DML, or other statements are allowed.',
    };
  }

  // Check for CTE-wrapped writes
  if (CTE_WRITE_RE.test(sql)) {
    return {
      valid: false,
      error: 'CTEs containing INSERT, UPDATE, DELETE, or MERGE are not allowed.',
    };
  }

  // Check for forbidden keywords (but not inside CTEs that already passed)
  // For queries starting with WITH, we need to check the non-CTE parts too
  if (FORBIDDEN_RE.test(sql)) {
    // Extract the matched keyword for a helpful error message
    const match = sql.match(FORBIDDEN_RE);
    const keyword = match ? match[0].toUpperCase() : 'unknown';
    return {
      valid: false,
      error: `Query contains forbidden keyword: ${keyword}. Only SELECT queries are allowed.`,
    };
  }

  return { valid: true };
}

export const runReadQueryTool: ToolAdapter<
  RunReadQueryArgs,
  RunReadQueryOutput
> = async (args, loaders) => {
  const parsed = runReadQueryArgs.parse(args);

  const validation = validateReadOnlySQL(parsed.sql);
  if (!validation.valid) {
    return runReadQueryOutput.parse({
      columns: [],
      rows: [],
      row_count: 0,
      truncated: false,
      error: validation.error,
    });
  }

  const result = await loaders.runReadQuery(parsed.sql);

  const truncated = result.totalRows > MAX_ROWS;
  const limitedRows = result.rows.slice(0, MAX_ROWS);

  const strippedResult = {
    columns: result.columns,
    rows: limitedRows,
    row_count: Math.min(result.totalRows, MAX_ROWS),
    truncated,
  };

  return runReadQueryOutput.parse(stripPII(strippedResult));
};
