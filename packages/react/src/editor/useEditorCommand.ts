// One toolbar control, as a hook.
//
// Built ON `useEditorState`: the enabled/active/reason triple is derived through the
// shared `toolbarCommandState` helper (the same can-before-exec table both adapters
// use), selected with a field-wise equality so the component re-renders only when its
// OWN control's state moves — a bold button sleeps through caret moves that change
// nothing about bold. `execute` runs through `runToolbarCommand`, which asks
// `Editor.can` first; a refusal (unwired slot, read-only document, no editor yet) is a
// safe no-op, with the reason already surfaced on `disabledReason`.

import { useCallback, useMemo } from 'react';
import {
  runToolbarCommand,
  toolbarCommandState,
  type ChromeSlotId,
} from '@docx-editor.dev/core-contract/editor';
import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';

/**
 * The live state of one chrome slot, plus its action.
 *
 * @public
 */
export interface EditorCommandState {
  /** Run the slot's command (can-before-exec). A refusal is a safe no-op. */
  readonly execute: () => void;
  /** Whether the command is currently applied at the selection (bold on bold text). */
  readonly isActive: boolean;
  /** Whether the engine will honour the command right now. */
  readonly isEnabled: boolean;
  /** The engine's reason when disabled — surface it as a tooltip, never invent one. */
  readonly disabledReason: string | null;
}

interface CommandSlice {
  readonly active: boolean;
  readonly enabled: boolean;
  readonly disabledReason: string | null;
}

function commandSliceEqual(a: CommandSlice, b: CommandSlice): boolean {
  return a.active === b.active && a.enabled === b.enabled && a.disabledReason === b.disabledReason;
}

/**
 * Bind one chrome slot (`'text.bold'`, `'history.undo'`, …) to the editor. The result
 * object is identity-stable while its fields are unchanged, so it can sit in dependency
 * arrays and `memo` props without churn.
 *
 * @public
 */
export function useEditorCommand(slotId: ChromeSlotId): EditorCommandState {
  const editor = useDocxEditor();

  // The snapshot argument is the change SIGNAL; the state itself comes from the shared
  // helper, which asks `Editor.can`/`isActive` — the same authority the snapshot's
  // formatting derives from, re-read at the same version.
  const selectSlice = useCallback(
    (_snapshot: unknown): CommandSlice => {
      const state = toolbarCommandState(editor, slotId);
      return { active: state.active, enabled: state.enabled, disabledReason: state.disabledReason };
    },
    [editor, slotId]
  );
  const slice = useEditorState(selectSlice, commandSliceEqual);

  const execute = useCallback(() => {
    runToolbarCommand(editor, slotId);
  }, [editor, slotId]);

  return useMemo(
    () => ({
      execute,
      isActive: slice.active,
      isEnabled: slice.enabled,
      disabledReason: slice.disabledReason,
    }),
    [execute, slice]
  );
}
