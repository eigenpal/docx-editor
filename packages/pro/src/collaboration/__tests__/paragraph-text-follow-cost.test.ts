/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Two peers that join one paragraph at once can leave moved text in a deleted paragraph that
// no other paragraph holds. Placing that text reads what every other source typed. A
// keystroke elsewhere must not then cost a read of the whole document.
import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { asLogicalId, type LogicalId } from '../document/identity.ts';
import { TextFollow } from '../document/paragraph-text-follow.ts';
import { textMarksOf } from '../document/paragraph-text-marks.ts';

/** Milliseconds per keystroke in one paragraph of `paragraphs`, with or without the source. */
function keystrokeCost(paragraphs: number, withDeletedSource: boolean): number {
  const doc = new Y.Doc();
  const marks = textMarksOf(doc);
  const texts = new Map<string, Y.Text>();
  const order = new Map<string, number>();
  doc.clientID = 1;
  for (let at = 0; at < paragraphs; at += 1) {
    const text = doc.getText(`p${at}`);
    text.insert(0, 'x'.repeat(300));
    // Typed after a deleted character: the paragraph is a source with an anchor.
    text.delete(299, 1);
    text.insert(299, 'y');
    texts.set(`p${at}`, text);
    order.set(`p${at}`, at);
  }
  const deleted = new Set<string>();
  if (withDeletedSource) {
    doc.clientID = 2;
    const text = doc.getText('gone');
    text.insert(0, 'q');
    marks.markCopy('move', 2, 0, 1, '9:0');
    texts.set('gone', text);
    order.set('gone', paragraphs);
    deleted.add('gone');
  }
  const follow = new TextFollow(
    (id) => texts.get(id) ?? null,
    (id) => deleted.has(id),
    (left, right) => order.get(left)! - order.get(right)!,
    () => {},
    () => null
  );
  for (const id of texts.keys()) follow.paragraphChanged(asLogicalId(id));
  follow.settle();
  const typed: LogicalId = asLogicalId('p0');
  const text = texts.get('p0')!;
  doc.clientID = 1;
  const keystrokes = 40;
  const started = performance.now();
  for (let at = 0; at < keystrokes; at += 1) {
    text.insert(text.length, 'k');
    follow.paragraphChanged(typed);
    follow.settle();
  }
  return (performance.now() - started) / keystrokes;
}

describe('following text cost', () => {
  test('a deleted source that reads other sources keeps a keystroke near its usual cost', () => {
    const usual = keystrokeCost(1500, false);
    const withSource = keystrokeCost(1500, true);
    // Rebuilding every source's typed text on each placement made this about 70 times the
    // usual cost on 2,000 paragraphs, and it grew with the document.
    expect(withSource).toBeLessThan(Math.max(usual * 8, 1));
  });

  test('many paragraphs that hold one moved run cost about their text to show', () => {
    // Every paragraph holds a moved copy of the same characters; the last one shows them.
    const paragraphs = 800;
    const length = 400;
    const doc = new Y.Doc();
    const marks = textMarksOf(doc);
    const texts = new Map<string, Y.Text>();
    const order = new Map<string, number>();
    for (let at = 0; at < paragraphs; at += 1) {
      doc.clientID = 1000 + at;
      const text = doc.getText(`p${at}`);
      text.insert(0, 'x'.repeat(length));
      marks.markCopy('move', 1000 + at, 0, length, '5:0');
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
    follow.settle();
    const started = performance.now();
    let hidden = 0;
    for (const [id, text] of texts) hidden += follow.shown(asLogicalId(id), text).hidden.size;
    const elapsed = performance.now() - started;
    expect(hidden).toBe((paragraphs - 1) * length);
    // Each character asked every holder before: seconds here.
    expect(elapsed).toBeLessThan(1500);
  });

  test('one long moved run does not make lookups of short runs scan them all', () => {
    const runs = 20_000;
    const showCost = (withLong: boolean): number => {
      const doc = new Y.Doc();
      const marks = textMarksOf(doc);
      const texts = new Map<string, Y.Text>();
      doc.clientID = 1000;
      const long = doc.getText('a');
      long.insert(0, 'x'.repeat(runs));
      if (withLong) marks.markCopy('move', 1000, 0, runs, '5:0');
      texts.set('a', long);
      doc.clientID = 2000;
      const short = doc.getText('b');
      short.insert(0, 'y'.repeat(runs));
      // One-character copies of the same characters, in reverse order.
      for (let at = 0; at < runs; at += 1) {
        marks.markCopy('move', 2000, at, 1, `5:${runs - 1 - at}`);
      }
      texts.set('b', short);
      const order = new Map([
        ['a', 0],
        ['b', 1],
      ]);
      const follow = new TextFollow(
        (id) => texts.get(id) ?? null,
        () => false,
        (left, right) => order.get(left)! - order.get(right)!,
        () => {},
        () => null
      );
      for (const id of texts.keys()) follow.paragraphChanged(asLogicalId(id));
      follow.settle();
      const started = performance.now();
      follow.shown(asLogicalId('b'), short);
      follow.orderChanged();
      return performance.now() - started;
    };
    // The fastest of three interleaved rounds: a busy machine only makes a round slower.
    let without = Infinity;
    let withLong = Infinity;
    for (let round = 0; round < 3; round += 1) {
      without = Math.min(without, showCost(false));
      withLong = Math.min(withLong, showCost(true));
    }
    // One bound for every run's length made the long run cost about 35 times more here.
    expect(withLong).toBeLessThan(Math.max(without * 10, 30));
  });
});
