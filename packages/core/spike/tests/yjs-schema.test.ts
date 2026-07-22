import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadBindingOracle, loadYjsSchemaOracle } from '../src';

describe('yjs-schema.v1 oracle', () => {
  test('approved root/meta keys contain no stale inverse-history container', () => {
    const rootKeys = Object.keys(schema.root.keys);
    const metaFields = Object.keys(schema.root.keys.meta.fields);
    expect(rootKeys).toEqual([
      'meta',
      'storyOrder',
      'stories',
      'blocks',
      'texts',
      'marks',
      'capsules',
      'allocator',
    ]);
    expect(metaFields).toEqual([
      'schemaVersion',
      'backendVersion',
      'documentId',
      'normalizationVersion',
      'collisionCandidates',
      'tombstones',
      'splitTailEditJournal',
    ]);
    for (const path of [
      '../src/store/yjs/doc-access.ts',
      '../src/store/yjs/doc-bootstrap.ts',
      '../src/store/yjs/doc-types.ts',
      '../src/store/yjs/snapshot.ts',
      '../src/comparators/yjs-schema-fingerprint.ts',
      '../src/store/backend/yjs-backend.ts',
    ]) {
      expect(readFileSync(join(import.meta.dir, path), 'utf8')).not.toContain('historyEffects');
    }
  });
  const schema = loadYjsSchemaOracle();

  test('GC is disabled for inspectable tombstones', () => {
    expect(schema.gcEnabled).toBe(false);
  });

  test('root contains required versioned keys', () => {
    expect(Object.keys(schema.root.keys).sort()).toEqual(
      ['allocator', 'blocks', 'capsules', 'marks', 'meta', 'stories', 'storyOrder', 'texts'].sort()
    );
  });

  test('marks use half-open endpoints with affinity', () => {
    expect(schema.markEndpoints.convention).toBe('half-open');
    expect(schema.markEndpoints.startInclusive).toBe(true);
    expect(schema.markEndpoints.endExclusive).toBe(true);
    expect(schema.markEndpoints.offsetUnit).toBe('Yjs-relative-position');
    expect(schema.markEndpoints.defaultStartAffinity).toBe('before');
    expect(schema.markEndpoints.defaultEndAffinity).toBe('after');
    expect(schema.root.keys.marks.record.fields.start.type).toBe('RelativeEndpointEnvelope');
    expect(schema.root.keys.marks.record.fields.end.type).toBe('RelativeEndpointEnvelope');
  });

  test('texts are metadata Y.Map records containing a Y.Text child', () => {
    expect(schema.root.keys.texts.record.containerType).toBe('Y.Map');
    expect(schema.root.keys.texts.record.fields.content.type).toBe('Y.Text');
  });

  test('ownership rule excludes only root body story parent', () => {
    expect(schema.ownershipAndOrder.parentReferenceRule).toContain('body story is root-owned');
    expect(schema.root.keys.stories.record.fields.parentId.required).toBe(false);
    expect(schema.root.keys.blocks.record.fields.parentId.required).toBe(true);
  });

  test('collision precedence includes deterministic creation tie-breakers', () => {
    expect(schema.collisionPrecedence.order).toEqual([
      'ActorId-UTF16-code-unit-ascending',
      'CommitId-UTF16-code-unit-ascending',
      'CreationId-localSeq-numeric-ascending',
      'CreationId-UTF16-code-unit-ascending',
    ]);
  });

  test('anchor envelope is opaque and trusted-field bound', () => {
    expect(schema.anchorEnvelope.version).toBe('anchor-envelope/1');
    expect(schema.anchorEnvelope.trustedFields).toContain('documentId');
    expect(schema.anchorEnvelope.trustedFields).toContain('relativeBytes');
    expect(schema.anchorEnvelope.encoding).toBe('opaque-base64url');
  });

  test('creation IDs follow actor commit local format', () => {
    expect(schema.creationIdFormat).toBe('{actorId}:{commitSeq}:{localSeq}');
  });
});

describe('binding-oracle.v1', () => {
  const binding = loadBindingOracle();

  test('normalization precedence is frozen and ordered', () => {
    expect(binding.normalizationPrecedence[0]).toBe('repair-orphaned-mark-endpoints');
    expect(binding.normalizationPrecedence.at(-1)).toBe('remove-zero-length-marks');
    expect(binding.normalizationPrecedence).toHaveLength(6);
  });

  test('IME fixtures declare exact expected strings', () => {
    const fixture = binding.ime.fixtures.find((f) => f.id === 'ime-remote-insert-during-compose');
    expect(fixture?.commitExpectedText).toBe('!helloni');
    expect(fixture?.cancelExpectedText).toBe('!hello');
    expect(fixture?.historyGroupCount).toBe(1);
    const replacement = binding.ime.fixtures.find(
      (f) => f.id === 'ime-remote-delete-intersecting-compose'
    );
    expect(binding.offsetUnit).toBe('UTF-16-code-unit');
    expect(binding.ime.compositionInputSequenceSemantics).toBe(
      'ordered-compositionupdate-full-text-values-not-deltas'
    );
    expect(fixture?.compositionInputSequence).toEqual(['n', 'ni']);
    expect(replacement?.commitExpectedText).toBe('aXef');
  });

  test('selection grapheme boundaries include emoji cluster', () => {
    const fixture = binding.selection.graphemeFixtures.find(
      (f) => f.id === 'emoji-cluster-boundaries'
    );
    expect(fixture?.graphemeClusters).toEqual(['a', '🇺🇸', 'b']);
    expect(fixture?.validBoundaries).toEqual([0, 1, 5, 6]);
  });

  test('grouped undo histories are actor-local with redo snapshot expectations', () => {
    const history = binding.undoRedo.groupedHistories.find(
      (item) => item.id === 'split-then-remote-interleave'
    );
    expect(history?.id).toBe('split-then-remote-interleave');
    expect(history?.snapshotAfterRedo?.redoEligibleForAlice).toBe(false);
    expect(history?.snapshotAfterUndo?.redoEligibleForAlice).toBe(true);
  });

  test('histories cover grouping, invalidation, failures, normalization ownership', () => {
    const ids = binding.undoRedo.groupedHistories.map((history) => history.id);
    expect(ids).toEqual([
      'split-then-remote-interleave',
      'solo-and-collaborative-grouping-equivalence',
      'redo-invalidation-by-new-local-edit',
      'failed-and-normalized-operations',
    ]);
    const normalized = binding.undoRedo.groupedHistories.find(
      (history) => history.id === 'failed-and-normalized-operations'
    );
    expect(normalized?.normalizedOperation?.normalizationOwner).toBe('commit-alice-normalized-1');
  });

  test('snapshot includes normalization, constituent coverage, safe audit cursor', () => {
    expect(binding.snapshots.durableFields).toContain('normalizationVersion');
    expect(binding.snapshots.durableFields).toContain('appliedConstituentIds');
    expect(binding.snapshots.durableFields).toContain('safeAuditCursor');
    expect(binding.snapshots.reopenExpectations.safeAuditCursor.containsRawText).toBe(false);
  });
});
