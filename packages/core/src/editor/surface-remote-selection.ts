// Remote presence overlay: geometry from layout records, paint into the furniture layer.
//
// The awareness payload names only an anchor and a head. This module walks the receiver's
// layout to cover every line between them, including a range that crosses a page or a cell.

import { caretAt, selectionRects } from '@docx-editor.dev/core/layout';
import type { SemanticLayout, SemanticSelection } from '@docx-editor.dev/core/layout';
import { paintSelectionOverlay, type OverlayRect } from '@docx-editor.dev/core/output';
import type {
  CollaborationLocalSelection,
  CollaborationParagraph,
  CollaborationRemoteSelection,
} from '@docx-editor.dev/core/collaboration';

/** Map a surface selection to the stable paragraph ids awareness publishes. */
export function localCollaborationSelection(
  selection: SemanticSelection,
  paragraphByNodeId: (nodeId: string) => CollaborationParagraph | null
): CollaborationLocalSelection | null {
  const anchor = paragraphByNodeId(selection.anchor.paragraphId);
  const head = paragraphByNodeId(selection.head.paragraphId);
  if (!anchor || !head) return null;
  return {
    anchor: { paragraphId: anchor.paragraphId, offset: Math.max(0, selection.anchor.offset) },
    head: { paragraphId: head.paragraphId, offset: Math.max(0, selection.head.offset) },
  };
}

export interface RemoteSelectionPaintOptions {
  readonly scale: number;
  readonly pageOffsetX?: ReadonlyMap<number, number>;
  readonly paragraphOrder: readonly string[];
}

function isCollapsed(remote: CollaborationRemoteSelection): boolean {
  return remote.anchor.nodeId === remote.head.nodeId && remote.anchor.offset === remote.head.offset;
}

/**
 * Paint every remote selection into the overlay layer.
 *
 * The layer is furniture: the caller keeps it `contenteditable=false` and outside the pages.
 * Display names reach `textContent` only. Author colour is a CSS custom property, never
 * interpolated into a style string.
 */
export function paintRemoteSelections(
  layer: HTMLElement,
  layout: SemanticLayout,
  selections: readonly CollaborationRemoteSelection[],
  options: RemoteSelectionPaintOptions
): void {
  const { scale, pageOffsetX, paragraphOrder } = options;
  const rects: OverlayRect[] = [];
  const rectColors: (string | undefined)[] = [];
  const labels: {
    readonly name: string;
    readonly color?: string;
    readonly pageIndex: number;
    readonly x: number;
    readonly y: number;
  }[] = [];
  for (const remote of selections) {
    const labelGeometry = caretAt(layout, {
      paragraphId: remote.head.nodeId,
      offset: remote.head.offset,
    });
    if (labelGeometry) {
      labels.push({
        name: remote.name,
        ...(remote.color ? { color: remote.color } : {}),
        pageIndex: labelGeometry.pageIndex,
        x: labelGeometry.x,
        y: labelGeometry.y,
      });
    }
    if (isCollapsed(remote)) {
      const geometry = caretAt(layout, {
        paragraphId: remote.anchor.nodeId,
        offset: remote.anchor.offset,
      });
      if (!geometry) continue;
      rects.push({
        pageIndex: geometry.pageIndex,
        x: geometry.x,
        y: geometry.y,
        width: Math.max(1 / scale, 1),
        height: geometry.height,
        className: 'docx-remote-caret',
      });
      rectColors.push(remote.color);
      continue;
    }
    const selection: SemanticSelection = {
      anchor: { paragraphId: remote.anchor.nodeId, offset: remote.anchor.offset },
      head: { paragraphId: remote.head.nodeId, offset: remote.head.offset },
    };
    for (const rect of selectionRects(layout, selection, paragraphOrder)) {
      rects.push({ ...rect, className: 'docx-remote-selection-rect' });
      rectColors.push(remote.color);
    }
  }
  paintSelectionOverlay(layer, layout, rects, { scale, pageOffsetX });
  [...layer.children].forEach((element, index) => {
    const color = rectColors[index];
    if (!color || !(element instanceof HTMLElement)) return;
    element.style.setProperty('--doc-remote-color', color);
  });
  const document = layer.ownerDocument;
  for (const label of labels) {
    const page = layout.pages[label.pageIndex];
    if (!page) continue;
    const element = document.createElement('div');
    element.className = 'docx-remote-caret-label';
    element.textContent = label.name;
    element.style.left = `${
      (page.contentBox.x + label.x + (pageOffsetX?.get(label.pageIndex) ?? 0)) * scale
    }px`;
    element.style.top = `${(page.contentBox.y + label.y) * scale}px`;
    if (label.color) element.style.setProperty('--doc-remote-color', label.color);
    layer.append(element);
  }
}
