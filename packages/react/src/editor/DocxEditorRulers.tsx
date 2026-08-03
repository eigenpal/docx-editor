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

import { useCallback, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import type {
  EditorSnapshot,
  IndentFormatting,
} from '@docx-editor.dev/core-contract/contracts/editor';
import type { RulerIndent } from '@docx-editor.dev/core-contract/editor';
import { HorizontalRuler, type RulerPageSetup } from '../components/ui/HorizontalRuler';
import { VerticalRuler } from '../components/ui/VerticalRuler';
import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';
import { usePageSetup } from './usePageSetup';
import { useNavigationShift } from './navigation/navigation-layout';

const selectZoom = (snapshot: EditorSnapshot): number => snapshot.zoom;
const selectEditable = (snapshot: EditorSnapshot): boolean => snapshot.editable;
const selectIndent = (snapshot: EditorSnapshot): IndentFormatting | null =>
  snapshot.formatting?.indent ?? null;

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
  const editable = useEditorState(selectEditable);
  const stored = useEditorState(selectIndent);
  const [pending, setPending] = useState<RulerIndent | null>(null);
  const pendingRef = useRef<RulerIndent | null>(null);
  // The selection the drag STARTED against.
  const anchorRef = useRef<string | null>(null);

  const isEnabled = useMemo(
    () => editable && editor !== null && editor.can({ type: 'setIndent', left: 0 }).ok,
    [editor, editable]
  );

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
    if (!next || !editor) return;
    // A drag describes the paragraphs that were selected when it began, and `setIndent`
    // carries no target — it writes wherever the selection is NOW. An agent write or a
    // layout catch-up between press and release would otherwise land the drag on somebody
    // else's paragraphs.
    if (anchor !== null && anchor !== selectionKey(editor)) return;
    editor.exec({
      type: 'setIndent',
      left: next.left,
      right: next.right,
      firstLine: next.firstLine,
    });
  }, [editor]);

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
  // The ruler sits ABOVE the scroll container, so an open navigation pane displaces the
  // page without displacing the ruler unless the ruler is told. Same value, same easing,
  // so the tick marks stay over the page they measure. Zero when no pane is mounted.
  const shift = useNavigationShift();
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
        ...props.style,
        // The ruler is centred by its host row, so the same rule applies as to the page:
        // a left offset of S moves a centred box by S/2. Feeding the ruler the SAME px the
        // viewport pads by keeps the two in lockstep at every window width.
        marginInlineStart: shift,
        transition: 'margin-inline-start 0.2s ease',
      }}
    />
  );
}

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
