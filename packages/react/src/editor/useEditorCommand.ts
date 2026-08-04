// One editor control, as a hook.
//
// Takes EITHER a chrome slot or a raw `EditorCommand`. The slot form derives the
// enabled/active triple through `toolbarCommandState` — the shared can-before-exec table
// both adapters use — so a registry control cannot describe itself differently in two
// places. The command form asks `Editor.can`/`isActive` about the command directly.
//
// BOTH forms exist because the registry is not the whole vocabulary. It describes toolbar
// and menu-bar controls; commands like `cut`, `selectAll` or a host's own `setMarkAttr`
// action have no slot and never will, and before this took them every such control
// hand-rolled its own copy of this derivation.
//
// Either way the component re-renders only when its OWN answer moves: the slice is
// compared field-wise, so a bold button sleeps through caret moves that change nothing
// about bold.

import { useCallback, useMemo, useRef } from 'react';
import {
  runToolbarCommand,
  toolbarCommandState,
  type ChromeSlotId,
} from '@docx-editor.dev/core-contract/editor';
import type { EditorCommand } from '@docx-editor.dev/core-contract/contracts/editor';
import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';

/**
 * The live state of one editor control, plus its action.
 *
 * @public
 */
export interface EditorCommandState {
  /** Run the command (can-before-exec). A refusal is a safe no-op. */
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

/** A slot is a string; a command is an object with a `type`. */
function isSlot(target: ChromeSlotId | EditorCommand): target is ChromeSlotId {
  return typeof target === 'string';
}

/**
 * Bind a chrome slot (`'text.bold'`, `'history.undo'`, …) or a raw `EditorCommand`
 * (`{ type: 'selectAll' }`) to the editor. The result object is identity-stable while its
 * fields are unchanged, so it can sit in dependency arrays and `memo` props without churn.
 *
 * @public
 */
export function useEditorCommand(target: ChromeSlotId | EditorCommand): EditorCommandState {
  const editor = useDocxEditor();

  // A COMMAND OBJECT IS REBUILT EVERY RENDER by most callers (`useEditorCommand({ type:
  // 'cut' })`), so keying the memos on its identity would resubscribe `useEditorState` on
  // every frame. The ref holds the latest value and the dependency is its `type`, which is
  // what actually changes when a caller means a different command.
  const latest = useRef(target);
  latest.current = target;
  const key = isSlot(target) ? target : target.type;

  // The snapshot argument is the change SIGNAL; the state itself comes from the engine,
  // re-read at the same version the snapshot describes.
  const selectSlice = useCallback(
    (_snapshot: unknown): CommandSlice => {
      const current = latest.current;
      if (isSlot(current)) {
        const state = toolbarCommandState(editor, current);
        return {
          active: state.active,
          enabled: state.enabled,
          disabledReason: state.disabledReason,
        };
      }
      if (!editor) return { active: false, enabled: false, disabledReason: null };
      const allowed = editor.can(current);
      return {
        active: editor.isActive(current),
        enabled: allowed.ok,
        disabledReason: allowed.ok ? null : (allowed.reason ?? null),
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the target's identity-stable shape
    [editor, key]
  );
  const slice = useEditorState(selectSlice, commandSliceEqual);

  const execute = useCallback(() => {
    const current = latest.current;
    if (isSlot(current)) {
      runToolbarCommand(editor, current);
      return;
    }
    // Can-before-exec, the same order `runToolbarCommand` uses: a refusal is a safe no-op
    // and its reason is already on `disabledReason`.
    if (editor?.can(current).ok) editor.exec(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the target's identity-stable shape
  }, [editor, key]);

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
