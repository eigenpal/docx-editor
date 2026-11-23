/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Paragraphs that concurrent splits of one paragraph added keep their order when a peer
// removes one of them: by a deleted block or a join. Each test checks both client orders.

import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import { writeOoxmlPackage, type OoxmlNode } from '@docx-editor.dev/core/store';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support';
import { collectKind, loadPackage } from './document-support.ts';

const paragraph = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const ORDERS = [
  { label: 'Alice first', ids: { alice: 1_000, bob: 2_000 } },
  { label: 'Bob first', ids: { alice: 2_000, bob: 1_000 } },
];

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
  setSystemTime();
});

let now = 1_800_000_000_000;
/** Move the clock past the undo capture window, so the next edit is its own undo step. */
function later(): void {
  now += 2_000;
  setSystemTime(new Date(now));
}

function textOf(node: OoxmlNode): string {
  return node.kind === 'textValue' ? node.value : node.children.map(textOf).join('');
}

async function room(
  ids: Readonly<Record<string, number>>,
  first: string,
  trailing = paragraph('End')
) {
  const harness = createPeerHarness('split-sibling-removal', undefined, ids);
  cleanup = harness.cleanup;
  const pair = await harness.pair(zipDocument(paragraph(first) + trailing));
  /** Each body paragraph as `text`, in the order a peer shows them. */
  const shown = (peer: Peer): { id: string; text: string }[] => {
    const out: { id: string; text: string }[] = [];
    const visit = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      if (node.kind === 'paragraph') {
        out.push({ id: node.id, text: textOf(node) });
        return;
      }
      for (const child of node.children) visit(child);
    };
    const pkg = harness.packageOf(peer);
    visit(pkg.parts.get(pkg.mainDocumentPart)!.root);
    return out;
  };
  return {
    ...pair,
    harness,
    shown,
    /** Both peers show the same paragraphs, in the same order, and save alike. */
    converged(): { id: string; text: string }[] {
      harness.expectConverged(pair.alice, pair.bob);
      return shown(pair.alice);
    },
    split(peer: Peer, index: number, offset: number): void {
      harness.apply(peer, [
        { op: 'splitParagraph', paragraphId: harness.paragraphIdAt(peer, index), offset },
      ]);
    },
  };
}

const ids = (list: readonly { id: string }[]) => list.map((entry) => entry.id);

describe('removing a paragraph of a concurrent split run', () => {
  /**
   * Alice splits `abcdefgh` after `a` and her piece after `bcd`; Bob splits it after `ab` and
   * his piece after `cd`. Both pieces that start at `e` follow a split piece of their own.
   */
  async function splitTwice(clientIds: Readonly<Record<string, number>>) {
    const r = await room(clientIds, 'abcdefgh');
    r.pause();
    r.split(r.alice, 0, 1);
    r.split(r.alice, 1, 3);
    r.split(r.bob, 0, 2);
    r.split(r.bob, 1, 2);
    r.resume();
    return r;
  }

  for (const { label, ids: clientIds } of ORDERS)
    for (const by of ['alice', 'bob'] as const) {
      test(`deleting a split piece keeps the others in place (${label}, ${by})`, async () => {
        const r = await splitTwice(clientIds);
        const before = r.converged();
        const removed = before.find((entry) => entry.text === 'b')!.id;
        r.harness.apply(r[by], [{ op: 'deleteBlock', blockId: removed }]);
        expect(ids(r.converged())).toEqual(ids(before).filter((id) => id !== removed));
      });

      test(`joining a split piece keeps the others in place (${label}, ${by})`, async () => {
        const r = await splitTwice(clientIds);
        const before = r.converged();
        const at = before.findIndex((entry) => entry.text === 'b');
        const removed = before[at]!.id;
        r.harness.apply(r[by], [
          { op: 'joinParagraphs', firstId: before[at - 1]!.id, secondId: removed },
        ]);
        expect(ids(r.converged())).toEqual(ids(before).filter((id) => id !== removed));
      });

      test(`a split piece a peer deletes offline leaves the others in place (${label}, ${by})`, async () => {
        const r = await splitTwice(clientIds);
        const before = r.converged();
        const removed = before.find((entry) => entry.text === 'b')!.id;
        r.pause();
        r.harness.apply(r[by], [{ op: 'deleteBlock', blockId: removed }]);
        r.resume();
        expect(ids(r.converged())).toEqual(ids(before).filter((id) => id !== removed));
      });

      test(`an undo of the delete shows every piece where it was (${label}, ${by})`, async () => {
        const r = await splitTwice(clientIds);
        const before = r.converged();
        const removed = before.find((entry) => entry.text === 'b')!.id;
        later();
        r.harness.apply(r[by], [{ op: 'deleteBlock', blockId: removed }]);
        r.converged();
        expect(r[by].room.session.undo()).toBe(true);
        expect(r.converged().map((entry) => entry.text)).toEqual(before.map((entry) => entry.text));
      });
    }
});

describe('a split piece an undo put back', () => {
  for (const { label, ids: clientIds } of ORDERS)
    for (const joiner of ['alice', 'bob'] as const)
      for (const splitter of ['alice', 'bob'] as const)
        test(`splitting it again shows both halves in its place (${label}, ${joiner} undoes, ${splitter} splits)`, async () => {
          const r = await room(clientIds, 'abcdefgh');
          r.pause();
          r.split(r.alice, 0, 2);
          r.split(r.bob, 0, 4);
          r.resume();
          const pieces = r.converged();
          expect(pieces.map((entry) => entry.text)).toEqual(['ab', 'cd', 'efgh', 'End']);
          later();
          r.harness.apply(r[joiner], [
            { op: 'joinParagraphs', firstId: pieces[1]!.id, secondId: pieces[2]!.id },
          ]);
          r.converged();
          expect(r[joiner].room.session.undo()).toBe(true);
          expect(ids(r.converged())).toEqual(ids(pieces));
          later();
          r.split(r[splitter], 2, 2);
          // The half split off goes right after the piece, in the splitter's view too.
          expect(r.shown(r[splitter]).map((entry) => entry.text)).toEqual([
            'ab',
            'cd',
            'ef',
            'gh',
            'End',
          ]);
          expect(r.converged().map((entry) => entry.text)).toEqual(['ab', 'cd', 'ef', 'gh', 'End']);
        });

  for (const { label, ids: clientIds } of ORDERS)
    for (const splitter of ['alice', 'bob'] as const)
      test(`splitting it twice, the second time earlier, keeps the halves in order (${label}, ${splitter} splits)`, async () => {
        const r = await room(clientIds, 'abcdefgh');
        r.pause();
        r.split(r.alice, 0, 2);
        r.split(r.bob, 0, 4);
        r.resume();
        const pieces = r.converged();
        later();
        r.harness.apply(r.alice, [
          { op: 'joinParagraphs', firstId: pieces[1]!.id, secondId: pieces[2]!.id },
        ]);
        r.converged();
        expect(r.alice.room.session.undo()).toBe(true);
        expect(ids(r.converged())).toEqual(ids(pieces));
        later();
        r.split(r[splitter], 2, 3);
        r.converged();
        later();
        r.split(r[splitter], 2, 1);
        expect(r.shown(r[splitter]).map((entry) => entry.text)).toEqual([
          'ab',
          'cd',
          'e',
          'fg',
          'h',
          'End',
        ]);
        expect(r.converged().map((entry) => entry.text)).toEqual([
          'ab',
          'cd',
          'e',
          'fg',
          'h',
          'End',
        ]);
      });
});

describe('concurrent splits before an existing paragraph', () => {
  for (const { label, ids: clientIds } of ORDERS)
    for (const first of ['alice', 'bob'] as const)
      test(`both pieces precede the existing split piece (${label}, ${first} splits first)`, async () => {
        const r = await room(clientIds, 'efgh', '');
        r.split(r[first], 0, 3);
        r.pause();
        r.split(r.alice, 0, 1);
        r.split(r.bob, 0, 2);
        r.resume();
        expect(r.converged().map((entry) => entry.text)).toEqual(['e', 'f', 'g', 'h']);
      });
});

describe('concurrent splits of an earlier split piece', () => {
  for (const { label, ids: clientIds } of ORDERS)
    for (const first of ['alice', 'bob'] as const)
      for (const restored of [false, true])
        test(`nested split order (${label}, ${first} splits first, restored=${restored})`, async () => {
          const r = await room(clientIds, 'abcdefgh');
          r.pause();
          r.split(r.alice, 0, 2);
          r.split(r.bob, 0, 4);
          r.resume();
          if (restored) {
            const pieces = r.converged();
            later();
            r.harness.apply(r[first], [
              { op: 'joinParagraphs', firstId: pieces[1]!.id, secondId: pieces[2]!.id },
            ]);
            expect(r[first].room.session.undo()).toBe(true);
          }
          r.split(r[first], 2, 3);
          later();
          r.pause();
          r.split(r.alice, 2, 1);
          r.split(r.bob, 2, 2);
          r.resume();
          const order = () => r.converged().map((entry) => entry.text);
          const expected = ['ab', 'cd', 'e', 'f', 'g', 'h', 'End'];
          expect(order()).toEqual(expected);
          const reopened = loadPackage(writeOoxmlPackage(r.harness.packageOf(r.alice)));
          expect(collectKind(reopened, 'paragraph').map(textOf)).toEqual(expected);
          expect(r.alice.room.session.undo()).toBe(true);
          expect(order()).toEqual(['ab', 'cd', 'ef', 'g', 'h', 'End']);
          expect(r.alice.room.session.redo()).toBe(true);
          expect(order()).toEqual(expected);
          const piece = r.harness.paragraphIdAt(r.alice, 3);
          r.pause();
          r.harness.apply(r.alice, [{ op: 'deleteBlock', blockId: piece }]);
          r.harness.apply(r.bob, [{ op: 'insertText', paragraphId: piece, offset: 1, text: 'x' }]);
          r.resume();
          expect(order()).toEqual(['ab', 'cd', 'e', 'g', 'h', 'End']);
        });
});

describe('concurrent splits of a piece inside an earlier concurrent run', () => {
  const CASES = [
    {
      name: 'a piece shown after its earlier sibling',
      text: 'abcdefghij',
      outer: [6, 4],
      piece: 2,
      before: null,
      inner: [1, 2],
      expected: ['abcd', 'ef', 'g', 'h', 'ij', 'End'],
    },
    {
      name: 'a middle piece with a split-off follower',
      text: 'abcdefgh',
      outer: [2, 6],
      piece: 1,
      before: 3,
      inner: [1, 2],
      expected: ['ab', 'c', 'd', 'e', 'f', 'gh', 'End'],
    },
  ] as const;

  for (const c of CASES)
    for (const { label, ids: clientIds } of ORDERS)
      test(`${c.name} keeps text order (${label})`, async () => {
        const r = await room(clientIds, c.text);
        r.pause();
        r.split(r.alice, 0, c.outer[0]);
        r.split(r.bob, 0, c.outer[1]);
        r.resume();
        if (c.before !== null) r.split(r.alice, c.piece, c.before);
        later();
        r.pause();
        r.split(r.alice, c.piece, c.inner[0]);
        r.split(r.bob, c.piece, c.inner[1]);
        r.resume();
        expect(r.converged().map((entry) => entry.text)).toEqual([...c.expected]);
      });
});
