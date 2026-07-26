// Toolbar command wiring (interactive-paginated-editing M4.0 / M5.1).
//
// Shared by both adapters: the can-before-exec rule is one implementation, so
// React and Vue toolbars cannot drift on when a control is enabled.
//
// The toolbar never calls `Editor.exec` blind. Every formatting and history
// control asks `Editor.can(command)` first: that single answer decides both
// whether the button is enabled and whether the click is allowed to run. A
// control the engine cannot honour is disabled with the engine's own reason,
// rather than looking live and failing silently when pressed.

import type {
  CanResult,
  Editor,
  EditorCommand,
  ExecResult,
} from '@docx-editor.dev/core-contract/editor';

/**
 * The controls this toolbar exposes.
 *
 * @public
 */
export type ToolbarCommandId = 'bold' | 'italic' | 'underline' | 'undo' | 'redo';

const COMMANDS: Record<ToolbarCommandId, EditorCommand> = {
  bold: { type: 'toggleMark', mark: 'bold' },
  italic: { type: 'toggleMark', mark: 'italic' },
  underline: { type: 'toggleMark', mark: 'underline' },
  undo: { type: 'undo' },
  redo: { type: 'redo' },
};

/**
 * The public editor command behind one control.
 *
 * @public
 */
export function toolbarCommand(id: ToolbarCommandId): EditorCommand {
  return COMMANDS[id];
}

/**
 * Whether one control is enabled, and the engine's reason when it is not.
 *
 * @public
 */
export interface ToolbarCommandState {
  readonly id: ToolbarCommandId;
  readonly enabled: boolean;
  /** The engine's reason when disabled — surfaced as a tooltip, never invented. */
  readonly disabledReason: string | null;
  /** Whether the command is currently APPLIED at the selection, from `Editor.isActive`.
   *  A placeholder in the engine today (always `false`), so the wiring exists in both
   *  adapters before the derivation does. */
  readonly active: boolean;
}

/**
 * Ask the engine whether one control should be enabled.
 *
 * @public
 */
export function toolbarCommandState(
  editor: Editor | null,
  id: ToolbarCommandId
): ToolbarCommandState {
  if (!editor) return { id, enabled: false, disabledReason: 'editor is not ready', active: false };
  const result: CanResult = editor.can(COMMANDS[id]);
  // Optional call: `isActive` is newer than this helper's callers, and a host or test
  // double built against the earlier contract must not crash the toolbar. Absent means
  // "not active", which is the same honest default the engine placeholder returns.
  const active = editor.isActive?.(COMMANDS[id]) ?? false;
  return result.ok
    ? { id, enabled: true, disabledReason: null, active }
    : { id, enabled: false, disabledReason: result.reason, active };
}

/**
 * Enabled state for several controls in one pass.
 *
 * @public
 */
export function toolbarCommandStates(
  editor: Editor | null,
  ids: readonly ToolbarCommandId[]
): readonly ToolbarCommandState[] {
  return ids.map((id) => toolbarCommandState(editor, id));
}

/**
 * Run a toolbar control: `can` first, then `exec` only if it said yes. Returns
 * the engine's refusal untouched when it said no, so a caller cannot mistake a
 * declined command for a no-op.
 *
 * @public
 */
export function runToolbarCommand(editor: Editor | null, id: ToolbarCommandId): ExecResult {
  if (!editor) return { ok: false, code: 'unsupported', reason: 'editor is not ready' };
  const allowed = editor.can(COMMANDS[id]);
  if (!allowed.ok) return { ok: false, code: allowed.code, reason: allowed.reason };
  return editor.exec(COMMANDS[id]);
}

/**
 * Save goes straight to `Editor.save()` — it is not a command.
 *
 * @public
 */
export function runSave(editor: Editor | null): Promise<ArrayBuffer> {
  if (!editor) return Promise.reject(new Error('editor is not ready'));
  return editor.save();
}
