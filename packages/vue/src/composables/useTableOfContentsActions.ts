import { nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue';
import type { EditorView } from 'prosemirror-view';
import type { PageLayout } from '@eigenpal/docx-editor-core/pagination-model';
import {
  findTableOfContentsBlocks,
  hasTableOfContentsNeedingUpdate,
  insertTableOfContents,
  updateTableOfContents,
} from '@eigenpal/docx-editor-core/prosemirror';
import type { Node as PMNode } from 'prosemirror-model';
import type { TFunction } from '@eigenpal/docx-editor-i18n';

export interface UseTableOfContentsActionsOptions {
  editorView: Ref<EditorView | null>;
  layout: Ref<PageLayout | null>;
  readOnly: Ref<boolean>;
  t: TFunction;
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
  const promptedSignature = ref<string | null>(null);
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
        promptedSignature.value = null;
        return;
      }
      const signature = tocPromptSignature(view.state.doc);
      if (signature !== promptedSignature.value) {
        prompted.value = false;
        promptedSignature.value = signature;
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

function tocPromptSignature(doc: PMNode): string {
  return findTableOfContentsBlocks(doc)
    .filter((block) => block.needsUpdate)
    .map((block) =>
      [
        block.pos,
        block.instruction.raw,
        String(block.node.attrs.rawPreserveXml ?? ''),
        String(block.node.attrs.rawPreserveText ?? ''),
      ].join('\u001f')
    )
    .join('\u001e');
}
