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
  'script.super': { type: 'toggleMark', mark: 'superscript' },
  'script.sub': { type: 'toggleMark', mark: 'subscript' },
  'format.clear': { type: 'clearFormatting' },
  'alignment.left': { type: 'setAlignment', align: 'left' },
  'alignment.center': { type: 'setAlignment', align: 'center' },
  'alignment.right': { type: 'setAlignment', align: 'right' },
  'alignment.justify': { type: 'setAlignment', align: 'justify' },
  'list.bullet': { type: 'toggleList', kind: 'bullet' },
  'list.numbered': { type: 'toggleList', kind: 'ordered' },
  'list.indent': { type: 'adjustIndent', direction: 'increase' },
  'list.outdent': { type: 'adjustIndent', direction: 'decrease' },
  'insert.pageBreak': { type: 'insertBreak', kind: 'page' },
  'insert.sectionBreakNextPage': { type: 'insertBreak', kind: 'section' },
  // `insert.sectionBreakContinuous` and `insert.toc` are deliberately absent: a continuous
  // section break is not in the `insertBreak` vocabulary, and a table of contents is not an
  // edit the tree editor executes. Neither has a command SHAPE to probe with either, so
  // their disabled reason is this table's, not the engine's — see `toolbarCommandState`.
};

/**
 * The probe a slot uses to ask "would the engine honour this right now?" when its real
 * command needs an argument the slot itself cannot supply.
 *
 * `text.link` is the case: whether this selection could become a link is the engine's
 * question, but WHICH link is a URL field's. Chrome that owns a link UI (React's
 * `ToolbarLink`) asks with this and dispatches through that UI.
 *
 * DELIBERATELY NOT in `SLOT_COMMANDS`. Enabled state has one source, and putting the probe
 * there would enable the control in EVERY adapter — including Vue, which has grown no link
 * UI, where the result is an enabled button whose click can only be refused. A dead button
 * is the worse lie: `file.save` was a disabled control for a capability that works, and this
 * would be an enabled control for one that is not reachable. Vue's slot therefore keeps
 * reporting the honest "not wired to an editor command" until its popover lands.
 *
 * @public
 */
export function chromeProbeForSlot(slotId: ChromeSlotId): EditorCommand | null {
  return CHROME_PROBES[slotId] ?? null;
}

const CHROME_PROBES: Partial<Record<ChromeSlotId, EditorCommand>> = {
  'text.link': { type: 'insertHyperlink', href: 'https://example.com' },
  // Insert image and insert table have a real command shape (`insertImage`/`insertTable`
  // are in the edit vocabulary), they are simply not executed by this engine yet. Probing
  // means their disabled tooltip is the ENGINE saying so in its own words instead of chrome
  // guessing — and the day the engine wires them, `can` starts answering yes and the probe
  // stops being the reason they are disabled, with no registry edit needed. `data` and
  // `rows`/`cols` are shape-satisfying placeholders; the probe is never executed.
  'image.insert': { type: 'insertImage', data: new Uint8Array(0) },
  'table.insert': { type: 'insertTable', rows: 1, cols: 1 },
  // Page setup is the same shape: whether this document's sections can be rewritten is the
  // engine's question, but WHICH size, orientation and margins is the dialog's. The probe
  // names one field so `classifyCommand`'s "requires at least one field" gate passes; it is
  // never executed, and the dialog sends the user's real values.
  'file.pageSetup': { type: 'setPageSetup', orientation: 'portrait' },
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

/** The `setMarkAttr` mark behind each value-typed slot. */
const VALUE_SLOT_MARKS: Partial<Record<ChromeSlotId, { mark: string; attr: string }>> = {
  'font.family': { mark: 'fontFamily', attr: 'family' },
  'font.size': { mark: 'fontSize', attr: 'val' },
  'text.color': { mark: 'color', attr: 'val' },
  'text.highlight': { mark: 'highlight', attr: 'val' },
};

/**
 * Known-valid probe values, so `toolbarCommandState` can ask `Editor.can` about a
 * value-typed slot without having a value yet. The probe never executes: it only
 * answers "would a well-formed value be honoured right now" — which is the editable
 * gate, exactly what enables the picker. The style probe passes the SHAPE gate on any
 * document (existence is an exec-time check), which is exactly right: the picker's
 * options come from `getDocumentStyles`, so a real pick always exists.
 */
const VALUE_SLOT_PROBES: Partial<Record<ChromeSlotId, unknown>> = {
  'font.family': 'Arial',
  'font.size': 22,
  'text.color': '000000',
  'text.highlight': 'yellow',
  'styles.style': 'Normal',
  // Single spacing: the one pick every document can honour, so the probe answers the
  // editable gate and nothing narrower.
  'list.lineSpacing': 1,
};

/**
 * The engine command for a VALUE-TYPED slot carrying the picked value, or `null` for a
 * slot that does not take a value.
 *
 * Two families: the run-property pickers (`font.family`, `font.size`, `text.color`,
 * `text.highlight`) resolve to `setMarkAttr`, and `styles.style` resolves to
 * `setParagraphStyle` — a paragraph styleId, not a mark. Either way the value is
 * validated by the engine's own gate (`can` refuses a malformed one with `invalidArgs`;
 * a styleId the document does not define is refused at `exec`), so a host can pass user
 * input through unmodified.
 *
 * @public
 */
export function commandForSlotValue(slotId: ChromeSlotId, value: unknown): EditorCommand | null {
  // The style picker is value-typed but not a MARK: its value is a paragraph styleId.
  // Passed through unvalidated like the mark values — the engine's own gate refuses a
  // malformed one (`classifyCommand`) and an unknown one (`exec`), with typed reasons.
  if (slotId === 'styles.style') {
    return { type: 'setParagraphStyle', styleId: value as string };
  }
  // The line-spacing picker's value is a MULTIPLE (Word's 1.0 / 1.15 / 1.5 / 2.0 menu).
  // `exact` and `atLeast` are the paragraph dialog's, not a one-number dropdown's, so a
  // host that wants them builds `setLineSpacing` itself.
  if (slotId === 'list.lineSpacing') {
    return { type: 'setLineSpacing', rule: 'multiple', value: value as number };
  }
  const entry = VALUE_SLOT_MARKS[slotId];
  if (!entry) return null;
  return { type: 'setMarkAttr', mark: entry.mark, attr: entry.attr, value };
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
    // A value-typed slot has no fixed command, but it still has an honest enabled
    // state: whether a well-formed value would be honoured right now. `active` stays
    // false — "the selection is Arial" is a VALUE for the picker to show, not a
    // pressed state.
    const probe = VALUE_SLOT_PROBES[id];
    if (probe !== undefined) {
      const canApply: CanResult = editor.can(commandForSlotValue(id, probe)!);
      return canApply.ok
        ? { id, enabled: true, disabledReason: null, active: false }
        : { id, enabled: false, disabledReason: canApply.reason, active: false };
    }
    // A slot with a PROBE has a command shape the engine can judge, even though no fixed
    // command can be dispatched from a bare click. When the engine REFUSES the probe, that
    // refusal is the honest reason and it is the engine's own words — quote it rather than
    // inventing one. When the engine ALLOWS it, the gap is this chrome's, not the engine's,
    // so the answer falls through below: the capability exists, this control cannot reach
    // it. That asymmetry is deliberate — reporting "enabled" here would light up
    // `text.link` in an adapter that has grown no link UI, which is the enabled-dead-button
    // this table exists to avoid.
    const shapeProbe = CHROME_PROBES[id];
    if (shapeProbe) {
      const judged: CanResult = editor.can(shapeProbe);
      if (!judged.ok) {
        return { id, enabled: false, disabledReason: judged.reason, active: false };
      }
    }
    // Save is wired — just not as a command. Reporting it "not wired to an editor
    // command" told a host the capability is missing when what is actually missing is a
    // COMMAND for it: the control runs `runSave`, and both adapters reach it by branching
    // on the registry's `kind: 'save'`. Say which of the two it is.
    if (id === 'file.save') {
      return {
        id,
        enabled: false,
        disabledReason: 'save is not a command; run it with runSave(editor)',
        active: false,
      };
    }
    // Open is save's twin and gets the same distinction: the capability is there, a
    // COMMAND for it is not. Bytes come from a picker the host owns and go in through
    // `Editor.load`, so chrome that has one drives the control itself.
    if (id === 'file.open') {
      return {
        id,
        enabled: false,
        disabledReason: 'open is not a command; run it with editor.load(bytes)',
        active: false,
      };
    }
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
    if (id === 'file.save') {
      return {
        ok: false,
        code: 'unsupported',
        reason: 'save is not a command; run it with runSave(editor)',
      };
    }
    if (id === 'file.open') {
      return {
        ok: false,
        code: 'unsupported',
        reason: 'open is not a command; run it with editor.load(bytes)',
      };
    }
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
