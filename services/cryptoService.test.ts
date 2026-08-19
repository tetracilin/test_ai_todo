import { describe, expect, it } from 'vitest';
import { hashPassword } from './cryptoService';

describe('hashPassword', () => {
  it('matches the known SHA-256 digest for a fixed input', async () => {
    const hash = await hashPassword('hunter2');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe('f52fbd32b2b3b86ff88ef6c490628285f482af15ddcb29541f94bcf526a3f6c7');
  });

  it('is deterministic for the same input', async () => {
    const [a, b] = await Promise.all([hashPassword('hunter2'), hashPassword('hunter2')]);
    expect(a).toBe(b);
  });

  it('produces different digests for different inputs', async () => {
    const [a, b] = await Promise.all([hashPassword('hunter2'), hashPassword('hunter3')]);
    expect(a).not.toBe(b);
  });
});
