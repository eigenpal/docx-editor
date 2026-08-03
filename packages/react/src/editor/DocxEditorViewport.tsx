// The scroll container around the painted pages.
//
// The class list is LOAD-BEARING, not styling sugar:
// - `ep-root` scopes every --doc-* token and the library's Tailwind layer;
// - `ep-one-surface ep-one-surface__viewport` carry the one-surface chrome geometry;
// - `docx-editor__scroll-container` is how the engine finds its scroller — the
//   paginated pages locate the nearest ancestor with that class for scroll
//   rematerialization and page-visibility work. Without it the engine falls back to
//   document scrolling and virtualization degrades.

import { useCallback } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useNavigationLayoutStore, useNavigationShift } from './navigation/navigation-layout';

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
  // The navigation pane needs this element's width to decide whether it has to move the
  // page at all, and publishes the answer back as `--docx-nav-shift`. Both directions are
  // no-ops when no pane is mounted: the store stays at 0 and the custom property falls
  // back to 0 in the stylesheet.
  const layout = useNavigationLayoutStore();
  const shift = useNavigationShift();
  const attach = useCallback(
    (element: HTMLDivElement | null) => layout?.setViewport(element),
    [layout]
  );

  return (
    <div
      ref={attach}
      data-testid="docx-editor-scroll"
      className={`ep-root ep-one-surface ep-one-surface__viewport docx-editor__scroll-container${
        className ? ` ${className}` : ''
      }`}
      style={{ ...style, ['--docx-nav-shift' as string]: `${shift}px` } as CSSProperties}
    >
      {children}
    </div>
  );
}
