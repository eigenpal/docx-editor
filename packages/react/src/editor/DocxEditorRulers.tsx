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

import { useCallback, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import type { EditorSnapshot } from '@docx-editor.dev/core-contract/contracts/editor';
import { HorizontalRuler, type RulerPageSetup } from '../components/ui/HorizontalRuler';
import { VerticalRuler } from '../components/ui/VerticalRuler';
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
  const preview = useCallback(
    (side: keyof PendingMargins) => (twips: number) =>
      setPending((current) => ({ ...current, [side]: Math.round(twips) })),
    []
  );
  const commit = useCallback(() => {
    setPending((current) => {
      if (Object.keys(current).length > 0) {
        apply({
          ...(current.top !== undefined ? { marginTop: current.top } : {}),
          ...(current.right !== undefined ? { marginRight: current.right } : {}),
          ...(current.bottom !== undefined ? { marginBottom: current.bottom } : {}),
          ...(current.left !== undefined ? { marginLeft: current.left } : {}),
        });
      }
      return {};
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
      style={props.style}
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
