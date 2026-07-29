// Versioned anchor envelope tests (document-engine task 4.10): serialize/restore,
// and typed invalid-anchor failures for wrong document, version, backend, future
// schema, staleness, and malformed input.

import { describe, expect, test } from 'bun:test';
import { serializeAnchorEnvelope, restoreAnchorEnvelope, type AnchorContext } from '../store/index.ts';

const env = serializeAnchorEnvelope({
  documentId: 'doc-1',
  backendKind: 'yjs',
  schemaVersion: 1,
  checkpoint: 5,
  affinity: 'after',
  bytesHex: 'deadbeef',
});

const ctx = (over: Partial<AnchorContext> = {}): AnchorContext => ({
  documentId: 'doc-1',
  backendKind: 'yjs',
  schemaVersion: 1,
  currentCheckpoint: 7,
  ...over,
});

describe('restore', () => {
  test('valid envelope restores opaque bytes + affinity', () => {
    expect(restoreAnchorEnvelope(env, ctx())).toEqual({ ok: true, bytesHex: 'deadbeef', affinity: 'after' });
  });
});

describe('invalid-anchor failures (never resolves to a guessed location)', () => {
  test('an envelope from another document', () => {
    expect(restoreAnchorEnvelope(env, ctx({ documentId: 'other' }))).toMatchObject({ ok: false, reason: 'wrong-document' });
  });
  test('a different backend kind', () => {
    expect(restoreAnchorEnvelope(env, ctx({ backendKind: 'local' }))).toMatchObject({ ok: false, reason: 'backend-mismatch' });
  });
  test('a future anchor schema is unmigratable', () => {
    const future = serializeAnchorEnvelope({ ...env, schemaVersion: 2 });
    expect(restoreAnchorEnvelope(future, ctx())).toMatchObject({ ok: false, reason: 'schema-unmigratable' });
  });
  test('a checkpoint newer than current is stale/invalid', () => {
    expect(restoreAnchorEnvelope(env, ctx({ currentCheckpoint: 3 }))).toMatchObject({ ok: false, reason: 'stale-checkpoint' });
  });
  test('a checkpoint outside the retention window is stale', () => {
    expect(restoreAnchorEnvelope(env, ctx({ currentCheckpoint: 100, checkpointWindow: 10 }))).toMatchObject({
      ok: false,
      reason: 'stale-checkpoint',
    });
  });
  test('a wrong version', () => {
    expect(restoreAnchorEnvelope({ ...env, version: 999 }, ctx())).toMatchObject({ ok: false, reason: 'version-mismatch' });
  });
  test('a malformed envelope', () => {
    expect(restoreAnchorEnvelope({ nope: true }, ctx())).toMatchObject({ ok: false, reason: 'malformed' });
    expect(restoreAnchorEnvelope(null, ctx())).toMatchObject({ ok: false, reason: 'malformed' });
  });
});
