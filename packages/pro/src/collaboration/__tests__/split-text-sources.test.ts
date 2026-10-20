/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { DEFAULT_DOCUMENT_LIMITS } from '../document/limits.ts';
import { hasPendingUpdates, makeTextRecord, NODE_TEXT_FIELD } from '../document/schema.ts';
import { SplitTextSources, NODE_SPLIT_TEXT_SOURCE_FIELD } from '../document/split-text-sources.ts';
import { asLogicalId } from '../document/identity.ts';

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
    sources.register(asLogicalId('left'), asLogicalId('source'), 0, 5);
    sources.register(asLogicalId('right'), asLogicalId('source'), 5, 10);
    expect(sources.value(asLogicalId('left'))).toBe('abcde');
    text.insert(5, 'BOUNDARY');
    text.insert(0, 'START');
    text.insert(text.length, 'END');
    expect(sources.value(asLogicalId('left'))).toBe('STARTabcdeBOUNDARY');
    expect(sources.value(asLogicalId('right'))).toBe('fghijEND');
    expect(sources.value(asLogicalId('left'))! + sources.value(asLogicalId('right'))!).toBe(
      text.toString()
    );
  });

  test('nested spans flatten and preserve inherited endpoints', () => {
    const { sources, nodes, text } = setup();
    sources.register(asLogicalId('right'), asLogicalId('source'), 5, 10);
    sources.register(asLogicalId('nested'), asLogicalId('right'), 0, 5);
    expect(
      JSON.parse(nodes.get('nested')!.get(NODE_SPLIT_TEXT_SOURCE_FIELD) as string).sourceId
    ).toBe('source');
    text.insert(5, 'L');
    text.insert(text.length, 'R');
    expect(sources.value(asLogicalId('right'))).toBe('fghijR');
    expect(sources.value(asLogicalId('nested'))).toBe('fghijR');
    sources.register(asLogicalId('left'), asLogicalId('right'), 1, 3);
    text.insert(6, 'BEFORE');
    expect(sources.value(asLogicalId('left'))).toBe('gh');
  });

  test('deletion across boundaries and later insertion keep slices disjoint', () => {
    const { sources, text } = setup();
    sources.register(asLogicalId('left'), asLogicalId('source'), 0, 5);
    sources.register(asLogicalId('right'), asLogicalId('source'), 5, 10);
    text.delete(3, 4);
    text.insert(3, 'NEW');
    expect(sources.value(asLogicalId('left'))! + sources.value(asLogicalId('right'))!).toBe(
      text.toString()
    );
  });

  test('source edits dirty aliases and removing provenance removes the overlay', () => {
    const { sources, nodes, text } = setup();
    sources.register(asLogicalId('left'), asLogicalId('source'), 0, 5);
    expect(sources.overlays().changedIds.has(asLogicalId('left'))).toBe(true);
    expect(sources.overlays().changedIds.size).toBe(0);
    text.insert(1, 'X');
    sources.noteChanged(asLogicalId('source'));
    expect(sources.overlays().values.get(asLogicalId('left'))).toBe('aXbcde');
    nodes.get('left')!.delete(NODE_SPLIT_TEXT_SOURCE_FIELD);
    sources.noteChanged(asLogicalId('left'));
    const removed = sources.overlays();
    expect(removed.changedIds.has(asLogicalId('left'))).toBe(true);
    expect(removed.values.has(asLogicalId('left'))).toBe(false);
  });

  test('cold decoding and source undo/redo follow the same shared characters', () => {
    const { doc, sources, text } = setup();
    sources.register(asLogicalId('left'), asLogicalId('source'), 0, 5);
    sources.register(asLogicalId('right'), asLogicalId('source'), 5, 10);
    const undo = new Y.UndoManager(text);
    text.insert(3, 'X');
    expect(sources.value(asLogicalId('left'))).toBe('abcXde');
    undo.undo();
    expect(sources.value(asLogicalId('left'))).toBe('abcde');
    undo.redo();
    expect(sources.value(asLogicalId('left'))).toBe('abcXde');
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    const joined = new SplitTextSources(remote.getMap('nodes'), remote, DEFAULT_DOCUMENT_LIMITS);
    joined.reset();
    expect(joined.overlays().values.get(asLogicalId('left'))).toBe('abcXde');
    expect(joined.value(asLogicalId('right'))).toBe('fghij');
    undo.destroy();
  });

  test('relative anchors survive undo and redo of source characters at a split boundary', () => {
    const { sources, text } = setup();
    const undo = new Y.UndoManager(text);
    text.insert(5, 'X');
    sources.register(asLogicalId('left'), asLogicalId('source'), 0, 5);
    sources.register(asLogicalId('right'), asLogicalId('source'), 5, 11);
    undo.undo();
    expect(sources.value(asLogicalId('left'))! + sources.value(asLogicalId('right'))!).toBe(
      'abcdefghij'
    );
    undo.redo();
    expect(sources.value(asLogicalId('left'))! + sources.value(asLogicalId('right'))!).toBe(
      'abcdeXfghij'
    );
    undo.destroy();
  });

  test('concurrent source updates merge without copied insertions', () => {
    const { doc, sources, text } = setup();
    sources.register(asLogicalId('left'), asLogicalId('source'), 0, 5);
    sources.register(asLogicalId('right'), asLogicalId('source'), 5, 10);
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    const remoteNodes = remote.getMap<Y.Map<unknown>>('nodes');
    const joined = new SplitTextSources(remoteNodes, remote, DEFAULT_DOCUMENT_LIMITS);
    const remoteText = remoteNodes.get('source')!.get(NODE_TEXT_FIELD) as Y.Text;
    text.insert(5, 'A');
    remoteText.insert(5, 'B');
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote));
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    expect(sources.value(asLogicalId('left'))! + sources.value(asLogicalId('right'))!).toBe(
      text.toString()
    );
    expect(joined.value(asLogicalId('left'))).toBe(sources.value(asLogicalId('left')));
    expect(joined.value(asLogicalId('right'))).toBe(sources.value(asLogicalId('right')));
  });

  test('empty source and inherited empty span retain future typing', () => {
    const { sources, text } = setup('');
    sources.register(asLogicalId('left'), asLogicalId('source'), 0, 0);
    sources.register(asLogicalId('nested'), asLogicalId('left'), 0, 0);
    text.insert(0, 'new');
    expect(sources.value(asLogicalId('left'))).toBe('new');
    expect(sources.value(asLogicalId('nested'))).toBe('new');
  });

  test('alias metadata undo and redo invalidate derived values', () => {
    const { sources, nodes } = setup();
    const undo = new Y.UndoManager(nodes);
    sources.register(asLogicalId('left'), asLogicalId('source'), 0, 5);
    sources.overlays();
    undo.undo();
    sources.noteChanged(asLogicalId('left'));
    expect(sources.overlays().values.has(asLogicalId('left'))).toBe(false);
    undo.redo();
    sources.noteChanged(asLogicalId('left'));
    expect(sources.overlays().values.get(asLogicalId('left'))).toBe('abcde');
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
      expect(() =>
        sources.register(asLogicalId('left'), asLogicalId('source'), start!, end!)
      ).toThrow('invalid-bound');
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
      expect(() => sources.value(asLogicalId('left'))).toThrow('invalid-string');
      // Indexing runs inside a Yjs observer, so it defers the refusal to the next
      // materialize rather than throwing out of `applyUpdate`.
      expect(() => sources.indexExisting(asLogicalId('left'))).not.toThrow();
      expect(() => sources.overlays()).toThrow('invalid-string');
    }
  });

  test('a missing source is pending; forged positions and nonflattened aliases are refused', () => {
    const { sources, nodes } = setup();
    sources.register(asLogicalId('left'), asLogicalId('source'), 0, 5);
    const original = nodes.get('left')!.get(NODE_SPLIT_TEXT_SOURCE_FIELD) as string;
    const data = JSON.parse(original);
    nodes
      .get('left')!
      .set(NODE_SPLIT_TEXT_SOURCE_FIELD, JSON.stringify({ ...data, sourceId: 'missing' }));
    // A source that has not reached this replica is pending, as a Yjs update is: no text yet.
    expect(sources.value(asLogicalId('left'))).toBeNull();
    sources.indexExisting(asLogicalId('left'));
    expect([...sources.overlays().awaiting]).toContain(asLogicalId('left'));
    nodes
      .get('left')!
      .set(
        NODE_SPLIT_TEXT_SOURCE_FIELD,
        JSON.stringify({ ...data, end: { ...data.end, type: { client: 999999, clock: 0 } } })
      );
    expect(() => sources.value(asLogicalId('left'))).toThrow('invalid-bound');
    nodes.get('left')!.set(NODE_SPLIT_TEXT_SOURCE_FIELD, original);
    nodes
      .get('right')!
      .set(NODE_SPLIT_TEXT_SOURCE_FIELD, JSON.stringify({ ...data, sourceId: 'left' }));
    expect(() => sources.value(asLogicalId('right'))).toThrow('invalid-bound');
  });

  test('an unrelated update held back forever does not keep a removed alias alive', () => {
    // A peer can send an update with a gap in its own history, so Yjs holds it pending for as
    // long as the peer likes. That update rewrites no alias, so a real removal of one, such
    // as an undo, takes effect at once on every replica.
    const author = setup();
    author.sources.register(asLogicalId('right'), asLogicalId('source'), 5, 10);
    const reader = new Y.Doc();
    Y.applyUpdate(reader, Y.encodeStateAsUpdate(author.doc));
    const readerNodes = reader.getMap<Y.Map<unknown>>('nodes');
    const readerSources = new SplitTextSources(readerNodes, reader, DEFAULT_DOCUMENT_LIMITS);
    expect(readerSources.value(asLogicalId('right'))).toBe('fghij');

    const hostile = new Y.Doc();
    Y.applyUpdate(hostile, Y.encodeStateAsUpdate(author.doc));
    hostile.getMap('other').set('withheld', 1);
    const afterGap = Y.encodeStateVector(hostile);
    hostile.getMap('other').set('parked', 2);
    Y.applyUpdate(reader, Y.encodeStateAsUpdate(hostile, afterGap));
    expect(hasPendingUpdates(reader)).toBe(true);

    const beforeRemoval = Y.encodeStateVector(author.doc);
    author.nodes.get('right')!.delete(NODE_SPLIT_TEXT_SOURCE_FIELD);
    Y.applyUpdate(reader, Y.encodeStateAsUpdate(author.doc, beforeRemoval));
    expect(readerSources.isPending(asLogicalId('right'))).toBe(false);
    expect(readerSources.range(asLogicalId('right'))).toBeNull();
    const cold = new SplitTextSources(readerNodes, reader, DEFAULT_DOCUMENT_LIMITS);
    expect(cold.isPending(asLogicalId('right'))).toBe(false);
    expect(cold.range(asLogicalId('right'))).toBeNull();
  });

  test('a peer rewrite whose new value is still in flight leaves the alias pending', () => {
    // Yjs applies a delete as soon as its target exists, but holds an insert until the
    // writer's earlier updates arrive. A peer's rewrite of this field can therefore land as
    // "old value gone, new value not yet". Reading that as "no alias" let a local split
    // build an alias on top of this alias, and the room failed with `invalid-bound`.
    const author = setup();
    author.sources.register(asLogicalId('right'), asLogicalId('source'), 5, 10);
    const peer = new Y.Doc();
    const reader = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(author.doc));
    Y.applyUpdate(reader, Y.encodeStateAsUpdate(author.doc));
    const peerNodes = peer.getMap<Y.Map<unknown>>('nodes');
    const readerNodes = reader.getMap<Y.Map<unknown>>('nodes');
    const readerSources = new SplitTextSources(readerNodes, reader, DEFAULT_DOCUMENT_LIMITS);
    expect(readerSources.value(asLogicalId('right'))).toBe('fghij');

    // The peer writes something the reader will not get yet, then rewrites the field.
    const beforeUnrelated = Y.encodeStateVector(peer);
    peer.getMap('other').set('unrelated', 1);
    const beforeRewrite = Y.encodeStateVector(peer);
    const record = peerNodes.get('right')!;
    record.set(NODE_SPLIT_TEXT_SOURCE_FIELD, record.get(NODE_SPLIT_TEXT_SOURCE_FIELD));
    const rewrite = Y.encodeStateAsUpdate(peer, beforeRewrite);
    const unrelated = Y.encodeStateAsUpdate(peer, beforeUnrelated);

    Y.applyUpdate(reader, rewrite);
    expect(readerNodes.get('right')!.has(NODE_SPLIT_TEXT_SOURCE_FIELD)).toBe(false);
    // The last value this replica read still holds, so the text does not vanish meanwhile.
    expect(readerSources.isPending(asLogicalId('right'))).toBe(false);
    expect(readerSources.value(asLogicalId('right'))).toBe('fghij');
    // A replica that never read the alias has nothing to hold: it is pending, as in Yjs,
    // and never mistaken for a plain text node.
    const cold = new SplitTextSources(readerNodes, reader, DEFAULT_DOCUMENT_LIMITS);
    expect(cold.isPending(asLogicalId('right'))).toBe(true);
    expect(cold.value(asLogicalId('right'))).toBeNull();

    Y.applyUpdate(reader, unrelated);
    expect(readerSources.value(asLogicalId('right'))).toBe('fghij');
    expect(cold.isPending(asLogicalId('right'))).toBe(false);
    expect(cold.value(asLogicalId('right'))).toBe('fghij');
  });

  test('two live anchors past each other read as an empty slice, the same on every replica', () => {
    // Undo restores characters as new items, which can carry a slice's live anchors past each
    // other. Refusing that range stopped a late joiner from opening the room.
    const { sources, nodes } = setup();
    sources.register(asLogicalId('left'), asLogicalId('source'), 2, 6);
    const data = JSON.parse(nodes.get('left')!.get(NODE_SPLIT_TEXT_SOURCE_FIELD) as string);
    nodes
      .get('left')!
      .set(
        NODE_SPLIT_TEXT_SOURCE_FIELD,
        JSON.stringify({ sourceId: data.sourceId, start: data.end, end: data.start })
      );
    expect(sources.value(asLogicalId('left'))).toBe('');
  });
});
