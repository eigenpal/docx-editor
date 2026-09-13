/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { DEFAULT_DOCUMENT_LIMITS } from '../document/limits.ts';
import { makeTextRecord, NODE_TEXT_FIELD } from '../document/schema.ts';
import { SplitTextSources, NODE_SPLIT_TEXT_SOURCE_FIELD } from '../document/split-text-sources.ts';

const IDS = ['left', 'middle', 'right'];

function setup(value = 'abcdefghij', cuts = [4, 6]) {
  const doc = new Y.Doc();
  const nodes = doc.getMap<Y.Map<unknown>>('nodes');
  for (const id of ['source', ...IDS]) nodes.set(id, makeTextRecord(id === 'source' ? value : ''));
  const sources = new SplitTextSources(nodes, doc, DEFAULT_DOCUMENT_LIMITS);
  const text = nodes.get('source')!.get(NODE_TEXT_FIELD) as Y.Text;
  const edges = [0, ...cuts, value.length];
  for (let i = 0; i < IDS.length; i++)
    sources.register(IDS[i]!, 'source', edges[i]!, edges[i + 1]!);
  // The real session tracks node maps too. Derived anchor rewrites must not enter that
  // history or clear redo, so this deliberately tracks the wider scope rather than text alone.
  const undo = new Y.UndoManager(nodes);
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  const relay = (update: Uint8Array) => Y.applyUpdate(remote, update);
  doc.on('update', relay);
  const parts = () => IDS.map((id) => sources.value(id));
  const read = (target: Y.Doc) => {
    const projection = new SplitTextSources(
      target.getMap('nodes'),
      target,
      DEFAULT_DOCUMENT_LIMITS
    );
    projection.reset();
    return IDS.map((id) => projection.value(id));
  };
  const assertAll = (expected: readonly string[]) => {
    expect(parts()).toEqual([...expected]);
    expect(read(remote)).toEqual([...expected]);
    const cold = new Y.Doc();
    try {
      Y.applyUpdate(cold, Y.encodeStateAsUpdate(doc));
      expect(read(cold)).toEqual([...expected]);
    } finally {
      cold.destroy();
    }
  };
  const destroy = () => {
    doc.off('update', relay);
    undo.destroy();
    doc.destroy();
    remote.destroy();
  };
  return { doc, nodes, sources, text, undo, remote, parts, read, assertAll, destroy };
}

describe('replicated split boundaries across undo and redo', () => {
  test.each([
    [0, 10],
    [2, 6],
    [4, 2],
    [4, 1],
    [0, 4],
  ])('restores the original formatted slices after deleting [%i, +%i]', (start, count) => {
    const room = setup();
    try {
      const original = ['abcd', 'ef', 'ghij'];
      room.text.delete(start, count);
      const deleted = room.parts() as string[];
      room.assertAll(deleted);
      for (let cycle = 0; cycle < 3; cycle++) {
        expect(room.undo.undo()).not.toBeNull();
        room.sources.normalizeRestoredAnchors();
        room.assertAll(original);
        expect(room.undo.redoStack.length).toBe(1);
        expect(room.undo.redo()).not.toBeNull();
        room.sources.normalizeRestoredAnchors();
        room.assertAll(deleted);
      }
    } finally {
      room.destroy();
    }
  });

  test('restored in-item UTF-16 offsets retain an astral glyph and surrounding partitions', () => {
    const room = setup('ab😀cdefgh', [4, 6]);
    try {
      room.text.delete(1, 6);
      room.undo.undo();
      room.sources.normalizeRestoredAnchors();
      room.assertAll(['ab😀', 'cd', 'efgh']);
    } finally {
      room.destroy();
    }
  });

  test('normalization retains deleted anchors and is idempotent once restoration is published', () => {
    const room = setup();
    try {
      const anchors = () => IDS.map((id) => room.nodes.get(id)!.get(NODE_SPLIT_TEXT_SOURCE_FIELD));
      const original = anchors();
      room.text.delete(0, room.text.length);
      room.sources.normalizeRestoredAnchors();
      expect(anchors()).toEqual(original);
      room.undo.undo();
      room.sources.normalizeRestoredAnchors();
      room.assertAll(['abcd', 'ef', 'ghij']);
      const restored = anchors();
      let updates = 0;
      const count = () => updates++;
      room.doc.on('update', count);
      room.sources.normalizeRestoredAnchors();
      room.doc.off('update', count);
      expect(updates).toBe(0);
      expect(anchors()).toEqual(restored);
    } finally {
      room.destroy();
    }
  });

  test('a peer insertion survives source undo with identical restored formatting boundaries', () => {
    const room = setup();
    try {
      room.text.delete(2, 6);
      const remoteText = room.remote
        .getMap<Y.Map<unknown>>('nodes')
        .get('source')!
        .get(NODE_TEXT_FIELD) as Y.Text;
      remoteText.insert(2, 'REMOTE');
      Y.applyUpdate(room.doc, Y.encodeStateAsUpdate(room.remote), 'remote');
      room.undo.undo();
      room.sources.normalizeRestoredAnchors();
      const parts = room.parts() as string[];
      expect(parts.map((part) => part.replace('REMOTE', ''))).toEqual(['abcd', 'ef', 'ghij']);
      expect(parts.join('').match(/REMOTE/g)?.length).toBe(1);
      room.assertAll(parts);
    } finally {
      room.destroy();
    }
  });
});
