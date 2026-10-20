/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Paragraph text keeps a node's identity in Yjs formatting markers. Yjs removes markers it
// finds redundant, after a remote update and around a deletion, as one replica sees them; a
// peer's concurrent insert behind such a marker then lost its run. The writer deletes only
// content, and no replica cleans markers up.

import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { deleteContent, deletePositions, keepFormattingMarkers } from '../document/yjs-items.ts';

function formatMarkers(text: Y.Text): number {
  let count = 0;
  for (let item = text._start; item; item = item.right) {
    if (!item.deleted && item.content instanceof Y.ContentFormat) count += 1;
  }
  return count;
}

describe('formatting markers', () => {
  test('deleting content removes the characters asked for and keeps every marker', () => {
    const doc = new Y.Doc();
    const text = doc.getText('t');
    text.insert(0, 'ab', { t: 'one' });
    text.insert(2, 'cd', { t: 'two' });
    text.insert(4, 'ef', { t: 'one' });
    const markers = formatMarkers(text);
    deleteContent(text, 1, 4);
    expect(text.toString()).toBe('af');
    expect(formatMarkers(text)).toBe(markers);
    // Index lookups after the deletion read the text as it is now.
    text.insert(1, 'X', { t: 'one' });
    expect(text.toString()).toBe('aXf');
  });

  test('deleting many positions in one pass deletes exactly those, across item boundaries', () => {
    let seed = 7;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let round = 0; round < 50; round += 1) {
      const doc = new Y.Doc();
      const text = doc.getText('t');
      // Many inserts at random places, so items and their boundaries vary.
      for (let insert = 0; insert < 20; insert += 1) {
        const value = 'abcdefghij'.slice(0, 1 + Math.floor(random() * 9));
        text.insert(Math.floor(random() * (text.length + 1)), value, {
          t: random() < 0.5 ? 'one' : 'two',
        });
      }
      const before = text.toString();
      const positions = [...before].flatMap((_, at) => (random() < 0.3 ? [at] : []));
      deletePositions(text, positions);
      const expected = [...before].filter((_, at) => !positions.includes(at)).join('');
      expect(text.toString()).toBe(expected);
      // Index lookups still work after the one-pass deletion.
      text.insert(0, 'Z');
      expect(text.toString()).toBe(`Z${expected}`);
    }
  });

  test('a peer typing behind a marker keeps its run when a replica receives a deletion', () => {
    const left = new Y.Doc();
    const right = new Y.Doc();
    for (const doc of [left, right]) keepFormattingMarkers(doc);
    left.getText('t').insert(0, 'abcd', { t: 'one' });
    Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
    // One peer deletes the run's text; the other types into it with the run's element.
    deleteContent(left.getText('t'), 0, 4);
    right.getText('t').insert(2, 'XY', { t: 'one' });
    Y.applyUpdate(left, Y.encodeStateAsUpdate(right));
    Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
    for (const doc of [left, right]) {
      expect(doc.getText('t').toDelta()).toEqual([{ insert: 'XY', attributes: { t: 'one' } }]);
    }
  });
});
