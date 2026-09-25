// The SVG frame of a drawing's typed vector members, shared by the shape paint and by a
// group picture, which paints its vector members over the image.
//
// Trust boundary: colours are validated 6-digit sRGB and coordinates are finite numbers from
// the projection; the SVG is built with createElementNS/setAttribute only.

import type { AnchoredDrawingRecord, InlineDrawingRecord } from '../layout/drawing-layout.ts';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

function finiteStyle(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return String(value);
}

/**
 * The extent frame holding `drawing.vectorShape` as inline SVG, positioned relative to the
 * drawing's paint bounds. The caller guarantees `vectorShape` is non-null.
 */
export function vectorShapeFrame(
  document: Document,
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  scale: number
): HTMLElement {
  const shape = drawing.vectorShape!;
  const content = drawing.geometry.contentBounds;
  const paint = drawing.paintBounds;
  const frame = document.createElement('div');
  frame.className = 'docx-drawing-image-frame';
  frame.style.position = 'absolute';
  frame.style.left = `${(content.x - paint.x) * scale}px`;
  frame.style.top = `${(content.y - paint.y) * scale}px`;
  frame.style.width = `${content.width * scale}px`;
  frame.style.height = `${content.height * scale}px`;

  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  svg.setAttribute(
    'viewBox',
    `0 0 ${finiteStyle(Math.max(1, shape.extentEmu.cx))} ${finiteStyle(Math.max(1, shape.extentEmu.cy))}`
  );
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.style.display = 'block';
  // A non-root `<svg>` clips to its viewport by default. Line-end triangles can extend past
  // the authored extent; Word records that overhang in `wp:effectExtent`, which layout folds
  // into `paintBounds`, so the clip belongs to the outer box alone. A file with no effect
  // extent still clips at the extent, which is what Word shows for it too.
  svg.style.overflow = 'visible';

  // `components` is the paint authority and is always non-empty; the top-level `fillHex`
  // and `strokeHex` describe a one-component shape only.
  for (const component of shape.components) {
    const path = document.createElementNS(SVG_NAMESPACE, 'path');
    const d = component.subpathsEmu
      .map(
        (points, index) =>
          `M${points.map((point) => `${finiteStyle(point.x)} ${finiteStyle(point.y)}`).join('L')}${component.subpathsClosed?.[index] === false ? '' : 'Z'}`
      )
      .join('');
    path.setAttribute('d', d);
    // SAFE: colours are validated 6-digit sRGB at the projection trust boundary.
    path.setAttribute('fill', component.fillHex !== null ? `#${component.fillHex}` : 'none');
    path.setAttribute('fill-rule', 'evenodd');
    if (component.fillAlpha < 1) {
      path.setAttribute('fill-opacity', finiteStyle(Math.max(0, component.fillAlpha)));
    }
    if (component.strokeHex !== null) {
      path.setAttribute('stroke', `#${component.strokeHex}`);
      path.setAttribute('stroke-width', finiteStyle(Math.max(1, component.strokeWidthEmu)));
      if (component.strokeAlpha < 1) {
        path.setAttribute('stroke-opacity', finiteStyle(Math.max(0, component.strokeAlpha)));
      }
    }
    svg.append(path);
    if (component.strokeHex !== null) {
      for (const points of component.arrowheadsEmu ?? []) {
        const arrow = document.createElementNS(SVG_NAMESPACE, 'path');
        arrow.setAttribute(
          'd',
          `M${points.map((point) => `${finiteStyle(point.x)} ${finiteStyle(point.y)}`).join('L')}Z`
        );
        arrow.setAttribute('fill', `#${component.strokeHex}`);
        arrow.setAttribute(
          'fill-opacity',
          finiteStyle(Math.max(0, Math.min(1, component.strokeAlpha)))
        );
        arrow.setAttribute('data-docx-line-end', 'triangle');
        svg.append(arrow);
      }
    }
  }
  frame.append(svg);
  return frame;
}
