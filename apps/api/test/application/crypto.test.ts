import { describe, expect, it } from 'vitest';
import { generateEncryptionKey, NodeIdGenerator, NodeTokenService } from '../../src/infrastructure/crypto/nodeTokenService.js';

describe('NodeTokenService', () => {
  const t = new NodeTokenService(generateEncryptionKey());
  it('generates ≥128-bit url-safe tokens', () => {
    const tok = t.generate();
    expect(tok).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(t.generate()).not.toBe(tok);
  });
  it('hashes deterministically', () => {
    expect(t.hash('a')).toBe(t.hash('a'));
    expect(t.hash('a')).toHaveLength(64);
  });
  it('round-trips encryption and rejects tampering', () => {
    const enc = t.encrypt('secret');
    expect(enc).not.toContain('secret');
    expect(t.decrypt(enc)).toBe('secret');
    const parts = enc.split('.');
    parts[2] = Buffer.from('xxxxxx').toString('base64url');
    expect(() => t.decrypt(parts.join('.'))).toThrow();
  });
  it('rejects a wrong key size', () => {
    expect(() => new NodeTokenService(Buffer.alloc(16).toString('base64'))).toThrow();
  });
});

describe('NodeIdGenerator', () => {
  it('room ids are 10 chars', () => {
    expect(new NodeIdGenerator().roomId()).toMatch(/^[A-Za-z0-9]{10}$/);
  });
});
