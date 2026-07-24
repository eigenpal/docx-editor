// Toolbar can-before-exec wiring (interactive-paginated-editing M4.0).

import { describe, expect, test } from 'bun:test';
import type { CanResult, Editor, EditorCommand, ExecResult } from '@docx-editor.dev/core-contract/editor';
import {
  runSave,
  runToolbarCommand,
  toolbarCommand,
  toolbarCommandState,
  toolbarCommandStates,
} from '../src/toolbar-commands.ts';

interface Calls {
  readonly can: EditorCommand[];
  readonly exec: EditorCommand[];
  saves: number;
}

function fakeEditor(
  canResult: (command: EditorCommand) => CanResult,
  execResult: ExecResult = { ok: true, changed: true },
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

describe('toolbar command wiring (task M4.0)', () => {
  test('every control maps to a public editor command', () => {
    expect(toolbarCommand('bold')).toEqual({ type: 'toggleMark', mark: 'bold' });
    expect(toolbarCommand('italic')).toEqual({ type: 'toggleMark', mark: 'italic' });
    expect(toolbarCommand('underline')).toEqual({ type: 'toggleMark', mark: 'underline' });
    expect(toolbarCommand('undo')).toEqual({ type: 'undo' });
    expect(toolbarCommand('redo')).toEqual({ type: 'redo' });
  });

  test('a control asks can() and is enabled by its answer', () => {
    const { editor, calls } = fakeEditor(ALLOW);
    expect(toolbarCommandState(editor, 'bold')).toEqual({ id: 'bold', enabled: true, disabledReason: null });
    expect(calls.can).toEqual([{ type: 'toggleMark', mark: 'bold' }]);
  });

  test('a refused control is disabled and carries the engine reason verbatim', () => {
    const { editor } = fakeEditor(DENY('underline is not modeled as a toggle'));
    const state = toolbarCommandState(editor, 'underline');
    expect(state.enabled).toBe(false);
    // The reason must be the engine's own words, not an adapter paraphrase.
    expect(state.disabledReason).toBe('underline is not modeled as a toggle');
  });

  test('exec never runs when can() said no', () => {
    const { editor, calls } = fakeEditor(DENY('nope'));
    const result = runToolbarCommand(editor, 'bold');
    expect(result).toEqual({ ok: false, code: 'unsupported', reason: 'nope' });
    expect(calls.exec).toEqual([]);
  });

  test('exec runs exactly once after can() said yes', () => {
    const { editor, calls } = fakeEditor(ALLOW);
    expect(runToolbarCommand(editor, 'italic')).toEqual({ ok: true, changed: true });
    expect(calls.can).toHaveLength(1);
    expect(calls.exec).toEqual([{ type: 'toggleMark', mark: 'italic' }]);
  });

  test('a refusal is returned as a refusal, never flattened into a no-op', () => {
    const { editor } = fakeEditor(DENY('locked'));
    const result = runToolbarCommand(editor, 'undo');
    expect(result.ok).toBe(false);
    // A caller must be able to tell "declined" from "ran and changed nothing".
    expect(result).not.toEqual({ ok: true, changed: false });
  });

  test('a missing editor disables every control instead of throwing', () => {
    const states = toolbarCommandStates(null, ['bold', 'italic', 'underline', 'undo', 'redo']);
    expect(states.every((s) => !s.enabled)).toBe(true);
    expect(states.every((s) => s.disabledReason === 'editor is not ready')).toBe(true);
    expect(runToolbarCommand(null, 'bold').ok).toBe(false);
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
        : { ok: true },
    );
    const states = toolbarCommandStates(editor, ['bold', 'underline', 'undo']);
    expect(states.map((s) => s.enabled)).toEqual([true, false, true]);
    expect(states[1]!.disabledReason).toBe('w:u carries a style');
  });
});
