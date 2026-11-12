// Where a press reaches a vector shape: its filled area, and its outline or path within reach.
// A shape with no fill, a line and a connector take a press only near the path they paint, so
// a press on text inside or beside them goes to the text. A shape that paints nothing at all
// takes a press anywhere on its frame, so it stays reachable.

import type { AnchoredDrawingRecord, InlineDrawingRecord } from './drawing-layout.ts';
import type { VectorShapeComponent } from '../store/package/drawing-shape-projection.ts';

type Drawing = InlineDrawingRecord | AnchoredDrawingRecord;
type Point = { readonly x: number; readonly y: number };

/** How far, in points, a press reaches past a painted path or outline edge. */
export const PATH_HIT_REACH = 3;
const EMU_PER_POINT = 12_700;

/**
 * Whether `point` (page-content points) reaches the shape `drawing` paints, or null when the
 * drawing is not a plain vector shape: a picture, a text box or any other drawing keeps its
 * whole frame.
 */
export function vectorShapeHit(drawing: Drawing, point: Point): boolean | null {
  const shape = drawing.vectorShape;
  if (!shape || drawing.textboxStory || drawing.resource.kind === 'ready') return null;
  // A picture's outline projects as a stroke-only shape; the picture keeps its whole frame,
  // whatever its resource state. A legacy VML drawing and a group of pictures do too.
  if (drawing.placeholderGraphicKind === null || drawing.groupPicture) return null;
  const content = drawing.geometry.contentBounds;
  const { cx, cy } = shape.extentEmu;
  const sx = cx > 0 ? content.width / cx : 0;
  const sy = cy > 0 ? content.height / cy : 0;
  const place = (p: Point): Point => ({ x: content.x + p.x * sx, y: content.y + p.y * sy });
  // A shape that paints nothing would be out of reach: its frame takes the press instead.
  if (!shape.components.some(paints)) return insideBox(content, point, PATH_HIT_REACH);
  for (const component of shape.components) {
    if (componentHit(component, place, point)) return true;
  }
  return false;
}

function paints(component: VectorShapeComponent): boolean {
  return (
    (component.fillHex !== null && component.fillAlpha > 0) ||
    !!component.fillGradient ||
    !!component.fillPattern ||
    (component.strokeHex !== null && component.strokeAlpha > 0) ||
    !!component.arrowheadsEmu?.length
  );
}

function insideBox(
  box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  point: Point,
  reach: number
): boolean {
  return (
    point.x >= box.x - reach &&
    point.x <= box.x + box.width + reach &&
    point.y >= box.y - reach &&
    point.y <= box.y + box.height + reach
  );
}

function componentHit(
  component: VectorShapeComponent,
  place: (p: Point) => Point,
  point: Point
): boolean {
  const rings = component.subpathsEmu.map((ring) => ring.map(place));
  const closed = (index: number) => component.subpathsClosed?.[index] !== false;
  const filled =
    (component.fillHex !== null && component.fillAlpha > 0) ||
    !!component.fillGradient ||
    !!component.fillPattern;
  if (
    filled &&
    insideRings(
      rings.filter((_, index) => closed(index)),
      point
    )
  )
    return true;
  if (component.arrowheadsEmu?.some((head) => insideRings([head.map(place)], point))) return true;
  const stroked = component.strokeHex !== null && component.strokeAlpha > 0;
  const reach = PATH_HIT_REACH + (stroked ? component.strokeWidthEmu / EMU_PER_POINT / 2 : 0);
  return rings.some((ring, index) => nearPath(ring, closed(index), point, reach));
}

/** Even-odd inside test over every ring, as the fill paints. */
function insideRings(rings: readonly (readonly Point[])[], point: Point): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]!;
      const b = ring[j]!;
      if (a.y > point.y !== b.y > point.y) {
        const x = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
        if (point.x < x) inside = !inside;
      }
    }
  }
  return inside;
}

function nearPath(ring: readonly Point[], closed: boolean, point: Point, reach: number): boolean {
  const limit = reach * reach;
  if (ring.length === 1) return squaredDistance(ring[0]!, ring[0]!, point) <= limit;
  const last = closed ? ring.length : ring.length - 1;
  for (let index = 0; index < last; index += 1) {
    const a = ring[index]!;
    const b = ring[(index + 1) % ring.length]!;
    if (squaredDistance(a, b, point) <= limit) return true;
  }
  return false;
}

/** The squared distance from `point` to the segment `a`-`b`. */
function squaredDistance(a: Point, b: Point, point: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t =
    length === 0
      ? 0
      : Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
  const x = a.x + t * dx - point.x;
  const y = a.y + t * dy - point.y;
  return x * x + y * y;
}
