import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { deleteBody, insertBody, openReplica } from './client.ts';
import { GenerationHost } from './host.ts';
import {
  BODY_KEY,
  SUPPORTED_SCHEMA,
  blobDigest,
  canonicalIdentity,
  compareAndSwapActive,
  recoverProcess,
  schemaOf,
  writeSchema,
  type Checkpoint,
} from './schema.ts';

function seededHost(text = 'hello'): GenerationHost {
  return GenerationHost.seed(text);
}

describe('scratch room generation host', () => {
  test('checkpoint metadata records versions, vectors, identity, and blobs', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const digest = blobDigest(bytes);
    const host = GenerationHost.seed('hello', {
      blobs: new Map([[digest, bytes]]),
      requiredBlobs: [digest],
    });
    const alice = host.join('alice');
    expect(alice.ok).toBe(true);
    const checkpoint = host.createCheckpoint();
    expect(alice.ok && host.session('alice')?.connected).toBe(true);
    expect(checkpoint.checkpointId).toBe('ckpt-1');
    expect(checkpoint.roomGenerationId).toBe('g-1');
    expect(checkpoint.schema).toEqual(SUPPORTED_SCHEMA);
    expect(checkpoint.requiredBlobs).toEqual([digest]);
    expect(checkpoint.lastValidCanonicalIdentity).toBe(canonicalIdentity('hello', [digest]));
    expect(checkpoint.state.byteLength).toBeGreaterThan(0);
    expect(checkpoint.stateVector.byteLength).toBeGreaterThan(0);
    const restored = new Y.Doc();
    Y.applyUpdate(restored, checkpoint.state);
    expect(restored.getText(BODY_KEY).toString()).toBe('hello');
    expect([...Y.decodeStateVector(checkpoint.stateVector).keys()].sort()).toEqual(
      [...host.active().doc.store.clients.keys()].sort()
    );
    expect(host.auditFacts().map((fact) => fact.kind)).toEqual(['checkpoint']);
    expect(JSON.stringify(host.auditFacts())).not.toContain('hello');
    host.destroy();
  });

  test('administrator restore creates generation N+1 from a checkpoint', () => {
    const host = seededHost();
    const joined = host.join('alice');
    if (!joined.ok) throw new Error('join failed');
    const alice = openReplica(joined.snapshot);
    const checkpoint = host.createCheckpoint();
    const later = insertBody(alice, 5, ' world');
    expect(host.submit({ sessionId: 'alice', roomGenerationId: 'g-1', update: later }).ok).toBe(
      true
    );
    expect(host.bodyOf()).toBe('hello world');

    const restored = host.restore(checkpoint.checkpointId);
    expect(restored).toEqual({
      ok: true,
      roomGenerationId: 'g-2',
      previousGenerationId: 'g-1',
    });
    expect(host.activeGenerationId()).toBe('g-2');
    expect(host.bodyOf('g-2')).toBe('hello');
    expect(host.bodyOf('g-1')).toBe('hello world');
    expect(host.generation('g-1')?.doc).not.toBe(host.generation('g-2')?.doc);
    expect(host.session('alice')?.connected).toBe(false);
    expect(host.session('alice')?.disconnectReason).toBe('stale-generation');
    expect(host.auditFacts().map((fact) => fact.kind)).toEqual(['checkpoint', 'restore']);

    const undo = new Y.UndoManager(host.active().doc.getText(BODY_KEY));
    expect(undo.undoStack).toHaveLength(0);
    undo.destroy();
    alice.destroy();
    host.destroy();
  });

  test('process recovery reloads the same generation from checkpoint plus later updates', () => {
    const host = seededHost();
    const joined = host.join('alice');
    if (!joined.ok) throw new Error('join failed');
    const alice = openReplica(joined.snapshot);
    const checkpoint = host.createCheckpoint();
    const later = insertBody(alice, 5, ' world');
    host.submit({ sessionId: 'alice', roomGenerationId: 'g-1', update: later });

    const recovered = recoverProcess(checkpoint, [later]);
    expect(recovered.roomGenerationId).toBe('g-1');
    expect(recovered.text).toBe('hello world');
    expect(host.activeGenerationId()).toBe('g-1');
    recovered.doc.destroy();
    alice.destroy();
    host.destroy();
  });

  test('destructive reset validates a new snapshot, retains the old generation, and audits', () => {
    const host = seededHost('original');
    host.join('alice');
    const reset = host.reset({ text: 'imported-docx' });
    expect(reset).toEqual({
      ok: true,
      roomGenerationId: 'g-2',
      previousGenerationId: 'g-1',
    });
    expect(host.bodyOf('g-2')).toBe('imported-docx');
    expect(host.bodyOf('g-1')).toBe('original');
    expect(host.session('alice')?.connected).toBe(false);
    expect(host.auditFacts().map((fact) => fact.kind)).toEqual(['destructive-reset']);
    expect(JSON.stringify(host.auditFacts())).not.toContain('imported-docx');
    host.destroy();
  });

  test('failed candidate validation leaves the active generation unchanged', () => {
    const host = seededHost();
    const before = host.active().doc;
    const missingBlob = host.restoreFrom({
      checkpointId: 'tainted',
      roomGenerationId: 'g-1',
      schema: SUPPORTED_SCHEMA,
      state: Y.encodeStateAsUpdate(host.active().doc),
      stateVector: Y.encodeStateVector(host.active().doc),
      lastValidCanonicalIdentity: host.active().lastValidCanonicalIdentity,
      requiredBlobs: ['blob-missing'],
    });
    expect(missingBlob).toEqual({ ok: false, code: 'missing-blob' });
    expect(host.activeGenerationId()).toBe('g-1');
    expect(host.active().doc).toBe(before);
    expect(host.generation('g-2')).toBeUndefined();

    const unsupported = host.reset({
      text: 'next',
      schema: { ...SUPPORTED_SCHEMA, protocolVersion: 99 },
    });
    expect(unsupported).toEqual({ ok: false, code: 'unsupported-version' });
    expect(host.activeGenerationId()).toBe('g-1');
    expect(host.bodyOf()).toBe('hello');

    const invalid = new Y.Doc();
    invalid.getText(BODY_KEY).insert(0, 'broken');
    writeSchema(schemaOf(invalid).meta, SUPPORTED_SCHEMA);
    const uninitialized: Checkpoint = {
      checkpointId: 'no-init',
      roomGenerationId: 'g-1',
      schema: SUPPORTED_SCHEMA,
      state: Y.encodeStateAsUpdate(invalid),
      stateVector: Y.encodeStateVector(invalid),
      lastValidCanonicalIdentity: 'canon:broken:',
      requiredBlobs: [],
    };
    expect(host.restoreFrom(uninitialized)).toEqual({ ok: false, code: 'invalid-snapshot' });
    expect(host.activeGenerationId()).toBe('g-1');

    const mismatched = new Y.Doc();
    mismatched.getText(BODY_KEY).insert(0, 'x');
    writeSchema(schemaOf(mismatched).meta, {
      ...SUPPORTED_SCHEMA,
      protocolVersion: 99,
    });
    schemaOf(mismatched).meta.set('initialized', true);
    expect(
      host.restoreFrom({
        checkpointId: 'meta-mismatch',
        roomGenerationId: 'g-1',
        schema: SUPPORTED_SCHEMA,
        state: Y.encodeStateAsUpdate(mismatched),
        stateVector: Y.encodeStateVector(mismatched),
        lastValidCanonicalIdentity: canonicalIdentity('x', []),
        requiredBlobs: [],
      })
    ).toEqual({ ok: false, code: 'invalid-schema' });

    expect(
      host.restoreFrom({
        checkpointId: 'no-identity',
        roomGenerationId: 'g-1',
        schema: SUPPORTED_SCHEMA,
        state: Y.encodeStateAsUpdate(host.active().doc),
        stateVector: Y.encodeStateVector(host.active().doc),
        lastValidCanonicalIdentity: '',
        requiredBlobs: [],
      })
    ).toEqual({ ok: false, code: 'empty-canonical-identity' });
    expect(host.activeGenerationId()).toBe('g-1');
    expect(host.auditFacts().every((fact) => fact.kind === 'discard-candidate')).toBe(true);
    invalid.destroy();
    mismatched.destroy();
    host.destroy();
  });

  test('old-generation updates are rejected and stale sessions must rejoin', () => {
    const host = seededHost();
    const joined = host.join('alice');
    if (!joined.ok) throw new Error('join failed');
    const alice = openReplica(joined.snapshot);
    const mismatched = insertBody(alice, 5, '!');
    expect(
      host.submit({
        sessionId: 'alice',
        roomGenerationId: 'g-99',
        update: mismatched,
      })
    ).toEqual({ ok: false, code: 'stale-generation' });
    expect(host.bodyOf()).toBe('hello');
    expect(host.session('alice')?.connected).toBe(false);
    expect(host.session('alice')?.disconnectReason).toBe('stale-generation');

    const rejoinG1 = host.join('alice');
    if (!rejoinG1.ok) throw new Error('rejoin failed');
    const aliceG1 = openReplica(rejoinG1.snapshot);
    host.reset({ text: 'reset-body' });
    expect(host.session('alice')?.connected).toBe(false);

    const afterReset = insertBody(aliceG1, 5, '!');
    expect(
      host.submit({
        sessionId: 'alice',
        roomGenerationId: 'g-1',
        update: afterReset,
      })
    ).toEqual({ ok: false, code: 'disconnected' });
    expect(host.bodyOf()).toBe('reset-body');

    const spoofed = host.submit({
      sessionId: 'alice',
      roomGenerationId: 'g-2',
      update: afterReset,
    });
    expect(spoofed).toEqual({ ok: false, code: 'disconnected' });

    const rejoin = host.join('alice');
    if (!rejoin.ok) throw new Error('rejoin failed');
    expect(rejoin.roomGenerationId).toBe('g-2');
    const fresh = openReplica(rejoin.snapshot);
    const accepted = insertBody(fresh, 10, '!');
    expect(host.submit({ sessionId: 'alice', roomGenerationId: 'g-2', update: accepted }).ok).toBe(
      true
    );
    expect(host.bodyOf()).toBe('reset-body!');
    alice.destroy();
    aliceG1.destroy();
    fresh.destroy();
    host.destroy();
  });

  test('rollback switches the active generation pointer and keeps both docs', () => {
    const host = seededHost();
    const joined = host.join('alice');
    if (!joined.ok) throw new Error('join failed');
    const alice = openReplica(joined.snapshot);
    const checkpoint = host.createCheckpoint();
    const later = insertBody(alice, 5, ' world');
    host.submit({ sessionId: 'alice', roomGenerationId: 'g-1', update: later });
    expect(host.bodyOf()).toBe('hello world');
    expect(host.restore(checkpoint.checkpointId).ok).toBe(true);
    expect(host.bodyOf()).toBe('hello');

    const rolled = host.rollback('g-1');
    expect(rolled).toEqual({
      ok: true,
      roomGenerationId: 'g-1',
      previousGenerationId: 'g-2',
    });
    expect(host.activeGenerationId()).toBe('g-1');
    expect(host.bodyOf('g-1')).toBe('hello world');
    expect(host.bodyOf('g-2')).toBe('hello');
    expect(host.generation('g-1')?.doc).not.toBe(host.generation('g-2')?.doc);
    expect(host.session('alice')?.connected).toBe(false);

    const back = host.join('bob');
    if (!back.ok) throw new Error('join failed');
    expect(back.roomGenerationId).toBe('g-1');
    expect(host.auditFacts().map((fact) => fact.kind)).toEqual([
      'checkpoint',
      'restore',
      'rollback',
    ]);
    alice.destroy();
    host.destroy();
  });

  test('maintenance lock rejects writers and restore while locked leaves the room unchanged', () => {
    const host = seededHost();
    const joined = host.join('alice');
    if (!joined.ok) throw new Error('join failed');
    const alice = openReplica(joined.snapshot);
    expect(host.beginMaintenance().ok).toBe(true);
    expect(host.isWritersLocked()).toBe(true);
    const lockedWrite = insertBody(alice, 5, '!');
    expect(
      host.submit({ sessionId: 'alice', roomGenerationId: 'g-1', update: lockedWrite })
    ).toEqual({ ok: false, code: 'writers-locked' });
    expect(
      host.restoreFrom({
        checkpointId: 'ignored',
        roomGenerationId: 'g-1',
        schema: SUPPORTED_SCHEMA,
        state: Y.encodeStateAsUpdate(host.active().doc),
        stateVector: Y.encodeStateVector(host.active().doc),
        lastValidCanonicalIdentity: host.active().lastValidCanonicalIdentity,
        requiredBlobs: [],
      })
    ).toEqual({ ok: false, code: 'writers-locked' });
    expect(host.session('alice')?.connected).toBe(true);
    host.endMaintenance();
    expect(host.reset({ text: 'after-lock' }).ok).toBe(true);
    expect(host.activeGenerationId()).toBe('g-2');
    alice.destroy();
    host.destroy();
  });

  test('compare-and-swap refuses a stale expected generation', () => {
    expect(compareAndSwapActive('g-1', 'g-1', 'g-2')).toEqual({ ok: true, active: 'g-2' });
    expect(compareAndSwapActive('g-2', 'g-1', 'g-3')).toEqual({
      ok: false,
      active: 'g-2',
      code: 'cas-mismatch',
    });
    expect(compareAndSwapActive(null, 'g-1', 'g-2')).toEqual({
      ok: false,
      active: null,
      code: 'cas-mismatch',
    });
  });

  test('migration retains the old generation and a missing blob blocks restore', () => {
    const bytes = new Uint8Array([9, 9, 9]);
    const digest = blobDigest(bytes);
    const host = GenerationHost.seed('hello', {
      blobs: new Map([[digest, bytes]]),
      requiredBlobs: [digest],
    });
    const checkpoint = host.createCheckpoint();
    host.dropBlob(digest);
    expect(host.restore(checkpoint.checkpointId)).toEqual({ ok: false, code: 'missing-blob' });
    expect(host.activeGenerationId()).toBe('g-1');
    host.retainBlob(digest, bytes);
    const migrated = host.migrate(SUPPORTED_SCHEMA);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) throw new Error('migrate failed');
    expect(migrated.previousGenerationId).toBe('g-1');
    expect(host.activeGenerationId()).toBe(migrated.roomGenerationId);
    expect(host.bodyOf()).toBe('hello');
    expect(host.bodyOf('g-1')).toBe('hello');
    host.destroy();
  });

  test('in-place checkpoint apply cannot implement restore, so generation switch is required', () => {
    const host = seededHost();
    const joined = host.join('alice');
    if (!joined.ok) throw new Error('join failed');
    const alice = openReplica(joined.snapshot);
    const checkpoint = host.createCheckpoint();
    const later = insertBody(alice, 5, ' world');
    host.submit({ sessionId: 'alice', roomGenerationId: 'g-1', update: later });
    const deleted = deleteBody(alice, 0, 5);
    host.submit({ sessionId: 'alice', roomGenerationId: 'g-1', update: deleted });
    expect(host.bodyOf()).toBe(' world');

    Y.applyUpdate(host.active().doc, checkpoint.state, 'naive-restore');
    expect(host.bodyOf()).toBe(' world');

    expect(host.restore(checkpoint.checkpointId).ok).toBe(true);
    expect(host.bodyOf()).toBe('hello');
    alice.destroy();
    host.destroy();
  });
});
