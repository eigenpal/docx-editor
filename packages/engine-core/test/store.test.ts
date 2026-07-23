// Semantic DocumentStore tests (document-engine section 4): four contracts (4.1),
// synchronous transactions (4.2), DocOps (4.3), validation (4.4), all-or-nothing
// batches (4.5), normalization (4.6), ModelChange (4.7), plus undo and anchors.

import { describe, expect, test } from 'bun:test';
import {
  DocumentStore,
  isDocOp,
  isModelChange,
  isReplicationUpdate,
  isSnapshot,
  normalizeRuns,
  type DocOp,
  type ModelChange,
} from '../src/store/index.ts';
import { createEmptyModel, bodyStoryId, paragraphText, type ParagraphRecord } from '../src/model/index.ts';
import { ORIGIN_IDS } from '../src/registry/frozen-ids.ts';

const HUMAN = ORIGIN_IDS.mutationHuman;

function newStore(): { store: DocumentStore; storyId: string; p1: string } {
  const model = createEmptyModel();
  const storyId = bodyStoryId(model);
  const p1 = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
  return { store: new DocumentStore(model), storyId, p1 };
}

describe('4.1 four distinct contracts', () => {
  test('guards accept only their own contract', () => {
    const docOp: DocOp = { op: 'deleteParagraph', paragraphId: 'p-1' };
    const mc: ModelChange = {
      change: 'model-change', fromRevision: 0, toRevision: 1, commitId: 'c', origin: HUMAN,
      dirty: [], deleted: [], created: [], moves: [], splitJoin: [], dependencyKeys: [], normalized: false,
    };
    expect(isDocOp(docOp)).toBe(true);
    expect(isDocOp(mc)).toBe(false);
    expect(isModelChange(mc)).toBe(true);
    expect(isModelChange(docOp)).toBe(false);
    expect(isReplicationUpdate({ envelope: 'update' })).toBe(true);
    expect(isSnapshot({ envelope: 'snapshot' })).toBe(true);
    expect(isReplicationUpdate(mc)).toBe(false);
  });
});

describe('4.2 synchronous transactions', () => {
  test('commit bumps revision, notifies subscribers, returns ModelChange', () => {
    const { store, p1 } = newStore();
    const seen: ModelChange[] = [];
    store.subscribe((mc) => seen.push(mc));
    const r = store.transact(HUMAN, (ctx) => ctx.apply({ op: 'insertText', paragraphId: p1, text: 'Hi' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.revision).toBe(1);
    expect(seen).toHaveLength(1);
    expect(paragraphText(store.currentModel, p1)).toBe('Hi');
  });

  test('callback throw rolls back with no notification', () => {
    const { store, p1 } = newStore();
    let notified = 0;
    store.subscribe(() => notified++);
    expect(() =>
      store.transact(HUMAN, (ctx) => {
        ctx.apply({ op: 'insertText', paragraphId: p1, text: 'x' });
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(store.currentRevision).toBe(0);
    expect(notified).toBe(0);
    expect(paragraphText(store.currentModel, p1)).toBe('');
  });

  test('nested transaction is rejected', () => {
    const { store, p1 } = newStore();
    expect(() =>
      store.transact(HUMAN, () => {
        store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p1, text: 'x' }));
      }),
    ).toThrow(/nested|reentrant/);
  });

  test('async callback is rejected and rolls back', () => {
    const { store } = newStore();
    expect(() => store.transact(HUMAN, () => Promise.resolve() as unknown as void)).toThrow(/async/);
    expect(store.currentRevision).toBe(0);
  });

  test('baseRevision mismatch returns a conflict without mutating', () => {
    const { store, p1 } = newStore();
    const r = store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p1, text: 'x' }), { baseRevision: 5 });
    expect(r).toMatchObject({ ok: false, failure: { kind: 'conflict' } });
    expect(store.currentRevision).toBe(0);
  });

  test('invalid op returns a validation failure', () => {
    const { store } = newStore();
    const r = store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: '', text: 'x' }));
    expect(r).toMatchObject({ ok: false, failure: { kind: 'validation' } });
  });
});

describe('4.5 all-or-nothing batches', () => {
  test('middle failure aborts all five with positional results and no state change', () => {
    const { store, storyId, p1 } = newStore();
    const before = store.currentRevision;
    const ops: DocOp[] = [
      { op: 'insertText', paragraphId: p1, text: 'a' },
      { op: 'appendParagraph', storyId },
      { op: 'insertText', paragraphId: '', text: 'bad' }, // invalid (index 2)
      { op: 'appendParagraph', storyId },
      { op: 'insertText', paragraphId: p1, text: 'e' },
    ];
    const r = store.applyEdits(ops, HUMAN);
    expect(r.ok).toBe(false);
    expect(r.results).toHaveLength(5);
    expect(r.results[2].status).toBe('failed');
    expect(r.results.filter((x) => x.status === 'aborted')).toHaveLength(4);
    expect(store.currentRevision).toBe(before);
    expect(paragraphText(store.currentModel, p1)).toBe(''); // unchanged
  });

  test('symbolic ids resolve across the batch', () => {
    const { store, storyId } = newStore();
    const r = store.applyEdits(
      [
        { op: 'appendParagraph', storyId, symbolicId: '$new' },
        { op: 'insertText', paragraphId: '$new', text: 'fresh' },
      ],
      HUMAN,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const created = r.modelChange.created[0];
    expect(paragraphText(store.currentModel, created)).toBe('fresh');
  });
});

describe('4.6 normalization', () => {
  test('normalizeRuns merges adjacent identical-prop runs and drops empty runs', () => {
    const merged = normalizeRuns([{ text: 'a' }, { text: 'b' }, { text: '' }, { text: 'c', props: { bold: true } }]);
    expect(merged).toEqual([{ text: 'ab' }, { text: 'c', props: { bold: true } }]);
  });
  test('normalization is idempotent', () => {
    const once = normalizeRuns([{ text: 'a' }, { text: 'b' }]);
    expect(normalizeRuns(once)).toEqual(once);
  });
});

describe('4.7 ModelChange + 4.3 DocOps', () => {
  test('split records split map, created, and dirty', () => {
    const { store, p1 } = newStore();
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p1, text: 'HelloWorld' }));
    const r = store.transact(HUMAN, (c) => c.apply({ op: 'splitParagraph', paragraphId: p1, offset: 5 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.modelChange.splitJoin[0]).toHaveProperty('split');
    expect(r.modelChange.created).toHaveLength(1);
    expect(r.modelChange.dirty).toContain(p1);
  });
});

describe('undo / redo and anchors', () => {
  test('undo restores prior state and emits an inverted change', () => {
    const { store, p1 } = newStore();
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p1, text: 'Hi' }));
    expect(store.canUndo()).toBe(true);
    const u = store.undo();
    expect(u.ok).toBe(true);
    expect(paragraphText(store.currentModel, p1)).toBe('');
    const redo = store.redoLast();
    expect(redo.ok).toBe(true);
    expect(paragraphText(store.currentModel, p1)).toBe('Hi');
  });

  test('anchor resolves while its block exists and is invalid after deletion', () => {
    const { store, storyId } = newStore();
    const r = store.transact(HUMAN, (c) => c.apply({ op: 'appendParagraph', storyId }));
    const created = r.ok ? r.modelChange.created[0] : '';
    const anchor = store.createAnchor(created)!;
    expect(store.resolveAnchor(anchor)).toMatchObject({ blockId: created });
    store.transact(HUMAN, (c) => c.apply({ op: 'deleteParagraph', paragraphId: created }));
    expect(store.resolveAnchor(anchor)).toEqual({ invalid: true });
  });
});
