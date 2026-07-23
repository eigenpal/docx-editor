// EditorBinding tests (document-engine section 6): projection (6.2), forward
// mapping with identity preservation (6.3, 6.4), reverse reconciliation (6.5),
// and loop prevention (6.9). Runs headless — no EditorView, no DOM.

import { describe, expect, test } from 'bun:test';
import { EditorBinding, docSchema, paragraphNodeToRuns } from '../src/index.ts';
import {
  DocumentStore,
  createEmptyModel,
  bodyStoryId,
  paragraphText,
  ORIGIN_IDS,
  type ParagraphRecord,
} from '@docx-editor.dev/engine-core';

const HUMAN = ORIGIN_IDS.mutationHuman;

function seeded(): { binding: EditorBinding; store: DocumentStore; p1: string } {
  const model = createEmptyModel();
  const p1 = (model.stories.get(bodyStoryId(model))!.blocks[0] as ParagraphRecord).id;
  const store = new DocumentStore(model);
  store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p1, text: 'Hello' }));
  return { binding: new EditorBinding(store), store, p1 };
}

describe('projection (6.2)', () => {
  test('body story projects to a PM doc with semId-tagged paragraphs', () => {
    const { binding, p1 } = seeded();
    const doc = binding.projectDoc();
    expect(doc.childCount).toBe(1);
    expect(doc.child(0).attrs.semId).toBe(p1);
    expect(doc.child(0).textContent).toBe('Hello');
  });
});

describe('forward mapping (6.3, 6.4)', () => {
  test('editing a paragraph maps to setParagraphRuns and preserves identity', () => {
    const { binding, store, p1 } = seeded();
    // Build an edited PM doc: same paragraph (same semId) with new text.
    const edited = docSchema.node('doc', null, [
      docSchema.node('paragraph', { semId: p1 }, [docSchema.text('Hello world')]),
    ]);
    const { ops, result } = binding.commitFromDoc(edited);
    expect(ops).toEqual([{ op: 'setParagraphRuns', paragraphId: p1, runs: [{ text: 'Hello world' }] }]);
    expect(result?.ok).toBe(true);
    expect(paragraphText(store.currentModel, p1)).toBe('Hello world');
    // Identity preserved: same id still present.
    expect(store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks[0].id).toBe(p1);
  });

  test('a clean SPLIT (Enter) maps to one splitParagraph and keeps the head id', () => {
    const { binding, store, p1 } = seeded(); // p1 = 'Hello'
    // Enter after "Hel": head keeps p1, tail is a new (null-semId) paragraph.
    const edited = docSchema.node('doc', null, [
      docSchema.node('paragraph', { semId: p1 }, [docSchema.text('Hel')]),
      docSchema.node('paragraph', { semId: null }, [docSchema.text('lo')]),
    ]);
    const { ops, result } = binding.commitFromDoc(edited);
    expect(ops).toEqual([{ op: 'splitParagraph', paragraphId: p1, offset: 3 }]);
    expect(result?.ok).toBe(true);
    const blocks = store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks;
    expect(blocks).toHaveLength(2);
    expect(blocks[0].id).toBe(p1); // head keeps identity
    expect(paragraphText(store.currentModel, p1)).toBe('Hel');
    expect((blocks[1] as ParagraphRecord).runs.map((r) => r.text).join('')).toBe('lo');
  });

  test('a clean JOIN (Backspace at boundary) maps to one joinParagraphs', () => {
    const { binding, store, p1 } = seeded(); // p1 = 'Hello'
    store.transact(HUMAN, (c) => c.apply({ op: 'appendParagraph', storyId: bodyStoryId(store.currentModel) }));
    const p2 = store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks[1].id;
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p2, text: 'World' }));
    // Join: the survivor keeps p1 and carries both texts; p2 is gone.
    const edited = docSchema.node('doc', null, [
      docSchema.node('paragraph', { semId: p1 }, [docSchema.text('HelloWorld')]),
    ]);
    const { ops, result } = binding.commitFromDoc(edited);
    expect(ops).toEqual([{ op: 'joinParagraphs', firstId: p1, secondId: p2 }]);
    expect(result?.ok).toBe(true);
    const blocks = store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks;
    expect(blocks).toHaveLength(1);
    expect(paragraphText(store.currentModel, p1)).toBe('HelloWorld');
  });

  test('inserting a new paragraph after an existing one maps to insertParagraph', () => {
    const { binding, store, p1 } = seeded();
    const storyId = bodyStoryId(store.currentModel);
    const edited = docSchema.node('doc', null, [
      docSchema.node('paragraph', { semId: p1 }, [docSchema.text('Hello')]),
      docSchema.node('paragraph', { semId: null }, [docSchema.text('second')]),
    ]);
    const res = binding.commitFromDoc(edited);
    expect(res.rejected).toBeUndefined();
    expect(res.ops).toEqual([{ op: 'insertParagraph', storyId, index: 1, runs: [{ text: 'second' }] }]);
    const blocks = store.currentModel.stories.get(storyId)!.blocks;
    expect(blocks).toHaveLength(2);
    expect(blocks[0].id).toBe(p1); // the existing paragraph keeps its identity
    expect((blocks[1] as ParagraphRecord).runs.map((r) => r.text).join('')).toBe('second');
  });

  test('DELETING a whole non-empty paragraph fails closed (its content would be lost)', () => {
    const { binding, store, p1 } = seeded();
    store.transact(HUMAN, (c) => c.apply({ op: 'appendParagraph', storyId: bodyStoryId(store.currentModel) }));
    const p2 = store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks[1].id;
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p2, text: 'World' }));
    // The survivor still reads only 'Hello' — 'World' vanished: NOT a clean join.
    const edited = docSchema.node('doc', null, [docSchema.node('paragraph', { semId: p1 }, [docSchema.text('Hello')])]);
    const res = binding.commitFromDoc(edited);
    expect(res.rejected).toBe(true);
    expect(store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks).toHaveLength(2);
  });

  test('a multi-paragraph paste (two new blocks) maps to two insertParagraph ops in order', () => {
    const { binding, store, p1 } = seeded();
    const storyId = bodyStoryId(store.currentModel);
    const edited = docSchema.node('doc', null, [
      docSchema.node('paragraph', { semId: p1 }, [docSchema.text('Hello')]),
      docSchema.node('paragraph', { semId: null }, [docSchema.text('a')]),
      docSchema.node('paragraph', { semId: null }, [docSchema.text('b')]),
    ]);
    const res = binding.commitFromDoc(edited);
    expect(res.rejected).toBeUndefined();
    expect(res.ops).toEqual([
      { op: 'insertParagraph', storyId, index: 1, runs: [{ text: 'a' }] },
      { op: 'insertParagraph', storyId, index: 2, runs: [{ text: 'b' }] },
    ]);
    const blocks = store.currentModel.stories.get(storyId)!.blocks;
    expect(blocks.map((b) => (b as ParagraphRecord).runs.map((r) => r.text).join(''))).toEqual(['Hello', 'a', 'b']);
  });

  test('a paste combined with an edit to an existing paragraph fails closed', () => {
    const { binding, store, p1 } = seeded();
    const edited = docSchema.node('doc', null, [
      docSchema.node('paragraph', { semId: p1 }, [docSchema.text('CHANGED')]), // existing edited
      docSchema.node('paragraph', { semId: null }, [docSchema.text('a')]),
      docSchema.node('paragraph', { semId: null }, [docSchema.text('b')]),
    ]);
    const res = binding.commitFromDoc(edited);
    expect(res.rejected).toBe(true);
    expect(store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks).toHaveLength(1);
  });

  test('marks round-trip through projection and forward mapping', () => {
    const { binding, store, p1 } = seeded();
    const edited = docSchema.node('doc', null, [
      docSchema.node('paragraph', { semId: p1 }, [docSchema.text('bold', [docSchema.marks.bold.create()])]),
    ]);
    binding.commitFromDoc(edited);
    const runs = (store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks[0] as ParagraphRecord).runs;
    expect(runs).toEqual([{ text: 'bold', props: { bold: true } }]);
  });
});

describe('reverse reconciliation + loop prevention (6.5, 6.9)', () => {
  test('a non-PM commit is reflected by reprojection', () => {
    const { binding, store, p1 } = seeded();
    // Simulate a remote/agent edit straight to the store.
    store.transact(ORIGIN_IDS.mutationAgent, (c) => c.apply({ op: 'insertText', paragraphId: p1, text: '!' }));
    const doc = binding.reconcileDoc();
    expect(doc.child(0).textContent).toBe('Hello!');
  });

  test('a reconciled doc maps to ZERO ops (no feedback loop)', () => {
    const { binding } = seeded();
    const reconciled = binding.reconcileDoc();
    expect(binding.mapDocToOps(reconciled)).toEqual([]);
  });

  test('paragraphNodeToRuns drops empty text nodes', () => {
    const node = docSchema.node('paragraph', { semId: 'x' }, [docSchema.text('a')]);
    expect(paragraphNodeToRuns(node)).toEqual([{ text: 'a' }]);
  });
});
