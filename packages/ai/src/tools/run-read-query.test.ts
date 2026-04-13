import { describe, expect, it } from 'vitest';

import {
  runReadQueryTool,
  validateReadOnlySQL,
} from './run-read-query.ts';
import type { ToolLoaders } from './types.ts';

function makeLoaders(overrides: Partial<ToolLoaders> = {}): ToolLoaders {
  return {
    loadEntries: async () => [],
    loadAccounts: async () => [],
    loadCategoryNameMap: async () => new Map(),
    loadAccountNameMap: async () => new Map(),
    loadTransactions: async () => ({ rows: [], total: 0 }),
    loadBudgetStatus: async () => [],
    loadRecurringStatus: async () => [],
    loadCategories: async () => [],
    loadAccountsList: async () => [],
    loadGoals: async () => [],
    runReadQuery: async () => ({ columns: [], rows: [], totalRows: 0 }),
    ...overrides,
  };
}

describe('validateReadOnlySQL', () => {
  it('allows plain SELECT statements', () => {
    expect(validateReadOnlySQL('SELECT * FROM entry').valid).toBe(true);
    expect(
      validateReadOnlySQL('SELECT id, name FROM category WHERE id = 1').valid,
    ).toBe(true);
    expect(
      validateReadOnlySQL('select count(*) from entry').valid,
    ).toBe(true);
  });

  it('allows SELECT with leading whitespace', () => {
    expect(validateReadOnlySQL('  SELECT 1').valid).toBe(true);
    expect(validateReadOnlySQL('\n  SELECT 1').valid).toBe(true);
  });

  it('allows SELECT with leading SQL comments', () => {
    expect(
      validateReadOnlySQL('-- this is a comment\nSELECT 1').valid,
    ).toBe(true);
    expect(
      validateReadOnlySQL('/* block comment */ SELECT 1').valid,
    ).toBe(true);
  });

  it('allows read-only CTEs', () => {
    expect(
      validateReadOnlySQL(
        'WITH totals AS (SELECT SUM(amount) FROM entry_line) SELECT * FROM totals',
      ).valid,
    ).toBe(true);
  });

  it('rejects DDL statements', () => {
    expect(validateReadOnlySQL('CREATE TABLE foo (id int)').valid).toBe(false);
    expect(validateReadOnlySQL('DROP TABLE entry').valid).toBe(false);
    expect(validateReadOnlySQL('ALTER TABLE entry ADD COLUMN x int').valid).toBe(
      false,
    );
    expect(validateReadOnlySQL('TRUNCATE entry').valid).toBe(false);
  });

  it('rejects DML statements', () => {
    expect(
      validateReadOnlySQL("INSERT INTO entry (id) VALUES ('x')").valid,
    ).toBe(false);
    expect(
      validateReadOnlySQL("UPDATE entry SET description = 'x'").valid,
    ).toBe(false);
    expect(validateReadOnlySQL('DELETE FROM entry').valid).toBe(false);
    expect(validateReadOnlySQL('MERGE INTO entry USING source ON true').valid).toBe(
      false,
    );
  });

  it('rejects dangerous statements (case insensitive)', () => {
    expect(validateReadOnlySQL('GRANT ALL ON entry TO public').valid).toBe(
      false,
    );
    expect(validateReadOnlySQL('revoke select on entry from public').valid).toBe(
      false,
    );
    expect(validateReadOnlySQL('COPY entry TO stdout').valid).toBe(false);
    expect(validateReadOnlySQL('EXECUTE some_function()').valid).toBe(false);
    expect(validateReadOnlySQL('CALL some_procedure()').valid).toBe(false);
    expect(
      validateReadOnlySQL("SET search_path TO 'public'").valid,
    ).toBe(false);
    expect(validateReadOnlySQL('VACUUM entry').valid).toBe(false);
    expect(validateReadOnlySQL('ANALYZE entry').valid).toBe(false);
    expect(validateReadOnlySQL('REINDEX TABLE entry').valid).toBe(false);
  });

  it('rejects SELECT INTO (table creation)', () => {
    const result = validateReadOnlySQL(
      'SELECT * INTO new_table FROM entry',
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain('INTO');
  });

  it('rejects CTEs with write operations', () => {
    expect(
      validateReadOnlySQL(
        'WITH deleted AS (DELETE FROM entry RETURNING *) SELECT * FROM deleted',
      ).valid,
    ).toBe(false);
    expect(
      validateReadOnlySQL(
        "WITH ins AS (INSERT INTO entry (id) VALUES ('x') RETURNING *) SELECT * FROM ins",
      ).valid,
    ).toBe(false);
  });

  it('rejects case variations', () => {
    expect(validateReadOnlySQL('select * INTO foo from entry').valid).toBe(
      false,
    );
    expect(
      validateReadOnlySQL("Select * From entry; Delete From entry").valid,
    ).toBe(false);
  });

  it('provides helpful error messages', () => {
    // UPDATE doesn't start with SELECT, so the error is about starting keyword
    const result = validateReadOnlySQL("UPDATE entry SET x = 'y'");
    expect(result.valid).toBe(false);
    expect(result.error).toContain('must start with SELECT');

    const ddlResult = validateReadOnlySQL('CREATE TABLE foo (id int)');
    expect(ddlResult.valid).toBe(false);
    expect(ddlResult.error).toContain('must start with SELECT');

    // Embedded forbidden keyword in an otherwise valid SELECT
    const intoResult = validateReadOnlySQL('SELECT * INTO new_table FROM entry');
    expect(intoResult.valid).toBe(false);
    expect(intoResult.error).toContain('INTO');
  });

  it('rejects non-SELECT starting statements', () => {
    expect(validateReadOnlySQL('LISTEN channel').valid).toBe(false);
    expect(validateReadOnlySQL('NOTIFY channel').valid).toBe(false);
    expect(validateReadOnlySQL('RESET ALL').valid).toBe(false);
  });
});

describe('runReadQueryTool', () => {
  it('executes a valid SELECT and returns results', async () => {
    const loaders = makeLoaders({
      runReadQuery: async () => ({
        columns: ['id', 'name'],
        rows: [
          { id: 'cat1', name: 'Groceries' },
          { id: 'cat2', name: 'Dining' },
        ],
        totalRows: 2,
      }),
    });

    const out = await runReadQueryTool(
      { sql: 'SELECT id, name FROM category' },
      loaders,
    );

    expect(out.columns).toEqual(['id', 'name']);
    expect(out.rows).toHaveLength(2);
    expect(out.row_count).toBe(2);
    expect(out.truncated).toBe(false);
  });

  it('truncates results at 100 rows', async () => {
    const bigResult = Array.from({ length: 150 }, (_, i) => ({
      id: `row-${i}`,
      value: `v${i}`,
    }));

    const loaders = makeLoaders({
      runReadQuery: async () => ({
        columns: ['id', 'value'],
        rows: bigResult,
        totalRows: 150,
      }),
    });

    const out = await runReadQueryTool(
      { sql: 'SELECT * FROM big_table' },
      loaders,
    );

    expect(out.rows).toHaveLength(100);
    expect(out.row_count).toBe(100);
    expect(out.truncated).toBe(true);
  });

  it('returns error for rejected SQL', async () => {
    const loaders = makeLoaders();

    const out = await runReadQueryTool(
      { sql: 'DELETE FROM entry' },
      loaders,
    );

    expect(out.columns).toEqual([]);
    expect(out.rows).toHaveLength(0);
    expect(out.row_count).toBe(0);
    expect(out.truncated).toBe(false);
  });

  it('strips PII from result values', async () => {
    const loaders = makeLoaders({
      runReadQuery: async () => ({
        columns: ['description'],
        rows: [
          { description: 'Payment to customer: John Doe, email: john@example.com' },
        ],
        totalRows: 1,
      }),
    });

    const out = await runReadQueryTool(
      { sql: 'SELECT description FROM entry' },
      loaders,
    );

    const desc = out.rows[0]!.description as string;
    expect(desc).not.toContain('john@example.com');
    expect(desc).toContain('[email]');
  });

  it('handles empty result set', async () => {
    const loaders = makeLoaders({
      runReadQuery: async () => ({
        columns: ['id'],
        rows: [],
        totalRows: 0,
      }),
    });

    const out = await runReadQueryTool(
      { sql: 'SELECT id FROM entry WHERE 1=0' },
      loaders,
    );

    expect(out.columns).toEqual(['id']);
    expect(out.rows).toHaveLength(0);
    expect(out.row_count).toBe(0);
    expect(out.truncated).toBe(false);
  });

  it('allows CTE with only SELECT', async () => {
    const loaders = makeLoaders({
      runReadQuery: async () => ({
        columns: ['total'],
        rows: [{ total: 1500 }],
        totalRows: 1,
      }),
    });

    const out = await runReadQueryTool(
      {
        sql: 'WITH totals AS (SELECT SUM(amount) AS total FROM entry_line) SELECT * FROM totals',
      },
      loaders,
    );

    expect(out.row_count).toBe(1);
  });

  it('strips PII from account-number-like values in results', async () => {
    const loaders = makeLoaders({
      runReadQuery: async () => ({
        columns: ['note'],
        // 9876543210 is a 10-digit number that won't match routing (starts with 98)
        rows: [{ note: 'Transfer ref 9876543210 completed' }],
        totalRows: 1,
      }),
    });

    const out = await runReadQueryTool(
      { sql: 'SELECT note FROM entry' },
      loaders,
    );

    const note = out.rows[0]!.note as string;
    expect(note).toContain('[account]');
    expect(note).not.toContain('9876543210');
  });
});
