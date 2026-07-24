// Polished shell presentation (interactive-paginated-editing M4.2).
// Shared adapter presentation and compatibility behavior.
// PRESENTATION ONLY. The legacy shell took thirty-odd props wired to legacy
// authority — ruler mutation callbacks, outline headings, tracked-change style
// injection, agent panels, PM-derived overlays. None of that comes across.
//
// What remains is what the shell actually is to a user: a framed app region
// with a toolbar slot, a scrolling document backdrop the page floats on, and a
// page-indicator slot. Everything inside the viewport is the one-surface editor,
// which owns its own geometry and interaction.

import type { ReactNode } from 'react';

export interface DocxEditorShellProps {
  /** Toolbar slot, rendered above the scrolling document region. */
  readonly toolbar?: ReactNode;
  /** Title chrome slot, rendered above the toolbar. */
  readonly titleBar?: ReactNode;
  /** Horizontal ruler slot — display-only (M4.4). */
  readonly horizontalRuler?: ReactNode;
  /** Vertical ruler slot — display-only (M4.4). */
  readonly verticalRuler?: ReactNode;
  /** Page indicator slot, floated over the bottom of the document region. */
  readonly pageIndicator?: ReactNode;
  /** The one-surface editor. */
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * The framed editor shell. It positions chrome around the editing surface and
 * deliberately owns no document state: it never measures the document, never
 * touches selection, and passes no editor through to its slots.
 */
export function DocxEditorShell({
  toolbar,
  titleBar,
  horizontalRuler,
  verticalRuler,
  pageIndicator,
  children,
  className,
}: DocxEditorShellProps): ReactNode {
  return (
    <div className={`ep-root docx-editor ep-shell${className ? ` ${className}` : ''}`} data-testid="docx-editor-shell">
      {titleBar ? <div className="ep-shell__title">{titleBar}</div> : null}
      {toolbar ? <div className="ep-shell__toolbar">{toolbar}</div> : null}
      <div className="ep-shell__document">
        {horizontalRuler ? <div className="ep-shell__ruler-h">{horizontalRuler}</div> : null}
        <div className="ep-shell__canvas">
          {verticalRuler ? <div className="ep-shell__ruler-v">{verticalRuler}</div> : null}
          {children}
        </div>
        {pageIndicator ? <div className="ep-shell__page-indicator">{pageIndicator}</div> : null}
      </div>
    </div>
  );
}
