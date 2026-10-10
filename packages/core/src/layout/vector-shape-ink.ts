// The paint clip of a vector shape, grown where a stroked outline reaches past its extent.

import type { AnchoredDrawingRecord, InlineDrawingRecord } from './drawing-layout.ts';
import {
  expandBoxByInsets,
  finite,
  type DrawingInsets,
  type DrawingPoint as Point,
} from './drawing-geometry.ts';
import type { VectorShapeProjection } from '../store/package/drawing-projection.ts';
import type { LayoutBox } from './semantic-records.ts';

type Drawing = InlineDrawingRecord | AnchoredDrawingRecord;

/**
 * How far inside the extent edge a paint edge must sit to count as cut. Layout moves
 * `paintBounds` by any amount but skips geometry moves under 1e-4pt, so smaller drift between
 * the two is not a cut.
 */
const CLIP_EPSILON = 1e-3;
/**
 * Group transforms scale child points by `extent / chExt`, which can land a point on the
 * extent edge a few ULPs outside it. One EMU of tolerance keeps such an edge inside.
 */
const EXTENT_TOLERANCE_EMU = 1;
/** The miter limit both painters use (SVG default, PDF `4 M`). */
const MITER_LIMIT = 4;
const NO_GROWTH: DrawingInsets = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
/**
 * The stroke reach depends only on the projected shape, which keeps its identity when layout
 * moves the drawing into a new record, and on every page a header group repeats on.
 */
const reachCache = new WeakMap<VectorShapeProjection, DrawingInsets>();

/**
 * The box a painter clips a vector shape to: `bounds` grown on each side where a stroked
 * outline reaches past the drawing extent.
 *
 * An outline is centred on its geometry and is not cut at the extent, a text column, or a cell
 * edge that meets the extent: a rule at x=0 of a group with `wp:effectExtent l="0"` keeps
 * its full width. The reach comes from butt-capped segments and miter joins, measured
 * only on the part of each segment inside the extent, so geometry outside the extent stays
 * clipped and a side grows by at most the miter reach. A line-end triangle on a line that
 * ends inside the extent grows it too. A side stays as it is when a layout region or a
 * negative effect extent cut into the shape itself, and a drawing clipped to nothing stays
 * empty.
 *
 * Only the paint clip grows. Collisions, hit testing, and pointer targets keep `paintBounds`,
 * so a painter clips with this box without making it clickable.
 *
 * `bounds` is the drawing's `paintBounds` in any translation: the record's own, or the
 * absolute paint bounds of an export visit.
 *
 * @public
 */
export function vectorShapeInkClip(
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  bounds: LayoutBox
): LayoutBox {
  const growth = inkGrowth(drawing);
  return growth === NO_GROWTH ? bounds : expandBoxByInsets(bounds, growth);
}

function inkGrowth(drawing: Drawing): DrawingInsets {
  const shape = drawing.vectorShape;
  if (!shape) return NO_GROWTH;
  const { cx, cy } = shape.extentEmu;
  // A straight line has one zero axis; both zero is empty.
  if (!(cx >= 0) || !(cy >= 0) || (cx === 0 && cy === 0)) return NO_GROWTH;
  let reachEmu = reachCache.get(shape);
  if (!reachEmu) {
    reachEmu = strokeReach(shape);
    reachCache.set(shape, reachEmu);
  }
  if (reachEmu === NO_GROWTH) return NO_GROWTH;
  const paint = drawing.paintBounds;
  const content = drawing.geometry.contentBounds;
  // A drawing that a region clipped away entirely paints nothing, ink included. A zero-width
  // line keeps a zero-width paint box of its own, which is not a clip.
  if (!(paint.width > 0 || content.width <= 0) || !(paint.height > 0 || content.height <= 0)) {
    return NO_GROWTH;
  }
  // A collapsed axis has no scale of its own; the drawing's other axis gives it.
  const scaleX = cx > 0 ? content.width / cx : content.height / cy;
  const scaleY = cy > 0 ? content.height / cy : content.width / cx;
  // `room` is how far the paint edge already sits outside the extent edge: the effect extent,
  // or less where a region cut it. A paint edge inside the extent means a region or a negative
  // effect extent cut into the shape itself, and that side stays as it is.
  const grow = (overhangEmu: number, scale: number, room: number) => {
    if (room < -CLIP_EPSILON) return 0;
    const extra = overhangEmu * scale - Math.max(0, room);
    return Number.isFinite(extra) && extra > 0 ? extra : 0;
  };
  const growth = {
    left: grow(reachEmu.left, scaleX, content.x - paint.x),
    top: grow(reachEmu.top, scaleY, content.y - paint.y),
    right: grow(reachEmu.right, scaleX, paint.x + paint.width - (content.x + content.width)),
    bottom: grow(reachEmu.bottom, scaleY, paint.y + paint.height - (content.y + content.height)),
  };
  return growth.left || growth.top || growth.right || growth.bottom
    ? Object.freeze(growth)
    : NO_GROWTH;
}

/** How far stroked ink reaches past each extent edge, in EMU; `NO_GROWTH` when it stays in. */
function strokeReach(shape: VectorShapeProjection): DrawingInsets {
  const { cx, cy } = shape.extentEmu;
  let minX = 0;
  let minY = 0;
  let maxX = cx;
  let maxY = cy;
  const include = (x: number, y: number) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };
  const t = EXTENT_TOLERANCE_EMU;
  const inside = (point: Point) =>
    point.x >= -t && point.x <= cx + t && point.y >= -t && point.y <= cy + t;
  for (const component of shape.components) {
    // An inset outline stays inside the geometry, so it keeps the extent clip.
    if (component.strokeHex === null || component.strokeInset === true) continue;
    // Both painters draw at least a 1 EMU stroke.
    const half = Math.max(1, finite(component.strokeWidthEmu)) / 2;
    component.subpathsEmu.forEach((raw, index) => {
      const closed = component.subpathsClosed?.[index] !== false;
      const points = distinctPoints(raw, closed);
      const segments = closed && points.length > 2 ? points.length : points.length - 1;
      const normals: Point[] = [];
      for (let at = 0; at < segments; at += 1) {
        const a = points[at]!;
        const b = points[(at + 1) % points.length]!;
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        const normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
        normals.push(normal);
        if (!clipSegment(a, b, -t, cx + t, -t, cy + t)) continue;
        for (let end = 0; end < 2; end += 1) {
          const along = SPAN[end]!;
          const x = a.x + (b.x - a.x) * along;
          const y = a.y + (b.y - a.y) * along;
          include(x + normal.x * half, y + normal.y * half);
          include(x - normal.x * half, y - normal.y * half);
        }
      }
      // A miter join reaches past the segment edges along the bisector of its two normals.
      const joins = closed && points.length > 2 ? normals.length : normals.length - 1;
      for (let at = 0; at < joins; at += 1) {
        const vertex = points[(at + 1) % points.length]!;
        if (!inside(vertex)) continue;
        const first = normals[at]!;
        const second = normals[(at + 1) % normals.length]!;
        const denominator = 1 + first.x * second.x + first.y * second.y;
        // 1 / cos(half the turn) is the miter ratio; past the limit the join is bevelled.
        if (denominator < 2 / (MITER_LIMIT * MITER_LIMIT)) continue;
        // The tip lies on the outer side of the turn: right of a left turn, left of a right
        // turn. Directions are the normals turned back a quarter (d = (n.y, -n.x)).
        const turn = first.y * -second.x - -first.x * second.y;
        if (turn === 0) continue;
        const side = turn > 0 ? -1 : 1;
        include(
          vertex.x + (side * (first.x + second.x) * half) / denominator,
          vertex.y + (side * (first.y + second.y) * half) / denominator
        );
      }
    });
    // A line-end triangle is painted in the stroke colour wherever its line ends in the extent.
    // Its first point is the line end (see `projectLineArrowheads`).
    for (const triangle of component.arrowheadsEmu ?? []) {
      if (!triangle[0] || !inside(triangle[0])) continue;
      for (const point of triangle) include(point.x, point.y);
    }
  }
  if (minX >= 0 && minY >= 0 && maxX <= cx && maxY <= cy) return NO_GROWTH;
  return Object.freeze({ left: -minX, top: -minY, right: maxX - cx, bottom: maxY - cy });
}

/** The path without repeated points, including a closing point that repeats the first. */
function distinctPoints(points: readonly Point[], closed: boolean): readonly Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (!last || last.x !== point.x || last.y !== point.y) out.push(point);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (closed && out.length > 1 && first!.x === last!.x && first!.y === last!.y) out.pop();
  return out;
}

/**
 * The part of segment a→b inside the box (Liang–Barsky), as the start and end fractions in
 * `SPAN`; false when the segment misses the box. The scratch array keeps the walk
 * allocation-free.
 */
const SPAN = new Float64Array(2);
function clipSegment(
  a: Point,
  b: Point,
  left: number,
  right: number,
  top: number,
  bottom: number
): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  SPAN[0] = 0;
  SPAN[1] = 1;
  return (
    clipEdge(-dx, a.x - left) &&
    clipEdge(dx, right - a.x) &&
    clipEdge(-dy, a.y - top) &&
    clipEdge(dy, bottom - a.y)
  );
}

/** One Liang–Barsky edge test: narrows `SPAN`, false when nothing is left. */
function clipEdge(p: number, q: number): boolean {
  if (p === 0) return q >= 0;
  const t = q / p;
  if (p < 0) SPAN[0] = Math.max(SPAN[0]!, t);
  else SPAN[1] = Math.min(SPAN[1]!, t);
  return SPAN[0]! <= SPAN[1]!;
}
