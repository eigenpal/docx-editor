// Legacy shell structure, ported (interactive-paginated-editing M6V.1, React only).
//
// This is a PORT of the legacy `DocxEditor/DocxEditorShell.tsx` hierarchy at
// 9bb06c38, not an approximation of it. The M4.2 version of this file was a
// simplified four-div frame with its own `ep-shell__*` class names; that is what
// M6V.1 exists to replace, because a generic frame is not visual parity.
//
// The legacy nesting, class names, sticky/absolute positioning, z-index, and the
// three inline style objects (`containerStyle`, `mainContentStyle`,
// `editorContainerStyle`) are reproduced as they were. Structure matters here beyond
// looks: the scroll container must be the SOLE scroller with `overflow-anchor: none`,
// the horizontal ruler must be `position: sticky` inside it so it tracks horizontal
// scroll, and the vertical ruler must be absolutely positioned at the content's left
// edge with `padding-top: 48` matching the pages container — get any of those wrong
// and the rulers drift away from the page.
//
// What deliberately does NOT come across is legacy AUTHORITY. The legacy shell took
// thirty-odd props wired to it: ruler mutation callbacks, outline headings,
// tracked-change style injection, comment sidebar shift, agent panels, PM-derived
// overlays, `onEditorBgMouseDown`/`onEditorContextMenu` handlers that read DOM
// selection. None of that is here. Chrome regions are slots; the editor inside owns
// its own geometry and interaction, and the shell measures nothing.

import type { CSSProperties, ReactNode } from 'react';

/**
 * `Z_INDEX.ruler` in the legacy code. Both rulers sit above the inline
 * header/footer editor so they stay readable during horizontal scroll.
 */
const RULER_Z_INDEX = 30;

/**
 * Legacy `paddingTop: 48`, and the comment explaining it is load-bearing: it must
 * match `.paged-editor__pages` padding-top (24 viewport + 24 pages container). The
 * greenfield equivalent is `.ep-one-surface__viewport` + `__pages`.
 */
const VERTICAL_RULER_PAD_TOP = 48;

/** Legacy horizontal padding on the sticky ruler row. */
const RULER_ROW_PAD_X = 20;

const containerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  width: '100%',
  backgroundColor: 'var(--doc-bg)',
};

const mainContentStyle: CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0, // allow the flex item to shrink below content size
  minWidth: 0, // allow it to shrink below content width on narrow viewports
  flexDirection: 'row',
};

/** The sole scroll container. The editor sizes to content inside it. */
const editorContainerStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  overflow: 'auto',
  position: 'relative',
  overflowAnchor: 'none',
};

const columnStyle: CSSProperties = {
  position: 'relative',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
};

const contentRowStyle: CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
  position: 'relative',
};

const contentStyle: CSSProperties = {
  position: 'relative',
  flex: 1,
  minWidth: 0,
};

export interface DocxEditorShellProps {
  /** Application title and menu region, above the toolbar. */
  readonly titleBar?: ReactNode;
  /** Toolbar / ribbon region, inside the column above the scroll container. */
  readonly toolbar?: ReactNode;
  /** Horizontal ruler — display-only, rendered sticky at the scroller's top. */
  readonly horizontalRuler?: ReactNode;
  /** Vertical ruler — display-only, pinned at the content's left edge. */
  readonly verticalRuler?: ReactNode;
  /** Page indicator, floated at the bottom of the document region. */
  readonly pageIndicator?: ReactNode;
  /** Sidebar / dialog launch surface, the row's second flex child. */
  readonly sidebar?: ReactNode;
  /** The one-surface editor. */
  readonly children: ReactNode;
  readonly className?: string;
  /**
   * Minimum layout width, which the legacy shell applied to both the ruler row and
   * the content row so the page and ruler scroll together rather than independently.
   */
  readonly minLayoutWidth?: number;
}

/**
 * The framed editor shell.
 *
 * Owns no document state: it never measures the document, never touches selection,
 * and passes no editor to its slots. `data-testid="docx-editor"` is kept from the
 * legacy markup so existing selectors keep working.
 */
export function DocxEditorShell({
  titleBar,
  toolbar,
  horizontalRuler,
  verticalRuler,
  pageIndicator,
  sidebar,
  children,
  className,
  minLayoutWidth,
}: DocxEditorShellProps): ReactNode {
  return (
    <div
      className={`ep-root docx-editor${className ? ` ${className}` : ''}`}
      style={containerStyle}
      data-testid="docx-editor"
    >
      {titleBar ? <div className="docx-editor__title-region">{titleBar}</div> : null}
      <div style={mainContentStyle}>
        <div style={columnStyle}>
          {toolbar}

          <div className="docx-editor__scroll-container" style={editorContainerStyle}>
            {/* Horizontal ruler — sticky-top, scrolls horizontally with the doc. */}
            {horizontalRuler ? (
              <div
                className="docx-editor__ruler-row"
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  paddingTop: 4,
                  paddingBottom: 4,
                  flexShrink: 0,
                  backgroundColor: 'var(--doc-bg)',
                  position: 'sticky',
                  top: 0,
                  zIndex: RULER_Z_INDEX,
                  paddingLeft: RULER_ROW_PAD_X,
                  paddingRight: RULER_ROW_PAD_X,
                  minWidth: minLayoutWidth,
                  transition: 'padding 0.2s ease',
                }}
              >
                {horizontalRuler}
              </div>
            ) : null}

            <div style={{ ...contentRowStyle, minWidth: minLayoutWidth }}>
              <div className="docx-editor__content" style={contentStyle}>
                {/* Vertical ruler — at the content's left edge so it scrolls
                    horizontally with the page. `paddingTop` must match the pages
                    container's top padding or it drifts. */}
                {verticalRuler ? (
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      zIndex: RULER_Z_INDEX,
                      paddingTop: VERTICAL_RULER_PAD_TOP,
                    }}
                  >
                    {verticalRuler}
                  </div>
                ) : null}
                {children}
              </div>
            </div>
          </div>

          {pageIndicator}
        </div>
        {sidebar}
      </div>
    </div>
  );
}
