// The ring that the geometry of a shape clips a picture to: a shape with a picture fill, or
// a picture member of a group.

import { readShapeGeometry } from './drawing-shape-geometry.ts';
import { schemaAttributeValue } from './ooxml-drawing-rules.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';

const A = DRAWINGML_MAIN_NAMESPACE_URI;
/** The most points one clip ring holds. */
const MAX_CLIP_POINTS = 1024;

/** The shape's one filled outline in the unit square of its extent; null for a rectangle. */
export function shapeClipRing(
  spPr: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>
): readonly Readonly<{ x: number; y: number }>[] | null {
  const geometry = readShapeGeometry(spPr, extent);
  if (!geometry) return null;
  const outlines = geometry.paths
    .filter((path) => path.fill !== 'none')
    .flatMap((path) => path.subpaths);
  if (outlines.length !== 1) return null;
  const points = outlines[0]!.points;
  if (points.length < 3 || points.length > MAX_CLIP_POINTS) return null;
  const ring = points.map((point) =>
    Object.freeze({ x: point.x / extent.cx, y: point.y / extent.cy })
  );
  const rectangle =
    ring.length === 4 &&
    ring.every((point) => (point.x === 0 || point.x === 1) && (point.y === 0 || point.y === 1));
  return rectangle ? null : Object.freeze(ring);
}

/**
 * Whether the geometry of `spPr` clips a picture and gives no ring: it has several filled
 * outlines (a `donut` or a `frame`), too many points, or is outside the geometry reader. The
 * picture then paints as a rectangle.
 */
export function shapeClipLeftOut(
  spPr: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>
): boolean {
  const authored = spPr.children.some(
    (node) =>
      node.kind !== 'textValue' &&
      node.namespaceUri === A &&
      (node.localName === 'custGeom' ||
        (node.localName === 'prstGeom' && schemaAttributeValue(node.attributes, 'prst') !== 'rect'))
  );
  if (!authored || !(extent.cx > 0) || !(extent.cy > 0)) return false;
  const geometry = readShapeGeometry(spPr, extent);
  if (!geometry) return true;
  const outlines = geometry.paths
    .filter((path) => path.fill !== 'none')
    .flatMap((path) => path.subpaths);
  if (outlines.length !== 1) return true;
  const count = outlines[0]!.points.length;
  return count < 3 || count > MAX_CLIP_POINTS;
}
