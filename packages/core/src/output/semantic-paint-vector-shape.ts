// The SVG frame of a drawing's typed vector members, shared by the shape paint and by a
// group picture, which paints its vector members over the image.
//
// Trust boundary: colours are validated 6-digit sRGB and coordinates are finite numbers from
// the projection; the SVG is built with createElementNS/setAttribute only.

import type { AnchoredDrawingRecord, InlineDrawingRecord } from '../layout/drawing-layout.ts';
import { finite } from '../layout/drawing-geometry.ts';
import type { LayoutBox } from '../layout/semantic-records.ts';
import { applyInsetStroke, vectorShapeViewport } from './vector-shape-svg.ts';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

function finiteStyle(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return String(value);
}

/**
 * Let stroked ink reach past `paint` on the outer box. Where an outline reaches past the
 * extent, a negative inset widens the clip past `paintBounds` without another element. The
 * frame then takes no pointer events, so the outer box stays the target that layout hit
 * testing matches. `ink` is `vectorShapeInkClip` of the same paint bounds.
 */
export function applyVectorInkReach(
  outer: HTMLElement,
  frame: HTMLElement,
  paint: LayoutBox,
  ink: LayoutBox,
  scale: number
): void {
  if (ink === paint) return;
  const reach = (value: number) => `${finiteStyle(-value * scale)}px`;
  outer.style.overflow = 'visible';
  outer.style.clipPath = `inset(${reach(paint.y - ink.y)} ${reach(
    ink.x + ink.width - (paint.x + paint.width)
  )} ${reach(ink.y + ink.height - (paint.y + paint.height))} ${reach(paint.x - ink.x)})`;
  frame.style.pointerEvents = 'none';
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
  const viewport = vectorShapeViewport(shape, content);
  frame.style.left = `${(viewport.frame.x - paint.x) * scale}px`;
  frame.style.top = `${(viewport.frame.y - paint.y) * scale}px`;
  frame.style.width = `${viewport.frame.width * scale}px`;
  frame.style.height = `${viewport.frame.height * scale}px`;

  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  svg.setAttribute('viewBox', viewport.viewBox.map(finiteStyle).join(' '));
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.style.display = 'block';
  // A non-root `<svg>` clips to its viewport by default, so the clip belongs to the outer box
  // alone: `paintBounds`, which carries `wp:effectExtent`, widened by the inset where stroked
  // ink reaches past the extent.
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
      if (component.strokeInset) {
        applyInsetStroke(document, svg, path, d, finite(component.strokeWidthEmu));
      }
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
