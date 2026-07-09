import { nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue';
import type { EditorView } from 'prosemirror-view';
import type { Layout } from '@eigenpal/docx-editor-core/layout-engine';
import {
  hasTableOfContentsNeedingUpdate,
  insertTableOfContents,
  updateTableOfContents,
} from '@eigenpal/docx-editor-core/prosemirror';

export interface UseTableOfContentsActionsOptions {
  editorView: Ref<EditorView | null>;
  layout: Ref<Layout | null>;
  readOnly: Ref<boolean>;
  t: (key: string) => string;
}

export interface UseTableOfContentsActionsReturn {
  runTableOfContentsUpdate(position?: number | null): boolean;
  handleInsertTableOfContents(): void;
}

export function useTableOfContentsActions({
  editorView,
  layout,
  readOnly,
  t,
}: UseTableOfContentsActionsOptions): UseTableOfContentsActionsReturn {
  const prompted = ref(false);
  const secondPassRequested = ref(false);
  let secondPassTimer: number | null = null;

  function runPendingSecondPass() {
    if (!secondPassRequested.value || !editorView.value || !layout.value) return;
    secondPassRequested.value = false;
    updateTableOfContents(editorView.value.state, editorView.value.dispatch, {
      layout: layout.value,
    });
  }

  function requestSecondPass() {
    secondPassRequested.value = true;
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
    });
    if (updated) requestSecondPass();
    return updated;
  }

  function handleInsertTableOfContents() {
    if (!editorView.value) return;
    insertTableOfContents(editorView.value.state, editorView.value.dispatch);
    prompted.value = true;
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

  watch(
    [editorView, layout],
    ([view, currentLayout]) => {
      if (!view || readOnly.value) return;
      if (!hasTableOfContentsNeedingUpdate(view.state.doc)) {
        prompted.value = false;
        return;
      }
      if (prompted.value || !currentLayout) return;
      prompted.value = true;
      if (window.confirm(t('toc.updatePrompt'))) {
        runTableOfContentsUpdate();
      }
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
