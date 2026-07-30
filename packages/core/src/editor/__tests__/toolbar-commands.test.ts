// Toolbar can-before-exec wiring (interactive-paginated-editing M4.0), re-keyed on the
// public `ChromeSlotId` vocabulary — one command table (`commandForSlot`) for both
// adapters, replacing the drifted `ToolbarCommandId`/`ChromeCommandId` pair.

import { describe, expect, test } from 'bun:test';
import type {
  CanResult,
  Editor,
  EditorCommand,
  ExecResult,
} from '@docx-editor.dev/core-contract/contracts/editor';
import {
  commandForSlot,
  commandForSlotValue,
  runSave,
  runToolbarCommand,
  toolbarCommandState,
  toolbarCommandStates,
} from '../toolbar-commands.ts';

interface Calls {
  readonly can: EditorCommand[];
  readonly exec: EditorCommand[];
  saves: number;
}

function fakeEditor(
  canResult: (command: EditorCommand) => CanResult,
  execResult: ExecResult = { ok: true, changed: true }
): { editor: Editor; calls: Calls } {
  const calls: Calls = { can: [], exec: [], saves: 0 };
  const editor = {
    can: (command: EditorCommand) => {
      calls.can.push(command);
      return canResult(command);
    },
    exec: (command: EditorCommand) => {
      calls.exec.push(command);
      return execResult;
    },
    save: async () => {
      calls.saves += 1;
      return new ArrayBuffer(8);
    },
  } as unknown as Editor;
  return { editor, calls };
}

const ALLOW = (): CanResult => ({ ok: true });
const DENY = (reason: string) => (): CanResult => ({ ok: false, code: 'unsupported', reason });

describe('slot → command table (commandForSlot)', () => {
  test('wired slots resolve to their public editor commands', () => {
    expect(commandForSlot('text.bold')).toEqual({ type: 'toggleMark', mark: 'bold' });
    expect(commandForSlot('text.italic')).toEqual({ type: 'toggleMark', mark: 'italic' });
    expect(commandForSlot('text.underline')).toEqual({ type: 'toggleMark', mark: 'underline' });
    expect(commandForSlot('text.strike')).toEqual({ type: 'toggleMark', mark: 'strike' });
    expect(commandForSlot('history.undo')).toEqual({ type: 'undo' });
    expect(commandForSlot('history.redo')).toEqual({ type: 'redo' });
    expect(commandForSlot('alignment.left')).toEqual({ type: 'setAlignment', align: 'left' });
    expect(commandForSlot('alignment.center')).toEqual({ type: 'setAlignment', align: 'center' });
    expect(commandForSlot('alignment.right')).toEqual({ type: 'setAlignment', align: 'right' });
    expect(commandForSlot('alignment.justify')).toEqual({ type: 'setAlignment', align: 'justify' });
  });

  test('an unwired slot answers null, never an invented command', () => {
    expect(commandForSlot('text.highlight')).toBeNull();
    expect(commandForSlot('font.family')).toBeNull();
    // Save is not a command — it goes through runSave.
    expect(commandForSlot('file.save')).toBeNull();
  });
});

describe('toolbar command wiring (task M4.0)', () => {
  test('a control asks can() and is enabled by its answer', () => {
    const { editor, calls } = fakeEditor(ALLOW);
    // `active` comes from `Editor.isActive`; the fake editor omits the method entirely,
    // which must read as "not active", never crash.
    expect(toolbarCommandState(editor, 'text.bold')).toEqual({
      id: 'text.bold',
      enabled: true,
      disabledReason: null,
      active: false,
    });
    expect(calls.can).toEqual([{ type: 'toggleMark', mark: 'bold' }]);
  });

  test('active reflects Editor.isActive when the editor implements it', () => {
    const { editor } = fakeEditor(ALLOW);
    (editor as { isActive?: (c: EditorCommand) => boolean }).isActive = (c) =>
      c.type === 'toggleMark' && c.mark === 'bold';
    expect(toolbarCommandState(editor, 'text.bold').active).toBe(true);
    expect(toolbarCommandState(editor, 'text.italic').active).toBe(false);
  });

  test('an unwired slot is disabled without ever calling the editor', () => {
    const { editor, calls } = fakeEditor(ALLOW);
    // `text.highlight` graduated to a value-typed slot; `text.link` stays unwired.
    const state = toolbarCommandState(editor, 'text.link');
    expect(state.enabled).toBe(false);
    expect(state.disabledReason).toBe('not wired to an editor command');
    expect(calls.can).toEqual([]);
    expect(runToolbarCommand(editor, 'text.highlight')).toEqual({
      ok: false,
      code: 'unsupported',
      reason: 'not wired to an editor command',
    });
    expect(calls.exec).toEqual([]);
  });

  test('a refused control is disabled and carries the engine reason verbatim', () => {
    const { editor } = fakeEditor(DENY('underline is not modeled as a toggle'));
    const state = toolbarCommandState(editor, 'text.underline');
    expect(state.enabled).toBe(false);
    // The reason must be the engine's own words, not an adapter paraphrase.
    expect(state.disabledReason).toBe('underline is not modeled as a toggle');
  });

  test('exec never runs when can() said no', () => {
    const { editor, calls } = fakeEditor(DENY('nope'));
    const result = runToolbarCommand(editor, 'text.bold');
    expect(result).toEqual({ ok: false, code: 'unsupported', reason: 'nope' });
    expect(calls.exec).toEqual([]);
  });

  test('exec runs exactly once after can() said yes', () => {
    const { editor, calls } = fakeEditor(ALLOW);
    expect(runToolbarCommand(editor, 'text.italic')).toEqual({ ok: true, changed: true });
    expect(calls.can).toHaveLength(1);
    expect(calls.exec).toEqual([{ type: 'toggleMark', mark: 'italic' }]);
  });

  test('a refusal is returned as a refusal, never flattened into a no-op', () => {
    const { editor } = fakeEditor(DENY('locked'));
    const result = runToolbarCommand(editor, 'history.undo');
    expect(result.ok).toBe(false);
    // A caller must be able to tell "declined" from "ran and changed nothing".
    expect(result).not.toEqual({ ok: true, changed: false });
  });

  test('a missing editor disables every control instead of throwing', () => {
    const states = toolbarCommandStates(null, [
      'text.bold',
      'text.italic',
      'text.underline',
      'history.undo',
      'history.redo',
    ]);
    expect(states.every((s) => !s.enabled)).toBe(true);
    expect(states.every((s) => s.disabledReason === 'editor is not ready')).toBe(true);
    expect(runToolbarCommand(null, 'text.bold').ok).toBe(false);
  });

  test('save calls Editor.save directly and is not routed through can/exec', () => {
    const { editor, calls } = fakeEditor(ALLOW);
    void runSave(editor);
    expect(calls.saves).toBe(1);
    expect(calls.can).toEqual([]);
    expect(calls.exec).toEqual([]);
  });

  test('states are computed per control, not shared', () => {
    const { editor } = fakeEditor((command) =>
      command.type === 'toggleMark' && command.mark === 'underline'
        ? { ok: false, code: 'unsupported', reason: 'w:u carries a style' }
        : { ok: true }
    );
    const states = toolbarCommandStates(editor, ['text.bold', 'text.underline', 'history.undo']);
    expect(states.map((s) => s.enabled)).toEqual([true, false, true]);
    expect(states[1]!.disabledReason).toBe('w:u carries a style');
  });
});

describe('value-typed slots (commandForSlotValue)', () => {
  test('resolves the four value slots to setMarkAttr commands carrying the value', () => {
    expect(commandForSlotValue('font.family', 'Georgia')).toEqual({
      type: 'setMarkAttr',
      mark: 'fontFamily',
      attr: 'family',
      value: 'Georgia',
    });
    expect(commandForSlotValue('font.size', 28)).toEqual({
      type: 'setMarkAttr',
      mark: 'fontSize',
      attr: 'val',
      value: 28,
    });
    expect(commandForSlotValue('font.color', 'FF0000')).toEqual({
      type: 'setMarkAttr',
      mark: 'color',
      attr: 'val',
      value: 'FF0000',
    });
    expect(commandForSlotValue('text.highlight', 'yellow')).toEqual({
      type: 'setMarkAttr',
      mark: 'highlight',
      attr: 'val',
      value: 'yellow',
    });
    // A slot that does not take a value has no value command.
    expect(commandForSlotValue('text.bold', true)).toBeNull();
    expect(commandForSlotValue('image.insert', 'x')).toBeNull();
  });

  test('toolbarCommandState answers enabled-when-editable and never active for value slots', () => {
    const { editor, calls } = fakeEditor(ALLOW);
    const state = toolbarCommandState(editor, 'font.family');
    expect(state).toEqual({
      id: 'font.family',
      enabled: true,
      disabledReason: null,
      active: false,
    });
    // The probe asked `can` with a well-formed setMarkAttr, not a bare slot command.
    expect(calls.can[0]).toMatchObject({ type: 'setMarkAttr', mark: 'fontFamily' });

    const denied = fakeEditor(DENY('the document is read-only'));
    expect(toolbarCommandState(denied.editor, 'font.size')).toEqual({
      id: 'font.size',
      enabled: false,
      disabledReason: 'the document is read-only',
      active: false,
    });
  });
});
