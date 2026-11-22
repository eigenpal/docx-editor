/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Tracked concurrent splits of a paragraph that an earlier concurrent split created. Every
// break proposal shows on the paragraph that holds its split point, so rejecting all of them,
// or the breaks of one author, gives back the text in order.

import { afterAll, afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import type * as Y from 'yjs';
import { DocumentRegistry, isElementRecord } from '../document/index.ts';
import {
  later,
  ORDERS,
  rejectAll,
  revisionCount,
  room,
  type Runtime,
} from './concurrent-split-room';

const registered = !GlobalRegistrator.isRegistered;
if (registered) GlobalRegistrator.register();
afterAll(() => {
  if (registered) GlobalRegistrator.unregister();
});
afterEach(() => setSystemTime());

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

/** Reject the tracked changes of one author. */
const rejectBy = (runtime: Runtime, author: string) =>
  runtime.run(async (context) => {
    const revisions = context.document.body.revisions;
    revisions.load('items/author');
    await context.sync();
    for (const revision of revisions.items) if (revision.author === author) revision.reject();
    await context.sync();
  });

type Room = Awaited<ReturnType<typeof room>>;

/** Alice and Bob each split the paragraph at `index` while offline, then reconnect. */
async function both(r: Room, index: number, first: string, second: string): Promise<void> {
  r.offline();
  await splitAt(r.alice.runtime, index, first);
  later();
  await splitAt(r.bob.runtime, index, second);
  later();
  r.online();
}

describe('tracked concurrent splits of a piece inside an earlier concurrent run', () => {
  for (const { label, ids } of ORDERS)
    test(`every break keeps text order and rejects cleanly (${label})`, async () => {
      const r = await room('ab; cd; e; f; g; h', ids);
      try {
        await both(r, 0, 'ab; ', 'cd; ');
        await splitAt(r.alice.runtime, 2, 'g; ');
        r.sync();
        later();
        await both(r, 2, 'e; ', 'f; ');
        // Breaks one author proposes next to each other form one revision.
        const split = ['ab; ', 'cd; ', 'e; ', 'f; ', 'g; ', 'h', 'Signed'];
        await r.expectAll(split, 3);
        await r.expectReopens(split, 3);
        await r.expectJoinerConverges();
        later();
        await rejectAll(r.carol.runtime);
        r.sync();
        await r.expectAll(['ab; cd; e; f; g; h', 'Signed'], 0);
      } finally {
        r.close();
      }
    });

  for (const { label, ids } of ORDERS)
    test(`rejecting one author's breaks keeps the other author's text in order (${label})`, async () => {
      const r = await room('a; b; c; d; e; f; g; h; i; j;', ids);
      try {
        await both(r, 0, 'g; ', 'c; ');
        await both(r, 2, 'h; ', 'i; ');
        await r.expectAll(['a; b; c; ', 'd; e; f; g; ', 'h; ', 'i; ', 'j;', 'Signed']);
        later();
        await rejectBy(r.carol.runtime, 'Bob');
        r.sync();
        await r.expectAll(['a; b; c; d; e; f; g; ', 'h; ', 'i; j;', 'Signed']);
      } finally {
        r.close();
      }
    });
});

/** Rounds of splits of `TEXT`: in each, `alice` and `bob` split paragraph `index`. */
interface Rounds {
  readonly name: string;
  readonly rounds: readonly { index: number; alice: string; bob?: string }[];
  /** All the pieces, then the pieces after rejecting Alice's breaks, then Bob's. */
  readonly split: readonly string[];
  readonly Alice: readonly string[];
  readonly Bob: readonly string[];
}

const TEXT = 'a; b; c; d; e; f; g; h; i; j;';
const ROUNDS: readonly Rounds[] = [
  {
    // Each new paragraph copies the earlier break proposal of the paragraph it came from.
    name: 'concurrent splits of a paragraph that proposes its own break',
    rounds: [
      { index: 0, alice: 'g; ' },
      { index: 0, alice: 'b; ', bob: 'd; ' },
    ],
    split: ['a; b; ', 'c; d; ', 'e; f; g; ', 'h; i; j;', 'Signed'],
    Alice: ['a; b; c; d; ', 'e; f; g; h; i; j;', 'Signed'],
    Bob: ['a; b; ', 'c; d; e; f; g; ', 'h; i; j;', 'Signed'],
  },
  {
    name: 'concurrent splits of the first piece of an earlier concurrent run',
    rounds: [
      { index: 0, alice: 'g; ', bob: 'c; ' },
      { index: 0, alice: 'b; ', bob: 'a; ' },
    ],
    split: ['a; ', 'b; ', 'c; ', 'd; e; f; g; ', 'h; i; j;', 'Signed'],
    Alice: ['a; ', 'b; c; ', 'd; e; f; g; h; i; j;', 'Signed'],
    Bob: ['a; b; ', 'c; d; e; f; g; ', 'h; i; j;', 'Signed'],
  },
  {
    name: 'concurrent splits of a middle piece of an earlier concurrent run',
    rounds: [
      { index: 0, alice: 'g; ', bob: 'c; ' },
      { index: 1, alice: 'd; ', bob: 'e; ' },
    ],
    split: ['a; b; c; ', 'd; ', 'e; ', 'f; g; ', 'h; i; j;', 'Signed'],
    Alice: ['a; b; c; ', 'd; e; ', 'f; g; h; i; j;', 'Signed'],
    Bob: ['a; b; c; d; ', 'e; f; g; ', 'h; i; j;', 'Signed'],
  },
  {
    // Rejecting Alice's breaks joins the piece Bob split into the paragraph before it.
    name: 'concurrent splits of a middle piece split off by the other author',
    rounds: [
      { index: 0, alice: 'b; ', bob: 'g; ' },
      { index: 1, alice: 'd; ', bob: 'c; ' },
    ],
    split: ['a; b; ', 'c; ', 'd; ', 'e; f; g; ', 'h; i; j;', 'Signed'],
    Alice: ['a; b; c; ', 'd; e; f; g; ', 'h; i; j;', 'Signed'],
    Bob: ['a; b; ', 'c; d; ', 'e; f; g; h; i; j;', 'Signed'],
  },
  {
    // A run's members listed after a later split of one of them are not shown next to it.
    name: 'concurrent splits after nested and sequential splits',
    rounds: [
      { index: 0, alice: 'g; ', bob: 'b; ' },
      { index: 1, alice: 'c; ', bob: 'd; ' },
      { index: 3, alice: 'f; ' },
      { index: 5, alice: 'h; ', bob: 'i; ' },
    ],
    split: ['a; b; ', 'c; ', 'd; ', 'e; f; ', 'g; ', 'h; ', 'i; ', 'j;', 'Signed'],
    Alice: ['a; b; ', 'c; d; ', 'e; f; g; h; i; ', 'j;', 'Signed'],
    Bob: ['a; b; c; ', 'd; e; f; ', 'g; ', 'h; ', 'i; j;', 'Signed'],
  },
];

describe('rejecting tracked breaks after several rounds of splits', () => {
  for (const { name, rounds, split, ...kept } of ROUNDS)
    for (const author of ['Alice', 'Bob', 'every author'] as const)
      for (const { label, ids } of ORDERS)
        test(`${name}: reject ${author} (${label})`, async () => {
          const r = await room(TEXT, ids);
          try {
            for (const { index, alice, bob } of rounds) {
              r.offline();
              await splitAt(r.alice.runtime, index, alice);
              later();
              if (bob) await splitAt(r.bob.runtime, index, bob);
              later();
              r.online();
            }
            r.sync();
            await r.expectAll(split);
            await r.expectJoinerConverges();
            later();
            if (author === 'every author') await rejectAll(r.carol.runtime);
            else await rejectBy(r.carol.runtime, author);
            r.sync();
            const expected = author === 'every author' ? [TEXT, 'Signed'] : kept[author];
            await r.expectAll(expected);
            await r.expectReopens(expected, await revisionCount(r.carol.runtime));
            await r.expectJoinerConverges();
            // Every break the other author proposed is still a pending change.
            later();
            await rejectAll(r.carol.runtime);
            r.sync();
            await r.expectAll([TEXT, 'Signed'], 0);
          } finally {
            r.close();
          }
        });
});

/** Center paragraph `index` without tracking. */
const center = (runtime: Runtime, index: number) =>
  runtime.run(async (context) => {
    context.document.changeTrackingMode = 'Off';
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items');
    await context.sync();
    paragraphs.items[index]!.alignment = 'Centered';
    await context.sync();
  });

/** How many `w:pPr` each body paragraph lists in shared state. */
function listedProperties(ydoc: Y.Doc): number[] {
  const registry = new DocumentRegistry(ydoc);
  try {
    const ids = [...registry.schema.nodes.keys()] as Parameters<typeof registry.record>[0][];
    const body = registry.record(ids.find((id) => registry.record(id)?.kind === 'body')!);
    if (!body || !isElementRecord(body)) return [];
    return body.childIds.map((id) => {
      const paragraph = registry.record(id);
      if (!paragraph || !isElementRecord(paragraph)) return 0;
      return paragraph.childIds.filter((child) => registry.kindOf(child) === 'paragraphProperties')
        .length;
    });
  } finally {
    registry.destroy();
  }
}

describe('formatting paragraphs whose break proposals show on another paragraph', () => {
  for (const { name, rounds, split, Bob } of [ROUNDS[0]!, ROUNDS[2]!])
    for (const { label, ids } of ORDERS)
      test(`${name}: every break stays pending (${label})`, async () => {
        const r = await room(TEXT, ids);
        try {
          for (const { index, alice, bob } of rounds) {
            r.offline();
            await splitAt(r.alice.runtime, index, alice);
            later();
            if (bob) await splitAt(r.bob.runtime, index, bob);
            later();
            r.online();
          }
          r.sync();
          const pending = await revisionCount(r.carol.runtime);
          // The edit lands on each paragraph's shown properties, a moved proposal included.
          for (let index = 0; index < split.length - 1; index += 1) {
            later();
            await center(r.carol.runtime, index);
            r.sync();
          }
          await r.expectAll(split, pending);
          // Each edit listed the proposals where they show, and removed the copies they replace.
          expect(Math.max(...listedProperties(r.carol.ydoc))).toBe(1);
          await r.expectJoinerConverges();
          later();
          await rejectBy(r.carol.runtime, 'Bob');
          r.sync();
          await r.expectAll(Bob);
        } finally {
          r.close();
        }
      });
});
