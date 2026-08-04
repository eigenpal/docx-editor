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

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import type { EditorSnapshot } from '@docx-editor.dev/core-contract/contracts/editor';
import type { RulerIndent } from '@docx-editor.dev/core-contract/editor';
import { HorizontalRuler, type RulerPageSetup } from '../components/ui/HorizontalRuler';
import { VerticalRuler } from '../components/ui/VerticalRuler';
import { ReviewRailContext, useDocxEditor } from './context';
import { useEditorState } from './useEditorState';
import { usePageSetup } from './usePageSetup';
import { useParagraphIndent } from './useParagraphIndent';
import { useNavigationShift, useNavigationViewportElement } from './navigation/navigation-layout';

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

/** What the ruler needs to drive the four indent handles. */
interface IndentDrag {
  /** The paragraph's indent with any in-flight drag folded in; null hides the handles. */
  readonly indent: RulerIndent | null;
  readonly isEnabled: boolean;
  readonly preview: (next: RulerIndent) => void;
  readonly commit: () => void;
}

/** The selection as a comparable key, for noticing that it moved under a drag. */
function selectionKey(editor: ReturnType<typeof useDocxEditor>): string {
  const selection = editor?.snapshot().selection ?? null;
  return selection ? JSON.stringify(selection) : '';
}

/**
 * Indent drags: preview locally, commit ONCE on release, like the margin drags above.
 *
 * `snapshot().formatting` is reference-stable across ticks that did not change it (the
 * engine's own value-equality cache), so the nested `indent` is too and the default
 * comparator is enough — no fresh object reaches a subscriber on every keystroke.
 */
function useIndentDrag(): IndentDrag {
  const editor = useDocxEditor();
  // The READ and the WRITE both come from the public hook, so the ruler is exactly the
  // chrome a host could build itself — no privileged path.
  const { indent: stored, isEnabled, apply } = useParagraphIndent();
  const [pending, setPending] = useState<RulerIndent | null>(null);
  const pendingRef = useRef<RulerIndent | null>(null);
  // The selection the drag STARTED against.
  const anchorRef = useRef<string | null>(null);

  const preview = useCallback(
    (next: RulerIndent) => {
      if (anchorRef.current === null) anchorRef.current = selectionKey(editor);
      pendingRef.current = next;
      setPending(next);
    },
    [editor]
  );

  const commit = useCallback(() => {
    const next = pendingRef.current;
    const anchor = anchorRef.current;
    pendingRef.current = null;
    anchorRef.current = null;
    setPending(null);
    if (!next) return;
    // A drag describes the paragraphs that were selected when it began, and `setIndent`
    // carries no target — it writes wherever the selection is NOW. An agent write or a
    // layout catch-up between press and release would otherwise land the drag on somebody
    // else's paragraphs.
    if (anchor !== null && anchor !== selectionKey(editor)) return;
    apply({ left: next.left, right: next.right, firstLine: next.firstLine });
  }, [editor, apply]);

  const indent = useMemo(
    () =>
      pending ??
      (stored ? { left: stored.left, right: stored.right, firstLine: stored.firstLine } : null),
    [pending, stored]
  );

  return useMemo(
    () => ({ indent, isEnabled, preview, commit }),
    [indent, isEnabled, preview, commit]
  );
}

/** Horizontal viewport movement shared by the painted page and the ruler above it. */
function useViewportScrollLeft(): number {
  const viewport = useNavigationViewportElement();
  const [scrollLeft, setScrollLeft] = useState(0);

  useEffect(() => {
    if (!viewport) {
      setScrollLeft(0);
      return undefined;
    }
    const sync = () => setScrollLeft(viewport.scrollLeft);
    sync();
    viewport.addEventListener('scroll', sync, { passive: true });
    return () => viewport.removeEventListener('scroll', sync);
  }, [viewport]);

  return scrollLeft;
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
  const indentDrag = useIndentDrag();
  // The ruler measures the page, so it has to move with the page — and BOTH panes move it.
  // The ruler sits ABOVE the scroll container, so it has to be told about each: the
  // navigation pane displaces the page from the left, the review pane reserves a gutter on
  // the right. Same values, same easing, so the ticks stay over the page they measure.
  const shift = useNavigationShift();
  const reserved = useReviewGutter();
  const scrollLeft = useViewportScrollLeft();
  return (
    <HorizontalRuler
      pageSetup={previewed(pageSetup, pending)}
      zoom={zoom}
      editable={isEnabled}
      onLeftMarginChange={preview('left')}
      onRightMarginChange={preview('right')}
      onMarginDragEnd={commit}
      showIndentHandles={indentDrag.indent !== null}
      indent={indentDrag.indent}
      indentEditable={indentDrag.isEnabled}
      onIndentChange={indentDrag.preview}
      onIndentDragEnd={indentDrag.commit}
      unit={props.unit ?? 'inch'}
      className={props.className ?? ''}
      style={{
        // A ruler always represents the full page width. In a narrow host its surrounding
        // row overflows; shrinking the ruler would move its ticks off the document.
        flexShrink: 0,
        marginRight: reserved,
        ...props.style,
        // The ruler is centred by its host row, so the same rule applies as to the page:
        // a left offset of S moves a centred box by S/2. Feeding the ruler the SAME px the
        // viewport pads by keeps the two in lockstep at every window width.
        marginInlineStart: shift,
        // `margin`, not one edge: the review pane moves the other side, and animating only
        // `margin-inline-start` left the ruler snapping while the page glided.
        transition: 'margin 0.2s ease',
        // The ruler lives above the scroller, so mirror its horizontal movement explicitly.
        transform: `${props.style?.transform ? `${props.style.transform} ` : ''}translateX(${-scrollLeft}px)`,
      }}
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
