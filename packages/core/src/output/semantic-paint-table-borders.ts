// Table-cell border paint: scale and draw layout-owned records only.
//
// Conflict resolution, compound stroke/gap/extent/inset math, and corner endpoint
// ownership live in `layout/table-borders.ts`. This module must not invent geometry.

import type {
  ResolvedCellBorders,
  ResolvedTableBorderEdge,
  TableBorderStrokeRecord,
} from '@docx-editor.dev/core/layout';

const HEX = /^[0-9A-Fa-f]{6}$/;

export type TableBorderSide = 'Top' | 'Right' | 'Bottom' | 'Left';

/** Map a layout-owned table border style to a CSS border-style keyword. */
export function cssBorderStyle(style: ResolvedTableBorderEdge['style']): string {
  switch (style) {
    case 'dashed':
      return 'dashed';
    case 'dotted':
      return 'dotted';
    case 'double':
    case 'triple':
      // Compound edges are drawn from published stroke records, not CSS border-style.
      return 'solid';
    case 'thick':
    case 'single':
    default:
      return 'solid';
  }
}

function hexColor(color: string | null | undefined): string {
  return color && HEX.test(color) ? color : '000000';
}

/** Selection-inert overlay shell for layout-owned stroke records. */
function createTableBorderOverlay(document: Document, className: string): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.className = className;
  overlay.setAttribute('aria-hidden', 'true');
  overlay.setAttribute('contenteditable', 'false');
  overlay.style.position = 'absolute';
  overlay.style.left = '0';
  overlay.style.top = '0';
  overlay.style.right = '0';
  overlay.style.bottom = '0';
  overlay.style.overflow = 'visible';
  overlay.style.pointerEvents = 'none';
  overlay.style.boxSizing = 'border-box';
  return overlay;
}

function applyCssEdge(
  element: HTMLElement,
  side: TableBorderSide,
  edge: ResolvedTableBorderEdge | undefined,
  scale: number
): void {
  if (!edge) return;
  const color = `#${hexColor(edge.color)}`;
  const widthPx = `${Math.max(0, edge.widthPt * scale)}px`;
  element.style[`border${side}Width` as 'borderTopWidth'] = widthPx;
  element.style[`border${side}Color` as 'borderTopColor'] = color;
  // Compound sides: CSS would collapse thin doubles; strokes carry the geometry.
  if (edge.style === 'double' || edge.style === 'triple') {
    element.style[`border${side}Style` as 'borderTopStyle'] = 'none';
    return;
  }
  element.style[`border${side}Style` as 'borderTopStyle'] = cssBorderStyle(edge.style);
}

function appendStroke(
  document: Document,
  host: HTMLElement,
  stroke: TableBorderStrokeRecord,
  scale: number,
  className: string
): void {
  const seg = document.createElement('div');
  seg.className = className;
  seg.dataset.edge = stroke.side;
  seg.dataset.stroke = stroke.role;
  seg.style.position = 'absolute';
  seg.style.left = `${stroke.x * scale}px`;
  seg.style.top = `${stroke.y * scale}px`;
  seg.style.width = `${stroke.width * scale}px`;
  seg.style.height = `${stroke.height * scale}px`;
  seg.style.pointerEvents = 'none';
  seg.style.backgroundColor = `#${hexColor(stroke.color)}`;
  if (stroke.cssStyle !== 'solid') seg.dataset.cssStyle = stroke.cssStyle;
  host.append(seg);
}

/** One pass over published strokes — O(n) role lookup per stroke during paint. */
function strokeRoleIndex(strokes: readonly TableBorderStrokeRecord[]): Set<string> {
  const roles = new Set<string>();
  for (const stroke of strokes) {
    roles.add(`${stroke.side}\0${stroke.role}`);
  }
  return roles;
}

function paintPublishedStrokes(
  document: Document,
  element: HTMLElement,
  strokes: readonly TableBorderStrokeRecord[],
  scale: number
): void {
  const roles = strokeRoleIndex(strokes);
  const hasMiddleOnSide = (side: TableBorderStrokeRecord['side']): boolean =>
    roles.has(`${side}\0middle`);

  const doubleHost = createTableBorderOverlay(document, 'docx-table-border-double');
  const tripleHost = createTableBorderOverlay(document, 'docx-table-border-triple');
  const edgeHost = createTableBorderOverlay(document, 'docx-table-border-edge');
  let hasDouble = false;
  let hasTriple = false;
  let hasEdge = false;

  for (const stroke of strokes) {
    if (stroke.role === 'edge') {
      hasEdge = true;
      appendStroke(document, edgeHost, stroke, scale, 'docx-table-border-edge-stroke');
      continue;
    }
    if (hasMiddleOnSide(stroke.side)) {
      hasTriple = true;
      appendStroke(document, tripleHost, stroke, scale, 'docx-table-border-triple-stroke');
      continue;
    }
    if (stroke.role === 'outer' || stroke.role === 'inner') {
      hasDouble = true;
      appendStroke(document, doubleHost, stroke, scale, 'docx-table-border-double-stroke');
    }
  }

  if (hasDouble) element.append(doubleHost);
  if (hasTriple) element.append(tripleHost);
  if (hasEdge) element.append(edgeHost);
}

/**
 * Apply layout-owned cell borders: CSS for simple full-side edges, inert overlays for
 * published stroke records. No metrics, gap, conflict, or corner ownership here.
 */
export function applyCellBorders(
  document: Document,
  element: HTMLElement,
  borders: ResolvedCellBorders | undefined,
  scale: number
): void {
  applyCssEdge(element, 'Top', borders?.top, scale);
  applyCssEdge(element, 'Right', borders?.right, scale);
  applyCssEdge(element, 'Bottom', borders?.bottom, scale);
  applyCssEdge(element, 'Left', borders?.left, scale);
  if (borders?.strokes && borders.strokes.length > 0) {
    paintPublishedStrokes(document, element, borders.strokes, scale);
  }
}
