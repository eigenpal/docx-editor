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

function setup(value = 'abcdefghij') {
  const doc = new Y.Doc();
  const nodes = doc.getMap<Y.Map<unknown>>('nodes');
  for (const id of ['source', 'left', 'right', 'nested'])
    nodes.set(id, makeTextRecord(id === 'source' ? value : 'copy'));
  const sources = new SplitTextSources(nodes, doc, DEFAULT_DOCUMENT_LIMITS);
  const text = nodes.get('source')!.get(NODE_TEXT_FIELD) as Y.Text;
  return { doc, nodes, sources, text };
}

describe('shared split text sources', () => {
  test('outer endpoints and shared interior boundaries retain every inserted character once', () => {
    const { sources, text } = setup();
    sources.register('left', 'source', 0, 5);
    sources.register('right', 'source', 5, 10);
    expect(sources.value('left')).toBe('abcde');
    text.insert(5, 'BOUNDARY');
    text.insert(0, 'START');
    text.insert(text.length, 'END');
    expect(sources.value('left')).toBe('STARTabcdeBOUNDARY');
    expect(sources.value('right')).toBe('fghijEND');
    expect(sources.value('left')! + sources.value('right')!).toBe(text.toString());
  });

  test('nested spans flatten and preserve inherited endpoints', () => {
    const { sources, nodes, text } = setup();
    sources.register('right', 'source', 5, 10);
    sources.register('nested', 'right', 0, 5);
    expect(
      JSON.parse(nodes.get('nested')!.get(NODE_SPLIT_TEXT_SOURCE_FIELD) as string).sourceId
    ).toBe('source');
    text.insert(5, 'L');
    text.insert(text.length, 'R');
    expect(sources.value('right')).toBe('fghijR');
    expect(sources.value('nested')).toBe('fghijR');
    sources.register('left', 'right', 1, 3);
    text.insert(6, 'BEFORE');
    expect(sources.value('left')).toBe('gh');
  });

  test('deletion across boundaries and later insertion keep slices disjoint', () => {
    const { sources, text } = setup();
    sources.register('left', 'source', 0, 5);
    sources.register('right', 'source', 5, 10);
    text.delete(3, 4);
    text.insert(3, 'NEW');
    expect(sources.value('left')! + sources.value('right')!).toBe(text.toString());
  });

  test('source edits dirty aliases and removing provenance removes the overlay', () => {
    const { sources, nodes, text } = setup();
    sources.register('left', 'source', 0, 5);
    expect(sources.overlays().changedIds.has('left')).toBe(true);
    expect(sources.overlays().changedIds.size).toBe(0);
    text.insert(1, 'X');
    sources.noteChanged('source');
    expect(sources.overlays().values.get('left')).toBe('aXbcde');
    nodes.get('left')!.delete(NODE_SPLIT_TEXT_SOURCE_FIELD);
    sources.noteChanged('left');
    const removed = sources.overlays();
    expect(removed.changedIds.has('left')).toBe(true);
    expect(removed.values.has('left')).toBe(false);
  });

  test('cold decoding and source undo/redo follow the same shared characters', () => {
    const { doc, sources, text } = setup();
    sources.register('left', 'source', 0, 5);
    sources.register('right', 'source', 5, 10);
    const undo = new Y.UndoManager(text);
    text.insert(3, 'X');
    expect(sources.value('left')).toBe('abcXde');
    undo.undo();
    expect(sources.value('left')).toBe('abcde');
    undo.redo();
    expect(sources.value('left')).toBe('abcXde');
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    const joined = new SplitTextSources(remote.getMap('nodes'), remote, DEFAULT_DOCUMENT_LIMITS);
    joined.reset();
    expect(joined.overlays().values.get('left')).toBe('abcXde');
    expect(joined.value('right')).toBe('fghij');
    undo.destroy();
  });

  test('relative anchors survive undo and redo of source characters at a split boundary', () => {
    const { sources, text } = setup();
    const undo = new Y.UndoManager(text);
    text.insert(5, 'X');
    sources.register('left', 'source', 0, 5);
    sources.register('right', 'source', 5, 11);
    undo.undo();
    expect(sources.value('left')! + sources.value('right')!).toBe('abcdefghij');
    undo.redo();
    expect(sources.value('left')! + sources.value('right')!).toBe('abcdeXfghij');
    undo.destroy();
  });

  test('concurrent source updates merge without copied insertions', () => {
    const { doc, sources, text } = setup();
    sources.register('left', 'source', 0, 5);
    sources.register('right', 'source', 5, 10);
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    const remoteNodes = remote.getMap<Y.Map<unknown>>('nodes');
    const joined = new SplitTextSources(remoteNodes, remote, DEFAULT_DOCUMENT_LIMITS);
    const remoteText = remoteNodes.get('source')!.get(NODE_TEXT_FIELD) as Y.Text;
    text.insert(5, 'A');
    remoteText.insert(5, 'B');
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote));
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    expect(sources.value('left')! + sources.value('right')!).toBe(text.toString());
    expect(joined.value('left')).toBe(sources.value('left'));
    expect(joined.value('right')).toBe(sources.value('right'));
  });

  test('empty source and inherited empty span retain future typing', () => {
    const { sources, text } = setup('');
    sources.register('left', 'source', 0, 0);
    sources.register('nested', 'left', 0, 0);
    text.insert(0, 'new');
    expect(sources.value('left')).toBe('new');
    expect(sources.value('nested')).toBe('new');
  });

  test('alias metadata undo and redo invalidate derived values', () => {
    const { sources, nodes } = setup();
    const undo = new Y.UndoManager(nodes);
    sources.register('left', 'source', 0, 5);
    sources.overlays();
    undo.undo();
    sources.noteChanged('left');
    expect(sources.overlays().values.has('left')).toBe(false);
    undo.redo();
    sources.noteChanged('left');
    expect(sources.overlays().values.get('left')).toBe('abcde');
    undo.destroy();
  });

  test('invalid registration does not write metadata', () => {
    const { sources, nodes } = setup();
    for (const [start, end] of [
      [-1, 5],
      [6, 5],
      [0, 11],
      [0.5, 5],
    ]) {
      expect(() => sources.register('left', 'source', start!, end!)).toThrow('invalid-bound');
      expect(nodes.get('left')!.has(NODE_SPLIT_TEXT_SOURCE_FIELD)).toBe(false);
    }
  });

  test('malformed claimed aliases refuse instead of displaying copied text', () => {
    const { sources, nodes } = setup();
    for (const value of [
      null,
      4,
      '{',
      '{}',
      'x'.repeat(DEFAULT_DOCUMENT_LIMITS.maxStringLength + 1),
      JSON.stringify({ sourceId: '__proto__', start: {}, end: {} }),
    ]) {
      nodes.get('left')!.set(NODE_SPLIT_TEXT_SOURCE_FIELD, value);
      expect(() => sources.value('left')).toThrow('invalid-string');
      expect(() => sources.indexExisting('left')).toThrow('invalid-string');
    }
  });

  test('reject missing sources, forged positions, and nonflattened aliases', () => {
    const { sources, nodes } = setup();
    sources.register('left', 'source', 0, 5);
    const original = nodes.get('left')!.get(NODE_SPLIT_TEXT_SOURCE_FIELD) as string;
    const data = JSON.parse(original);
    nodes
      .get('left')!
      .set(NODE_SPLIT_TEXT_SOURCE_FIELD, JSON.stringify({ ...data, sourceId: 'missing' }));
    expect(() => sources.value('left')).toThrow('invalid-bound');
    nodes
      .get('left')!
      .set(
        NODE_SPLIT_TEXT_SOURCE_FIELD,
        JSON.stringify({ ...data, end: { ...data.end, type: { client: 999999, clock: 0 } } })
      );
    expect(() => sources.value('left')).toThrow('invalid-bound');
    nodes.get('left')!.set(NODE_SPLIT_TEXT_SOURCE_FIELD, original);
    nodes
      .get('right')!
      .set(NODE_SPLIT_TEXT_SOURCE_FIELD, JSON.stringify({ ...data, sourceId: 'left' }));
    expect(() => sources.value('right')).toThrow('invalid-bound');
  });
});
