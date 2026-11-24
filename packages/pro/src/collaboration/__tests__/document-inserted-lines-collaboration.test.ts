/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// An insert of several lines next to another participant's edits: the lines keep their order
// beside a concurrent split, text typed after them keeps its place when they are undone, and
// an undo of them takes back only their own breaks.

import { afterAll, afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { later, ORDERS, rejectAll, room, type Runtime } from './concurrent-split-room';

const registered = !GlobalRegistrator.isRegistered;
if (registered) GlobalRegistrator.register();
afterAll(() => {
  if (registered) GlobalRegistrator.unregister();
});
afterEach(() => setSystemTime());

const TEXT = 'a; b; c; d; e; f; g; h;';
type Mode = 'TrackMineOnly' | 'Off';

/** Insert `text` after the first match of `find` in paragraph `index`. */
const insertAfter = (runtime: Runtime, index: number, find: string, text: string, mode: Mode) =>
  runtime.run(async (context) => {
    context.document.changeTrackingMode = mode;
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items');
    await context.sync();
    const found = paragraphs.items[index]!.search(find);
    found.load('items');
    await context.sync();
    found.items[0]!.insertText(text, 'After');
    await context.sync();
  });

/** Split the paragraph at `index` after `delimiter`, as a tracked change. */
const splitAt = (runtime: Runtime, index: number, delimiter: string) =>
  runtime.run(async (context) => {
    context.document.changeTrackingMode = 'TrackMineOnly';
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items');
    await context.sync();
    paragraphs.items[index]!.split([delimiter]);
    await context.sync();
  });

/** The paragraphs of `TEXT` with `lines` inserted after `c;` and a break after `split`. */
function expectedWith(lines: string, split: string): string[] {
  const out: string[] = [];
  for (const part of `a; b; c;${lines} d; e; f; g; h;`.split('\n')) {
    const at = part.indexOf(split);
    if (at < 0) out.push(part);
    else out.push(part.slice(0, at + split.length), part.slice(at + split.length));
  }
  return [...out, 'Signed'];
}

describe('an insert of several lines made at the same time as a split', () => {
  const cases = [
    ...['X1\nX2\nX3', '\n\n', 'X1\nX2\nX3\nX4'].map((lines) => ({ lines, split: 'f; ' })),
    ...['X1\nX2\nX3', 'X1\nX2', '\n'].map((lines) => ({ lines, split: 'h;' })),
  ];
  for (const { lines, split } of cases)
    for (const mode of ['TrackMineOnly', 'Off'] as const)
      for (const { label, ids } of ORDERS)
        test(`of ${JSON.stringify(lines)} ${mode}, split after ${JSON.stringify(split)} (${label})`, async () => {
          const r = await room(TEXT, ids);
          try {
            r.offline();
            later();
            await insertAfter(r.alice.runtime, 0, 'c;', lines, mode);
            later();
            await splitAt(r.bob.runtime, 0, split);
            later();
            r.online();
            r.sync();
            await r.expectAll(expectedWith(lines, split));
            await r.expectJoinerConverges();
            if (mode === 'Off') return;
            later();
            await rejectAll(r.carol.runtime);
            r.sync();
            await r.expectAll([TEXT, 'Signed'], 0);
          } finally {
            r.close();
          }
        });
});

describe('text typed after inserted lines, then an undo of the lines', () => {
  for (const mode of ['TrackMineOnly', 'Off'] as const)
    for (const redone of [false, true])
      for (const { label, ids } of ORDERS)
        test(`keeps its place ${mode}${redone ? ' after an undo and a redo' : ''} (${label})`, async () => {
          const r = await room(TEXT, ids);
          try {
            later();
            await insertAfter(r.alice.runtime, 0, 'c;', 'X1\nX2\nX3', mode);
            r.sync();
            if (redone) {
              later();
              expect(r.alice.room.session.undo()).toBe(true);
              r.sync();
              later();
              expect(r.alice.room.session.redo()).toBe(true);
              r.sync();
            }
            later();
            await insertAfter(r.bob.runtime, 2, 'X3', 'B', mode);
            r.sync();
            later();
            expect(r.alice.room.session.undo()).toBe(true);
            r.sync();
            // Bob's tracked letter is the one revision left.
            const revisions = mode === 'Off' ? 0 : 1;
            await r.expectAll(['a; b; c;B d; e; f; g; h;', 'Signed'], revisions);
            await r.expectJoinerConverges();
            await r.expectReopens(['a; b; c;B d; e; f; g; h;', 'Signed'], revisions);
          } finally {
            r.close();
          }
        });
});

describe('an undo of an insert of empty lines that a participant split inside', () => {
  for (const lines of ['\n', '\n\n', '\n\n\n'])
    for (const split of ['a; ', 'b; '])
      for (const { label, ids } of ORDERS)
        test(`of ${JSON.stringify(lines)}, split after ${JSON.stringify(split)}, keeps only that split's break (${label})`, async () => {
          const r = await room(TEXT, ids);
          try {
            later();
            await insertAfter(r.alice.runtime, 0, 'c;', lines, 'TrackMineOnly');
            r.sync();
            later();
            await splitAt(r.bob.runtime, 0, split);
            r.sync();
            later();
            expect(r.alice.room.session.undo()).toBe(true);
            r.sync();
            const at = TEXT.indexOf(split) + split.length;
            await r.expectAll([TEXT.slice(0, at), TEXT.slice(at), 'Signed'], 1);
            await r.expectJoinerConverges();
            later();
            await rejectAll(r.carol.runtime);
            r.sync();
            await r.expectAll([TEXT, 'Signed'], 0);
          } finally {
            r.close();
          }
        });
});
