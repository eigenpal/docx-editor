import { computed, type ComputedRef } from 'vue';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { commandForSlotValue } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import { useEditorCommand } from '../useEditorCommand';

const EMPTY_FONTS: readonly string[] = Object.freeze([]);
const selectFontFamily = (snapshot: EditorSnapshot) => snapshot.formatting?.fontFamily ?? null;
const selectSnapshot = (snapshot: EditorSnapshot) => snapshot;

/** @public */
export interface UseFontFamilyResult {
  readonly value: ComputedRef<string | null>;
  readonly setValue: (family: string) => void;
  readonly options: ComputedRef<readonly string[]>;
  readonly isEnabled: ComputedRef<boolean>;
}

/** @public */
export function useFontFamily(): UseFontFamilyResult {
  const editorRef = useDocxEditor();
  const value = useEditorState(selectFontFamily);
  const snapshot = useEditorState(selectSnapshot);
  const options = computed(() =>
    editorRef.value && !snapshot.value.isLoading ? editorRef.value.getAvailableFonts() : EMPTY_FONTS
  );
  const command = useEditorCommand('font.family');

  const setValue = (family: string) => {
    if (!editorRef.value) return;
    const cmd = commandForSlotValue('font.family', family);
    if (!cmd) return;
    if (editorRef.value!.can(cmd).ok) editorRef.value!.exec(cmd);
  };

  return {
    value: computed(() => value.value),
    setValue,
    options,
    isEnabled: command.isEnabled,
  };
}
