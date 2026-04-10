import { AccessUrlError, NetworkError, SetupTokenInvalidError } from './errors.ts';

/**
 * Exchange a one-time SimpleFIN Setup Token for a long-lived Access URL.
 *
 * The Setup Token is a base64-encoded claim URL. We decode it, POST to it,
 * and receive the Access URL as the response body (plain text). The Setup
 * Token is consumed on first use — subsequent attempts return 403.
 */
export async function exchangeSetupToken(token: string): Promise<string> {
  // 1. Base64-decode the token into a URL
  let claimUrl: string;
  try {
    claimUrl = Buffer.from(token, 'base64').toString('utf8');
  } catch (err) {
    throw new SetupTokenInvalidError('Failed to base64-decode setup token', {
      cause: err,
    });
  }

  // Validate the decoded value is an http(s) URL
  let parsed: URL;
  try {
    parsed = new URL(claimUrl);
  } catch (err) {
    throw new SetupTokenInvalidError(
      `Decoded setup token is not a valid URL: ${claimUrl}`,
      { cause: err },
    );
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new SetupTokenInvalidError(
      `Decoded setup token URL has unsupported protocol: ${parsed.protocol}`,
    );
  }

  // 2. POST to the claim URL
  let response: Response;
  try {
    response = await fetch(claimUrl, { method: 'POST' });
  } catch (err) {
    throw new NetworkError(`Failed to POST to claim URL: ${claimUrl}`, {
      cause: err,
    });
  }
  if (!response.ok) {
    throw new SetupTokenInvalidError(
      `Claim URL returned HTTP ${response.status}`,
      { cause: { status: response.status } },
    );
  }

  // 3. The response body is the Access URL as plain text
  const accessUrl = (await response.text()).trim();

  // 4. Validate the Access URL looks like https://user:pass@host/path
  let accessParsed: URL;
  try {
    accessParsed = new URL(accessUrl);
  } catch (err) {
    throw new AccessUrlError(
      `Received Access URL is not a valid URL: ${accessUrl}`,
      { cause: err },
    );
  }
  if (!accessParsed.username || !accessParsed.password) {
    throw new AccessUrlError(
      'Received Access URL is missing userinfo (username:password)',
    );
  }

  return accessUrl;
}
