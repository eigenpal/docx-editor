// The demo's own edit: frost a passage, or thaw it.
//
// Shared by the toolbar action and the context-menu rows on purpose. A host action reached
// from two surfaces should be ONE definition — otherwise the toolbar and the menu drift
// into disagreeing about when it is available, which is the exact failure the library
// avoids for its own controls by deriving both from the chrome registry.
//
// It is a REAL command (`setMarkAttr` on the `highlight` mark), so it undoes, redoes and
// round-trips to DOCX like any other formatting. A demo action that only moved local state
// would look the same on screen and prove nothing about the API.

import { useCallback, useMemo } from 'react';
import { useDocxEditor, useEditorCommand, useEditorState } from '@docx-editor.dev/react';
import type { EditorCommand } from '@docx-editor.dev/react';

const frostCommand = (value: string): EditorCommand => ({
  type: 'setMarkAttr',
  mark: 'highlight',
  attr: 'val',
  value,
});

export interface FrostActions {
  readonly freeze: () => void;
  readonly thaw: () => void;
  /** Whether the ENGINE would honour the edit right now. */
  readonly enabled: boolean;
  /** The engine's reason when it would not. Never invent one. */
  readonly disabledReason: string | null;
}

export function useFrost(): FrostActions {
  const editor = useDocxEditor();

  // TWO gates, because they answer two different questions.
  //
  // `useEditorCommand` reports whether the ENGINE would honour the command — false in a
  // read-only document. But the engine says yes at a collapsed caret, and correctly so:
  // `setMarkAttr` there arms the typing format, which is exactly what Word's Bold does. It
  // paints nothing, though, so a highlight button that stays live at a caret is one the user
  // presses and sees nothing happen.
  //
  // The second gate is the demo's own judgement, not a defect in `can`: THIS action is only
  // meaningful over a range. `selectionCollapsed` answers it for the cost of a boolean —
  // asking `query({ type: 'selectedText' })` would build the entire selected string, on
  // every tick this selector runs, to learn one bit.
  const { isEnabled, disabledReason } = useEditorCommand(frostCommand('cyan'));
  const collapsed = useEditorState((snapshot) => snapshot.selectionCollapsed);

  // Memoized like the library's own hooks: three surfaces render from this return, and a
  // fresh object per render would defeat any memo a consumer put between itself and it.
  const freeze = useCallback(() => editor?.exec(frostCommand('cyan')), [editor]);
  const thaw = useCallback(() => editor?.exec(frostCommand('none')), [editor]);
  return useMemo(
    () => ({
      freeze,
      thaw,
      enabled: isEnabled && !collapsed,
      disabledReason: collapsed && isEnabled ? 'nothing is selected' : disabledReason,
    }),
    [freeze, thaw, isEnabled, collapsed, disabledReason]
  );
}
