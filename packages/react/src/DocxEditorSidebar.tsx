// Sidebar and dialog presentation (interactive-paginated-editing M4.6).
// Shared adapter presentation and compatibility behavior.
// at 9bb06c38, reduced to what public contracts can honour today.
//
// The legacy sidebar hosted comments, tracked changes, and an outline; the
// legacy dialog set covered find/replace, hyperlinks, images, tables, symbols,
// and footnotes. Every one of those needs a query or mutation contract this
// change does not own (annotations are section 9). Per the milestone rule,
// unsupported controls are **hidden or disabled, never faked** — so this ships
// the frame plus the one panel that needs no engine contract, and states plainly
// what is deferred.

import type { ReactNode } from 'react';
import type { Editor } from '@docx-editor.dev/core-contract/editor';

/** A panel the sidebar can show. */
export interface SidebarPanel {
  readonly id: string;
  readonly title: string;
  readonly content: ReactNode;
}

export interface DocxEditorSidebarProps {
  readonly editor: Editor | null;
  readonly open: boolean;
  readonly onClose?: () => void;
  /** Host-supplied panels. Empty by default — nothing is faked. */
  readonly panels?: readonly SidebarPanel[];
}

/**
 * The sidebar frame. Renders nothing when closed or when it has no panel to
 * show, so an empty shell never appears as a broken feature.
 */
export function DocxEditorSidebar({ editor, open, onClose, panels }: DocxEditorSidebarProps): ReactNode {
  const items = panels ?? [];
  if (!open || !editor || items.length === 0) return null;
  return (
    <aside className="ep-sidebar" data-testid="docx-editor-sidebar" aria-label="Document panels">
      <div className="ep-sidebar__header">
        <span className="ep-sidebar__title">{items[0]!.title}</span>
        {onClose ? (
          <button type="button" className="ep-sidebar__close" onClick={onClose} aria-label="Close panel">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
              <path
                d="M6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5l5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19Z"
                fill="currentColor"
              />
            </svg>
          </button>
        ) : null}
      </div>
      <div className="ep-sidebar__body">{items[0]!.content}</div>
    </aside>
  );
}

/**
 * Dialogs deferred until their contracts land. Exported so the shell and the
 * demo boundary record agree on one list rather than drifting apart.
 */
export const DEFERRED_DIALOGS = [
  'findReplace',
  'hyperlink',
  'insertImage',
  'insertTable',
  'insertSymbol',
  'imageProperties',
  'footnoteProperties',
] as const;

export type DeferredDialogId = (typeof DEFERRED_DIALOGS)[number];
