/**
 * The paged document area.
 *
 * THIS FILE IS THE ONE DELIBERATE NON-PORT. Every other component under
 * `components/DocxEditor/` is the legacy file with its import paths and engine calls
 * edited. Legacy's `DocxEditorPagedArea` wraps `PagedEditor` — an editing-engine view
 * plus legacy's own layout and painter — and the port rule set excludes exactly that:
 * the greenfield painter owns the document canvas, and legacy's layout/painter is not
 * ported. So the file keeps its name and its place in the tree, and its body is the
 * greenfield counterpart: the engine emits positioned `DisplayPage[]`, and this paints
 * them.
 *
 * What it owns, and why each piece is here rather than in the orchestrator:
 *
 *  - `viewport` is the scroll container when no chrome is rendered, and inert inside the
 *    shell, where `.docx-editor__scroll-container` scrolls instead. Two nested
 *    `overflow: auto` boxes left neither bounded and the window scrolled.
 *  - `pages` is the engine's content origin: page 0 is published at content (0, 0) and
 *    `measureInteractionHostMetrics` reports this element's client origin as that point,
 *    so hit testing is a plain subtract-and-divide.
 *  - `inputHost` is where the hidden semantic projection mounts.
 */
import type { ReactNode, RefObject } from 'react';
import type { DisplayPage } from '@docx-editor.dev/core-contract/geometry';
import type { FrameOverlays, GlyphClickTarget } from '@docx-editor.dev/engine-editor';
import type { InstalledDisplayFonts } from '@docx-editor.dev/engine-editor';
import { paintDisplay } from '../../paintDisplay';

export interface DocxEditorPagedAreaProps {
  /** Positioned pages from the engine's display. */
  pages: readonly DisplayPage[];
  /** Caret and selection geometry for the current frame. */
  overlays: FrameOverlays;
  clickTarget: GlyphClickTarget | null;
  /** Exact FontFace aliases loaded from the shaping snapshot for these pages. */
  installedFonts: InstalledDisplayFonts | null;
  /** Visible typed font installation failure. */
  fontError?: string | null;
  /** Display scale. Engine-owned (`Editor.getZoom`), applied from the stack's top-left. */
  zoom: number;
  /** Set when this element is the scroll container — i.e. when no chrome is rendered. */
  scrollRef: RefObject<HTMLDivElement | null> | null;
  pagesRef: RefObject<HTMLDivElement | null>;
  bodyRef: RefObject<HTMLDivElement | null>;
  /** Private feedback checkpoint: render the PM projection instead of painted pages. */
  visibleProjection?: boolean;
  /** True when rendered inside the shell, which owns scrolling. */
  hosted: boolean;
  className?: string | undefined;
  /**
   * Absolutely-positioned affordances that sit over the pages — today the floating
   * "Add comment" button. Legacy rendered them inside this component; they arrive as a
   * slot so the button's own markup stays in one place with the state that drives it.
   */
  overlayChildren?: ReactNode;
  /**
   * A double-click landed on the pages. The CALLER decides what is under the point by
   * asking the engine (`hitTest`) — this component reports the client coordinates and
   * derives nothing, because deriving geometry here is exactly what the one-surface
   * contract forbids and what the engine exists to answer.
   */
  onPagesDoubleClick?: (point: { x: number; y: number }) => void;
}

export function DocxEditorPagedArea({
  pages,
  overlays,
  clickTarget,
  installedFonts,
  fontError,
  zoom,
  scrollRef,
  pagesRef,
  bodyRef,
  visibleProjection = false,
  hosted,
  className,
  overlayChildren,
  onPagesDoubleClick,
}: DocxEditorPagedAreaProps) {
  return (
    <div
      ref={scrollRef}
      data-testid="docx-editor-scroll"
      // `ep-root` is the library's style scope: every --doc-* token is declared
      // under it. Without it the caret, selection highlight, and page background
      // all resolve to nothing and paint invisibly on a white page.
      className={`ep-root ep-one-surface ep-one-surface__viewport${hosted ? ' ep-one-surface__viewport--hosted' : ''}${className ? ` ${className}` : ''}`}
    >
      <div
        ref={pagesRef}
        onDoubleClick={(e) => onPagesDoubleClick?.({ x: e.clientX, y: e.clientY })}
        className="ep-one-surface__pages"
        style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
      >
        {visibleProjection ? (
          <div
            className="ep-one-surface__page ep-browser-first__page"
            data-testid="browser-first-page"
          >
            <div ref={bodyRef} className="ep-one-surface__input-host ep-browser-first__mount" />
          </div>
        ) : installedFonts ? (
          paintDisplay(pages, installedFonts, overlays, clickTarget)
        ) : null}
      </div>
      {fontError ? (
        <div role="alert" data-testid="docx-editor-font-error">
          {fontError}
        </div>
      ) : null}
      {!visibleProjection ? (
        <div
          ref={bodyRef}
          className="ep-one-surface__input-host"
          style={{
            position: 'fixed',
            width: 0,
            height: 0,
            overflow: 'visible',
            pointerEvents: 'none',
          }}
        />
      ) : null}
      {overlayChildren}
    </div>
  );
}
