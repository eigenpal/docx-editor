import { describe, expect, test } from 'bun:test';
import type { EditorView } from 'prosemirror-view';
import { EditorState, TextSelection } from 'prosemirror-state';
import { schema } from '../../prosemirror/schema';
import { createReviewPlugin } from './index';

function createInsertionDoc() {
  const insertion = schema.marks.insertion.create({
    revisionId: 201,
    author: 'Alice',
    date: '2026-02-19T12:00:00Z',
  });

  return schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, [schema.text(' '), schema.text('Alpha', [insertion])]),
  ]);
}

function createView(state: EditorState): EditorView {
  return { state } as EditorView;
}

describe('review plugin', () => {
  test('does not emit state updates when doc and selection are unchanged', () => {
    const plugin = createReviewPlugin();
    const state = EditorState.create({ schema, doc: createInsertionDoc() });
    const view = createView(state);

    const initial = plugin.initialize?.(view);
    expect(initial).toBeDefined();

    const firstUpdate = plugin.onStateChange?.(view);
    expect(firstUpdate).toBeDefined();
    expect(firstUpdate?.totalCount).toBe(1);

    const secondUpdate = plugin.onStateChange?.(view);
    expect(secondUpdate).toBeUndefined();
  });

  test('updates active revision from selection changes without rescanning doc', () => {
    const plugin = createReviewPlugin();
    const baseState = EditorState.create({ schema, doc: createInsertionDoc() });
    const view = createView(baseState);

    plugin.initialize?.(view);

    const selectionOutside = TextSelection.create(baseState.doc, 1, 1);
    view.state = baseState.apply(baseState.tr.setSelection(selectionOutside));
    const outsideUpdate = plugin.onStateChange?.(view);
    expect(outsideUpdate).toBeDefined();
    expect(outsideUpdate?.activeRevisionId).toBeNull();

    const selectionInside = TextSelection.create(baseState.doc, 3, 3);
    view.state = view.state.apply(view.state.tr.setSelection(selectionInside));
    const insideUpdate = plugin.onStateChange?.(view);
    expect(insideUpdate).toBeDefined();
    expect(insideUpdate?.activeRevisionId).not.toBeNull();

    expect(insideUpdate?.revisions).toBe(outsideUpdate?.revisions);
  });
});
