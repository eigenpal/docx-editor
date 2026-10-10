import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { deleteSetDigest } from './observer.ts';

describe('deleteSetDigest', () => {
  test('tells apart two documents that share a state vector but not a delete', () => {
    const writer = new Y.Doc();
    writer.getText('t').insert(0, 'hello');
    const reader = new Y.Doc();
    Y.applyUpdate(reader, Y.encodeStateAsUpdate(writer));
    const sameInserts = Y.encodeStateVector(reader);

    // A delete-only transaction: it adds no item, so the state vector stays the same.
    writer.getText('t').delete(1, 2);
    expect(Y.encodeStateVector(writer)).toEqual(sameInserts);
    expect(deleteSetDigest(writer)).not.toBe(deleteSetDigest(reader));

    Y.applyUpdate(reader, Y.encodeStateAsUpdate(writer));
    expect(deleteSetDigest(writer)).toBe(deleteSetDigest(reader));
  });

  test('does not depend on how each document split its items', () => {
    const one = new Y.Doc();
    one.getText('t').insert(0, 'abcdef');
    const two = new Y.Doc();
    Y.applyUpdate(two, Y.encodeStateAsUpdate(one));
    // Two deletes on one side, one merged update on the other.
    one.getText('t').delete(1, 1);
    one.getText('t').delete(1, 1);
    Y.applyUpdate(two, Y.encodeStateAsUpdate(one));
    expect(deleteSetDigest(two)).toBe(deleteSetDigest(one));
  });
});
