import type { Ref } from 'vue';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import { LOADING_SNAPSHOT } from '@docx-editor.dev/core/editor';
import type { DocxEditorRef } from '../../types';

/** @internal */
export const PRE_MOUNT_SNAPSHOT = LOADING_SNAPSHOT;

/** Build the seven-member imperative handle over the live editor ref. @internal */
export function createDocxEditorRefApi(getEditor: () => Editor | null): DocxEditorRef {
  return {
    load: (document) => {
      getEditor()?.load(document);
    },
    save: () => getEditor()?.save() ?? Promise.resolve(null),
    getDocumentHandle: () => getEditor()?.getDocumentHandle() ?? null,
    getEditor: () => getEditor(),
    focus: () => {
      getEditor()?.focus();
    },
    exec: (command, options) =>
      getEditor()?.exec(command, options) ?? {
        ok: false,
        code: 'notFound',
        reason: 'no editor is mounted',
      },
    snapshot: (options) => getEditor()?.snapshot(options) ?? PRE_MOUNT_SNAPSHOT,
  };
}

/** @internal */
export function useDocxEditorRefExpose(editorRef: Ref<Editor | null>): DocxEditorRef {
  return createDocxEditorRefApi(() => editorRef.value);
}
