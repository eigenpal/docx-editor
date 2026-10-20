/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The capture rule against a real Y.UndoManager, with the manager's own clock driven
// directly: yjs reads time through a binding taken at module load, so mocking `Date.now`
// would never reach its merge check.
import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { HistoryGroupCapture } from '../document/history-group-capture.ts';

const CAPTURE_TIMEOUT_MS = 5_000;

function setup() {
  const doc = new Y.Doc();
  const text = doc.getText('t');
  const origin = { kind: 'local' };
  const undo = new Y.UndoManager(text, {
    trackedOrigins: new Set([origin]),
    captureTimeout: CAPTURE_TIMEOUT_MS,
  });
  const capture = new HistoryGroupCapture(undo);
  const frame = (value: string, group?: symbol): void => {
    capture.capture(group, () => doc.transact(() => text.insert(text.length, value), origin));
  };
  /** Pretend the previous frame landed `ms` ago, as the manager measures it. */
  const elapse = (ms: number): void => {
    undo.lastChange -= ms;
  };
  return { doc, origin, text, undo, capture, frame, elapse, destroy: () => doc.destroy() };
}

describe('HistoryGroupCapture', () => {
  test('frames of one gesture merge across a gap longer than the capture window', () => {
    const { undo, frame, elapse, text, destroy } = setup();
    try {
      const gesture = Symbol('drag');
      frame('a', gesture);
      elapse(CAPTURE_TIMEOUT_MS * 2);
      frame('b', gesture);
      elapse(CAPTURE_TIMEOUT_MS * 2);
      frame('c', gesture);
      expect(undo.undoStack).toHaveLength(1);
      undo.undo();
      expect(text.toString()).toBe('');
    } finally {
      destroy();
    }
  });

  test('ungrouped frames keep the clock rule: inside the window they merge, outside they split', () => {
    const { undo, frame, elapse, destroy } = setup();
    try {
      frame('a');
      frame('b');
      expect(undo.undoStack).toHaveLength(1);
      elapse(CAPTURE_TIMEOUT_MS * 2);
      frame('c');
      expect(undo.undoStack).toHaveLength(2);
    } finally {
      destroy();
    }
  });

  test('a change of group is a boundary even inside the window', () => {
    const { undo, frame, destroy } = setup();
    try {
      const second = Symbol('second');
      frame('a', Symbol('first'));
      frame('b'); // out
      frame('c', second);
      frame('d', second);
      expect(undo.undoStack).toHaveLength(3);
    } finally {
      destroy();
    }
  });

  test('a frame that pushed no item does not let the next frame merge into older work', () => {
    const { undo, frame, capture, text, destroy } = setup();
    try {
      frame('typed'); // the user's earlier, unrelated work
      const gesture = Symbol('drag');
      // Frame 1 of the gesture: the shared transaction changes nothing tracked, so no item.
      capture.capture(gesture, () => {});
      frame('a', gesture);
      expect(undo.undoStack).toHaveLength(2);
      undo.undo();
      expect(text.toString()).toBe('typed');
    } finally {
      destroy();
    }
  });

  test('an unrelated local item between two frames is not the merge target', () => {
    const { undo, frame, elapse, text, doc, origin, destroy } = setup();
    try {
      const gesture = Symbol('drag');
      frame('a', gesture);
      // A tracked local write that is not a journal of this gesture, past the window so it
      // is an item of its own — and now on top.
      elapse(CAPTURE_TIMEOUT_MS * 2);
      doc.transact(() => text.insert(text.length, 'z'), origin);
      frame('b', gesture);
      undo.undo();
      expect(text.toString()).toBe('az');
    } finally {
      destroy();
    }
  });

  test('a remote change between two frames neither splits the gesture nor joins its undo', () => {
    const { undo, frame, elapse, text, doc, destroy } = setup();
    try {
      const decision = Symbol('decision');
      frame('a', decision);
      elapse(CAPTURE_TIMEOUT_MS * 2);
      // A peer's edit arrives under an untracked origin while the decision is still open.
      doc.transact(() => text.insert(0, 'R'), 'relay');
      frame('b', decision);
      expect(undo.undoStack).toHaveLength(1);
      undo.undo();
      expect(text.toString()).toBe('R');
      undo.redo();
      expect(text.toString()).toBe('Rab');
    } finally {
      destroy();
    }
  });

  test('frames of several kinds in one group are one item: a decision spans package writes', () => {
    const { doc, origin, destroy } = setup();
    try {
      const comments = doc.getMap('comments');
      const tracked = new Y.UndoManager([doc.getText('t'), comments], {
        trackedOrigins: new Set([origin]),
        captureTimeout: CAPTURE_TIMEOUT_MS,
      });
      const decision = new HistoryGroupCapture(tracked);
      const group = Symbol('decision');
      decision.capture(group, () => doc.transact(() => doc.getText('t').insert(0, 'x'), origin));
      tracked.lastChange -= CAPTURE_TIMEOUT_MS * 2;
      decision.capture(group, () => doc.transact(() => comments.set('c1', 'note'), origin));
      expect(tracked.undoStack).toHaveLength(1);
      tracked.undo();
      expect(comments.has('c1')).toBe(false);
      expect(doc.getText('t').toString()).toBe('');
      tracked.destroy();
    } finally {
      destroy();
    }
  });

  test('reset makes the next frame of the same gesture a new item', () => {
    const { undo, frame, capture, elapse, destroy } = setup();
    try {
      const gesture = Symbol('drag');
      frame('a', gesture);
      capture.reset();
      elapse(CAPTURE_TIMEOUT_MS * 2);
      frame('b', gesture);
      expect(undo.undoStack).toHaveLength(2);
    } finally {
      destroy();
    }
  });
});
