// Selection preservation through reconciliation (document-engine tasks 6.6, 6.7).

import { describe, expect, test } from 'bun:test';
import { EditorState, TextSelection } from 'prosemirror-state';
import { docSchema, captureSelection, resolveSelection, EditorBinding } from '../index.ts';
import { captureSelectionRange, resolveSelectionRange } from '../selection.ts';
import { DocumentStore, createEmptyModel, bodyStoryId, ORIGIN_IDS, type ParagraphRecord } from '@docx-editor.dev/engine-core';

const HUMAN = ORIGIN_IDS.mutationHuman;

function twoParagraphStore(): { store: DocumentStore; binding: EditorBinding; p1: string; p2: string } {
  const model = createEmptyModel();
  const p1 = (model.stories.get(bodyStoryId(model))!.blocks[0] as ParagraphRecord).id;
  const store = new DocumentStore(model);
  store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p1, text: 'hello' }));
  const r = store.transact(HUMAN, (c) => c.apply({ op: 'appendParagraph', storyId: bodyStoryId(model) }));
  const p2 = r.ok ? r.modelChange.created[0] : '';
  store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p2, text: 'world' }));
  return { store, binding: new EditorBinding(store), p1, p2 };
}

describe('capture + resolve', () => {
  test('caret in p1 survives an edit to p2 (offset preserved)', () => {
    const { store, binding, p1, p2 } = twoParagraphStore();
    const doc = binding.projectDoc();
    // Place caret at offset 3 inside p1 ("hel|lo").
    const paraStart = 1; // inside first paragraph
    const state = EditorState.create({ schema: docSchema, doc, selection: TextSelection.create(doc, paraStart + 3) });
    const anchor = captureSelection(state);
    expect(anchor).toMatchObject({ paragraphId: p1, offset: 3 });

    // Edit p2, reproject, resolve the anchor.
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p2, text: '!' }));
    const sel = resolveSelection(anchor, binding.reconcileDoc());
    // Still inside p1 at offset 3.
    expect(binding.reconcileDoc().resolve(sel.from).node(1).attrs.semId).toBe(p1);
    expect(sel.$from.parentOffset).toBe(3);
  });

  test('offset clamps when the anchored paragraph shrinks', () => {
    const { binding, p1 } = twoParagraphStore();
    const anchor = { paragraphId: p1, offset: 99, affinity: 'after' as const };
    const sel = resolveSelection(anchor, binding.reconcileDoc());
    expect(sel.$from.parentOffset).toBe(5); // "hello".length
  });

  test('a deleted paragraph collapses to a surviving boundary, never unrelated content', () => {
    const { store, binding, p1, p2 } = twoParagraphStore();
    const anchor = { paragraphId: p2, offset: 2, affinity: 'before' as const };
    store.transact(HUMAN, (c) => c.apply({ op: 'deleteParagraph', paragraphId: p2 }));
    const newDoc = binding.reconcileDoc();
    const sel = resolveSelection(anchor, newDoc);
    // p2 is gone; affinity 'before' collapses to the surviving p1, not onto p2's text.
    expect(newDoc.resolve(sel.from).node(1).attrs.semId).toBe(p1);
    expect(sel.empty).toBe(true);
  });

  test('a reverse selection preserves anchor and head direction through capture and resolve', () => {
    const { binding } = twoParagraphStore();
    const doc = binding.projectDoc();
    const state = EditorState.create({
      schema: docSchema,
      doc,
      selection: TextSelection.create(doc, 5, 2),
    });

    const captured = captureSelectionRange(state);
    const resolved = resolveSelectionRange(captured, doc);

    expect(captured.anchor.offset).toBeGreaterThan(captured.head.offset);
    expect(resolved.anchor).toBeGreaterThan(resolved.head);
  });
});
