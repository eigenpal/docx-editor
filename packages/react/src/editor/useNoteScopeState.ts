// Note editing scope — reference-stable slice for notes chrome.

import { useCallback } from 'react';
import type {
  Editor,
  EditorSnapshot,
  ViewScope,
} from '@docx-editor.dev/core-contract/contracts/editor';

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

/**
 * Subscribe to the active note view scope with reference-stable results when unchanged.
 *
 * @public
 */
export function useNoteScopeState(): Extract<ViewScope, { kind: 'note' }> | null {
  const editor = useDocxEditor();
  const select = useCallback(
    (_snapshot: EditorSnapshot): Extract<ViewScope, { kind: 'note' }> | null => {
      const scope = editor?.getActiveScope();
      return scope?.kind === 'note' ? scope : null;
    },
    [editor]
  );
  const scope = useEditorState(select, noteScopeEqual);
  return scope?.kind === 'note' ? scope : null;
}

export type NotePropertiesState = Exclude<ReturnType<Editor['getNotePropertiesState']>, null>;

function notePropertiesEqual(
  a: NotePropertiesState | null,
  b: NotePropertiesState | null
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.sectionIndex === b.sectionIndex &&
    a.footnote.resolved.pos === b.footnote.resolved.pos &&
    a.footnote.resolved.numFmt === b.footnote.resolved.numFmt &&
    a.footnote.resolved.numRestart === b.footnote.resolved.numRestart &&
    a.endnote.resolved.pos === b.endnote.resolved.pos &&
    a.endnote.resolved.numFmt === b.endnote.resolved.numFmt &&
    a.endnote.resolved.numRestart === b.endnote.resolved.numRestart
  );
}

/**
 * Subscribe to `getNotePropertiesState()` with reference-stable results when unchanged.
 *
 * @public
 */
export function useNotePropertiesState(): NotePropertiesState | null {
  const editor = useDocxEditor();
  const select = useCallback(
    (_snapshot: EditorSnapshot): NotePropertiesState | null =>
      editor?.getNotePropertiesState() ?? null,
    [editor]
  );
  return useEditorState(select, notePropertiesEqual);
}
