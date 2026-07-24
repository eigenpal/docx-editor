// Toolbar (interactive-paginated-editing M4.5).
// Shared adapter presentation and compatibility behavior.
// presentation. The legacy toolbar imported `prosemirror-history` and read
// `undoDepth`/`redoDepth` off a PM `EditorState` to decide what was enabled —
// exactly the adapter-side PM access the greenfield architecture forbids.
//
// Here every control's enabled state is one `Editor.can(command)` answer, and a
// click runs `Editor.exec(command)` only after `can` said yes. Save is not a
// command: it calls `Editor.save()` directly. A control the engine cannot
// honour renders disabled with the engine's own reason as its tooltip, so the
// UI can never claim a capability the engine does not have.

import type { ReactNode } from 'react';
import type { Editor } from '@docx-editor.dev/core-contract/editor';
import { runToolbarCommand, toolbarCommandState, type ToolbarCommandId } from './toolbarCommands';

/** Material Symbol paths, inlined — the repo ships no icon font. */
const ICONS: Record<ToolbarCommandId | 'save', string> = {
  bold: 'M8 19V5h5.2c1.4 0 2.5.4 3.3 1.1.8.7 1.2 1.6 1.2 2.8 0 .7-.2 1.3-.5 1.8s-.8.9-1.4 1.2c.8.2 1.4.6 1.8 1.2.4.6.7 1.3.7 2.1 0 1.2-.4 2.2-1.3 2.9-.9.7-2 1-3.5 1H8Zm2.8-2.3h2.4c.6 0 1.1-.2 1.4-.5.3-.3.5-.7.5-1.3s-.2-1-.5-1.3c-.3-.3-.8-.5-1.5-.5h-2.3v3.6Zm0-5.8h2c.6 0 1.1-.1 1.4-.4.3-.3.5-.7.5-1.2s-.2-.9-.5-1.2c-.3-.3-.8-.4-1.4-.4h-2v3.2Z',
  italic: 'M5 19v-2.2h3.2l3-9.6H8V5h8v2.2h-3.2l-3 9.6H13V19H5Z',
  underline: 'M5 21v-2h14v2H5Zm7-4c-1.7 0-3-.5-4-1.5-1-1-1.4-2.3-1.4-4V3h2.3v8.6c0 1 .3 1.8.8 2.4.6.6 1.3.9 2.3.9s1.8-.3 2.3-.9c.6-.6.8-1.4.8-2.4V3H17v8.5c0 1.7-.5 3-1.4 4-1 1-2.3 1.5-3.9 1.5Z',
  undo: 'M7.5 18c-.4 0-.8-.1-1-.4-.3-.3-.4-.6-.4-1s.1-.8.4-1c.2-.3.6-.4 1-.4h6.9c1.1 0 2-.4 2.8-1.1.8-.8 1.2-1.7 1.2-2.8s-.4-2-1.2-2.8c-.8-.7-1.7-1.1-2.8-1.1H7.9l2 2c.3.3.4.6.4 1s-.1.7-.4 1c-.3.3-.6.4-1 .4s-.7-.1-1-.4L3.4 8.6c-.3-.3-.4-.6-.4-1s.1-.7.4-1L7.9 2c.3-.3.6-.4 1-.4s.7.1 1 .4c.3.3.4.6.4 1s-.1.7-.4 1l-2 2h6.5c1.9 0 3.5.6 4.8 1.9 1.3 1.3 2 2.8 2 4.7s-.7 3.5-2 4.8c-1.3 1.3-2.9 1.9-4.8 1.9H7.5Z',
  redo: 'M9.6 18c-1.9 0-3.5-.6-4.8-1.9-1.3-1.3-2-2.9-2-4.8s.7-3.4 2-4.7C6.1 5.3 7.7 4.7 9.6 4.7h6.5l-2-2c-.3-.3-.4-.6-.4-1s.1-.7.4-1c.3-.3.6-.4 1-.4s.7.1 1 .4l4.5 4.6c.3.3.4.6.4 1s-.1.7-.4 1L16.1 12c-.3.3-.6.4-1 .4s-.7-.1-1-.4c-.3-.3-.4-.6-.4-1s.1-.7.4-1l2-2H9.6c-1.1 0-2 .4-2.8 1.1-.8.8-1.2 1.7-1.2 2.8s.4 2 1.2 2.8c.8.7 1.7 1.1 2.8 1.1h6.9c.4 0 .8.1 1 .4.3.2.4.6.4 1s-.1.7-.4 1c-.2.3-.6.4-1 .4H9.6Z',
  save: 'M5 21c-.6 0-1-.2-1.4-.6C3.2 20 3 19.6 3 19V5c0-.6.2-1 .6-1.4C4 3.2 4.4 3 5 3h11.2L21 7.8V19c0 .6-.2 1-.6 1.4-.4.4-.8.6-1.4.6H5Zm7-3c.8 0 1.5-.3 2.1-.9.6-.6.9-1.3.9-2.1s-.3-1.5-.9-2.1c-.6-.6-1.3-.9-2.1-.9s-1.5.3-2.1.9c-.6.6-.9 1.3-.9 2.1s.3 1.5.9 2.1c.6.6 1.3.9 2.1.9ZM6 10h9V6H6v4Z',
};

const LABELS: Record<ToolbarCommandId | 'save', string> = {
  bold: 'Bold',
  italic: 'Italic',
  underline: 'Underline',
  undo: 'Undo',
  redo: 'Redo',
  save: 'Save',
};

const FORMATTING: readonly ToolbarCommandId[] = ['bold', 'italic', 'underline'];
const HISTORY: readonly ToolbarCommandId[] = ['undo', 'redo'];

function ToolbarIcon({ id }: { readonly id: ToolbarCommandId | 'save' }): ReactNode {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path d={ICONS[id]} fill="currentColor" />
    </svg>
  );
}

function CommandButton({ editor, id }: { readonly editor: Editor | null; readonly id: ToolbarCommandId }): ReactNode {
  const state = toolbarCommandState(editor, id);
  return (
    <button
      type="button"
      className="ep-toolbar__button"
      data-testid={`toolbar-${id}`}
      disabled={!state.enabled}
      // The engine's own words, never an adapter paraphrase.
      title={state.disabledReason ?? LABELS[id]}
      aria-label={LABELS[id]}
      onMouseDown={(event) => event.preventDefault()} // keep focus on the editor
      onClick={() => runToolbarCommand(editor, id)}
    >
      <ToolbarIcon id={id} />
    </button>
  );
}

export interface DocxEditorToolbarProps {
  readonly editor: Editor | null;
  /** Save handler — the host decides what to do with the bytes. */
  readonly onSave?: () => void;
}

export function DocxEditorToolbar({ editor, onSave }: DocxEditorToolbarProps): ReactNode {
  return (
    <div className="ep-toolbar" role="toolbar" aria-label="Formatting" data-testid="docx-editor-toolbar">
      <div className="ep-toolbar__group">
        {HISTORY.map((id) => (
          <CommandButton key={id} editor={editor} id={id} />
        ))}
      </div>
      <div className="ep-toolbar__separator" role="separator" />
      <div className="ep-toolbar__group">
        {FORMATTING.map((id) => (
          <CommandButton key={id} editor={editor} id={id} />
        ))}
      </div>
      {onSave ? (
        <>
          <div className="ep-toolbar__separator" role="separator" />
          <div className="ep-toolbar__group">
            <button
              type="button"
              className="ep-toolbar__button"
              data-testid="toolbar-save"
              disabled={!editor}
              title={LABELS.save}
              aria-label={LABELS.save}
              onMouseDown={(event) => event.preventDefault()}
              onClick={onSave}
            >
              <ToolbarIcon id="save" />
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
