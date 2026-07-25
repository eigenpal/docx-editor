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
import { LEGACY_CHROME_UNAVAILABLE_KEY } from '@docx-editor.dev/engine-editor';
import type { Translate } from './DocxEditorToolbar';

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
  /**
   * Resolves i18n keys. Required when the sidebar renders its own chrome, so the
   * adapter never ships English of its own.
   */
  readonly t?: Translate;
}

/**
 * The sidebar frame, plus the legacy dialog LAUNCH surfaces (M6V.1).
 *
 * The legacy sidebar hosted comments, tracked changes, and an outline, and the legacy
 * chrome offered launchers for find/replace, hyperlink, insert image/table/symbol, and
 * image/footnote properties. Those need query and mutation contracts this change does
 * not own, so the launchers are PRESENT and permanently disabled with a localized
 * reason — the M6V.1 rule — rather than hidden, which would understate the parity gap.
 *
 * It renders whenever `open`, even with no host panel, because the region itself is
 * part of the visual parity being gated. Previously it returned null with no panels,
 * which made a named legacy region simply absent from the screenshot.
 */
export function DocxEditorSidebar({ editor, open, onClose, panels, t }: DocxEditorSidebarProps): ReactNode {
  const items = panels ?? [];
  if (!open || !editor) return null;
  const label = (key: string, fallbackKey: string) => (t ? t(key) : fallbackKey);
  const unavailable = t ? t(LEGACY_CHROME_UNAVAILABLE_KEY) : LEGACY_CHROME_UNAVAILABLE_KEY;
  return (
    <aside
      className="docx-editor__sidebar"
      data-testid="docx-editor-sidebar"
      aria-label={label('toolbar.format', 'toolbar.format')}
    >
      <div className="docx-editor__sidebar-header">
        <span>{items.length > 0 ? items[0]!.title : label('formattingBar.commentsAndChanges', 'formattingBar.commentsAndChanges')}</span>
        {onClose ? (
          <button
            type="button"
            className="ep-sidebar__close"
            onClick={onClose}
            aria-label={label('common.close', 'common.close')}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
              <path
                d="M6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5l5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19Z"
                fill="currentColor"
              />
            </svg>
          </button>
        ) : null}
      </div>
      {items.length > 0 ? (
        <div className="ep-sidebar__body">{items[0]!.content}</div>
      ) : (
        <div className="docx-editor__sidebar-empty" data-testid="sidebar-empty">
          {unavailable}
        </div>
      )}
      {/* Dialog launch surfaces: visible, disabled, with the reason on each. */}
      <div className="docx-editor__launchers" data-testid="dialog-launchers">
        {DEFERRED_DIALOGS.map((id) => {
          const key = DIALOG_LABEL_KEYS[id];
          const text = label(key, key);
          const reason = `${text} — ${unavailable}`;
          return (
            <button
              key={id}
              type="button"
              className="docx-editor__launcher"
              data-testid={`dialog-launcher-${id}`}
              data-parity-only="true"
              disabled
              title={reason}
              aria-label={reason}
            >
              {text}
            </button>
          );
        })}
      </div>
    </aside>
  );
}

/** i18n keys for the deferred dialog launchers. Keys only — never English here. */
const DIALOG_LABEL_KEYS: Record<DeferredDialogId, string> = {
  findReplace: 'dialogs.findReplace.titleFindReplace',
  hyperlink: 'formattingBar.insertLink',
  insertImage: 'toolbar.image',
  insertTable: 'toolbar.table',
  insertSymbol: 'toolbar.symbol',
  imageProperties: 'formattingBar.imageProperties',
  footnoteProperties: 'dialogs.footnoteProperties.title',
};

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
