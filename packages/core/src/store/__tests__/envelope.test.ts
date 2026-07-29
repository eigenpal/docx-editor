// Envelope validation tests (document-engine task 5.5): reject malformed,
// truncated, oversized, wrong-protocol, and wrong-document envelopes.

import { describe, expect, test } from 'bun:test';
import { validateEnvelope } from '../store/index.ts';

const good = { protocolVersion: 1, documentId: 'doc-1', bytesHex: 'deadbeef' };
const ctx = { documentId: 'doc-1', protocolVersion: 1 };

describe('validateEnvelope', () => {
  test('accepts a well-formed envelope', () => {
    expect(validateEnvelope(good, ctx)).toEqual({ ok: true });
  });
  test('rejects a wrong protocol version', () => {
    expect(validateEnvelope({ ...good, protocolVersion: 2 }, ctx)).toMatchObject({ ok: false, reason: 'wrong-protocol' });
  });
  test('rejects a wrong document', () => {
    expect(validateEnvelope({ ...good, documentId: 'other' }, ctx)).toMatchObject({ ok: false, reason: 'wrong-document' });
  });
  test('rejects malformed (missing/non-hex bytes)', () => {
    expect(validateEnvelope({ ...good, bytesHex: 'nothex!!' }, ctx)).toMatchObject({ ok: false, reason: 'malformed' });
    expect(validateEnvelope({ protocolVersion: 1, documentId: 'doc-1' }, ctx)).toMatchObject({ ok: false, reason: 'malformed' });
  });
  test('rejects a truncated (odd-length) payload', () => {
    expect(validateEnvelope({ ...good, bytesHex: 'abc' }, ctx)).toMatchObject({ ok: false, reason: 'truncated' });
  });
  test('rejects an oversized payload', () => {
    const big = 'ab'.repeat(100);
    expect(validateEnvelope({ ...good, bytesHex: big }, { ...ctx, limits: { maxBytes: 10 } })).toMatchObject({
      ok: false,
      reason: 'oversized',
    });
  });
});
