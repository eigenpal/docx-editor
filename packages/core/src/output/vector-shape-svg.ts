// SVG support for the vector-shape painter: the viewport of a straight line with a zero
// extent axis, and inset outlines (`a:ln algn="in"`).
import type { VectorShapeProjection } from '../store/package/drawing-projection.ts';
import type { VectorGradient } from '../store/package/drawing-gradient.ts';
import type { VectorShapeComponent } from '../store/package/drawing-shape-projection.ts';
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

let nextGradientId = 0;

/**
 * Fill `path` with `gradient`: a gradient element in user space, mapped onto the extent's
 * point space by the gradient's own matrix. Stop colours are validated sRGB from the
 * projection, so no file string reaches an attribute.
 */
export function applyGradientFill(
  document: Document,
  svg: SVGSVGElement,
  path: SVGPathElement,
  gradient: VectorGradient
): void {
  const id = `docx-gradient-${++nextGradientId}`;
  const element = document.createElementNS(
    SVG_NAMESPACE,
    gradient.kind === 'linear' ? 'linearGradient' : 'radialGradient'
  );
  element.setAttribute('id', id);
  element.setAttribute('gradientUnits', 'userSpaceOnUse');
  element.setAttribute(
    'gradientTransform',
    `matrix(${gradient.matrix.map(finiteNumber).join(' ')})`
  );
  const names = gradient.kind === 'linear' ? ['x1', 'y1', 'x2', 'y2'] : ['cx', 'cy', 'r'];
  names.forEach((name, index) =>
    element.setAttribute(name, finiteNumber(gradient.coords[index] ?? 0))
  );
  for (const stop of gradient.stops) {
    const node = document.createElementNS(SVG_NAMESPACE, 'stop');
    node.setAttribute('offset', finiteNumber(Math.max(0, Math.min(1, stop.offset))));
    node.setAttribute('stop-color', `#${stop.hex}`);
    if (stop.alpha < 1) node.setAttribute('stop-opacity', finiteNumber(Math.max(0, stop.alpha)));
    element.append(node);
  }
  svg.append(element);
  path.setAttribute('fill', `url(#${id})`);
}

function finiteNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : '0';
}

let nextShadowId = 0;

/**
 * The component's outer shadow: its path offset and filled (or stroked, for a line) in the
 * shadow colour, blurred by half the blur radius as a standard deviation. It is appended
 * before the component's own path, so it paints underneath.
 */
export function appendShadow(
  document: Document,
  svg: SVGSVGElement,
  d: string,
  component: VectorShapeComponent
): void {
  const shadow = component.shadow;
  if (!shadow || (component.fillHex === null && component.strokeHex === null)) return;
  const path = document.createElementNS(SVG_NAMESPACE, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill-rule', 'evenodd');
  // SAFE: the shadow colour is validated sRGB from the projection.
  path.setAttribute('fill', component.fillHex !== null ? `#${shadow.hex}` : 'none');
  if (component.strokeHex !== null) {
    path.setAttribute('stroke', `#${shadow.hex}`);
    path.setAttribute('stroke-width', finiteNumber(Math.max(1, component.strokeWidthEmu)));
  }
  path.setAttribute('opacity', finiteNumber(Math.max(0, Math.min(1, shadow.alpha))));
  path.setAttribute(
    'transform',
    `translate(${finiteNumber(shadow.dxEmu)} ${finiteNumber(shadow.dyEmu)})`
  );
  if (shadow.blurEmu > 0) {
    const id = `docx-shadow-${++nextShadowId}`;
    const filter = document.createElementNS(SVG_NAMESPACE, 'filter');
    filter.setAttribute('id', id);
    filter.setAttribute('x', '-50%');
    filter.setAttribute('y', '-50%');
    filter.setAttribute('width', '200%');
    filter.setAttribute('height', '200%');
    const blur = document.createElementNS(SVG_NAMESPACE, 'feGaussianBlur');
    blur.setAttribute('stdDeviation', finiteNumber(shadow.blurEmu / 2));
    filter.append(blur);
    svg.append(filter);
    path.setAttribute('filter', `url(#${id})`);
  }
  path.setAttribute('data-docx-shadow', '');
  svg.append(path);
}
