/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A decision record is written by a peer, so a reader ignores every key and value it cannot
// trust, and a valid record leaves only the characters it saw out of the revision.

import { expect, test } from 'bun:test';
import * as Y from 'yjs';
import {
  DECISION_PREFIX,
  decidedOf,
  recordDecisions,
} from '../document/paragraph-text-decisions.ts';
import { sharedDelta } from '../document/paragraph-text-strikes.ts';

const KEY = 'v:lid:a:1';
const VALUE = JSON.stringify({ e: { i: 'lid:a:1', l: 'ins', k: 'revisionInsert' }, d: 1 });

function paragraph(): { doc: Y.Doc; record: Y.Map<unknown>; text: Y.Text } {
  const doc = new Y.Doc();
  doc.clientID = 7;
  const record = doc.getMap<unknown>('nodes').set('p', new Y.Map<unknown>()) as Y.Map<unknown>;
  const text = record.set('inline', new Y.Text()) as Y.Text;
  text.insert(0, 'abc', { [KEY]: VALUE });
  return { doc, record, text };
}

function revisionsOf(text: Y.Text): string[] {
  return sharedDelta(text).map((op) =>
    Object.keys(op.attributes ?? {})
      .filter((key) => key.startsWith('v:'))
      .join(',')
  );
}

test('a reader ignores decision records it cannot trust', () => {
  const { record, text } = paragraph();
  record.set(`${DECISION_PREFIX}${KEY}\u001f7`, 'not json');
  record.set(`${DECISION_PREFIX}${KEY}\u001fpeer`, JSON.stringify({ 7: 9 }));
  record.set(`${DECISION_PREFIX}__proto__\u001f7`, JSON.stringify({ 7: 9 }));
  record.set(`${DECISION_PREFIX}${KEY}\u001f8`, JSON.stringify({ seven: 9 }));
  record.set(`${DECISION_PREFIX}${KEY}\u001f9`, JSON.stringify({ 7: -1 }));
  expect(decidedOf(text)).toBeNull();
  expect(revisionsOf(text)).toEqual([KEY]);
});

test('a decision record leaves only the characters it saw out of the revision', () => {
  const { text } = paragraph();
  recordDecisions(text, new Map([[KEY, VALUE]]));
  expect(revisionsOf(text)).toEqual(['']);
  // A character typed after the decision keeps the revision it takes.
  text.insert(3, 'd', { [KEY]: VALUE });
  expect(sharedDelta(text).map((op) => op.insert)).toEqual(['abc', 'd']);
  expect(revisionsOf(text)).toEqual(['', KEY]);
});

test('a decision record applies only to the revision it names under its key', () => {
  const { text } = paragraph();
  const other = JSON.stringify({
    e: { i: 'lid:a:1', l: 'del', k: 'revisionDelete', a: [['author', 'Bob']] },
    d: 1,
  });
  recordDecisions(text, new Map([[KEY, other]]));
  expect(decidedOf(text)).not.toBeNull();
  expect(revisionsOf(text)).toEqual([KEY]);
});
