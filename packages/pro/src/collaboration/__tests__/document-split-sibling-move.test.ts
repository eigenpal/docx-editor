/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Two peers split one paragraph at once, so the text after both split points has a copy in
// both new paragraphs. A peer that then moves one of the new paragraphs must not change which
// paragraph shows that text: the paragraph moved below the other one showed both tails, the
// other one showed nothing, and a later split of the moved paragraph joined the text of both.
// Every case checks the text each peer shows, not only that the peers agree.

import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import * as Y from 'yjs';
import {
  findNode,
  readOoxmlPackage,
  replaceChildren,
  withPart,
  writeOoxmlPackage,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import {
  BODY,
  createPeerHarness,
  nodeText,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';

type Harness = ReturnType<typeof createPeerHarness>;
type Element = Exclude<OoxmlNode, { kind: 'textValue' }>;

let now = 1_800_000_000_000;
/** Move the clock on, so each edit is its own undo step. */
const later = (): void => {
  now += 2_000;
  setSystemTime(new Date(now));
};

let harness: Harness | null = null;
afterEach(() => {
  harness?.cleanup();
  harness = null;
  setSystemTime();
});

const paragraph = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const DOCUMENT = zipDocument(['One; two; three', 'Z'].map(paragraph).join('') + '<w:sectPr/>');
/** What both peers show once Alice's split at 5 and Bob's split at 10 meet. */
const SPLIT = ['One; ', 'two; ', 'three', 'Z'];

function bodyOf(peer: Peer): Element {
  const root = peer.store.bodyStore().part.root;
  const body = root.children.find((node) => node.kind !== 'textValue' && node.localName === 'body');
  if (!body || body.kind === 'textValue') throw new Error('no body');
  return body;
}

/** The body's paragraphs by text, as the peer shows them. */
const order = (peer: Peer): string[] =>
  bodyOf(peer)
    .children.filter((node) => node.kind === 'paragraph')
    .map((node) => nodeText(node));

function idOf(peer: Peer, text: string): string {
  const found = bodyOf(peer).children.find(
    (node) => node.kind === 'paragraph' && nodeText(node) === text
  );
  if (!found) throw new Error(`no paragraph ${JSON.stringify(text)} in ${order(peer)}`);
  return found.id;
}

/** Move the paragraph `name` to index `to` of the body, in one child-list replacement. */
function move(peer: Peer, name: string, to: number): void {
  const id = idOf(peer, name);
  const result = peer.store.transact(BODY, (context) =>
    context.applyPackage((pkg) => {
      const part = pkg.parts.get(pkg.mainDocumentPart)!;
      const body = findNode(part, bodyOf(peer).id) as Element;
      const children = [...body.children];
      const [block] = children.splice(
        children.findIndex((child) => child.id === id),
        1
      );
      children.splice(to, 0, block!);
      const edited = replaceChildren(part, body.id, children);
      if (!edited.ok) throw new Error('move refused');
      return withPart(pkg, edited.part);
    })
  );
  if (!result.ok) throw new Error(result.reason);
  peer.port.flushPendingJournals();
  later();
}

function split(h: Harness, peer: Peer, name: string, offset: number): void {
  h.apply(peer, [{ op: 'splitParagraph', paragraphId: idOf(peer, name), offset }]);
  later();
}

function typeAt(h: Harness, peer: Peer, name: string, offset: number, text: string): void {
  h.apply(peer, [{ op: 'insertText', paragraphId: idOf(peer, name), offset, text }]);
  later();
}

/** The paragraphs a saved copy of the peer's document shows when it is opened again. */
function reopened(h: Harness, peer: Peer): string[] {
  const loaded = readOoxmlPackage(writeOoxmlPackage(h.packageOf(peer)));
  if (!loaded.ok) throw new Error(loaded.reason);
  const texts: string[] = [];
  walk(loaded.package.parts.get(loaded.package.mainDocumentPart)!.root, (node) => {
    if (node.kind === 'paragraph') texts.push(nodeText(node));
  });
  return texts;
}

function expectShown(h: Harness, peers: readonly Peer[], expected: readonly string[]): void {
  for (const peer of peers) expect(order(peer)).toEqual([...expected]);
  for (let at = 1; at < peers.length; at += 1) h.expectConverged(peers[0]!, peers[at]!);
}

/** Both concurrent insert orders, with and without Yjs garbage collection. */
const VARIANTS = [
  { label: 'alice first', ids: { alice: 1_000, bob: 2_000 }, gc: true },
  { label: 'bob first', ids: { alice: 3_000, bob: 2_000 }, gc: true },
  { label: 'alice first, no gc', ids: { alice: 1_000, bob: 2_000 }, gc: false },
  { label: 'bob first, no gc', ids: { alice: 3_000, bob: 2_000 }, gc: false },
];

/** Alice splits at 5 while Bob splits at 10, and the splits meet. */
async function concurrentSplits(variant: (typeof VARIANTS)[number]) {
  later();
  const h = createPeerHarness(
    'split-sibling-move',
    { offlineEditing: true },
    variant.ids,
    variant.gc
  );
  harness = h;
  const pair = await h.pair(DOCUMENT);
  pair.pause();
  split(h, pair.alice, 'One; two; three', 5);
  split(h, pair.bob, 'One; two; three', 10);
  pair.resume();
  expectShown(h, [pair.alice, pair.bob], SPLIT);
  return { h, ...pair };
}

for (const variant of VARIANTS) {
  describe(`a moved split sibling keeps its own text (${variant.label})`, () => {
    test('moving the earlier sibling to the end', async () => {
      const { h, alice, bob } = await concurrentSplits(variant);
      move(alice, 'two; ', 3);
      expectShown(h, [alice, bob], ['One; ', 'three', 'Z', 'two; ']);
      expect(reopened(h, bob)).toEqual(['One; ', 'three', 'Z', 'two; ']);
    });

    test('moving the later sibling above the earlier one', async () => {
      const { h, alice, bob } = await concurrentSplits(variant);
      move(bob, 'three', 1);
      expectShown(h, [alice, bob], ['One; ', 'three', 'two; ', 'Z']);
    });

    test('moving either sibling to the start', async () => {
      const { h, alice, bob } = await concurrentSplits(variant);
      move(alice, 'three', 0);
      expectShown(h, [alice, bob], ['three', 'One; ', 'two; ', 'Z']);
      move(bob, 'two; ', 0);
      expectShown(h, [alice, bob], ['two; ', 'three', 'One; ', 'Z']);
    });

    test('moving the earlier sibling to the end, then splitting it', async () => {
      const { h, alice, bob } = await concurrentSplits(variant);
      move(alice, 'two; ', 3);
      split(h, bob, 'two; ', 2);
      expectShown(h, [alice, bob], ['One; ', 'three', 'Z', 'tw', 'o; ']);
      typeAt(h, alice, 'tw', 2, '!');
      expectShown(h, [alice, bob], ['One; ', 'three', 'Z', 'tw!', 'o; ']);
    });

    test('splitting the earlier sibling, then moving its first half to the end', async () => {
      const { h, alice, bob } = await concurrentSplits(variant);
      split(h, alice, 'two; ', 2);
      expectShown(h, [alice, bob], ['One; ', 'tw', 'o; ', 'three', 'Z']);
      move(bob, 'tw', 4);
      expectShown(h, [alice, bob], ['One; ', 'o; ', 'three', 'Z', 'tw']);
      move(alice, 'three', 0);
      expectShown(h, [alice, bob], ['three', 'One; ', 'o; ', 'Z', 'tw']);
    });

    test('a move to the end racing a split of the moved paragraph', async () => {
      const pair = await concurrentSplits(variant);
      const { h, alice, bob } = pair;
      const log: { from: 'alice' | 'bob'; update: Uint8Array }[] = [];
      for (const [from, peer] of [
        ['alice', alice],
        ['bob', bob],
      ] as const) {
        peer.ydoc.on('update', (update: Uint8Array, origin: unknown) => {
          if (origin !== 'relay' && origin !== 'join') log.push({ from, update });
        });
      }
      const dave = await h.joinDetached(alice, 'dave');
      const merged = ['One; ', 'o; ', 'three', 'Z', 'tw'];
      const paused = racing(pair, () => {
        move(alice, 'two; ', 3);
        split(h, bob, 'two; ', 2);
      });
      expect(paused.alice).toEqual(['One; ', 'three', 'Z', 'two; ']);
      expect(paused.bob).toEqual(['One; ', 'tw', 'o; ', 'three', 'Z']);
      expectShown(h, [alice, bob], merged);
      expect(reopened(h, alice)).toEqual(merged);

      // Late peers that receive the edits in any order show the same text.
      const deliveries = {
        natural: log.map((entry) => entry.update),
        reversed: log.map((entry) => entry.update).reverse(),
        bobFirst: [
          ...log.filter((entry) => entry.from === 'bob'),
          ...log.filter((entry) => entry.from === 'alice'),
        ].map((entry) => entry.update),
      };
      for (const [name, updates] of Object.entries(deliveries)) {
        const late = await h.joinDetached(dave, `late-${name}`);
        for (const update of updates) Y.applyUpdate(late.ydoc, update, 'relay');
        late.port.flushPendingJournals();
        expectShown(h, [alice, late], merged);
      }
      const fresh = await h.join(alice, 'fresh');
      expectShown(h, [alice, bob, fresh], merged);

      // A peer that mounts its document again reads the same shared state.
      const remounted = await h.remount(bob);
      expectShown(h, [alice, remounted], merged);
    });

    test('undo and redo of a move racing a split', async () => {
      const { h, alice, bob, ...pair } = await concurrentSplits(variant);
      racing({ alice, bob, ...pair }, () => {
        move(alice, 'two; ', 3);
        split(h, bob, 'two; ', 2);
      });
      const merged = ['One; ', 'o; ', 'three', 'Z', 'tw'];
      expectShown(h, [alice, bob], merged);
      // Alice takes her move back: the halves stand where Bob's split put them.
      expect(alice.room.session.undo()).toBe(true);
      later();
      expectShown(h, [alice, bob], ['One; ', 'tw', 'o; ', 'three', 'Z']);
      expect(alice.room.session.redo()).toBe(true);
      later();
      expectShown(h, [alice, bob], merged);
      // Bob takes his split back: the moved paragraph holds its whole text again.
      expect(bob.room.session.undo()).toBe(true);
      later();
      expectShown(h, [alice, bob], ['One; ', 'three', 'Z', 'two; ']);
      expect(bob.room.session.redo()).toBe(true);
      later();
      expectShown(h, [alice, bob], merged);
      // Every edit taken back, then made again.
      for (const peer of [alice, bob]) while (peer.room.session.undo()) later();
      expectShown(h, [alice, bob], ['One; two; three', 'Z']);
      for (const peer of [bob, alice]) while (peer.room.session.redo()) later();
      expectShown(h, [alice, bob], merged);
      expect(reopened(h, bob)).toEqual(merged);
    });

    test('a move of the later sibling racing typing in the earlier one', async () => {
      const { h, alice, bob, ...pair } = await concurrentSplits(variant);
      racing({ alice, bob, ...pair }, () => {
        move(alice, 'three', 0);
        typeAt(h, bob, 'two; ', 5, 'and ');
      });
      expectShown(h, [alice, bob], ['three', 'One; ', 'two; and ', 'Z']);
    });

    test('undo of a sequential move to the end', async () => {
      const { h, alice, bob } = await concurrentSplits(variant);
      move(alice, 'two; ', 3);
      expect(alice.room.session.undo()).toBe(true);
      later();
      expectShown(h, [alice, bob], SPLIT);
      expect(alice.room.session.redo()).toBe(true);
      later();
      expectShown(h, [alice, bob], ['One; ', 'three', 'Z', 'two; ']);
    });
  });
}

for (const variant of VARIANTS) {
  describe(`a moved split sibling keeps its own text after other edits (${variant.label})`, () => {
    test('after a peer deletes the first character of the later sibling', async () => {
      const { h, alice, bob } = await concurrentSplits(variant);
      h.apply(bob, [{ op: 'deleteText', paragraphId: idOf(bob, 'three'), start: 0, end: 1 }]);
      later();
      expectShown(h, [alice, bob], ['One; ', 'two; ', 'hree', 'Z']);
      move(alice, 'two; ', 3);
      expectShown(h, [alice, bob], ['One; ', 'hree', 'Z', 'two; ']);
    });

    test('after a peer types a long text at the start of the later sibling', async () => {
      const { h, alice, bob } = await concurrentSplits(variant);
      const typed = 'x'.repeat(4_200);
      typeAt(h, bob, 'three', 0, typed);
      move(alice, 'two; ', 3);
      expectShown(h, [alice, bob], ['One; ', `${typed}three`, 'Z', 'two; ']);
    });

    test('when one author typed the split text into two paragraphs that were joined', async () => {
      later();
      const h = createPeerHarness(
        'split-sibling-move-typed',
        { offlineEditing: true },
        variant.ids,
        variant.gc
      );
      harness = h;
      const document = zipDocument(['X', 'Y', 'Z'].map(paragraph).join('') + '<w:sectPr/>');
      const { alice, bob, pause, resume } = await h.pair(document);
      // One edit types into both paragraphs, so its characters have consecutive clocks.
      h.apply(alice, [
        { op: 'insertText', paragraphId: idOf(alice, 'X'), offset: 1, text: 'abc' },
        { op: 'insertText', paragraphId: idOf(alice, 'Y'), offset: 0, text: 'def' },
      ]);
      later();
      h.apply(alice, [
        { op: 'joinParagraphs', firstId: idOf(alice, 'Xabc'), secondId: idOf(alice, 'defY') },
      ]);
      later();
      expectShown(h, [alice, bob], ['XabcdefY', 'Z']);
      pause();
      split(h, alice, 'XabcdefY', 2);
      split(h, bob, 'XabcdefY', 5);
      resume();
      expectShown(h, [alice, bob], ['Xa', 'bcd', 'efY', 'Z']);
      move(alice, 'bcd', 3);
      expectShown(h, [alice, bob], ['Xa', 'efY', 'Z', 'bcd']);
    });

    test('when a third peer joins a long paragraph with the split one at the same time', async () => {
      later();
      const head = 'h'.repeat(4_200);
      const h = createPeerHarness(
        'split-sibling-move-join',
        { offlineEditing: true },
        { ...variant.ids, carol: 1_500 },
        variant.gc
      );
      harness = h;
      const document = zipDocument(
        [head, 'One; two; three', 'Z'].map(paragraph).join('') + '<w:sectPr/>'
      );
      const { alice, bob, pause, resume } = await h.pair(document);
      // Carol edits with no delivery; the test hands her edit to the others.
      const carol = await h.joinDetached(alice, 'carol');
      const fromCarol: Uint8Array[] = [];
      carol.ydoc.on('update', (update: Uint8Array, origin: unknown) => {
        if (origin !== 'relay') fromCarol.push(update);
      });
      pause();
      split(h, alice, 'One; two; three', 5);
      split(h, bob, 'One; two; three', 10);
      h.apply(carol, [
        {
          op: 'joinParagraphs',
          firstId: idOf(carol, head),
          secondId: idOf(carol, 'One; two; three'),
        },
      ]);
      later();
      resume();
      for (const update of fromCarol) {
        Y.applyUpdate(alice.ydoc, update, 'relay');
        Y.applyUpdate(bob.ydoc, update, 'relay');
      }
      Y.applyUpdate(carol.ydoc, Y.encodeStateAsUpdate(alice.ydoc), 'relay');
      for (const peer of [alice, bob, carol]) peer.port.flushPendingJournals();
      expectShown(h, [alice, bob, carol], [`${head}One; `, 'two; ', 'three', 'Z']);
      move(alice, 'three', 0);
      Y.applyUpdate(carol.ydoc, Y.encodeStateAsUpdate(alice.ydoc), 'relay');
      carol.port.flushPendingJournals();
      expectShown(h, [alice, bob, carol], ['three', `${head}One; `, 'two; ', 'Z']);
      move(bob, 'two; ', 3);
      Y.applyUpdate(carol.ydoc, Y.encodeStateAsUpdate(bob.ydoc), 'relay');
      carol.port.flushPendingJournals();
      expectShown(h, [alice, bob, carol], ['three', `${head}One; `, 'Z', 'two; ']);
    });
  });
}

interface Pair {
  readonly alice: Peer;
  readonly bob: Peer;
  readonly pause: () => void;
  readonly resume: () => void;
}

/** Run `edits` with delivery between the peers held, then deliver. Returns what each showed. */
function racing(pair: Pair, edits: () => void): { alice: string[]; bob: string[] } {
  pair.pause();
  edits();
  const shown = { alice: order(pair.alice), bob: order(pair.bob) };
  pair.resume();
  return shown;
}
