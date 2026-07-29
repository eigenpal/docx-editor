// Actor-local collaborative undo (document-engine task 4.12 / ADR-S4). Two users
// interleave edits; each undoes only their OWN eligible history, and all replicas
// converge. The Yjs backend uses an actor-scoped Y.UndoManager over tracked local
// origins; remote merges and the seed are untracked.

import { describe, expect, test } from 'bun:test';
import { YjsBackend } from '../index.ts';
import { createEmptyModel, type ParagraphRecord } from '@docx-editor.dev/engine-core';

const BODY = 'st-1';
const P1 = 'p-1';

function textOf(backend: YjsBackend): string {
  const p = backend.deriveModel().stories.get(BODY)!.blocks[0] as ParagraphRecord;
  return p.runs.map((r) => r.text).join('');
}

function sync(from: YjsBackend, to: YjsBackend, id: string): void {
  to.applyUpdate(from.encodeUpdate(id));
}

describe('actor-local collaborative undo', () => {
  test('each user undoes only their own edit; replicas converge', () => {
    const a = YjsBackend.fromModel('doc', 'a', createEmptyModel());
    const b = YjsBackend.join('doc', 'b', a.snapshot());

    a.insertText(P1, 'A1'); // A's local edit (tracked by A's UndoManager)
    sync(a, b, 'a1');
    b.insertText(P1, 'B1'); // B's local edit (tracked by B's UndoManager)
    sync(b, a, 'b1');

    // Both converged to A1+B1 (order deterministic via clientID).
    expect(textOf(a)).toBe(textOf(b));
    expect(textOf(a)).toContain('A1');
    expect(textOf(a)).toContain('B1');

    // A undoes — reverts ONLY A's edit (A1), not B's (B1, applied as remote).
    expect(a.canUndo).toBe(true);
    expect(a.undo()).toBe(true);
    expect(textOf(a)).toBe('B1');
    sync(a, b, 'a-undo');
    expect(textOf(b)).toBe('B1'); // both converge; B1 survives

    // A cannot undo B's edit (it is not in A's tracked history).
    expect(a.undo()).toBe(false);
    expect(textOf(a)).toBe('B1');

    // B undoes its own edit -> empty; converges.
    expect(b.undo()).toBe(true);
    expect(textOf(b)).toBe('');
    sync(b, a, 'b-undo');
    expect(textOf(a)).toBe('');
  });

  test('redo restores the actor’s undone edit', () => {
    const a = YjsBackend.fromModel('doc', 'a', createEmptyModel());
    a.insertText(P1, 'X');
    expect(textOf(a)).toBe('X');
    a.undo();
    expect(textOf(a)).toBe('');
    expect(a.redo()).toBe(true);
    expect(textOf(a)).toBe('X');
  });

  test('the initial seed content is never undoable', () => {
    const a = YjsBackend.fromModel('doc', 'a', createEmptyModel());
    // No local edits yet -> nothing to undo (seed used an untracked origin).
    expect(a.canUndo).toBe(false);
    expect(a.undo()).toBe(false);
  });
});
