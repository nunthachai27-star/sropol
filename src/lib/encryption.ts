// T036: PDPA field encryption — AES-256-GCM with random IV per encryption

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM recommended
const AUTH_TAG_LENGTH = 16;

export function encrypt(plaintext: string, hexKey: string): string {
  const key = Buffer.from(hexKey, 'hex');
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: base64(iv + authTag + ciphertext)
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return combined.toString('base64');
}

export function decrypt(ciphertext: string, hexKey: string): string {
  const key = Buffer.from(hexKey, 'hex');
  const combined = Buffer.from(ciphertext, 'base64');

  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

export function generateKey(): string {
  return randomBytes(32).toString('hex');
}

const HEX_64 = /^[0-9a-fA-F]{64}$/;

// Helper: get key from environment
export function getEncryptionKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is required');
  }
  if (!HEX_64.test(key)) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  return key;
}

/**
 * Best-effort decrypt for fields that *might* be encrypted — patient names
 * that came in through the webhook/sync pipeline are ciphertext, but test
 * fixtures and older rows may still be plaintext. Returns the input
 * unchanged if decryption throws (wrong format, bad key, missing key).
 *
 * Use this at API response boundaries that serve user-facing text. DO NOT
 * use this for security-critical paths where you need to fail hard on
 * tampering.
 */
export function decryptSafe(value: string | null | undefined): string {
  if (!value) return '';
  try {
    const key = getEncryptionKey();
    return decrypt(value, key);
  } catch {
    return value;
  }
}
