// T036: PDPA field encryption tests
import { describe, it, expect, vi } from 'vitest';
import { encrypt, decrypt, generateKey, getEncryptionKey } from '@/lib/encryption';

describe('PDPA Encryption', () => {
  const testKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  it('should encrypt and decrypt a string', () => {
    const plaintext = 'นาง สมหญิง ทดสอบ';
    const encrypted = encrypt(plaintext, testKey);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted.length).toBeGreaterThan(0);

    const decrypted = decrypt(encrypted, testKey);
    expect(decrypted).toBe(plaintext);
  });

  it('should produce different ciphertext for same plaintext (random IV)', () => {
    const plaintext = '1234567890123';
    const encrypted1 = encrypt(plaintext, testKey);
    const encrypted2 = encrypt(plaintext, testKey);
    expect(encrypted1).not.toBe(encrypted2);
  });

  it('should handle empty string', () => {
    const encrypted = encrypt('', testKey);
    const decrypted = decrypt(encrypted, testKey);
    expect(decrypted).toBe('');
  });

  it('should handle Thai patient names', () => {
    const name = 'นาง ประยูร สุขสบาย';
    const encrypted = encrypt(name, testKey);
    const decrypted = decrypt(encrypted, testKey);
    expect(decrypted).toBe(name);
  });

  it('should handle CID (13-digit national ID)', () => {
    const cid = '0000000000099';
    const encrypted = encrypt(cid, testKey);
    const decrypted = decrypt(encrypted, testKey);
    expect(decrypted).toBe(cid);
  });

  it('should generate a valid hex key', () => {
    const key = generateKey();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should fail decryption with wrong key', () => {
    const encrypted = encrypt('secret', testKey);
    const wrongKey = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    expect(() => decrypt(encrypted, wrongKey)).toThrow();
  });

  it('getEncryptionKey rejects a 64-char non-hex string', () => {
    vi.stubEnv('ENCRYPTION_KEY', 'z'.repeat(64));
    expect(() => getEncryptionKey()).toThrow(/hex/);
    vi.unstubAllEnvs();
  });
});
