// Page indicator (interactive-paginated-editing M4.3).
// Shared adapter presentation and compatibility behavior.
// component was handed `currentPage`/`totalPages` computed by the adapter from
// scroll measurement; this one reads them from the public editor queries, so
// the adapter never measures the document to decide what page it is on.

import type { ReactNode } from 'react';
import type { Editor } from '@docx-editor.dev/core-contract/editor';
import { useEditorSnapshot } from './useEditorSnapshot';

export interface PageIndicatorProps {
  readonly editor: Editor | null;
  /** Fade out when the user is not scrolling, as the legacy indicator did. */
  readonly visible?: boolean;
  /** `{current} of {total}` formatter — supplied by the host's i18n. */
  readonly format?: (current: number, total: number) => string;
}

/**
 * `current of total`, read from `Editor.getCurrentPage()` and
 * `Editor.getTotalPages()`. Renders nothing for a single-page document, matching
 * the legacy shell, and never intercepts pointer events.
 */
export function PageIndicator({ editor, visible = true, format }: PageIndicatorProps): ReactNode {
  useEditorSnapshot(editor);
  if (!editor) return null;
  const total = editor.getTotalPages();
  if (total <= 1) return null;
  const current = editor.getCurrentPage('viewport') + 1;
  const label = format ? format(current, total) : `${current} of ${total}`;
  return (
    <div
      className="ep-shell__page-indicator-chip"
      data-testid="page-indicator"
      style={{ opacity: visible ? 1 : 0 }}
      aria-live="polite"
      role="status"
    >
      {label}
    </div>
  );
}
