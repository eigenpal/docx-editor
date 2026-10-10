/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { WML_NAMESPACE_URI } from '@docx-editor.dev/core/store';
import {
  collectKind,
  moveFixture,
  nodeText,
  runWithText,
  twoParagraphFixture,
} from './fixtures.ts';
import { insertText, joinParagraphs, moveRun } from './ops.ts';
import { isElementRecord, isTextRecord, type TextRecord } from './contract.ts';
import { assertRegistryHasNoParentFields } from './registry-backend.ts';
import { concurrent, createPair, destroyPair, syncBoth, syncOne } from './replicas.ts';

const W = WML_NAMESPACE_URI;

function insertRun(
  replica: { backend: import('./contract.ts').RepresentationBackend; mint: { take: () => string } },
  parentId: string,
  index: number,
  text: string
): string {
  const runId = replica.mint.take();
  const textElId = replica.mint.take();
  const textId = replica.mint.take();
  replica.backend.createElement({
    logicalId: runId,
    kind: 'run',
    namespaceUri: W,
    localName: 'r',
    prefix: 'w',
    attributes: [],
    bindings: [],
  });
  replica.backend.createElement({
    logicalId: textElId,
    kind: 'text',
    namespaceUri: W,
    localName: 't',
    prefix: 'w',
    attributes: [],
    bindings: [],
  });
  replica.backend.createText(textId, text);
  replica.backend.spliceChildren(textElId, 0, 0, [textId]);
  replica.backend.spliceChildren(runId, 0, 0, [textElId]);
  replica.backend.spliceChildren(parentId, index, 0, [runId]);
  return runId;
}

describe('representation registry child-array authority', () => {
  test('records never store a parent field', () => {
    const pair = createPair('registry', twoParagraphFixture());
    try {
      assertRegistryHasNoParentFields(pair.left.backend as never);
      pair.left.backend.moveNode(
        runWithText(pair.left.materializer.current(), 'Alpha').id,
        collectKind(pair.left.materializer.current(), 'paragraph')[1]!.id,
        0
      );
      pair.left.materializer.rebuild();
      assertRegistryHasNoParentFields(pair.left.backend as never);
      pair.left.doc.getMap('spike-registry-nodes').forEach((value) => {
        if (value instanceof Y.Map) {
          expect(value.has('parent')).toBe(false);
          expect(value.has('parentId')).toBe(false);
        }
      });
    } finally {
      destroyPair(pair);
    }
  });

  test('two concurrent reparents keep one identity and emit duplicate-parent', () => {
    const pair = createPair('registry', moveFixture());
    try {
      const movedId = runWithText(pair.left.materializer.current(), 'MoveMe').id;
      concurrent(
        pair,
        (replica) => moveRun(replica, pair.left.materializer.current(), 'MoveMe', 'Dest', 1),
        (replica) => moveRun(replica, pair.right.materializer.current(), 'MoveMe', 'Keep', 0)
      );
      const left = pair.left.materializer.current();
      const matches = collectKind(left, 'run').filter((run) => run.id === movedId);
      expect(matches).toHaveLength(1);
      expect(pair.left.materializer.spikeIssues).toContain('duplicate-parent');
      expect(nodeText(matches[0]!)).toBe('MoveMe');
      const parent = collectKind(left, 'paragraph').find((paragraph) =>
        paragraph.children.some((child) => child.id === movedId)
      );
      expect(parent).toBeDefined();
      expect(nodeText(parent!)).toContain('Keep');
    } finally {
      destroyPair(pair);
    }
  });

  test('join uses replacedBy and keeps concurrent descendant text', () => {
    const pair = createPair('registry', twoParagraphFixture());
    try {
      const alphaId = collectKind(pair.left.materializer.current(), 'paragraph')[0]!.id;
      const bravoId = collectKind(pair.left.materializer.current(), 'paragraph')[1]!.id;
      concurrent(
        pair,
        (replica) => joinParagraphs(replica, pair.left.materializer.current(), 'Alpha', 'Bravo'),
        (replica) => insertText(replica, pair.right.materializer.current(), 'Bravo', 5, '!')
      );
      const left = pair.left.materializer.current();
      const paragraphs = collectKind(left, 'paragraph');
      expect(paragraphs).toHaveLength(1);
      expect(paragraphs[0]!.id).toBe(alphaId);
      expect(nodeText(paragraphs[0]!)).toContain('Bravo!');
      expect(pair.left.backend.isTombstoned(bravoId)).toBe(true);
      expect(pair.left.backend.replacedByOf(bravoId)).toBe(alphaId);
      expect(pair.left.doc.getMap('spike-registry-nodes').has(bravoId)).toBe(true);
    } finally {
      destroyPair(pair);
    }
  });

  test('join plus concurrent child insert adopts leftover children', () => {
    const pair = createPair('registry', twoParagraphFixture());
    try {
      const bravoId = collectKind(pair.left.materializer.current(), 'paragraph')[1]!.id;
      concurrent(
        pair,
        (replica) => joinParagraphs(replica, pair.left.materializer.current(), 'Alpha', 'Bravo'),
        (replica) => {
          const record = replica.backend.record(bravoId);
          if (!record || !isElementRecord(record)) throw new Error('bravo missing');
          insertRun(replica, bravoId, record.childIds.length, 'extra');
        }
      );
      const left = pair.left.materializer.current();
      expect(collectKind(left, 'paragraph')).toHaveLength(1);
      expect(nodeText(left.root)).toContain('Alpha');
      expect(nodeText(left.root)).toContain('Bravo');
      expect(nodeText(left.root)).toContain('extra');
      expect(
        pair.left.backend.adoptedChildren(collectKind(left, 'paragraph')[0]!.id).length
      ).toBeGreaterThan(0);
    } finally {
      destroyPair(pair);
    }
  });

  test('tombstone delete keeps the descendant record', () => {
    const pair = createPair('registry', twoParagraphFixture());
    try {
      const bravo = collectKind(pair.left.materializer.current(), 'paragraph')[1]!;
      concurrent(
        pair,
        (replica) => replica.backend.tombstone(bravo.id),
        (replica) => insertText(replica, pair.right.materializer.current(), 'Bravo', 5, '-keep')
      );
      const left = pair.left.materializer.current();
      expect(collectKind(left, 'paragraph').map(nodeText)).toEqual(['Alpha']);
      expect(pair.left.materializer.spikeIssues).toContain('orphan-with-content');
      expect(pair.left.backend.isTombstoned(bravo.id)).toBe(true);
      const kept = pair.left.backend
        .allLogicalIds()
        .map((id) => pair.left.backend.record(id))
        .find(
          (record): record is TextRecord =>
            record !== null && isTextRecord(record) && record.value.includes('Bravo')
        );
      expect(kept?.value ?? '').toBe('Bravo-keep');
    } finally {
      destroyPair(pair);
    }
  });

  test('actor undo of a move keeps remote descendant text', () => {
    const pair = createPair('registry', moveFixture());
    try {
      const movedId = runWithText(pair.left.materializer.current(), 'MoveMe').id;
      pair.left.backend.moveNode(
        movedId,
        collectKind(pair.left.materializer.current(), 'paragraph').find((node) =>
          nodeText(node).includes('Dest')
        )!.id,
        1
      );
      pair.left.materializer.rebuild();
      insertText(pair.right, pair.right.materializer.current(), 'MoveMe', 6, '!');
      syncBoth(pair.left, pair.right);
      expect(pair.left.undo.undoStack.length).toBeGreaterThan(0);
      pair.left.undo.undo();
      pair.left.materializer.rebuild();
      syncBoth(pair.left, pair.right);
      const left = pair.left.materializer.current();
      const run = collectKind(left, 'run').find((node) => node.id === movedId);
      expect(run).toBeDefined();
      expect(nodeText(run!)).toBe('MoveMe!');
      expect(nodeText(collectKind(left, 'paragraph')[0]!)).toContain('MoveMe!');
    } finally {
      destroyPair(pair);
    }
  });

  test('remote edits are not in the local undo stack', () => {
    const pair = createPair('registry', twoParagraphFixture());
    try {
      const before = pair.left.undo.undoStack.length;
      insertText(pair.right, pair.right.materializer.current(), 'Alpha', 0, 'z');
      syncOne(pair.right, pair.left);
      expect(pair.left.undo.undoStack.length).toBe(before);
      expect(nodeText(collectKind(pair.left.materializer.current(), 'paragraph')[0]!)).toBe(
        'zAlpha'
      );
      pair.left.undo.undo();
      pair.left.materializer.rebuild();
      expect(nodeText(collectKind(pair.left.materializer.current(), 'paragraph')[0]!)).toBe(
        'zAlpha'
      );
    } finally {
      destroyPair(pair);
    }
  });
});
