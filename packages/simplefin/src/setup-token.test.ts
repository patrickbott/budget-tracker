import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccessUrlError, SetupTokenInvalidError } from './errors.ts';
import { exchangeSetupToken } from './setup-token.ts';

describe('exchangeSetupToken', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('happy path: decodes token, POSTs, returns Access URL', async () => {
    const claimUrl = 'https://claim.example/token';
    const token = Buffer.from(claimUrl).toString('base64');
    const accessUrl = 'https://user:pass@bridge.simplefin.org/simplefin';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(accessUrl, { status: 200 })),
    );

    const result = await exchangeSetupToken(token);
    expect(result).toBe(accessUrl);

    const mockFetch = vi.mocked(fetch);
    expect(mockFetch).toHaveBeenCalledWith(claimUrl, { method: 'POST' });
  });

  it('throws SetupTokenInvalidError on non-base64 gibberish that decodes to non-URL', async () => {
    // This string base64-decodes but the result is not a URL
    const token = Buffer.from('not a url at all').toString('base64');
    await expect(exchangeSetupToken(token)).rejects.toThrow(
      SetupTokenInvalidError,
    );
  });

  it('throws SetupTokenInvalidError when decoded URL has non-http scheme', async () => {
    const token = Buffer.from('ftp://example.com/file').toString('base64');
    await expect(exchangeSetupToken(token)).rejects.toThrow(
      SetupTokenInvalidError,
    );
  });

  it('throws SetupTokenInvalidError on non-2xx response', async () => {
    const claimUrl = 'https://claim.example/token';
    const token = Buffer.from(claimUrl).toString('base64');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Server Error', { status: 500 })),
    );

    await expect(exchangeSetupToken(token)).rejects.toThrow(
      SetupTokenInvalidError,
    );
  });

  it('throws AccessUrlError when response body is garbage, not a URL', async () => {
    const claimUrl = 'https://claim.example/token';
    const token = Buffer.from(claimUrl).toString('base64');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('not-a-url', { status: 200 })),
    );

    await expect(exchangeSetupToken(token)).rejects.toThrow(AccessUrlError);
  });
});
