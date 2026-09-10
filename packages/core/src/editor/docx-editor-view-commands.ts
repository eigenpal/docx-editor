import type { CanResult, DocumentEditingMode, EditorCommand } from '../contracts/editor.ts';
import { PRO_REVIEW_REASON, type CommandRefusal } from './opening-editing-mode.ts';

/** View commands remain available in a read-only document, but never after destruction. */
export function canEditorViewCommand(
  command: EditorCommand,
  destroyed: boolean,
  reviewEnabled: boolean,
  editingModeRefusal: (mode: DocumentEditingMode) => CommandRefusal | null
): CanResult | null {
  if (
    command.type !== 'toggleReviewPane' &&
    command.type !== 'toggleParagraphMarks' &&
    command.type !== 'setEditingMode'
  )
    return null;
  if (destroyed) return { ok: false, code: 'notFound', reason: 'the editor was destroyed' };
  if (command.type === 'toggleReviewPane' && !reviewEnabled)
    return { ok: false, code: 'unsupported', reason: PRO_REVIEW_REASON };
  if (command.type === 'setEditingMode') return editingModeRefusal(command.mode) ?? { ok: true };
  return { ok: true };
}

/** Per-editor paragraph-mark preference, independent of the document and its history. */
export function createEditorParagraphMarks(onChange: (visible: boolean) => void) {
  let visible = false;
  return {
    get: () => visible,
    toggle: () => {
      visible = !visible;
      onChange(visible);
    },
  };
}
