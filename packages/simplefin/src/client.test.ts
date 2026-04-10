import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthError, NetworkError, RateLimitError } from './errors.ts';
import { fetchAccountSet } from './client.ts';

function loadFixture(name: string): unknown {
  const path = join(import.meta.dirname, 'fixtures', name);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ACCESS_URL = 'https://user:pass@bridge.simplefin.org/simplefin';

describe('fetchAccountSet', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('short window (14 days): single fetch, returns parsed result', async () => {
    const fixture = loadFixture('happy-path.json');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(fixture))),
    );

    const start = new Date('2024-04-01');
    const end = new Date('2024-04-15');
    const result = await fetchAccountSet(ACCESS_URL, {
      startDate: start,
      endDate: end,
    });

    expect(result.accounts).toHaveLength(2);
    expect(result.rateLimited).toBe(false);

    const mockFetch = vi.mocked(fetch);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    // Verify the URL includes the correct query params
    const calledUrl = mockFetch.mock.calls[0]![0] as string;
    expect(calledUrl).toContain('version=2');
    expect(calledUrl).toContain('pending=1');
  });

  it('long window (180 days): splits into chunks and merges', async () => {
    const fixture = loadFixture('happy-path.json');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(fixture))),
    );

    const start = new Date('2024-01-01');
    const end = new Date('2024-06-30'); // ~181 days
    const result = await fetchAccountSet(ACCESS_URL, {
      startDate: start,
      endDate: end,
    });

    const mockFetch = vi.mocked(fetch);
    // 181 days / 90 = 3 chunks (ceil)
    expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2);

    // Transactions from all chunks are merged (same account IDs, so
    // they get concatenated per account)
    expect(result.accounts).toHaveLength(2);
    // Each chunk returns 4 checking txns + 2 CC txns;
    // merged = chunks * per-chunk count
    const checkingTxns = result.accounts[0]!.transactions.length;
    expect(checkingTxns).toBeGreaterThan(4); // more than one chunk's worth
  });

  it('HTTP 401 throws AuthError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 })),
    );

    await expect(
      fetchAccountSet(ACCESS_URL, {
        startDate: new Date('2024-04-01'),
        endDate: new Date('2024-04-15'),
      }),
    ).rejects.toThrow(AuthError);
  });

  it('HTTP 429 throws RateLimitError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Too Many Requests', { status: 429 })),
    );

    await expect(
      fetchAccountSet(ACCESS_URL, {
        startDate: new Date('2024-04-01'),
        endDate: new Date('2024-04-15'),
      }),
    ).rejects.toThrow(RateLimitError);
  });

  it('200 with rate-limit in errlist returns rateLimited: true (not thrown)', async () => {
    const fixture = loadFixture('rate-limit-warning.json');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(fixture))),
    );

    const result = await fetchAccountSet(ACCESS_URL, {
      startDate: new Date('2024-04-01'),
      endDate: new Date('2024-04-15'),
    });

    expect(result.rateLimited).toBe(true);
    // The response is still usable
    expect(result.accounts).toHaveLength(1);
  });

  it('malformed JSON body throws NetworkError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('not json {{{', { status: 200 })),
    );

    await expect(
      fetchAccountSet(ACCESS_URL, {
        startDate: new Date('2024-04-01'),
        endDate: new Date('2024-04-15'),
      }),
    ).rejects.toThrow(NetworkError);
  });
});
