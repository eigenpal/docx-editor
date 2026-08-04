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

import { useDocxEditor, useEditorState } from '@docx-editor.dev/react';
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
  // Re-asked on every editor tick, like any other control's enabled state: a read-only
  // document, or one with no selection to format, must grey these out rather than offer an
  // action that will be refused.
  const gate = useEditorState(
    () => {
      const allowed = editor?.can(frostCommand('cyan'));
      if (!allowed) return { enabled: false, disabledReason: null };
      return allowed.ok
        ? { enabled: true, disabledReason: null }
        : { enabled: false, disabledReason: allowed.reason ?? null };
    },
    (a, b) => a.enabled === b.enabled && a.disabledReason === b.disabledReason
  );
  return {
    freeze: () => editor?.exec(frostCommand('cyan')),
    thaw: () => editor?.exec(frostCommand('none')),
    enabled: gate.enabled,
    disabledReason: gate.disabledReason,
  };
}
