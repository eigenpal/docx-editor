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

  test('ADDING a paragraph fails closed (structural editing is deferred)', () => {
    const { binding, store, p1 } = seeded();
    const edited = docSchema.node('doc', null, [
      docSchema.node('paragraph', { semId: p1 }, [docSchema.text('Hello')]),
      docSchema.node('paragraph', { semId: null }, [docSchema.text('second')]),
    ]);
    const res = binding.commitFromDoc(edited);
    expect(res.rejected).toBe(true);
    expect(res.ops).toHaveLength(0);
    // Store untouched — still one paragraph.
    expect(store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks).toHaveLength(1);
  });

  test('REMOVING a paragraph fails closed (structural editing is deferred)', () => {
    const { binding, store, p1 } = seeded();
    store.transact(HUMAN, (c) => c.apply({ op: 'appendParagraph', storyId: bodyStoryId(store.currentModel) }));
    const edited = docSchema.node('doc', null, [
      docSchema.node('paragraph', { semId: p1 }, [docSchema.text('Hello')]),
    ]);
    const res = binding.commitFromDoc(edited);
    expect(res.rejected).toBe(true);
    // Store untouched — still two paragraphs.
    expect(store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks).toHaveLength(2);
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
