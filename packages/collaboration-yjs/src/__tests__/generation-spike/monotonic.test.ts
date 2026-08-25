import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';

describe('Yjs checkpoints cannot rewind later state', () => {
  test('applying an older snapshot does not remove a later insert', () => {
    const doc = new Y.Doc();
    doc.clientID = 7;
    doc.getText('body').insert(0, 'hello');
    const checkpoint = Y.encodeStateAsUpdate(doc);

    doc.getText('body').insert(5, ' world');
    expect(doc.getText('body').toString()).toBe('hello world');

    Y.applyUpdate(doc, checkpoint, 'old-checkpoint');
    expect(doc.getText('body').toString()).toBe('hello world');
  });

  test('applying an older snapshot does not revive deleted text', () => {
    const doc = new Y.Doc();
    doc.getText('body').insert(0, 'hello');
    const checkpoint = Y.encodeStateAsUpdate(doc);

    doc.getText('body').delete(0, 5);
    expect(doc.getText('body').toString()).toBe('');

    Y.applyUpdate(doc, checkpoint, 'old-checkpoint');
    expect(doc.getText('body').toString()).toBe('');
  });

  test('a new Y.Doc loaded from the same checkpoint does rewind', () => {
    const live = new Y.Doc();
    live.getText('body').insert(0, 'hello');
    const checkpoint = Y.encodeStateAsUpdate(live);
    live.getText('body').insert(5, ' world');

    const restored = new Y.Doc();
    Y.applyUpdate(restored, checkpoint, 'restore');
    expect(live.getText('body').toString()).toBe('hello world');
    expect(restored.getText('body').toString()).toBe('hello');
  });

  test('later clocks remain after a full-state encode is reapplied', () => {
    const doc = new Y.Doc();
    doc.clientID = 11;
    doc.getText('body').insert(0, 'A');
    const checkpoint = Y.encodeStateAsUpdate(doc);
    doc.getText('body').insert(1, 'B');
    const laterVector = Y.encodeStateVector(doc);

    Y.applyUpdate(doc, checkpoint);
    expect(Object.fromEntries(Y.decodeStateVector(laterVector))).toEqual(
      Object.fromEntries(Y.decodeStateVector(Y.encodeStateVector(doc)))
    );
    expect(doc.getText('body').toString()).toBe('AB');
  });
});
