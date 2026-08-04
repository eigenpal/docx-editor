// Context-fed ruler parts: `DocxEditor.HorizontalRuler` / `DocxEditor.VerticalRuler`.
//
// Thin wrappers over the props-driven `HorizontalRuler` / `VerticalRuler` components
// (which stay exported unchanged): the wrappers read the page setup and zoom REACTIVELY
// off the snapshot via `usePageSetup` and feed them in.
//
// Margin drags are LIVE but commit ONCE: while a drag is in flight the wrapper previews
// the pending margin locally (the gray zone follows the cursor), and only the release
// writes through the engine's `setPageSetup` command — one transaction, one undo entry,
// no relayout storm at mousemove frequency. Editability follows what the engine reports
// (`usePageSetup().isEnabled`), so against a read-only document the handles stay inert.

import { useCallback, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import type { EditorSnapshot } from '@docx-editor.dev/core-contract/contracts/editor';
import { HorizontalRuler, type RulerPageSetup } from '../components/ui/HorizontalRuler';
import { VerticalRuler } from '../components/ui/VerticalRuler';
import { useContext } from 'react';
import { ReviewRailContext } from './context';
import { useEditorState } from './useEditorState';
import { usePageSetup } from './usePageSetup';

const selectZoom = (snapshot: EditorSnapshot): number => snapshot.zoom;

/** Props for the context-fed ruler parts. @public */
export interface DocxEditorRulerProps {
  /** Measurement unit for tick labels. Defaults to inches. */
  unit?: 'inch' | 'cm';
  className?: string;
  style?: CSSProperties;
}

type PendingMargins = Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>;

/** The page setup with any in-flight drag preview folded in. */
function previewed(
  pageSetup: RulerPageSetup | null,
  pending: PendingMargins
): RulerPageSetup | null {
  if (!pageSetup || Object.keys(pending).length === 0) return pageSetup;
  return { ...pageSetup, marginsTwips: { ...pageSetup.marginsTwips, ...pending } };
}

function useMarginDrag(): {
  pending: PendingMargins;
  preview: (side: keyof PendingMargins) => (twips: number) => void;
  commit: () => void;
} {
  const { apply } = usePageSetup();
  const [pending, setPending] = useState<PendingMargins>({});
  // The ref mirrors the state so `commit` can read the latest drag value WITHOUT doing
  // work inside a setState updater — updaters must stay pure (StrictMode double-invokes
  // them, which would commit two undo entries per drag).
  const pendingRef = useRef<PendingMargins>({});
  const preview = useCallback(
    (side: keyof PendingMargins) => (twips: number) => {
      pendingRef.current = { ...pendingRef.current, [side]: Math.round(twips) };
      setPending(pendingRef.current);
    },
    []
  );
  const commit = useCallback(() => {
    const current = pendingRef.current;
    pendingRef.current = {};
    setPending({});
    if (Object.keys(current).length === 0) return;
    // A ruler drag is Word's "this section" gesture: dragging the margin of a landscape
    // section must not reshape the portrait sections around it.
    apply({
      ...(current.top !== undefined ? { marginTopTwips: current.top } : {}),
      ...(current.right !== undefined ? { marginRightTwips: current.right } : {}),
      ...(current.bottom !== undefined ? { marginBottomTwips: current.bottom } : {}),
      ...(current.left !== undefined ? { marginLeftTwips: current.left } : {}),
      scope: 'section',
    });
  }, [apply]);
  return { pending, preview, commit };
}

/**
 * The horizontal ruler as a context-fed part (`DocxEditor.HorizontalRuler`): page
 * width, margins and zoom straight from the editor. Left/right margin handles are
 * draggable when the engine supports page-setup writes; the drag previews locally and
 * commits one undoable step on release.
 *
 * @public
 */
export function DocxEditorHorizontalRuler(props: DocxEditorRulerProps): ReactElement {
  const { pageSetup, isEnabled } = usePageSetup();
  const zoom = useEditorState(selectZoom);
  const { pending, preview, commit } = useMarginDrag();
  // The ruler measures the page, so it has to move with the page. The review pane shifts the
  // sheet by reserving a gutter in the scroller; the ruler lives ABOVE that scroller and
  // would otherwise stay centred on a page that is no longer under it. The same reservation
  // as a right margin moves it by the same half.
  const reserved = useReviewGutter();
  return (
    <HorizontalRuler
      pageSetup={previewed(pageSetup, pending)}
      zoom={zoom}
      editable={isEnabled}
      onLeftMarginChange={preview('left')}
      onRightMarginChange={preview('right')}
      onMarginDragEnd={commit}
      unit={props.unit ?? 'inch'}
      className={props.className ?? ''}
      style={{ marginRight: reserved, ...props.style }}
    />
  );
}

/**
 * The gutter the review pane reserves, in pixels.
 *
 * Read from the engine's pane state rather than from a prop, because the ruler and the
 * scroller must agree: two components deciding independently is how a ruler ends up an inch
 * off the page it is measuring.
 */
function useReviewGutter(): number {
  // The SNAPSHOT, not the review hook — the ruler needs one boolean, not the queue. And no
  // gutter at all unless a rail is mounted to occupy it.
  const paneOpen = useEditorState(selectPaneOpen);
  const rail = useContext(ReviewRailContext);
  if ((rail?.mounted ?? 0) === 0) return 0;
  return paneOpen ? REVIEW_PANE_GUTTER : REVIEW_MARKERS_GUTTER;
}

const selectPaneOpen = (snapshot: EditorSnapshot): boolean => snapshot.reviewPaneOpen ?? true;

/** Kept in step with the `[data-review-pane]` rules in the core stylesheet. */
const REVIEW_PANE_GUTTER = 316;
const REVIEW_MARKERS_GUTTER = 44;

/**
 * The vertical ruler as a context-fed part (`DocxEditor.VerticalRuler`): page height,
 * margins and zoom straight from the editor. Top/bottom margin handles are draggable
 * when the engine supports page-setup writes, committing one undoable step on release.
 *
 * @public
 */
export function DocxEditorVerticalRuler(props: DocxEditorRulerProps): ReactElement {
  const { pageSetup, isEnabled } = usePageSetup();
  const zoom = useEditorState(selectZoom);
  const { pending, preview, commit } = useMarginDrag();
  return (
    <VerticalRuler
      pageSetup={previewed(pageSetup, pending)}
      zoom={zoom}
      editable={isEnabled}
      onTopMarginChange={preview('top')}
      onBottomMarginChange={preview('bottom')}
      onMarginDragEnd={commit}
      unit={props.unit ?? 'inch'}
      className={props.className ?? ''}
      style={props.style}
    />
  );
}
