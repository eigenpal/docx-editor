import { describe, test, expect, mock } from 'bun:test';
import { ref } from 'vue';
import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { useOutlineSidebar } from './useOutlineSidebar';

/**
 * Issue #930: clicking an outline heading must scroll the VISIBLE paged
 * viewport. The hidden PM is off-screen (`left: -9999px`), so the navigate
 * handler must call the injected `scrollToVisiblePosition`, not rely on a
 * `tr.scrollIntoView()` that only moves the invisible editor.
 */
const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*', toDOM: () => ['p', 0] },
    text: {},
  },
});

function makeView() {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [schema.text('Heading One')]),
    schema.node('paragraph', null, [schema.text('Body text')]),
  ]);
  const state = EditorState.create({ schema, doc });
  const focus = mock(() => {});
  const view = {
    state,
    dispatch: mock(() => {}),
    focus,
  };
  return view as unknown as EditorView & {
    focus: ReturnType<typeof mock>;
    dispatch: ReturnType<typeof mock>;
  };
}

describe('useOutlineSidebar.handleOutlineNavigate (#930)', () => {
  test('scrolls the visible viewport to the clicked heading position', () => {
    const view = makeView();
    const scrollToVisiblePosition = mock((_pmPos: number) => {});

    const { handleOutlineNavigate } = useOutlineSidebar({
      editorView: ref(view) as never,
      showOutline: ref(false),
      showSidebar: ref(false),
      outlineHeadings: ref([]),
      activeSidebarItem: ref<string | null>(null),
      extractCommentsAndChanges: () => {},
      scrollToVisiblePosition,
    });

    // pmPos 13 is the start of the second paragraph node ("Body text").
    handleOutlineNavigate(13);

    expect(scrollToVisiblePosition).toHaveBeenCalledTimes(1);
    expect(scrollToVisiblePosition).toHaveBeenLastCalledWith(13);
    expect(view.focus).toHaveBeenCalledTimes(1);
  });

  test('is a no-op when there is no editor view', () => {
    const scrollToVisiblePosition = mock((_pmPos: number) => {});
    const { handleOutlineNavigate } = useOutlineSidebar({
      editorView: ref(null),
      showOutline: ref(false),
      showSidebar: ref(false),
      outlineHeadings: ref([]),
      activeSidebarItem: ref<string | null>(null),
      extractCommentsAndChanges: () => {},
      scrollToVisiblePosition,
    });

    handleOutlineNavigate(13);
    expect(scrollToVisiblePosition).not.toHaveBeenCalled();
  });
});
