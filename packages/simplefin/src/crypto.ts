import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { BridgeError } from './errors.ts';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;
const VERSION_PREFIX = 'v1:';

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_MASTER_KEY;
  if (!raw) {
    throw new BridgeError(
      'missing_encryption_key',
      'ENCRYPTION_MASTER_KEY environment variable is not set',
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new BridgeError(
      'missing_encryption_key',
      `ENCRYPTION_MASTER_KEY must be exactly ${KEY_BYTES} bytes (got ${key.length})`,
    );
  }
  return key;
}

function toBase64Url(buf: Buffer): string {
  return buf.toString('base64url');
}

function fromBase64Url(str: string): Buffer {
  return Buffer.from(str, 'base64url');
}

/**
 * Encrypt a plaintext Access URL into the envelope format:
 * `v1:<base64url(iv)>:<base64url(ciphertext)>:<base64url(authtag)>`
 */
export function encryptAccessUrl(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${VERSION_PREFIX}${toBase64Url(iv)}:${toBase64Url(encrypted)}:${toBase64Url(authTag)}`;
}

/**
 * Decrypt an envelope-format ciphertext back to the plaintext Access URL.
 * Throws on tampered ciphertext (GCM auth tag verification).
 */
export function decryptAccessUrl(ciphertext: string): string {
  const key = getKey();
  if (!ciphertext.startsWith(VERSION_PREFIX)) {
    throw new BridgeError(
      'decrypt_failed',
      'Ciphertext does not start with expected version prefix',
    );
  }
  const parts = ciphertext.slice(VERSION_PREFIX.length).split(':');
  if (parts.length !== 3) {
    throw new BridgeError(
      'decrypt_failed',
      'Ciphertext has wrong number of segments',
    );
  }
  const [ivB64, encB64, tagB64] = parts as [string, string, string];
  const iv = fromBase64Url(ivB64);
  const encrypted = fromBase64Url(encB64);
  const authTag = fromBase64Url(tagB64);

  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}
