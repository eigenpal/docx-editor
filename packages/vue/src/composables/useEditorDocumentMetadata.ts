import { computed, type ComputedRef, type Ref } from 'vue';
import type { EditorView } from 'prosemirror-view';
import { extractSelectionContext } from '@docx-editor.dev/core/prosemirror/plugins/selectionTracker';
import type {
  Document,
  SectionProperties,
  StyleDefinitions,
  Theme,
} from '@docx-editor.dev/core/types/document';

type ParagraphFormatting = ReturnType<typeof extractSelectionContext>['paragraphFormatting'];

export interface UseEditorDocumentMetadataReturn {
  currentSectionProps: ComputedRef<SectionProperties | null>;
  rulerIndents: ComputedRef<{
    indentLeft: number;
    indentRight: number;
    firstLineIndent: number;
    hangingIndent: boolean;
    tabMarks: ParagraphFormatting['tabs'] | null;
  }>;
  documentTheme: ComputedRef<Theme | null>;
  documentStyles: ComputedRef<StyleDefinitions['styles'] | undefined>;
}

export function useEditorDocumentMetadata(
  stateTick: Ref<number>,
  editorView: Ref<EditorView | null>,
  getDocument: () => Document | null,
  fallbackTheme: () => Theme | null | undefined
): UseEditorDocumentMetadataReturn {
  const currentSectionProps = computed(() => {
    void stateTick.value;
    const body = getDocument()?.package?.document;
    return body?.finalSectionProperties ?? body?.sections?.[0]?.properties ?? null;
  });
  const rulerIndents = computed(() => {
    void stateTick.value;
    const view = editorView.value;
    const pf = view ? extractSelectionContext(view.state).paragraphFormatting : {};
    return {
      indentLeft: pf.indentLeft ?? 0,
      indentRight: pf.indentRight ?? 0,
      firstLineIndent: pf.indentFirstLine ?? 0,
      hangingIndent: pf.hangingIndent ?? false,
      tabMarks: pf.tabs ?? null,
    };
  });
  const documentTheme = computed(() => {
    void stateTick.value;
    return getDocument()?.package?.theme ?? fallbackTheme() ?? null;
  });
  const documentStyles = computed(() => {
    void stateTick.value;
    return getDocument()?.package?.styles?.styles;
  });
  return { currentSectionProps, rulerIndents, documentTheme, documentStyles };
}
