/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The identities of a paragraph's text hold several values for each character. A read of
// every paragraph, as a cold build or an export makes, must not keep them all: the cache keeps
// the paragraphs read last, and a paragraph read again after it left shows the same text.
import { expect, test } from 'bun:test';
import * as Y from 'yjs';
import { asLogicalId } from '../document/identity.ts';
import { TextFollow } from '../document/paragraph-text-follow.ts';
import { textMarksOf } from '../document/paragraph-text-marks.ts';

test('a paragraph read again after the cache dropped it shows the same text', () => {
  const paragraphs = 300;
  const doc = new Y.Doc();
  const marks = textMarksOf(doc);
  const texts = new Map<string, Y.Text>();
  const order = new Map<string, number>();
  for (let at = 0; at < paragraphs; at += 1) {
    doc.clientID = 1000 + at;
    const text = doc.getText(`p${at}`);
    text.insert(0, 'abcdefghij');
    // Every paragraph holds a moved copy of the same characters: only the last shows them.
    marks.markCopy('move', 1000 + at, 0, 10, '5:0');
    texts.set(`p${at}`, text);
    order.set(`p${at}`, at);
  }
  const follow = new TextFollow(
    (id) => texts.get(id) ?? null,
    () => false,
    (left, right) => order.get(left)! - order.get(right)!,
    () => {},
    () => null
  );
  for (const id of texts.keys()) follow.paragraphChanged(asLogicalId(id));
  const first = new Map(
    [...texts].map(([id, text]) => [id, follow.shown(asLogicalId(id), text)] as const)
  );
  expect(first.get('p0')!.hidden.size).toBe(10);
  expect(first.get(`p${paragraphs - 1}`)!.hidden.size).toBe(0);
  for (const [id, text] of texts) {
    const again = follow.shown(asLogicalId(id), text);
    expect(again.hidden).toEqual(first.get(id)!.hidden);
    expect(again.identities).toEqual(first.get(id)!.identities);
  }
  // The first paragraph's identities were read anew: the cache no longer held them.
  expect(follow.shown(asLogicalId('p0'), texts.get('p0')!).identities).not.toBe(
    first.get('p0')!.identities
  );
  // The paragraph read last still comes from the cache.
  const last = `p${paragraphs - 1}`;
  expect(follow.shown(asLogicalId(last), texts.get(last)!).identities).toBe(
    follow.shown(asLogicalId(last), texts.get(last)!).identities
  );
});
