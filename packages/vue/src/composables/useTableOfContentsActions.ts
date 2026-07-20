import { nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue';
import type { EditorView } from 'prosemirror-view';
import type { PageLayout } from '@docx-editor.dev/core/pagination-model';
import { insertTableOfContents, updateTableOfContents } from '@docx-editor.dev/core/prosemirror';

export interface UseTableOfContentsActionsOptions {
  editorView: Ref<EditorView | null>;
  layout: Ref<PageLayout | null>;
}

export interface UseTableOfContentsActionsReturn {
  runTableOfContentsUpdate(position?: number | null): boolean;
  handleInsertTableOfContents(): void;
}

export function useTableOfContentsActions({
  editorView,
  layout,
}: UseTableOfContentsActionsOptions): UseTableOfContentsActionsReturn {
  const secondPassRequested = ref(false);
  let secondPassPosition: number | null | undefined;
  let secondPassTimer: number | null = null;

  function runPendingSecondPass() {
    if (!secondPassRequested.value || !editorView.value || !layout.value) return;
    secondPassRequested.value = false;
    const position = secondPassPosition;
    secondPassPosition = undefined;
    updateTableOfContents(editorView.value.state, editorView.value.dispatch, {
      layout: layout.value,
      position,
      force: position != null,
    });
  }

  function requestSecondPass(position?: number | null) {
    secondPassRequested.value = true;
    secondPassPosition = position;
    if (secondPassTimer != null) window.clearTimeout(secondPassTimer);
    secondPassTimer = window.setTimeout(() => {
      secondPassTimer = null;
      requestAnimationFrame(runPendingSecondPass);
    }, 120);
  }

  function runTableOfContentsUpdate(position?: number | null): boolean {
    if (!editorView.value) return false;
    const updated = updateTableOfContents(editorView.value.state, editorView.value.dispatch, {
      position,
      layout: layout.value,
      force: position != null,
    });
    if (updated) requestSecondPass(position);
    return updated;
  }

  function handleInsertTableOfContents() {
    if (!editorView.value) return;
    insertTableOfContents(editorView.value.state, editorView.value.dispatch);
    void nextTick(() => {
      requestAnimationFrame(() => runTableOfContentsUpdate());
    });
    editorView.value.focus();
  }

  watch(
    layout,
    () => {
      if (secondPassRequested.value) requestAnimationFrame(runPendingSecondPass);
    },
    { flush: 'post' }
  );

  onBeforeUnmount(() => {
    if (secondPassTimer != null) window.clearTimeout(secondPassTimer);
  });

  return {
    runTableOfContentsUpdate,
    handleInsertTableOfContents,
  };
}
