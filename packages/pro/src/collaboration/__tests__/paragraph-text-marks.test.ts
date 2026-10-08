/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The marks that give copied, put-back, and typed text its identity live in one map keyed by
// insert. They have to survive what formatting markers did not: two peers marking text at one
// place, a mark that arrives after its text, and peer-written garbage.

import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { MAX_MARK_LENGTH, TEXT_MARKS_KEY, textMarksOf } from '../document/paragraph-text-marks.ts';
import { itemIdentity, textIdentities } from '../document/paragraph-text-identity.ts';
import { firstItem } from '../document/yjs-items.ts';

function docWithText(clientID: number): { doc: Y.Doc; text: Y.Text } {
  const doc = new Y.Doc();
  doc.clientID = clientID;
  const text = doc.getText('t');
  return { doc, text };
}

describe('text marks', () => {
  test('a mark names every clock of its insert, and only those', () => {
    const { doc } = docWithText(7);
    const marks = textMarksOf(doc);
    marks.markCopy('move', 7, 10, 3, '1:100');
    expect(marks.origin('move', 7, 9)).toBeNull();
    expect(marks.origin('move', 7, 10)?.clock).toBe(100);
    expect(marks.origin('move', 7, 12)?.firstClock).toBe(10);
    expect(marks.origin('move', 7, 13)).toBeNull();
    expect(marks.origin('restore', 7, 10)).toBeNull();
  });

  test('a copy reads the identity of what it copies, character by character', () => {
    const { doc, text } = docWithText(7);
    text.insert(0, 'abc');
    const item = firstItem(text)!;
    textMarksOf(doc).markCopy('move', item.id.client, item.id.clock, 3, '1:100');
    expect(textIdentities(text).ids).toEqual(['1:100', '1:101', '1:102']);
    expect(textIdentities(text).moved).toEqual([true, true, true]);
  });

  test('a copy of a copy resolves to the first identity, also when the inner mark comes later', () => {
    const { doc, text } = docWithText(7);
    // Clocks 0 and 1 are the inner copy, 2 and 3 the outer one; Yjs may merge them in one item.
    text.insert(0, 'abab');
    const item = firstItem(text)!;
    const marks = textMarksOf(doc);
    // The outer copy names the inner one before the inner one has a mark of its own.
    marks.markCopy('move', 7, 2, 2, '7:0');
    expect(itemIdentity(text, item, 2)).toBe('7:0');
    marks.markCopy('restore', 7, 0, 2, '1:500');
    expect(itemIdentity(text, item, 2)).toBe('1:500');
    expect(itemIdentity(text, item, 3)).toBe('1:501');
  });

  test('marks that name each other end after a bounded chain', () => {
    const { doc, text } = docWithText(7);
    text.insert(0, 'a');
    const marks = textMarksOf(doc);
    marks.markCopy('move', 7, 0, 1, '8:0');
    marks.markCopy('move', 8, 0, 1, '7:0');
    expect(() => itemIdentity(text, firstItem(text)!, 0)).not.toThrow();
  });

  test('a mark from a peer reaches the other replica and its readers', () => {
    const author = docWithText(7);
    const reader = docWithText(9);
    author.text.insert(0, 'xy');
    const item = firstItem(author.text)!;
    Y.applyUpdate(reader.doc, Y.encodeStateAsUpdate(author.doc));
    expect(textIdentities(reader.text).ids).toEqual(['7:0', '7:1']);
    const seen: Y.Text[] = [];
    textMarksOf(reader.doc).subscribe((texts) => {
      if (texts !== 'all') seen.push(...texts);
    });
    // The mark arrives in its own update, after its text.
    const vector = Y.encodeStateVector(reader.doc);
    textMarksOf(author.doc).markCopy('restore', item.id.client, item.id.clock, 2, '3:40');
    Y.applyUpdate(reader.doc, Y.encodeStateAsUpdate(author.doc, vector));
    expect(textIdentities(reader.text).ids).toEqual(['3:40', '3:41']);
    expect(seen).toEqual([reader.text]);
  });

  test('a late mark reaches the readers of copies made before it', () => {
    const author = docWithText(7);
    const reader = docWithText(9);
    const copies = reader.doc.getText('copies');
    author.text.insert(0, 'xy');
    const original = firstItem(author.text)!;
    Y.applyUpdate(reader.doc, Y.encodeStateAsUpdate(author.doc));
    // The reader copies the text before the mark of what it copies arrives.
    copies.insert(0, 'xy');
    const copy = firstItem(copies)!;
    textMarksOf(reader.doc).markCopy('move', copy.id.client, copy.id.clock, 2, '7:0');
    expect(textIdentities(copies).ids).toEqual(['7:0', '7:1']);
    const seen: Y.Text[] = [];
    textMarksOf(reader.doc).subscribe((texts) => {
      if (texts !== 'all') seen.push(...texts);
    });
    const vector = Y.encodeStateVector(reader.doc);
    textMarksOf(author.doc).markCopy('restore', original.id.client, original.id.clock, 2, '3:40');
    Y.applyUpdate(reader.doc, Y.encodeStateAsUpdate(author.doc, vector));
    expect(textIdentities(copies).ids).toEqual(['3:40', '3:41']);
    expect(new Set(seen)).toEqual(new Set([reader.text, copies]));
  });

  test("a mark one client writes for another client's text is ignored", () => {
    const victim = docWithText(7);
    const peer = docWithText(9);
    victim.text.insert(0, 'ab');
    Y.applyUpdate(peer.doc, Y.encodeStateAsUpdate(victim.doc));
    // The peer claims the victim's insert is a copy of something of its choosing.
    textMarksOf(peer.doc).markCopy('move', 7, 0, 2, '9:100');
    Y.applyUpdate(victim.doc, Y.encodeStateAsUpdate(peer.doc));
    expect(textIdentities(victim.text).ids).toEqual(['7:0', '7:1']);
    expect(textIdentities(victim.text).moved).toEqual([false, false]);
  });

  test('a mark longer than any insert is ignored', () => {
    const { doc } = docWithText(7);
    const marks = textMarksOf(doc);
    marks.markCopy('move', 7, 0, MAX_MARK_LENGTH + 1, '1:100');
    expect(marks.origin('move', 7, 0)).toBeNull();
  });

  test('marks that branch at every step cost a bounded walk, then their clients read again', () => {
    // Long marks of one client, each naming the client itself at another shift: every step of
    // the walk branches, and an unbounded walk took seconds per update on every replica. The
    // walk stops, and the texts that hold that client's inserts read again, not every text.
    const author = docWithText(7);
    const reader = docWithText(9);
    const heard: (ReadonlySet<Y.Text> | 'all')[] = [];
    textMarksOf(reader.doc).subscribe((texts) => heard.push(texts));
    const marks = textMarksOf(author.doc);
    author.text.insert(0, 'typed');
    author.doc.transact(() => {
      for (let shift = 1; shift <= 12; shift += 1) {
        marks.markCopy('move', 7, shift * 1000, 900_000, `7:${shift * 7}`);
      }
    });
    const started = performance.now();
    Y.applyUpdate(reader.doc, Y.encodeStateAsUpdate(author.doc));
    expect(performance.now() - started).toBeLessThan(1000);
    expect(heard.includes('all')).toBe(false);
    // The one text that holds the client's inserts reads again.
    const read = new Set(heard.flatMap((texts) => (texts === 'all' ? [] : [...texts])));
    expect([...read]).toEqual([reader.doc.getText('t')]);
  });

  test('keys and values a peer writes wrong are ignored', () => {
    const { doc } = docWithText(7);
    const map = doc.getMap<unknown>(TEXT_MARKS_KEY);
    for (const [key, value] of [
      ['o7:0', 'not a mark'],
      ['o7:1', 42],
      ['__proto__', '1:2:3'],
      ['x7:2', '1:2:3'],
      ['o7:3', '1:2:0'],
      ['f7:4', '2|not an anchor'],
      ['o99999999999999999:5', '1:2:3'],
    ] as const) {
      map.set(key, value);
    }
    const marks = textMarksOf(doc);
    for (let clock = 0; clock < 6; clock += 1) {
      expect(marks.origin('move', 7, clock)).toBeNull();
      expect(marks.follow(7, clock)).toBeNull();
    }
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });

  test('a mark over many inserts reads the texts that hold them, not every text', () => {
    const doc = new Y.Doc();
    doc.clientID = 77;
    const marks = textMarksOf(doc);
    const map = doc.getMap<string>(TEXT_MARKS_KEY);
    // Other texts of the document, written by another client.
    doc.clientID = 5;
    for (let at = 0; at < 50; at += 1) doc.getText(`other-${at}`).insert(0, 'text');
    // More separate inserts of one client than one walk reads, all in one text.
    doc.clientID = 77;
    const own = doc.getText('own');
    doc.transact(() => {
      for (let at = 0; at < 5000; at += 1) own.insert(0, 'z');
    });
    const heard: (ReadonlySet<Y.Text> | 'all')[] = [];
    marks.subscribe((texts) => heard.push(texts));
    map.set('o77:0', `1:0:${MAX_MARK_LENGTH}`);
    expect(heard).toHaveLength(1);
    expect(heard[0]).not.toBe('all');
    expect([...(heard[0] as ReadonlySet<Y.Text>)]).toEqual([own]);
  });
});
