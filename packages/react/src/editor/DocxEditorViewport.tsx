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
import { useContext } from 'react';
import type { EditorSnapshot } from '@docx-editor.dev/core-contract/contracts/editor';
import { ReviewRailContext } from './context';
import { useEditorState } from './useEditorState';

const selectPaneOpen = (snapshot: EditorSnapshot): boolean => snapshot.reviewPaneOpen ?? true;

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
  // The open pane is given its own gutter rather than allowed to overlap: the page centres
  // inside the padding box, so reserving the rail's width shifts the sheet left by half of
  // it and the two read as one centred pair. Purely presentational — no layout input
  // changes, so the document does not re-paginate when the pane opens.
  // The SNAPSHOT, not the review hook: reading the pane state through `useReview` ran the
  // whole placement derivation — anchors and all — inside the parent of the painted document,
  // on every selection change, to learn one boolean.
  const paneOpen = useEditorState(selectPaneOpen);
  const rail = useContext(ReviewRailContext);
  const reserve = (rail?.mounted ?? 0) > 0;

  return (
    <div
      data-testid="docx-editor-scroll"
      {...(reserve ? { 'data-review-pane': paneOpen ? 'open' : 'closed' } : {})}
      className={`ep-root ep-one-surface ep-one-surface__viewport docx-editor__scroll-container${
        className ? ` ${className}` : ''
      }`}
      style={style}
    >
      {children}
    </div>
  );
}
