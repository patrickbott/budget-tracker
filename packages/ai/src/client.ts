/**
 * Thin wrapper around the Anthropic SDK. The full tool-use loop lands
 * in R3 when the adapters are wired to real DB loaders in `apps/web`;
 * this file just handles the one thing every future caller needs
 * first — a configured `Anthropic` client with an explicit failure
 * mode when the API key is missing, so callers don't hit cryptic
 * "invalid api key" errors from the SDK itself.
 */

import Anthropic from '@anthropic-ai/sdk';

export function createAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Add it to the environment before calling createAnthropicClient().',
    );
  }
  return new Anthropic({ apiKey });
}
