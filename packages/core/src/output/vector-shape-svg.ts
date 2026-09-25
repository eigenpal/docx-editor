// SVG support for the vector-shape painter: the viewport of a straight line with a zero
// extent axis, and inset outlines (`a:ln algn="in"`).
import type { VectorShapeProjection } from '../store/package/drawing-projection.ts';
import type { LayoutBox } from '../layout/semantic-records.ts';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
let nextClipId = 0;

/**
 * The `viewBox` (in EMU) and the frame box (in layout points) that map a shape onto its
 * content box. A straight vertical or horizontal line has a zero width or height, which would
 * scale that axis, and the stroke drawn across it, to nothing. That axis instead gets a small
 * range around the line at the other axis's scale, so the outline keeps its authored width.
 */
export function vectorShapeViewport(
  shape: VectorShapeProjection,
  content: LayoutBox
): { readonly viewBox: readonly [number, number, number, number]; readonly frame: LayoutBox } {
  const { cx, cy } = shape.extentEmu;
  if (cx > 0 && cy > 0) return { viewBox: [0, 0, cx, cy], frame: content };
  let pad = 1;
  for (const component of shape.components) pad = Math.max(pad, component.strokeWidthEmu);
  if (cx <= 0) {
    const scale = cy > 0 ? content.height / cy : 0;
    return {
      viewBox: [-pad, 0, 2 * pad, Math.max(1, cy)],
      frame: { ...content, x: content.x - pad * scale, width: 2 * pad * scale },
    };
  }
  const scale = content.width / cx;
  return {
    viewBox: [0, -pad, cx, 2 * pad],
    frame: { ...content, y: content.y - pad * scale, height: 2 * pad * scale },
  };
}

/**
 * Keep an inset outline inside its closed geometry: stroke at twice the authored width and
 * clip the stroke to the path, so the outer half is cut away and the authored width remains
 * inside the shape. The fill is inside the geometry already, so the clip leaves it unchanged.
 */
export function applyInsetStroke(
  document: Document,
  svg: SVGSVGElement,
  path: SVGPathElement,
  d: string,
  widthEmu: number
): void {
  const id = `docx-inset-${++nextClipId}`;
  const clip = document.createElementNS(SVG_NAMESPACE, 'clipPath');
  clip.setAttribute('id', id);
  const outline = document.createElementNS(SVG_NAMESPACE, 'path');
  outline.setAttribute('d', d);
  outline.setAttribute('clip-rule', 'evenodd');
  clip.append(outline);
  svg.append(clip);
  path.setAttribute('stroke-width', String(2 * Math.max(1, widthEmu)));
  path.setAttribute('clip-path', `url(#${id})`);
}
