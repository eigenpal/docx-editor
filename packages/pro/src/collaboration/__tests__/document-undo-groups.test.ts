/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Explicit undo groups on a collaboration session: one logical operation is one shared undo
// step, whatever the clock says, and two operations are two steps, however close together.
// Every case runs two real sessions in one room.
import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import type { CanonicalPrimitiveJournal } from '@docx-editor.dev/core/collaboration/replication';
import { CollaborationUndoGroupError } from '../document-undo-group.ts';
import { textMarksOf } from '../document/paragraph-text-marks.ts';
import {
  createPeerHarness,
  nodeText,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';

const harness = createPeerHarness('undo-groups-room');
const START = 1_800_000_000_000;
let now = START;

/** Move the clock that the shared undo manager reads. */
function elapse(milliseconds: number): void {
  now += milliseconds;
  setSystemTime(new Date(now));
}

afterEach(() => {
  harness.cleanup();
  setSystemTime();
  now = START;
});

const doc = () =>
  zipDocument(
    ['Alpha', 'Bravo', 'Charlie']
      .map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`)
      .join('') + '<w:sectPr/>'
  );

async function pair(): Promise<{ alice: Peer; bob: Peer; pause: () => void; resume: () => void }> {
  setSystemTime(new Date(now));
  return harness.pair(doc());
}

function texts(peer: Peer): string[] {
  const found: string[] = [];
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind === 'paragraph') found.push(nodeText(node));
  });
  return found;
}

function type(peer: Peer, paragraph: number, text: string): void {
  harness.apply(peer, [
    { op: 'insertText', paragraphId: harness.paragraphIdAt(peer, paragraph), offset: 0, text },
  ]);
}

function undo(peer: Peer): boolean {
  const undone = peer.room.session.undo();
  peer.port.flushPendingJournals();
  return undone;
}

describe('undo groups', () => {
  test('without a group, writes 100 ms apart share one step (the default stays)', async () => {
    const { alice } = await pair();
    type(alice, 0, 'A');
    elapse(100);
    type(alice, 0, 'B');
    expect(undo(alice)).toBe(true);
    expect(texts(alice)[0]).toBe('Alpha');
    expect(alice.room.session.canUndo()).toBe(false);
  });

  test('two grouped operations 100 ms apart are two steps', async () => {
    const { alice, bob } = await pair();
    const first = alice.room.session.beginUndoGroup();
    type(alice, 0, 'A');
    first.end();
    elapse(100);
    const second = alice.room.session.beginUndoGroup();
    type(alice, 1, 'B');
    second.end();
    expect(undo(alice)).toBe(true);
    expect(texts(alice).slice(0, 2)).toEqual(['AAlpha', 'Bravo']);
    expect(texts(bob).slice(0, 2)).toEqual(['AAlpha', 'Bravo']);
    expect(undo(alice)).toBe(true);
    expect(texts(alice).slice(0, 2)).toEqual(['Alpha', 'Bravo']);
    harness.expectConverged(alice, bob);
  });

  test('writes of one group stay one step across gaps longer than the capture window', async () => {
    const { alice, bob } = await pair();
    const group = alice.room.session.beginUndoGroup();
    type(alice, 0, 'A');
    elapse(2_000);
    type(alice, 1, 'B');
    elapse(60_000);
    harness.apply(alice, [
      { op: 'splitParagraph', paragraphId: harness.paragraphIdAt(alice, 2), offset: 3 },
    ]);
    group.end();
    expect(texts(bob)).toEqual(['AAlpha', 'BBravo', 'Cha', 'rlie']);
    expect(undo(alice)).toBe(true);
    expect(texts(alice)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(alice.room.session.canUndo()).toBe(false);
    harness.expectConverged(alice, bob);
  });

  test('the group boundary separates it from ungrouped writes on both sides', async () => {
    const { alice } = await pair();
    type(alice, 0, 'x');
    elapse(10);
    const group = alice.room.session.beginUndoGroup();
    type(alice, 0, 'A');
    group.end();
    elapse(10);
    type(alice, 0, 'y');
    expect(undo(alice)).toBe(true);
    expect(texts(alice)[0]).toBe('AxAlpha');
    expect(undo(alice)).toBe(true);
    expect(texts(alice)[0]).toBe('xAlpha');
    expect(undo(alice)).toBe(true);
    expect(texts(alice)[0]).toBe('Alpha');
  });

  test('an empty group adds no step and still ends the capture', async () => {
    const { alice } = await pair();
    type(alice, 0, 'x');
    elapse(10);
    alice.room.session.beginUndoGroup().end();
    elapse(10);
    type(alice, 0, 'y');
    expect(undo(alice)).toBe(true);
    expect(texts(alice)[0]).toBe('xAlpha');
    expect(undo(alice)).toBe(true);
    expect(texts(alice)[0]).toBe('Alpha');
    expect(alice.room.session.canUndo()).toBe(false);
  });

  test("undo of a group keeps another participant's concurrent edits", async () => {
    const { alice, bob } = await pair();
    const group = alice.room.session.beginUndoGroup();
    type(alice, 0, 'A');
    type(bob, 0, 'b');
    elapse(1_000);
    type(alice, 1, 'A');
    type(bob, 2, 'b');
    group.end();
    expect(undo(alice)).toBe(true);
    expect(texts(alice)).toEqual(['bAlpha', 'Bravo', 'bCharlie']);
    expect(texts(bob)).toEqual(['bAlpha', 'Bravo', 'bCharlie']);
    // Bob's history is his own: his two writes, a second apart, are two of his steps.
    expect(undo(bob)).toBe(true);
    expect(texts(bob)).toEqual(['bAlpha', 'Bravo', 'Charlie']);
    harness.expectConverged(alice, bob);
  });

  test('undo and redo refuse while a group is open, and work after it ends', async () => {
    const { alice } = await pair();
    type(alice, 0, 'x');
    const group = alice.room.session.beginUndoGroup();
    expect(alice.room.session.canUndo()).toBe(false);
    expect(undo(alice)).toBe(false);
    type(alice, 0, 'A');
    expect(alice.room.session.undo()).toBe(false);
    expect(alice.room.session.redo()).toBe(false);
    expect(texts(alice)[0]).toBe('AxAlpha');
    group.end();
    expect(alice.room.session.canUndo()).toBe(true);
    expect(undo(alice)).toBe(true);
    expect(texts(alice)[0]).toBe('xAlpha');
    const redoGroup = alice.room.session.beginUndoGroup();
    expect(alice.room.session.canRedo()).toBe(false);
    expect(alice.room.session.redo()).toBe(false);
    redoGroup.end();
    expect(alice.room.session.canRedo()).toBe(true);
    expect(alice.room.session.redo()).toBe(true);
    expect(texts(alice)[0]).toBe('AxAlpha');
  });

  test('groups do not nest: a second begin refuses with a stable code', async () => {
    const { alice } = await pair();
    const group = alice.room.session.beginUndoGroup();
    let thrown: unknown;
    try {
      alice.room.session.beginUndoGroup();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CollaborationUndoGroupError);
    expect((thrown as CollaborationUndoGroupError).code).toBe('undo-group-already-open');
    // The refusal leaves the open group untouched.
    expect(group.state).toBe('open');
    type(alice, 0, 'A');
    elapse(1_000);
    type(alice, 0, 'B');
    group.end();
    expect(undo(alice)).toBe(true);
    expect(texts(alice)[0]).toBe('Alpha');
  });

  test('end is idempotent, and a stale handle never closes a newer group', async () => {
    const { alice } = await pair();
    const first = alice.room.session.beginUndoGroup();
    first.end();
    first.end();
    expect(first.state).toBe('closed');
    const second = alice.room.session.beginUndoGroup();
    first.end();
    expect(second.state).toBe('open');
    type(alice, 0, 'A');
    elapse(1_000);
    type(alice, 0, 'B');
    second.end();
    expect(undo(alice)).toBe(true);
    expect(texts(alice)[0]).toBe('Alpha');
  });

  test('destroy closes an open group, and a destroyed session refuses a new one', async () => {
    const { alice, bob } = await pair();
    const group = alice.room.session.beginUndoGroup();
    type(alice, 0, 'A');
    alice.room.destroy();
    expect(group.state).toBe('closed');
    expect(() => group.end()).not.toThrow();
    expect(() => alice.room.session.beginUndoGroup()).toThrow(
      expect.objectContaining({ code: 'collaboration-session-destroyed' })
    );
    // The write the group held already reached the room.
    expect(texts(bob)[0]).toBe('AAlpha');
  });

  test('a refused write keeps the group: earlier and later writes stay one step', async () => {
    const { alice, bob } = await pair();
    // Re-attach through a tap, so the test can publish a journal shared state refuses.
    alice.detach();
    let tap: ((journal: CanonicalPrimitiveJournal) => void) | null = null;
    alice.room.session.attach({
      ...alice.port,
      observePrimitiveJournal: (listener) => {
        tap = listener;
        return alice.port.observePrimitiveJournal(listener);
      },
    });
    const group = alice.room.session.beginUndoGroup();
    type(alice, 0, 'A');
    elapse(1_000);
    tap!({
      effects: [
        { kind: 'spliceText', logicalId: 'missing', utf16Start: 0, deleteCount: 0, insert: 'X' },
      ],
    });
    // The refusal realigns the replica and recovers to `ready` once the batch is over.
    await Promise.resolve();
    expect(alice.room.session.status()).toBe('ready');
    elapse(1_000);
    type(alice, 1, 'B');
    group.end();
    expect(texts(bob).slice(0, 2)).toEqual(['AAlpha', 'BBravo']);
    expect(undo(alice)).toBe(true);
    expect(texts(alice)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(alice.room.session.canUndo()).toBe(false);
    harness.expectConverged(alice, bob);
  });

  test('a deletion by another participant inside the group survives its undo', async () => {
    const { alice, bob } = await pair();
    const group = alice.room.session.beginUndoGroup();
    type(alice, 1, 'A');
    harness.apply(bob, [{ op: 'deleteBlock', blockId: harness.paragraphIdAt(bob, 0) }]);
    elapse(700);
    type(alice, 1, 'C');
    group.end();
    expect(texts(bob)).toEqual(['ABravo', 'CCharlie']);
    expect(undo(alice)).toBe(true);
    expect(texts(alice)).toEqual(['Bravo', 'Charlie']);
    harness.expectConverged(alice, bob);
    // Save and reopen keeps the result.
    const reopened = await harness.remount(bob);
    expect(texts(reopened)).toEqual(['Bravo', 'Charlie']);
  });

  test('a group whose writes a peer removed undoes to nothing, never an older group', async () => {
    const { alice, bob } = await pair();
    const older = alice.room.session.beginUndoGroup();
    type(alice, 0, 'A');
    older.end();
    const newer = alice.room.session.beginUndoGroup();
    type(alice, 1, 'NEW');
    newer.end();
    harness.apply(bob, [
      { op: 'deleteText', paragraphId: harness.paragraphIdAt(bob, 1), start: 0, end: 3 },
    ]);
    expect(texts(alice).slice(0, 2)).toEqual(['AAlpha', 'Bravo']);
    // The newer group has nothing left to reverse. Its undo changes nothing.
    expect(undo(alice)).toBe(true);
    expect(texts(alice).slice(0, 2)).toEqual(['AAlpha', 'Bravo']);
    // Its redo changes nothing too, and the stacks stay in step.
    expect(alice.room.session.redo()).toBe(true);
    expect(texts(alice).slice(0, 2)).toEqual(['AAlpha', 'Bravo']);
    expect(undo(alice)).toBe(true);
    expect(undo(alice)).toBe(true);
    expect(texts(alice).slice(0, 2)).toEqual(['Alpha', 'Bravo']);
    expect(alice.room.session.redo()).toBe(true);
    expect(texts(alice).slice(0, 2)).toEqual(['AAlpha', 'Bravo']);
    harness.expectConverged(alice, bob);
  });

  test('a group whose typing a peer moved by a split undoes only that group', async () => {
    const { alice, bob } = await pair();
    const first = alice.room.session.beginUndoGroup();
    type(alice, 0, '[one]');
    first.end();
    // A split of the agent's own makes a paragraph of moved text. Typing after a moved
    // character writes a mark outside the undo manager's types.
    const second = alice.room.session.beginUndoGroup();
    harness.apply(alice, [
      { op: 'splitParagraph', paragraphId: harness.paragraphIdAt(alice, 1), offset: 2 },
    ]);
    second.end();
    const third = alice.room.session.beginUndoGroup();
    harness.apply(alice, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(alice, 2), offset: 1, text: '[two]' },
    ]);
    third.end();
    expect(texts(alice)).toEqual(['[one]Alpha', 'Br', 'a[two]vo', 'Charlie']);
    // The person's split moves the agent's typed text again.
    harness.apply(bob, [
      { op: 'splitParagraph', paragraphId: harness.paragraphIdAt(bob, 2), offset: 1 },
    ]);
    expect(undo(alice)).toBe(true);
    expect(texts(alice).join('|')).not.toContain('[two]');
    expect(texts(alice)[0]).toBe('[one]Alpha');
    expect(texts(alice)).toContain('Br');
    harness.expectConverged(alice, bob);
  });

  test('without groups too, an undo after a peer moved the typing reverts one step', async () => {
    const { alice, bob } = await pair();
    type(alice, 0, '[one]');
    elapse(1_000);
    harness.apply(alice, [
      { op: 'splitParagraph', paragraphId: harness.paragraphIdAt(alice, 1), offset: 2 },
    ]);
    elapse(1_000);
    harness.apply(alice, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(alice, 2), offset: 1, text: '[two]' },
    ]);
    harness.apply(bob, [
      { op: 'splitParagraph', paragraphId: harness.paragraphIdAt(bob, 2), offset: 1 },
    ]);
    expect(undo(alice)).toBe(true);
    expect(texts(alice).join('|')).not.toContain('[two]');
    expect(texts(alice)[0]).toBe('[one]Alpha');
    expect(texts(alice)).toContain('Br');
    harness.expectConverged(alice, bob);
  });

  test('an undo of redone typing that a peer split moved removes it, and redo restores it', async () => {
    const { alice, bob } = await pair();
    type(alice, 0, '[one]');
    expect(undo(alice)).toBe(true);
    expect(alice.room.session.redo()).toBe(true);
    expect(texts(alice)[0]).toBe('[one]Alpha');
    harness.apply(bob, [
      { op: 'splitParagraph', paragraphId: harness.paragraphIdAt(bob, 0), offset: 0 },
    ]);
    expect(undo(alice)).toBe(true);
    expect(texts(alice).join('|')).not.toContain('[one]');
    expect(texts(bob).join('|')).not.toContain('[one]');
    expect(alice.room.session.redo()).toBe(true);
    expect(texts(alice).join('|')).toContain('[one]');
    harness.expectConverged(alice, bob);
  });

  test('after a group, an emptied ungrouped step undoes to nothing, never the group', async () => {
    const { alice, bob } = await pair();
    const group = alice.room.session.beginUndoGroup();
    type(alice, 0, 'GROUP ');
    group.end();
    elapse(1_000);
    type(alice, 1, 'XYZ');
    harness.apply(bob, [
      { op: 'deleteText', paragraphId: harness.paragraphIdAt(bob, 1), start: 0, end: 3 },
    ]);
    expect(undo(alice)).toBe(true);
    expect(texts(alice)[0]).toBe('GROUP Alpha');
    expect(undo(alice)).toBe(true);
    expect(texts(alice)[0]).toBe('Alpha');
    harness.expectConverged(alice, bob);
  });

  test('undoGroupOpen tells an open group apart from an empty history', async () => {
    const { alice } = await pair();
    expect(alice.room.session.undoGroupOpen).toBe(false);
    const group = alice.room.session.beginUndoGroup();
    expect(alice.room.session.undoGroupOpen).toBe(true);
    type(alice, 0, 'A');
    expect(alice.room.session.undo()).toBe(false);
    expect(alice.room.session.undoGroupOpen).toBe(true);
    group.end();
    expect(alice.room.session.undoGroupOpen).toBe(false);
    expect(alice.room.session.undo()).toBe(true);
  });

  test('an undo removes typing that a concurrent split moved and a peer then edited', async () => {
    const { alice, bob, pause, resume } = await pair();
    pause();
    harness.apply(bob, [
      { op: 'splitParagraph', paragraphId: harness.paragraphIdAt(bob, 0), offset: 0 },
    ]);
    harness.apply(alice, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(alice, 0), offset: 1, text: '(one)' },
    ]);
    resume();
    // Bob edits the paragraph the split moved Alice's typing to, which copies it there.
    expect(texts(bob).slice(0, 2)).toEqual(['', 'A(one)lpha']);
    harness.apply(bob, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(bob, 1), offset: 8, text: '[two]' },
    ]);
    expect(texts(alice).slice(0, 2)).toEqual(['', 'A(one)lp[two]ha']);
    expect(undo(alice)).toBe(true);
    expect(texts(alice).join('|')).not.toContain('(one)');
    expect(texts(alice).join('|')).toContain('[two]');
    expect(alice.room.session.redo()).toBe(true);
    const shown = texts(alice).join('|');
    expect(shown.split('(one)').length - 1).toBe(1);
    harness.expectConverged(alice, bob);
  });

  test('an undo of a long paste reads its marks per insert, not per character', async () => {
    const { alice, bob, pause, resume } = await pair();
    // Alice's earlier typing moves with a concurrent split, and Bob's edit there copies it,
    // so her client holds copies outside the paste: a check by client alone cannot skip it.
    pause();
    harness.apply(bob, [
      { op: 'splitParagraph', paragraphId: harness.paragraphIdAt(bob, 2), offset: 0 },
    ]);
    harness.apply(alice, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(alice, 2), offset: 1, text: '(old)' },
    ]);
    resume();
    harness.apply(bob, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(bob, 3), offset: 7, text: '!' },
    ]);
    elapse(1_000);
    const marks = textMarksOf(alice.ydoc);
    const follow = (
      alice.room.session as unknown as {
        registry: {
          inline: {
            follow: {
              shownCopy(identity: string): unknown;
              index: { hasCopies(client: number): boolean };
            };
          };
        };
      }
    ).registry.inline.follow;
    expect(follow.index.hasCopies(alice.ydoc.clientID)).toBe(true);
    let lookups = 0;
    const origin = marks.origin.bind(marks);
    const shownCopy = follow.shownCopy.bind(follow);
    marks.origin = (...args) => ((lookups += 1), origin(...args));
    follow.shownCopy = (identity) => ((lookups += 1), shownCopy(identity));
    try {
      type(alice, 0, 'x'.repeat(200_000));
      lookups = 0;
      expect(undo(alice)).toBe(true);
      expect(texts(alice)[0]).toBe('Alpha');
      expect(lookups).toBeLessThan(50);
    } finally {
      marks.origin = origin;
      follow.shownCopy = shownCopy;
    }
  });

  test('an earlier group leaves ungrouped undo as it is without groups', async () => {
    const results: string[][] = [];
    for (const openGroupFirst of [false, true]) {
      const { alice, bob } = await pair();
      if (openGroupFirst) alice.room.session.beginUndoGroup().end();
      elapse(1_000);
      type(alice, 0, 'AAA');
      elapse(1_000);
      type(alice, 1, 'BBB');
      elapse(1_000);
      harness.apply(bob, [
        { op: 'deleteText', paragraphId: harness.paragraphIdAt(bob, 1), start: 0, end: 3 },
      ]);
      expect(undo(alice)).toBe(true);
      results.push(texts(alice));
      harness.cleanup();
    }
    expect(results[1]).toEqual(results[0]!);
  });

  test('a begin whose flush destroys the session refuses and leaves no group open', async () => {
    const { alice } = await pair();
    alice.detach();
    let destroyOnFlush = false;
    alice.room.session.attach({
      ...alice.port,
      flushPendingJournals: () => {
        alice.port.flushPendingJournals();
        // A status listener can destroy the room while the session flushes.
        if (destroyOnFlush) {
          destroyOnFlush = false;
          alice.room.destroy();
        }
      },
    });
    destroyOnFlush = true;
    expect(() => alice.room.session.beginUndoGroup()).toThrow(
      expect.objectContaining({ code: 'collaboration-session-destroyed' })
    );
    expect(alice.room.session.undoGroupOpen).toBe(false);
    expect(alice.room.session.status()).toBe('destroyed');
  });
});
