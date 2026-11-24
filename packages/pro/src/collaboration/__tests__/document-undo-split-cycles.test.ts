/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Several undos and redos of tracked concurrent splits, two or three rounds deep. Each undo
// joins the split's text back in order and takes back only its own break, each redo shows what
// the paragraphs showed before its undo, and rejecting every break gives back the text.

import { afterAll, afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { later, ORDERS, rejectAll, room, texts, type Runtime } from './concurrent-split-room';

const registered = !GlobalRegistrator.isRegistered;
if (registered) GlobalRegistrator.register();
afterAll(() => {
  if (registered) GlobalRegistrator.unregister();
});
afterEach(() => setSystemTime());

const TEXT = 'a; b; c; d; e; f; g; h; i; j;';

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

/** Center every paragraph before the signature in one untracked edit. */
const centerAll = (runtime: Runtime) =>
  runtime.run(async (context) => {
    context.document.changeTrackingMode = 'Off';
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items');
    await context.sync();
    for (const paragraph of paragraphs.items.slice(0, -1)) paragraph.alignment = 'Centered';
    await context.sync();
  });

type Who = 'alice' | 'bob';
/** An undo by one participant, or `redo`: a redo by the participant who undid last. */
type Step = Who | 'redo';

const CASES: {
  readonly name: string;
  /** Rounds of concurrent splits: Alice and Bob split the paragraph at `index`. */
  readonly rounds: readonly { index: number; alice: string; bob: string }[];
  readonly steps: readonly Step[];
  readonly shown: readonly string[];
}[] = [
  {
    name: 'Bob undoes both his splits',
    rounds: [
      { index: 0, alice: 'b; ', bob: 'g; ' },
      { index: 1, alice: 'd; ', bob: 'c; ' },
    ],
    steps: ['bob', 'bob'],
    shown: ['a; b; ', 'c; d; ', 'e; f; g; h; i; j;', 'Signed'],
  },
  {
    name: 'Alice undoes both her splits, then Bob undoes his later one',
    rounds: [
      { index: 0, alice: 'b; ', bob: 'g; ' },
      { index: 1, alice: 'd; ', bob: 'c; ' },
    ],
    steps: ['alice', 'alice', 'bob'],
    shown: ['a; b; c; d; e; f; g; ', 'h; i; j;', 'Signed'],
  },
  {
    name: 'three undos, three redos, and the undos again',
    rounds: [
      { index: 0, alice: 'b; ', bob: 'g; ' },
      { index: 1, alice: 'd; ', bob: 'c; ' },
    ],
    steps: ['alice', 'alice', 'bob', 'redo', 'redo', 'redo', 'alice', 'alice', 'bob'],
    shown: ['a; b; c; d; e; f; g; ', 'h; i; j;', 'Signed'],
  },
  {
    name: 'three undos and three redos of splits of one paragraph',
    rounds: [
      { index: 0, alice: 'g; ', bob: 'c; ' },
      { index: 0, alice: 'b; ', bob: 'a; ' },
    ],
    steps: ['alice', 'alice', 'bob', 'redo', 'redo', 'redo'],
    shown: ['a; ', 'b; ', 'c; ', 'd; e; f; g; ', 'h; i; j;', 'Signed'],
  },
  {
    name: 'Bob undoes, redoes, and undoes both his splits',
    rounds: [
      { index: 0, alice: 'g; ', bob: 'c; ' },
      { index: 1, alice: 'd; ', bob: 'e; ' },
    ],
    steps: ['bob', 'bob', 'redo', 'redo', 'bob', 'bob'],
    shown: ['a; b; c; d; ', 'e; f; g; ', 'h; i; j;', 'Signed'],
  },
  {
    // Bob's undos take back the copies of his first break, and Alice's undos list the marks
    // her splits replaced again: those must not show that break again.
    name: 'three rounds deep, Bob undoes his splits first',
    rounds: [
      { index: 0, alice: 'b; ', bob: 'h; ' },
      { index: 1, alice: 'e; ', bob: 'c; ' },
      { index: 3, alice: 'f; ', bob: 'g; ' },
    ],
    steps: ['bob', 'bob', 'bob', 'alice', 'alice', 'alice'],
    shown: [TEXT, 'Signed'],
  },
];

describe('undos and redos of tracked concurrent splits two rounds deep', () => {
  for (const { name, rounds, steps, shown } of CASES)
    for (const formatted of [false, true])
      for (const { label, ids } of ORDERS)
        test(`${name}${formatted ? ', after formatting' : ''} (${label})`, async () => {
          const r = await room(TEXT, ids);
          try {
            for (const { index, alice, bob } of rounds) {
              r.offline();
              later();
              await splitAt(r.alice.runtime, index, alice);
              later();
              await splitAt(r.bob.runtime, index, bob);
              later();
              r.online();
            }
            r.sync();
            if (formatted) {
              later();
              await centerAll(r.carol.runtime);
              r.sync();
            }
            // What each undo found, which its redo shows again.
            const undone: { who: Who; before: string[] }[] = [];
            for (const step of steps) {
              later();
              if (step === 'redo') {
                const last = undone.pop()!;
                expect(r[last.who].room.session.redo()).toBe(true);
                r.sync();
                await r.expectAll(last.before);
              } else {
                undone.push({ who: step, before: await texts(r.carol.runtime) });
                expect(r[step].room.session.undo()).toBe(true);
                r.sync();
              }
            }
            await r.expectAll(shown);
            await r.expectJoinerConverges();
            later();
            await rejectAll(r.carol.runtime);
            r.sync();
            await r.expectAll([TEXT, 'Signed'], 0);
            await r.expectReopens([TEXT, 'Signed']);
          } finally {
            r.close();
          }
        });
});

describe('an undo of a tracked insert of several lines', () => {
  const text = 'a; b; c; d; e; f; g; h;';
  for (const lines of ['X1\nX2', 'X1\nX2\nX3', 'X1\nX2\nX3\nX4', '\nX1\nX2\nX3'])
    for (const { label, ids } of ORDERS)
      test(`of ${JSON.stringify(lines)} leaves no break proposal (${label})`, async () => {
        const r = await room(text, ids);
        try {
          later();
          await r.alice.runtime.run(async (context) => {
            context.document.changeTrackingMode = 'TrackMineOnly';
            const found = context.document.body.search('c;');
            found.load('items');
            await context.sync();
            found.items[0]!.insertText(lines, 'After');
            await context.sync();
          });
          r.sync();
          later();
          expect(r.alice.room.session.undo()).toBe(true);
          r.sync();
          await r.expectAll([text, 'Signed'], 0);
          await r.expectJoinerConverges();
          later();
          expect(r.alice.room.session.redo()).toBe(true);
          r.sync();
          later();
          await rejectAll(r.carol.runtime);
          r.sync();
          await r.expectAll([text, 'Signed'], 0);
        } finally {
          r.close();
        }
      });
});

describe('an undo of a tracked insert of several lines made at the same time as a split', () => {
  const text = 'a; b; c; d; e; f; g; h;';
  for (const lines of ['X1\nX2\nX3', '\n\n'])
    for (const { label, ids } of ORDERS)
      test(`of ${JSON.stringify(lines)} keeps only the split's break (${label})`, async () => {
        const r = await room(text, ids);
        try {
          r.offline();
          later();
          await r.alice.runtime.run(async (context) => {
            context.document.changeTrackingMode = 'TrackMineOnly';
            const found = context.document.body.search('c;');
            found.load('items');
            await context.sync();
            found.items[0]!.insertText(lines, 'After');
            await context.sync();
          });
          later();
          await splitAt(r.bob.runtime, 0, 'f; ');
          later();
          r.online();
          r.sync();
          later();
          expect(r.alice.room.session.undo()).toBe(true);
          r.sync();
          await r.expectAll(['a; b; c; d; e; f; ', 'g; h;', 'Signed'], 1);
          await r.expectJoinerConverges();
          later();
          await rejectAll(r.carol.runtime);
          r.sync();
          await r.expectAll([text, 'Signed'], 0);
        } finally {
          r.close();
        }
      });
});
