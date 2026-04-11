import { describe, expect, it } from 'vitest';

import { TOOL_REGISTRY, toAnthropicToolDefinitions } from './index.ts';

describe('TOOL_REGISTRY', () => {
  it('exposes the four Phase 3 R2 tools by name', () => {
    expect(Object.keys(TOOL_REGISTRY).sort()).toEqual([
      'compare_periods',
      'get_cashflow',
      'get_net_worth',
      'get_spending_by_category',
    ]);
  });

  it('every entry has a non-empty description, schemas, and handler', () => {
    for (const [name, entry] of Object.entries(TOOL_REGISTRY)) {
      expect(entry.description.length, `${name}.description`).toBeGreaterThan(
        10,
      );
      expect(entry.inputSchema, `${name}.inputSchema`).toBeDefined();
      expect(entry.outputSchema, `${name}.outputSchema`).toBeDefined();
      expect(typeof entry.handler, `${name}.handler`).toBe('function');
    }
  });
});

describe('toAnthropicToolDefinitions', () => {
  it('returns one definition per registry entry', () => {
    const defs = toAnthropicToolDefinitions(TOOL_REGISTRY);
    expect(defs).toHaveLength(4);
  });

  it('produces non-empty input_schema objects', () => {
    const defs = toAnthropicToolDefinitions(TOOL_REGISTRY);
    for (const def of defs) {
      expect(def.name).toMatch(/^[a-z_]+$/);
      expect(def.description.length).toBeGreaterThan(10);
      expect(def.input_schema).toBeTypeOf('object');
      expect(def.input_schema.type).toBe('object');
      expect(Object.keys(def.input_schema)).not.toContain('$schema');
    }
  });

  it('exposes the exact input fields each tool expects', () => {
    const defs = toAnthropicToolDefinitions(TOOL_REGISTRY);
    const byName = new Map(defs.map((d) => [d.name, d]));

    const spending = byName.get('get_spending_by_category');
    expect(spending).toBeDefined();
    const spendingProps = (spending!.input_schema as { properties: object })
      .properties;
    expect(Object.keys(spendingProps).sort()).toEqual([
      'window_end',
      'window_start',
    ]);

    const netWorth = byName.get('get_net_worth');
    const netWorthProps = (netWorth!.input_schema as { properties: object })
      .properties;
    expect(Object.keys(netWorthProps)).toEqual(['as_of']);

    const compare = byName.get('compare_periods');
    const compareProps = (compare!.input_schema as { properties: object })
      .properties;
    expect(Object.keys(compareProps).sort()).toEqual([
      'dimension',
      'window_a_end',
      'window_a_start',
      'window_b_end',
      'window_b_start',
    ]);
  });
});
