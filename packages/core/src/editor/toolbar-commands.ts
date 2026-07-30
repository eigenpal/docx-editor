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
//
// ONE COMMAND VOCABULARY. Controls are addressed by their `ChromeSlotId`
// (`text.bold`, `history.undo`) — the same public slot taxonomy the chrome
// registry defines — and `commandForSlot` is the single table mapping a slot to
// its engine command. This replaces the two overlapping vocabularies that used
// to live here and in chrome-controls.ts (`ToolbarCommandId` and
// `ChromeCommandId`), which had already drifted on whether underline existed.

import type {
  CanResult,
  Editor,
  EditorCommand,
  ExecResult,
} from '@docx-editor.dev/core-contract/contracts/editor';
import type { ChromeSlotId } from './chrome-controls.ts';

/**
 * The one slot → engine-command table.
 *
 * A slot absent here is NOT WIRED YET: `commandForSlot` answers `null`, and
 * `toolbarCommandState` reports it disabled with that reason. Wiring a control is
 * adding one row — both adapters light up together. Save is deliberately absent:
 * `Editor.save()` is not a command (see `runSave`), and the chrome registry marks
 * the save control `kind: 'save'`.
 */
const SLOT_COMMANDS: Partial<Record<ChromeSlotId, EditorCommand>> = {
  'history.undo': { type: 'undo' },
  'history.redo': { type: 'redo' },
  'text.bold': { type: 'toggleMark', mark: 'bold' },
  'text.italic': { type: 'toggleMark', mark: 'italic' },
  'text.underline': { type: 'toggleMark', mark: 'underline' },
  'text.strike': { type: 'toggleMark', mark: 'strike' },
  'alignment.left': { type: 'setAlignment', align: 'left' },
  'alignment.center': { type: 'setAlignment', align: 'center' },
  'alignment.right': { type: 'setAlignment', align: 'right' },
  'alignment.justify': { type: 'setAlignment', align: 'justify' },
};

/**
 * The public editor command behind one chrome slot, or `null` when the slot is
 * not wired to a command yet (parity-only chrome, or save — which is not a
 * command). The single source of command truth for both adapters.
 *
 * @public
 */
export function commandForSlot(slotId: ChromeSlotId): EditorCommand | null {
  return SLOT_COMMANDS[slotId] ?? null;
}

/**
 * Whether one control is enabled, and the engine's reason when it is not.
 *
 * @public
 */
export interface ToolbarCommandState {
  readonly id: ChromeSlotId;
  readonly enabled: boolean;
  /** The engine's reason when disabled — surfaced as a tooltip, never invented. */
  readonly disabledReason: string | null;
  /** Whether the command is currently APPLIED at the selection, from `Editor.isActive` —
   *  derived in the engine for marks and alignment, honest-false elsewhere. */
  readonly active: boolean;
}

/**
 * Ask the engine whether one control should be enabled.
 *
 * @public
 */
export function toolbarCommandState(editor: Editor | null, id: ChromeSlotId): ToolbarCommandState {
  if (!editor) return { id, enabled: false, disabledReason: 'editor is not ready', active: false };
  const command = commandForSlot(id);
  if (!command) {
    return { id, enabled: false, disabledReason: 'not wired to an editor command', active: false };
  }
  const result: CanResult = editor.can(command);
  // Optional call: `isActive` is newer than this helper's callers, and a host or test
  // double built against the earlier contract must not crash the toolbar. Absent means
  // "not active", which is the same honest default an underived command returns.
  const active = editor.isActive?.(command) ?? false;
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
  ids: readonly ChromeSlotId[]
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
export function runToolbarCommand(editor: Editor | null, id: ChromeSlotId): ExecResult {
  if (!editor) return { ok: false, code: 'unsupported', reason: 'editor is not ready' };
  const command = commandForSlot(id);
  if (!command) {
    return { ok: false, code: 'unsupported', reason: 'not wired to an editor command' };
  }
  const allowed = editor.can(command);
  if (!allowed.ok) return { ok: false, code: allowed.code, reason: allowed.reason };
  return editor.exec(command);
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
