import { type ShallowRef } from 'vue';
import type { Editor, EditorSnapshot, ViewScope } from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';

function noteScopeEqual(a: ViewScope | null, b: ViewScope | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'note' && b.kind === 'note') return a.id === b.id;
  if (a.kind === 'headerFooter' && b.kind === 'headerFooter') return a.rId === b.rId;
  return true;
}

/** @public */
export function useNoteScopeState(): ShallowRef<Extract<ViewScope, { kind: 'note' }> | null> {
  const editorRef = useDocxEditor();
  const select = (_snapshot: EditorSnapshot): Extract<ViewScope, { kind: 'note' }> | null => {
    const scope = editorRef.value?.getActiveScope();
    return scope?.kind === 'note' ? scope : null;
  };
  return useEditorState(select, noteScopeEqual);
}

/** @public */
export type NotePropertiesState = Exclude<ReturnType<Editor['getNotePropertiesState']>, null>;

type AuthoredNoteNumbering = NonNullable<NotePropertiesState['footnote']['documentAuthored']>;

function authoredNoteNumberingEqual(
  a: AuthoredNoteNumbering | undefined,
  b: AuthoredNoteNumbering | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.pos === b.pos &&
    a.numFmt === b.numFmt &&
    a.numStart === b.numStart &&
    a.numRestart === b.numRestart
  );
}

function notePropertiesSideEqual(
  a: NotePropertiesState['footnote'],
  b: NotePropertiesState['footnote']
): boolean {
  return (
    a.resolved.pos === b.resolved.pos &&
    a.resolved.numFmt === b.resolved.numFmt &&
    a.resolved.numStart === b.resolved.numStart &&
    a.resolved.numRestart === b.resolved.numRestart &&
    authoredNoteNumberingEqual(a.documentAuthored, b.documentAuthored) &&
    authoredNoteNumberingEqual(a.sectionAuthored, b.sectionAuthored)
  );
}

function notePropertiesEqual(
  a: NotePropertiesState | null,
  b: NotePropertiesState | null
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.sectionIndex === b.sectionIndex &&
    notePropertiesSideEqual(a.footnote, b.footnote) &&
    notePropertiesSideEqual(a.endnote, b.endnote)
  );
}

/** @public */
export function useNotePropertiesState(): ShallowRef<NotePropertiesState | null> {
  const editorRef = useDocxEditor();
  const select = (_snapshot: EditorSnapshot): NotePropertiesState | null =>
    editorRef.value?.getNotePropertiesState() ?? null;
  return useEditorState(select, notePropertiesEqual);
}
