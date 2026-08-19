/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { inject, provide, shallowRef, watch, type InjectionKey } from 'vue';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '@docx-editor.dev/vue';

export interface EditorRenderRevision {
  readonly value: unknown;
}

const editorRenderRevisionKey: InjectionKey<EditorRenderRevision> =
  Symbol('proEditorRenderRevision');

/** Publishes an existing adapter snapshot subscription to the rail subtree. @internal */
export function provideEditorRenderRevision(revision: EditorRenderRevision): EditorRenderRevision {
  provide(editorRenderRevisionKey, revision);
  return revision;
}

/** Reads the rail revision, with a standalone-part snapshot subscription. @internal */
export function useEditorRenderRevision(): EditorRenderRevision {
  const provided = inject(editorRenderRevisionKey, null);
  if (provided) return provided;
  const editorRef = useDocxEditor();
  const revision = shallowRef<unknown>('none');
  watch(
    () => editorRef.value,
    (editor, _previous, onCleanup) => {
      if (!editor) {
        revision.value = 'none';
        return;
      }
      const current = editor as DocxEditorInstance;
      let key = `${current.getReviewRevision()}:${current.getEditingMode()}`;
      revision.value = key;
      let disposed = false;
      let scheduled: ReturnType<typeof setTimeout> | null = null;
      const notify = () => {
        if (disposed || scheduled !== null) return;
        scheduled = setTimeout(() => {
          scheduled = null;
          if (disposed) return;
          const next = `${current.getReviewRevision()}:${current.getEditingMode()}`;
          if (next === key) return;
          key = next;
          revision.value = next;
        }, 0);
      };
      const offDocument = current.on('change', notify);
      const offSelection = current.on('selectionChange', notify);
      const offError = current.on('error', notify);
      onCleanup(() => {
        disposed = true;
        if (scheduled !== null) clearTimeout(scheduled);
        offDocument();
        offSelection();
        offError();
      });
    },
    { immediate: true, flush: 'sync' }
  );
  return revision;
}
