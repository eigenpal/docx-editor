import { computed, type ComputedRef } from 'vue';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { commandForSlotValue } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import { useEditorCommand } from '../useEditorCommand';
import { builtInParagraphStyleLabel, paragraphStyleDisplayName } from '../../lib/stylePreview';
import { useTranslation } from '../../i18n';

/** @public */
export interface ParagraphStyleOption {
  readonly styleId: string;
  readonly name: string;
  readonly preview: {
    readonly fontFamily: string | null;
    readonly fontSizePt: number | null;
    readonly bold: boolean;
    readonly italic: boolean;
    readonly color: string | null;
  };
}

const EMPTY_OPTIONS: readonly ParagraphStyleOption[] = Object.freeze([]);
const selectStyleId = (snapshot: EditorSnapshot) => snapshot.formatting?.styleId ?? null;
const selectSnapshot = (snapshot: EditorSnapshot) => snapshot;

/** @public */
export interface UseParagraphStyleResult {
  readonly value: ComputedRef<string | null>;
  readonly setValue: (styleId: string) => void;
  readonly options: ComputedRef<readonly ParagraphStyleOption[]>;
  readonly isEnabled: ComputedRef<boolean>;
}

/** @public */
export function useParagraphStyle(): UseParagraphStyleResult {
  const editorRef = useDocxEditor();
  const value = useEditorState(selectStyleId);
  const snapshot = useEditorState(selectSnapshot);
  const translation = useTranslation();
  const options = computed(() =>
    editorRef.value && !snapshot.value.isLoading
      ? editorRef.value
          .getDocumentStyles()
          .filter((style) => style.type === 'paragraph')
          .map((style) => {
            // A built-in style takes its label in the UI language.
            const builtIn = builtInParagraphStyleLabel(style.name);
            return {
              styleId: style.styleId,
              name: builtIn
                ? translation.t(builtIn.key, builtIn.vars)
                : paragraphStyleDisplayName(style.name, style.styleId),
              preview: style.preview,
            };
          })
      : EMPTY_OPTIONS
  );
  const command = useEditorCommand('styles.style');

  const setValue = (styleId: string) => {
    if (!editorRef.value) return;
    const cmd = commandForSlotValue('styles.style', styleId);
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
