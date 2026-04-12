import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAnthropicClient } from './client.ts';

describe('createAnthropicClient', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('constructs a client when ANTHROPIC_API_KEY is set', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test-key');
    const client = createAnthropicClient();
    expect(client).toBeDefined();
  });

  it('throws a descriptive error when the API key is missing', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    expect(() => createAnthropicClient()).toThrow(/ANTHROPIC_API_KEY/);
  });
});
