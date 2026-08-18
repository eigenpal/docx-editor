import { computed, type ComputedRef } from 'vue';
import type { EditorSnapshot, PageSetup } from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';

/** @public */
export interface PageSetupUpdate {
  readonly pageWidthTwips?: number;
  readonly pageHeightTwips?: number;
  readonly orientation?: 'portrait' | 'landscape';
  readonly marginTopTwips?: number;
  readonly marginRightTwips?: number;
  readonly marginBottomTwips?: number;
  readonly marginLeftTwips?: number;
  readonly scope?: 'document' | 'section';
}

/** @public */
export interface UsePageSetupReturn {
  readonly pageSetup: ComputedRef<PageSetup | null>;
  readonly isEnabled: ComputedRef<boolean>;
  readonly apply: (update: PageSetupUpdate) => boolean;
}

const selectPageSetup = (snapshot: EditorSnapshot): PageSetup | null => snapshot.pageSetup ?? null;
const selectEditable = (snapshot: EditorSnapshot): boolean => snapshot.editable;

/** @public */
export function usePageSetup(): UsePageSetupReturn {
  const editorRef = useDocxEditor();
  const pageSetup = useEditorState(selectPageSetup);
  const editable = useEditorState(selectEditable);

  const isEnabled = computed(
    () =>
      editable.value &&
      editorRef.value !== null &&
      editorRef.value.can({ type: 'setPageSetup', marginTop: 0 }).ok
  );

  const apply = (update: PageSetupUpdate): boolean => {
    const editor = editorRef.value;
    if (!editor) return false;
    const result = editor.exec({
      ...(update.pageWidthTwips !== undefined ? { pageWidth: update.pageWidthTwips } : {}),
      ...(update.pageHeightTwips !== undefined ? { pageHeight: update.pageHeightTwips } : {}),
      ...(update.orientation !== undefined ? { orientation: update.orientation } : {}),
      ...(update.marginTopTwips !== undefined ? { marginTop: update.marginTopTwips } : {}),
      ...(update.marginRightTwips !== undefined ? { marginRight: update.marginRightTwips } : {}),
      ...(update.marginBottomTwips !== undefined ? { marginBottom: update.marginBottomTwips } : {}),
      ...(update.marginLeftTwips !== undefined ? { marginLeft: update.marginLeftTwips } : {}),
      ...(update.scope !== undefined ? { scope: update.scope } : {}),
      type: 'setPageSetup',
    });
    return result.ok;
  };

  return {
    pageSetup: computed(() => pageSetup.value),
    isEnabled,
    apply,
  };
}
