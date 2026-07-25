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
import type { RefObject } from 'react';
import type { DisplayPage } from '@docx-editor.dev/core-contract/geometry';
import type { FrameOverlays, GlyphClickTarget } from '@docx-editor.dev/engine-editor';
import { paintDisplay } from '../../paintDisplay';

export interface DocxEditorPagedAreaProps {
  /** Positioned pages from the engine's display. */
  pages: readonly DisplayPage[];
  /** Caret and selection geometry for the current frame. */
  overlays: FrameOverlays;
  clickTarget: GlyphClickTarget | null;
  /** Display scale. Engine-owned (`Editor.getZoom`), applied from the stack's top-left. */
  zoom: number;
  /** Set when this element is the scroll container — i.e. when no chrome is rendered. */
  scrollRef: RefObject<HTMLDivElement | null> | null;
  pagesRef: RefObject<HTMLDivElement | null>;
  bodyRef: RefObject<HTMLDivElement | null>;
  /** True when rendered inside the shell, which owns scrolling. */
  hosted: boolean;
  className?: string | undefined;
}

export function DocxEditorPagedArea({
  pages,
  overlays,
  clickTarget,
  zoom,
  scrollRef,
  pagesRef,
  bodyRef,
  hosted,
  className,
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
        className="ep-one-surface__pages"
        style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
      >
        {paintDisplay(pages, overlays, clickTarget)}
      </div>
      <div
        ref={bodyRef}
        className="ep-one-surface__input-host"
        style={{ position: 'fixed', width: 0, height: 0, overflow: 'visible', pointerEvents: 'none' }}
      />
    </div>
  );
}
