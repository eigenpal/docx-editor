import type { Editor, EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';

/** @public */
export type HeaderFooterState = Exclude<ReturnType<Editor['getHeaderFooterState']>, null>;

function headerFooterEqual(a: HeaderFooterState | null, b: HeaderFooterState | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.editing === b.editing &&
    a.sectionIndex === b.sectionIndex &&
    a.variant === b.variant &&
    a.rId === b.rId &&
    a.partName === b.partName &&
    a.inherited === b.inherited &&
    a.titlePage === b.titlePage &&
    a.evenAndOddHeaders === b.evenAndOddHeaders &&
    a.headerDistanceTwips === b.headerDistanceTwips &&
    a.footerDistanceTwips === b.footerDistanceTwips
  );
}

/** @public */
export function useHeaderFooterState() {
  const editorRef = useDocxEditor();
  const select = (_snapshot: EditorSnapshot): HeaderFooterState | null =>
    editorRef.value?.getHeaderFooterState() ?? null;
  return useEditorState(select, headerFooterEqual);
}
