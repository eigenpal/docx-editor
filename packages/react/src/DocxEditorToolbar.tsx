// Toolbar (interactive-paginated-editing M4.5, extended to full legacy parity at M6V.1).
// Shared adapter presentation and compatibility behavior.
// presentation. The legacy toolbar imported `prosemirror-history` and read
// `undoDepth`/`redoDepth` off a PM `EditorState` to decide what was enabled —
// exactly the adapter-side PM access the greenfield architecture forbids.
//
// Here every control's enabled state is one `Editor.can(command)` answer, and a
// click runs `Editor.exec(command)` only after `can` said yes. Save is not a
// command: it calls `Editor.save()` directly. A control the engine cannot honour
// renders disabled with the engine's own reason as its tooltip, so the UI can
// never claim a capability the engine does not have.
//
// M6V.1 renders the COMPLETE legacy group set for visual parity. Groups, ordering,
// icons, and i18n keys all come from `LEGACY_CHROME_GROUPS` in engine-editor so
// React and Vue cannot drift — a previous round of this change grew 24 React-only
// exports by putting shared shape in one adapter, and only a full-repo
// export-parity sweep caught it.
//
// Only undo, redo, bold, italic, and save may act. Everything else is present,
// visible, and permanently disabled: dropping it would understate the parity gap,
// and enabling it would claim a capability that does not exist.

import type { ReactNode } from 'react';
import type { Editor } from '@docx-editor.dev/core-contract/editor';
import {
  LEGACY_CHROME_GROUPS,
  LEGACY_CHROME_UNAVAILABLE_KEY,
  type LegacyChromeControl,
} from '@docx-editor.dev/engine-editor';
import { useEditorSnapshot } from './useEditorSnapshot';
import { runToolbarCommand, toolbarCommandState } from './toolbarCommands';

/**
 * Resolves an i18n key to display text.
 *
 * Required, not optional with an English fallback. `packages/i18n/en.json` is the
 * repo's single source of truth for user-facing strings, so shipping a fallback
 * table inside the adapter would create a second one — and CLAUDE.md forbids
 * hardcoded user-facing English in components. The host supplies the translator;
 * the adapter only ever holds keys.
 */
export type Translate = (key: string) => string;

function ToolbarIcon({ paths }: { readonly paths: readonly string[] }): ReactNode {
  return (
    <svg viewBox="0 -960 960 960" width="18" height="18" aria-hidden="true" focusable="false">
      {paths.map((d) => (
        <path key={d} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}

function ControlButton({
  editor,
  control,
  t,
  onSave,
}: {
  readonly editor: Editor | null;
  readonly control: LegacyChromeControl;
  readonly t: Translate;
  readonly onSave?: () => void;
}): ReactNode {
  const label = t(control.labelKey);

  // A picker (font, size, style, zoom) renders as a disabled combobox rather than
  // a button, because that is its legacy shape and the parity gate compares shapes.
  if (control.paths === null) {
    return (
      <span className="ep-toolbar__picker" data-testid={`toolbar-${control.id}`} aria-disabled="true">
        <span className="ep-toolbar__picker-value">{control.valueKey ? t(control.valueKey) : ''}</span>
        <span className="ep-toolbar__picker-caret" aria-hidden="true">
          ▾
        </span>
        <span className="ep-sr-only">{`${label} — ${t(LEGACY_CHROME_UNAVAILABLE_KEY)}`}</span>
      </span>
    );
  }

  if (control.state.kind === 'parityOnly') {
    const reason = `${label} — ${t(LEGACY_CHROME_UNAVAILABLE_KEY)}`;
    return (
      <button
        type="button"
        className="ep-toolbar__button"
        data-testid={`toolbar-${control.id}`}
        data-parity-only="true"
        disabled
        title={reason}
        aria-label={reason}
      >
        <ToolbarIcon paths={control.paths} />
      </button>
    );
  }

  if (control.state.kind === 'save') {
    return (
      <button
        type="button"
        className="ep-toolbar__button"
        data-testid={`toolbar-${control.id}`}
        disabled={!editor || !onSave}
        title={label}
        aria-label={label}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onSave}
      >
        <ToolbarIcon paths={control.paths} />
      </button>
    );
  }

  const commandId = control.state.command;
  const state = toolbarCommandState(editor, commandId);
  // No active/pressed state.
  //
  // A toolbar should show whether bold is currently ON, and the repo's own guidance
  // says controls must reflect live editor state rather than being static. It is
  // omitted here because `CanResult` is `{ ok } | { ok, code, reason }` — the public
  // contract can answer "may this run?" but not "is it currently applied?".
  // Surfacing it needs a new public query, and M6V.1 is explicitly a visual-shell
  // gate that must not widen the feature surface. Tracked as a known gap.
  return (
    <button
      type="button"
      className="ep-toolbar__button"
      data-testid={`toolbar-${control.id}`}
      disabled={!state.enabled}
      // The engine's own words, never an adapter paraphrase.
      title={state.disabledReason ?? label}
      aria-label={label}
      onMouseDown={(event) => event.preventDefault()} // keep focus on the editor
      onClick={() => runToolbarCommand(editor, commandId)}
    >
      <ToolbarIcon paths={control.paths} />
    </button>
  );
}

export interface DocxEditorToolbarProps {
  readonly editor: Editor | null;
  /** Resolves i18n keys. The adapter ships no English of its own. */
  readonly t: Translate;
  /** Save handler — the host decides what to do with the bytes. */
  readonly onSave?: () => void;
}

export function DocxEditorToolbar({ editor, t, onSave }: DocxEditorToolbarProps): ReactNode {
  // Re-render as the selection and document change, or `can()` answers go stale.
  useEditorSnapshot(editor);
  return (
    <div
      className="ep-toolbar"
      role="toolbar"
      aria-label={t('toolbar.ariaLabel')}
      data-testid="docx-editor-toolbar"
    >
      {LEGACY_CHROME_GROUPS.map((group, index) => (
        <div key={group.id} className="ep-toolbar__group-wrap">
          {index > 0 ? <div className="ep-toolbar__separator" role="separator" /> : null}
          <div className="ep-toolbar__group" role="group" aria-label={t(group.labelKey)} data-group={group.id}>
            {group.controls.map((control) => (
              <ControlButton key={control.id} editor={editor} control={control} t={t} onSave={onSave} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
