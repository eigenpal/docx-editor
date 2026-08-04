import { describe, test, expect } from 'bun:test';
import { verifySubresourceIntegrity } from '../../../scripts/lib/integrity.mjs';

describe('verifySubresourceIntegrity', () => {
  test('accepts a buffer matching its recorded sha512 integrity string', () => {
    const buffer = Buffer.from('hello world');
    // Precomputed: sha512 of "hello world", base64-encoded.
    const integrity =
      'sha512-MJ7MSJwS1utMxA9QyQLytNDtd+5RGnx6m808qG1M2G+YndNbxf9JlnDaNCVbRbDP2DDoH2Bdz33FVC6TrpzXbw==';
    expect(verifySubresourceIntegrity(buffer, integrity)).toBe(true);
  });

  test('rejects a buffer that does not match', () => {
    const buffer = Buffer.from('tampered content');
    const integrity =
      'sha512-MJ7MSJwS1utMxA9QyQLytNDtd+5RGnx6m808qG1M2G+YndNbxf9JlnDaNCVbRbDP2DDoH2Bdz33FVC6TrpzXbw==';
    expect(verifySubresourceIntegrity(buffer, integrity)).toBe(false);
  });

  test('rejects an unsupported algorithm rather than silently skipping verification', () => {
    const buffer = Buffer.from('hello world');
    expect(() => verifySubresourceIntegrity(buffer, 'md5-deadbeef')).toThrow(/unsupported/i);
  });

  test('rejects a malformed integrity string', () => {
    const buffer = Buffer.from('hello world');
    expect(() => verifySubresourceIntegrity(buffer, 'not-an-integrity-string')).toThrow();
  });
});
