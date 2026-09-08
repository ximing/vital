import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '../../src/llm/crypto.js';

describe('llm crypto', () => {
  it('round-trips a secret and rejects tampering', () => {
    const stored = encryptSecret('sk-test-key');
    expect(stored.startsWith('v1:')).toBe(true);
    expect(stored.includes('sk-test-key')).toBe(false);
    expect(decryptSecret(stored)).toBe('sk-test-key');
    expect(decryptSecret('v1:not-valid')).toBeNull();
    expect(decryptSecret('plain')).toBeNull();
    const flipped = `${stored.slice(0, -2)}aa`;
    expect(decryptSecret(flipped)).toBeNull();
  });
});
