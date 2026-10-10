/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A journal's `spliceText` and `spliceChildren` effects carry ABSOLUTE positions, diffed
// against the tree the transaction committed against. Applying one after a remote update
// integrated addresses a different base state, and an interior stale position is still inside
// bounds — so validation admits it and every replica agrees on the wrong document.
//
// Each case below commits locally, lets a remote update land, and then asserts BOTH authors'
// edits survived where each author put them. Every case is silent converged data loss when
// publication is held back past the commit.

import { afterEach, describe, expect, test } from 'bun:test';
import type { StoryScope, TreeDocOp } from '@docx-editor.dev/core/store';
import {
  BODY,
  createPeerHarness,
  nodeText,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';

const harness = createPeerHarness('queued-journal-staleness');

afterEach(() => {
  harness.cleanup();
});

/**
 * Commit locally the way the editing surface does, with no explicit publish.
 *
 * The commit must have reached shared state by the time this returns. Anything left over is a
 * journal holding positions that the next remote update can invalidate, and there is no
 * transport task between a keystroke and the next line of this test to close that window.
 */
function commitLocally(peer: Peer, ops: readonly TreeDocOp[], scope: StoryScope = BODY): void {
  const refusal = peer.room.session.gateOperations(ops, scope);
  if (refusal) throw new Error(`gate refused: ${refusal}`);
  const result = peer.store.transact(scope, (context) => {
    for (const op of ops) context.apply(op);
  });
  if (!result.ok) throw new Error(result.detail ?? result.reason);
  expect(peer.port.hasPendingJournals()).toBe(false);
}

function paragraphTexts(peer: Peer): string[] {
  const texts: string[] = [];
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind === 'paragraph') texts.push(nodeText(node));
  });
  return texts;
}

function paragraphIdAt(peer: Peer, index: number): string {
  const ids: string[] = [];
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind === 'paragraph') ids.push(node.id);
  });
  const id = ids[index];
  if (!id) throw new Error(`no paragraph at ${index}`);
  return id;
}

function paragraph(text: string): string {
  return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

describe('a local journal never lands against a base state it was not diffed against', () => {
  test('a local text insert keeps its authored offset when a remote insert follows', async () => {
    const { alice, bob } = await harness.pair(zipDocument(`${paragraph('Hello')}<w:sectPr/>`));
    expect(paragraphTexts(alice)).toEqual(['Hello']);

    // Alice types `!` after `Hello`. That reaches shared state as a run child appended at
    // index 1 of the run.
    commitLocally(alice, [
      { op: 'insertText', paragraphId: paragraphIdAt(alice, 0), offset: 5, text: '!' },
    ]);

    // Bob prepends `Hi `, which inserts a run child at index 0 and shifts alice's to index 2.
    // Held back, alice's journal would still name index 1 and produce `Hi !Hello`.
    harness.apply(bob, [
      { op: 'insertText', paragraphId: paragraphIdAt(bob, 0), offset: 0, text: 'Hi ' },
    ]);
    alice.port.flushPendingJournals();

    expect(paragraphTexts(alice)).toEqual(['Hi Hello!']);
    expect(paragraphTexts(bob)).toEqual(['Hi Hello!']);
    harness.expectConverged(alice, bob);
  });

  test('a local delete inside one text node keeps its authored range', async () => {
    // Both peers splice the SAME `w:t`, so the second offset is only meaningful against the
    // text the first one left behind. This is the `spliceText` case: interior, in bounds, and
    // invisible to validation.
    const { alice, bob } = await harness.pair(
      zipDocument(`${paragraph('Hello World Again')}<w:sectPr/>`)
    );
    const target = paragraphIdAt(alice, 0);

    // Alice removes `World `, the range 6 through 12.
    commitLocally(alice, [{ op: 'deleteText', paragraphId: target, start: 6, end: 12 }]);

    // Bob removes `He`, which shortens everything after it by two.
    harness.apply(bob, [
      { op: 'deleteText', paragraphId: paragraphIdAt(bob, 0), start: 0, end: 2 },
    ]);
    alice.port.flushPendingJournals();

    expect(paragraphTexts(alice)).toEqual(['llo Again']);
    expect(paragraphTexts(bob)).toEqual(['llo Again']);
    harness.expectConverged(alice, bob);
  });

  test('a local block delete keeps its authored target when a remote paragraph follows', async () => {
    const { alice, bob } = await harness.pair(
      zipDocument(`${paragraph('Alpha')}${paragraph('Bravo')}${paragraph('Charlie')}<w:sectPr/>`)
    );
    expect(paragraphTexts(alice)).toEqual(['Alpha', 'Bravo', 'Charlie']);

    // Alice deletes `Charlie`, the third body child, as `spliceChildren(body, 2, 1, [])`.
    commitLocally(alice, [{ op: 'deleteBlock', blockId: paragraphIdAt(alice, 2) }]);

    // Bob splits `Alpha`, inserting a paragraph ABOVE alice's target. Held back, alice's
    // journal would tombstone whatever index 2 now names, which is `Bravo`.
    harness.apply(bob, [{ op: 'splitParagraph', paragraphId: paragraphIdAt(bob, 0), offset: 2 }]);
    alice.port.flushPendingJournals();

    expect(paragraphTexts(alice)).toEqual(['Al', 'pha', 'Bravo']);
    expect(paragraphTexts(bob)).toEqual(['Al', 'pha', 'Bravo']);
    harness.expectConverged(alice, bob);
  });
});
