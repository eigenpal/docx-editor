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
import { strFromU8, unzipSync } from 'fflate';
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

/** Center or indent paragraph `index` without tracking. */
const format = (runtime: Runtime, index: number, property: 'alignment' | 'leftIndent') =>
  runtime.run(async (context) => {
    context.document.changeTrackingMode = 'Off';
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items');
    await context.sync();
    if (property === 'alignment') paragraphs.items[index]!.alignment = 'Centered';
    else paragraphs.items[index]!.leftIndent = 36;
    await context.sync();
  });

/** Format every paragraph before the signature, one edit each. */
async function formatEach(
  runtime: Runtime,
  count: number,
  property: 'alignment' | 'leftIndent',
  sync: () => void
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    later();
    await format(runtime, index, property);
    sync();
  }
}

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

/** How many `w:ind` the saved document holds. */
async function savedIndents(editor: { save(): Promise<ArrayBuffer | Uint8Array> }) {
  const saved = unzipSync(new Uint8Array(await editor.save()));
  return strFromU8(saved['word/document.xml']!).match(/<w:ind /g)?.length ?? 0;
}

/** Each round in turn: Alice and Bob split paragraph `index` offline, then reconnect. */
async function splitRounds(r: Room, rounds: Rounds['rounds']): Promise<void> {
  for (const { index, alice, bob } of rounds) {
    r.offline();
    await splitAt(r.alice.runtime, index, alice);
    later();
    if (bob) await splitAt(r.bob.runtime, index, bob);
    later();
    r.online();
  }
  r.sync();
}

describe('formatting paragraphs whose break proposals show on another paragraph', () => {
  for (const { name, rounds, split, Bob } of [ROUNDS[0]!, ROUNDS[2]!])
    for (const { label, ids } of ORDERS) {
      const count = split.length - 1;
      test(`${name}: every break stays pending (${label})`, async () => {
        const r = await room(TEXT, ids);
        try {
          await splitRounds(r, rounds);
          const pending = await revisionCount(r.carol.runtime);
          // The edit lands on each paragraph's shown properties, a moved proposal included.
          await formatEach(r.carol.runtime, count, 'alignment', r.sync);
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

      test(`${name}: an undo keeps every break and another participant's formatting (${label})`, async () => {
        const r = await room(TEXT, ids);
        try {
          await splitRounds(r, rounds);
          const pending = await revisionCount(r.carol.runtime);
          await formatEach(r.carol.runtime, count, 'alignment', r.sync);
          await formatEach(r.alice.runtime, count, 'leftIndent', r.sync);
          for (let step = 0; step < count; step += 1) {
            expect(r.carol.room.session.undo()).toBe(true);
            r.sync();
          }
          await r.expectAll(split, pending);
          expect(await savedIndents(r.carol.editor)).toBe(count);
          await r.expectJoinerConverges();
          later();
          await rejectBy(r.carol.runtime, 'Bob');
          r.sync();
          await r.expectAll(Bob);
        } finally {
          r.close();
        }
      });

      test(`${name}: an undo after concurrent formatting keeps every break (${label})`, async () => {
        const r = await room(TEXT, ids);
        try {
          await splitRounds(r, rounds);
          const pending = await revisionCount(r.carol.runtime);
          r.offline();
          await formatEach(r.carol.runtime, count, 'alignment', () => {});
          await formatEach(r.bob.runtime, count, 'alignment', () => {});
          r.online();
          r.sync();
          await r.expectAll(split, pending);
          for (let step = 0; step < count; step += 1) {
            expect(r.carol.room.session.undo()).toBe(true);
            r.sync();
          }
          await r.expectAll(split, pending);
          await r.expectJoinerConverges();
          later();
          await rejectBy(r.carol.runtime, 'Bob');
          r.sync();
          await r.expectAll(Bob);
        } finally {
          r.close();
        }
      });
    }
});

describe('an undo of one concurrent split of a paragraph that proposes its own break', () => {
  const cases = [
    {
      undoes: 'bob',
      shown: ['a; b; ', 'c; d; e; f; g; ', 'h; i; j;', 'Signed'],
      other: 'Alice',
      kept: [TEXT, 'Signed'],
    },
    {
      undoes: 'alice',
      shown: ['a; b; c; d; e; ', 'f; g; ', 'h; i; j;', 'Signed'],
      other: 'Bob',
      kept: ['a; b; c; d; e; f; g; ', 'h; i; j;', 'Signed'],
    },
  ] as const;
  for (const { undoes, shown, other, kept } of cases)
    for (const finish of ['other', 'all'] as const)
      for (const { label, ids } of ORDERS)
        test(`${undoes} undoes, then reject ${finish === 'all' ? 'all' : other} (${label})`, async () => {
          const r = await room(TEXT, ids);
          try {
            await splitRounds(r, [
              { index: 0, alice: 'g; ' },
              { index: 0, alice: 'b; ', bob: 'e; ' },
            ]);
            later();
            expect(r[undoes].room.session.undo()).toBe(true);
            r.sync();
            await r.expectAll(shown);
            await r.expectJoinerConverges();
            later();
            if (finish === 'all') await rejectAll(r.carol.runtime);
            else await rejectBy(r.carol.runtime, other);
            r.sync();
            await r.expectAll(finish === 'all' ? [TEXT, 'Signed'] : kept);
          } finally {
            r.close();
          }
        });
});

describe("an undo of a split whose paragraph shows another author's proposal", () => {
  const PROPERTIES = [
    { name: 'no properties', xml: '' },
    { name: 'paragraph properties', xml: '<w:pPr><w:jc w:val="right"/></w:pPr>' },
  ];
  for (const formatter of ['bob', 'carol'] as const)
    for (const { name, xml } of PROPERTIES)
      for (const { label, ids } of ORDERS) {
        /** Alice and Bob split; the formatter's edit lists Alice's proposal in Bob's paragraph. */
        const prepare = async () => {
          const r = await room(TEXT, ids, xml);
          await splitRounds(r, [{ index: 0, alice: 'g; ', bob: 'c; ' }]);
          later();
          await format(r[formatter].runtime, 0, 'alignment');
          r.sync();
          if (formatter === 'bob') {
            expect(r.bob.room.session.undo()).toBe(true);
            r.sync();
          }
          later();
          expect(r.bob.room.session.undo()).toBe(true);
          r.sync();
          return r;
        };

        test(`${formatter} formats, Bob undoes his split, ${name} (${label})`, async () => {
          const r = await prepare();
          try {
            await r.expectAll(['a; b; c; d; e; f; g; ', 'h; i; j;', 'Signed'], 1);
            await r.expectJoinerConverges();
            later();
            await rejectAll(r.carol.runtime);
            r.sync();
            await r.expectAll([TEXT, 'Signed'], 0);
          } finally {
            r.close();
          }
        });

        test(`${formatter} formats, Bob undoes and redoes his split, ${name} (${label})`, async () => {
          const r = await prepare();
          try {
            expect(r.bob.room.session.redo()).toBe(true);
            r.sync();
            await r.expectAll(['a; b; c; ', 'd; e; f; g; ', 'h; i; j;', 'Signed'], 2);
            await r.expectJoinerConverges();
            later();
            await rejectBy(r.carol.runtime, 'Alice');
            r.sync();
            await r.expectAll(['a; b; c; ', 'd; e; f; g; h; i; j;', 'Signed'], 1);
            later();
            await rejectBy(r.carol.runtime, 'Bob');
            r.sync();
            await r.expectAll([TEXT, 'Signed'], 0);
          } finally {
            r.close();
          }
        });
      }
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

describe('an undo of splits after another participant formats every paragraph', () => {
  const cases = [
    {
      name: 'a split of a paragraph that proposes its own break',
      rounds: [
        { index: 0, alice: 'g; ' },
        { index: 0, alice: 'b; ', bob: 'd; ' },
      ],
      undos: 1,
      shown: ['a; b; ', 'c; d; e; f; g; ', 'h; i; j;', 'Signed'],
    },
    {
      name: 'two rounds of splits',
      rounds: [
        { index: 0, alice: 'g; ', bob: 'c; ' },
        { index: 1, alice: 'd; ', bob: 'e; ' },
      ],
      undos: 2,
      shown: ['a; b; c; d; ', 'e; f; g; ', 'h; i; j;', 'Signed'],
    },
  ];
  for (const { name, rounds, undos, shown } of cases)
    for (const redo of [false, true])
      for (const { label, ids } of ORDERS)
        test(`Bob undoes ${name}${redo ? ', redoes, and undoes' : ''} (${label})`, async () => {
          const r = await room(TEXT, ids);
          const undo = () => {
            later();
            expect(r.bob.room.session.undo()).toBe(true);
            r.sync();
          };
          try {
            await splitRounds(r, rounds);
            later();
            await centerAll(r.carol.runtime);
            r.sync();
            for (let step = 0; step < undos; step += 1) undo();
            if (redo) {
              later();
              expect(r.bob.room.session.redo()).toBe(true);
              r.sync();
              undo();
            }
            // One revision groups Alice's breaks; one reject removes every break.
            await r.expectAll(shown, 1);
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
