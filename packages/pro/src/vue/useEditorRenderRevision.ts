/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { inject, provide, shallowRef, watch, type InjectionKey } from 'vue';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '@docx-editor.dev/vue';
import { nextTask } from './next-task.ts';

export interface EditorRenderRevision {
  readonly value: unknown;
}

function renderRevisionKey(editor: DocxEditorInstance): string {
  return `${editor.getReviewRevision()}:${editor.getEditingMode()}:${JSON.stringify(
    editor.snapshot().hiddenReviewAuthors ?? []
  )}`;
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
      let key = renderRevisionKey(current);
      revision.value = key;
      let disposed = false;
      // A message task, not a timer: see `next-task.ts`.
      let scheduled = false;
      const notify = () => {
        if (disposed || scheduled) return;
        scheduled = true;
        nextTask(() => {
          scheduled = false;
          if (disposed) return;
          const next = renderRevisionKey(current);
          if (next === key) return;
          key = next;
          revision.value = next;
        });
      };
      const offDocument = current.on('change', notify);
      const offSelection = current.on('selectionChange', notify);
      const offError = current.on('error', notify);
      onCleanup(() => {
        disposed = true;
        offDocument();
        offSelection();
        offError();
      });
    },
    { immediate: true, flush: 'sync' }
  );
  return revision;
}
