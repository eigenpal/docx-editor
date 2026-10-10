/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A peer can name one ID in any number of paragraph texts. Indexing them, and asking how each
// shows the ID, must cost about one step per text, not one step per pair of texts.
import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { asLogicalId } from '../document/identity.ts';
import { DEFAULT_DOCUMENT_LIMITS } from '../document/limits.ts';
import { InlineIndex } from '../document/paragraph-inline-index.ts';

describe('the inline index under many texts that name one ID', () => {
  test('builds and answers in time near linear in the texts', () => {
    const holders = 20_000;
    const doc = new Y.Doc();
    const nodes = doc.getMap<Y.Map<unknown>>('nodes');
    doc.transact(() => {
      for (let at = 0; at < holders; at += 1) {
        const record = new Y.Map<unknown>();
        nodes.set(`p${at}`, record);
        const text = new Y.Text();
        record.set('inline', text);
        text.insert(0, 'a');
        text.insertEmbed(1, { n: 'X' });
      }
    });
    const order = (left: string, right: string): number =>
      left < right ? -1 : left > right ? 1 : 0;
    const index = new InlineIndex(nodes, DEFAULT_DOCUMENT_LIMITS, () => false, order);
    const started = performance.now();
    expect(index.holdersOf('X').size).toBe(holders);
    let tagged = 0;
    for (let at = 0; at < holders; at += 1) {
      if (index.shownId(asLogicalId(`p${at}`), 'X') !== 'X') tagged += 1;
    }
    const elapsed = performance.now() - started;
    // The first holder by ID shows the ID bare; every other shows it tagged.
    expect(tagged).toBe(holders - 1);
    expect(index.shownId(asLogicalId('p0'), 'X')).toBe('X');
    // A walk over every holder for each one took seconds here.
    expect(elapsed).toBeLessThan(1500);
  });
});
