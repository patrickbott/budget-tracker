import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { decryptAccessUrl, encryptAccessUrl } from './crypto.ts';

describe('crypto — AES-256-GCM envelope encryption', () => {
  const testKey = randomBytes(32).toString('base64');
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.ENCRYPTION_MASTER_KEY;
    process.env.ENCRYPTION_MASTER_KEY = testKey;
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.ENCRYPTION_MASTER_KEY;
    } else {
      process.env.ENCRYPTION_MASTER_KEY = originalKey;
    }
  });

  it('round-trips a representative Access URL', () => {
    const url = 'https://user:pass@bridge.simplefin.org/simplefin';
    const encrypted = encryptAccessUrl(url);
    expect(encrypted).toMatch(/^v1:/);
    expect(decryptAccessUrl(encrypted)).toBe(url);
  });

  it('produces different ciphertext for the same plaintext (random IVs)', () => {
    const url = 'https://user:pass@bridge.simplefin.org/simplefin';
    const a = encryptAccessUrl(url);
    const b = encryptAccessUrl(url);
    expect(a).not.toBe(b);
    // Both still decrypt to the same value
    expect(decryptAccessUrl(a)).toBe(url);
    expect(decryptAccessUrl(b)).toBe(url);
  });

  it('detects tampered ciphertext via GCM auth tag', () => {
    const url = 'https://user:pass@bridge.simplefin.org/simplefin';
    const encrypted = encryptAccessUrl(url);
    // Flip a character in the ciphertext segment (third part after v1:)
    const parts = encrypted.split(':');
    const ciphertextPart = parts[2]!;
    const flipped =
      ciphertextPart[0] === 'A'
        ? 'B' + ciphertextPart.slice(1)
        : 'A' + ciphertextPart.slice(1);
    parts[2] = flipped;
    const tampered = parts.join(':');
    expect(() => decryptAccessUrl(tampered)).toThrow();
  });

  it('throws on missing ENCRYPTION_MASTER_KEY', () => {
    delete process.env.ENCRYPTION_MASTER_KEY;
    expect(() => encryptAccessUrl('x')).toThrow(/ENCRYPTION_MASTER_KEY/);
    try {
      encryptAccessUrl('x');
    } catch (err) {
      expect((err as import('./errors.ts').BridgeError).code).toBe('missing_encryption_key');
    }
  });

  it('throws on wrong-length key', () => {
    process.env.ENCRYPTION_MASTER_KEY = 'abc';
    expect(() => encryptAccessUrl('x')).toThrow(/ENCRYPTION_MASTER_KEY/);
    try {
      encryptAccessUrl('x');
    } catch (err) {
      expect((err as import('./errors.ts').BridgeError).code).toBe('missing_encryption_key');
    }
  });
});
