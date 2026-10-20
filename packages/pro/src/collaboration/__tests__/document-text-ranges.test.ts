/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A reviewer rewrites a paragraph through word ranges in a collaboration room: `getTextRanges`
// splits it, `expandTo` addresses a run of words, and `getReviewedText` reads the proposal back.
// The reads add no shared state, so these tests check that edits made through their ranges
// converge, survive save and reopen, and read the same on both peers, also while the other
// participant deletes words in the same paragraph, and through undo and redo.
import { afterAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import type { DocxEditorRuntime } from '@docx-editor.dev/editor-api/browser';
import {
  converged,
  direct,
  expectSameDecisions,
  expectSamePeers,
  room,
  tracked,
  type Edit,
} from './tracked-foreign-revisions-support';

const registered = !GlobalRegistrator.isRegistered;
if (registered) GlobalRegistrator.register();
afterAll(() => {
  if (registered) GlobalRegistrator.unregister();
});

const BODY =
  '<w:p><w:r><w:t xml:space="preserve">The fee is due per unit and the buyer agrees promptly.</w:t></w:r>' +
  '<w:r><w:tab/></w:r><w:r><w:t>End</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Second clause.</w:t></w:r></w:p>';

const ORIGINAL = 'The fee is due per unit and the buyer agrees promptly.\tEnd';
const PROPOSED = 'Each charge is due per net unit and buyer agrees promptly.\tEnd';

/**
 * Replace a two-word run, write after a word, and delete a word, by token index from the last
 * index to the first. Each token carries its trailing space.
 */
const rewrite: Edit = tracked(async (c) => {
  const words = c.document.body.paragraphs.getFirst().getTextRanges([' ']);
  words.load('items/text');
  await c.sync();
  expect(words.items[7]!.text).toBe('the ');
  words.items[7]!.delete();
  await c.sync();
  words.items[4]!.insertText('net ', 'After');
  await c.sync();
  words.items[0]!.expandTo(words.items[1]!).insertText('Each charge ', 'Replace');
  await c.sync();
});

async function reviewedOn(runtime: DocxEditorRuntime) {
  return runtime.run(async (c) => {
    const paragraph = c.document.body.paragraphs.getFirst();
    const current = paragraph.getReviewedText('Current');
    const original = paragraph.getReviewedText('Original');
    const words = paragraph.getTextRanges([' '], true);
    words.load('items/text');
    await c.sync();
    return {
      current: current.value,
      original: original.value,
      words: words.items.map((range) => range.text),
    };
  });
}

test('a rewrite through word ranges converges and reads the same on both peers', async () => {
  const r = await room('reviewer first', BODY);
  try {
    r.pair.pause();
    await r.peers[0]!.runtime.run(rewrite);
    await r.peers[1]!.runtime.run(
      direct('Second', (range) => range.insertText('Third', 'Replace'))
    );
    r.sync();
    r.pair.resume();
    r.sync();
    await converged(r);
    await expectSamePeers(r);
    const [left, right] = await Promise.all(r.peers.map(({ runtime }) => reviewedOn(runtime)));
    expect(left).toEqual(right!);
    expect(left!.current).toBe(PROPOSED);
    expect(left!.original).toBe(ORIGINAL);
    expect(await expectSameDecisions(r)).toEqual([
      `${ORIGINAL}\rThird clause.`,
      `${PROPOSED}\rThird clause.`,
    ]);
  } finally {
    r.close();
  }
});

test('a rewrite converges while the other participant deletes a word the rewrite does not touch', async () => {
  const r = await room('reviewer first', BODY);
  try {
    r.pair.pause();
    await r.peers[0]!.runtime.run(rewrite);
    await r.peers[1]!.runtime.run(direct('due ', (range) => range.delete()));
    r.sync();
    r.pair.resume();
    r.sync();
    await converged(r);
    await expectSamePeers(r);
    const [left, right] = await Promise.all(r.peers.map(({ runtime }) => reviewedOn(runtime)));
    expect(left).toEqual(right!);
    expect(left!.current).toBe(PROPOSED.replace('due ', ''));
    expect(left!.original).toBe(ORIGINAL.replace('due ', ''));
    await expectSameDecisions(r);
  } finally {
    r.close();
  }
});

test('undo and redo of a run replaced through expandTo converge on both peers', async () => {
  const r = await room('reviewer first', BODY);
  try {
    const before = await converged(r);
    await r.peers[0]!.runtime.run(
      tracked(async (c) => {
        const tokens = c.document.body.paragraphs.getFirst().getTextRanges([' '], true);
        tokens.load('items');
        await c.sync();
        tokens.items[0]!.expandTo(tokens.items[1]!).insertText('Each charge', 'Replace');
        await c.sync();
      })
    );
    r.sync();
    const written = await converged(r);
    expect(written).not.toBe(before);
    expect((await reviewedOn(r.peers[1]!.runtime)).current).toStartWith('Each charge is due');

    expect(r.peers[0]!.editor.exec({ type: 'undo' }).ok).toBe(true);
    r.sync();
    expect(await converged(r)).toBe(before);
    expect((await reviewedOn(r.peers[1]!.runtime)).current).toBe(ORIGINAL);

    expect(r.peers[0]!.editor.exec({ type: 'redo' }).ok).toBe(true);
    r.sync();
    expect(await converged(r)).toBe(written);
  } finally {
    r.close();
  }
});
