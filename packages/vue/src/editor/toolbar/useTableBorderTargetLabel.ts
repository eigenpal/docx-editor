import { computed, type ComputedRef } from 'vue';
import {
  DEFAULT_TABLE_CHROME_DRAFT,
  tableChromeLabelKeyForTarget,
  toolbarCommandState,
  type TableChromeDraft,
} from '@docx-editor.dev/core/editor';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import { useToolbarLabel } from './toolbar-context';

const selectSnapshot = (snapshot: EditorSnapshot) => snapshot;

/** @public */
export function useTableBorderTargetLabel(): ComputedRef<string> {
  const editorRef = useDocxEditor();
  const label = useToolbarLabel();
  const snapshot = useEditorState(selectSnapshot);

  return computed(() => {
    void snapshot.value;
    const state = toolbarCommandState(editorRef.value, 'table.borderTarget');
    const target =
      (state.value as TableChromeDraft['activeTarget'] | undefined) ??
      DEFAULT_TABLE_CHROME_DRAFT.activeTarget;
    return label(tableChromeLabelKeyForTarget(target));
  });
}
