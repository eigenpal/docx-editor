import { computed, type ComputedRef } from 'vue';
import type { EditorSnapshot, IndentFormatting } from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';

/** @public */
export interface IndentUpdate {
  readonly left?: number | null;
  readonly right?: number | null;
  readonly firstLine?: number | null;
}

/** @public */
export interface UseParagraphIndentReturn {
  readonly indent: ComputedRef<IndentFormatting | null>;
  readonly isEnabled: ComputedRef<boolean>;
  readonly apply: (update: IndentUpdate) => boolean;
}

const selectIndent = (snapshot: EditorSnapshot): IndentFormatting | null =>
  snapshot.formatting?.indent ?? null;
const selectEditable = (snapshot: EditorSnapshot): boolean => snapshot.editable;

/** @public */
export function useParagraphIndent(): UseParagraphIndentReturn {
  const editorRef = useDocxEditor();
  const indent = useEditorState(selectIndent);
  const editable = useEditorState(selectEditable);

  const isEnabled = computed(
    () =>
      editable.value &&
      editorRef.value !== null &&
      editorRef.value.can({ type: 'setIndent', left: 0 }).ok
  );

  const apply = (update: IndentUpdate): boolean => {
    if (!editorRef.value) return false;
    const result = editorRef.value.exec({
      ...(update.left !== undefined ? { left: update.left } : {}),
      ...(update.right !== undefined ? { right: update.right } : {}),
      ...(update.firstLine !== undefined ? { firstLine: update.firstLine } : {}),
      type: 'setIndent',
    });
    return result.ok;
  };

  return {
    indent: computed(() => indent.value),
    isEnabled,
    apply,
  };
}
