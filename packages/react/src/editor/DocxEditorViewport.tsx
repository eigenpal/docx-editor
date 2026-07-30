// The scroll container around the painted pages.
//
// The class list is LOAD-BEARING, not styling sugar:
// - `ep-root` scopes every --doc-* token and the library's Tailwind layer;
// - `ep-one-surface ep-one-surface__viewport` carry the one-surface chrome geometry;
// - `docx-editor__scroll-container` is how the engine finds its scroller — the
//   paginated pages locate the nearest ancestor with that class for scroll
//   rematerialization and page-visibility work. Without it the engine falls back to
//   document scrolling and virtualization degrades.

import type { CSSProperties, ReactNode } from 'react';

/** Props for `DocxEditor.Viewport`. @public */
export interface DocxEditorViewportProps {
  /** Appended after the load-bearing viewport classes (e.g. `dark` for chrome theming). */
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * The sole scroll container for the painted document. Put `DocxEditor.Content` inside
 * it; the engine discovers this element by class and manages scrolling against it.
 *
 * @public
 */
export function DocxEditorViewport({ className, style, children }: DocxEditorViewportProps) {
  return (
    <div
      data-testid="docx-editor-scroll"
      className={`ep-root ep-one-surface ep-one-surface__viewport docx-editor__scroll-container${
        className ? ` ${className}` : ''
      }`}
      style={style}
    >
      {children}
    </div>
  );
}
