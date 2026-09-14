// Clear blocked rectangular passages and combined table/contour bands.
// Curved-only exclusions retain their existing scanline placement path.
import { mergeAvailableIntervalsAtY, type ExclusionZone } from './drawing-exclusion.ts';
import { intersectScanlineIntervals, type ScanlineInterval } from './drawing-wrap.ts';
import type { DrawingPoint } from './drawing-geometry.ts';

const EPSILON = 0.001;
const MAX_CLEARANCE_STEPS = 32;
const MAX_CURVED_SCANLINES = 128;

function crossesContent(zone: ExclusionZone, left: number, right: number): boolean {
  if (zone.input.mode === 'topAndBottom') return true;
  const input = zone.input;
  let start = input.contentBounds.x;
  let end = start + input.contentBounds.width;
  for (const polygon of [input.polygon, input.clipPolygon]) {
    for (const point of polygon ?? []) {
      start = Math.min(start, point.x);
      end = Math.max(end, point.x);
    }
  }
  start -= input.wrapDistances.left + input.effectInsets.left;
  end += input.wrapDistances.right + input.effectInsets.right;
  return start < right - EPSILON && end > left + EPSILON;
}

/** Events where a polygon's expanded horizontal contour can change slope. */
function contourEvents(
  zones: readonly ExclusionZone[],
  from: number,
  to: number
): readonly number[] | undefined {
  const events = new Set<number>();
  const add = (event: number) => {
    if (event > from && event < to) events.add(event);
  };
  for (const zone of zones) {
    if (zone.verticalBand.y >= to || zone.verticalBand.y + zone.verticalBand.height <= from)
      continue;
    add(zone.verticalBand.y);
    add(zone.verticalBand.y + zone.verticalBand.height);
    const top = zone.input.wrapDistances.top + zone.input.effectInsets.top;
    const bottom = zone.input.wrapDistances.bottom + zone.input.effectInsets.bottom;
    for (const polygon of [zone.input.polygon, zone.input.clipPolygon]) {
      for (const point of polygon ?? []) {
        add(point.y - top);
        add(point.y + bottom);
        if (events.size > MAX_CURVED_SCANLINES) return undefined;
      }
    }
    if (events.size > MAX_CURVED_SCANLINES) return undefined;
  }
  return [...events].filter(Number.isFinite).sort((a, b) => a - b);
}

function isRectangularContour(polygon: readonly DrawingPoint[] | null): boolean {
  if (!polygon || polygon.length < 4) return false;
  let left = Infinity,
    right = -Infinity,
    top = Infinity,
    bottom = -Infinity;
  for (const point of polygon) {
    left = Math.min(left, point.x);
    right = Math.max(right, point.x);
    top = Math.min(top, point.y);
    bottom = Math.max(bottom, point.y);
  }
  if (!(right > left && bottom > top)) return false;
  return polygon.every((point, index) => {
    const next = polygon[(index + 1) % polygon.length]!;
    const onPerimeter =
      Math.abs(point.x - left) < EPSILON ||
      Math.abs(point.x - right) < EPSILON ||
      Math.abs(point.y - top) < EPSILON ||
      Math.abs(point.y - bottom) < EPSILON;
    return (
      onPerimeter && (Math.abs(point.x - next.x) < EPSILON || Math.abs(point.y - next.y) < EPSILON)
    );
  });
}

/** Return a bounded vertical skip for an empty line, in page-content coordinates. */
export function narrowRectangularWrapSkip(
  y: number,
  height: number,
  zones: readonly ExclusionZone[],
  left: number,
  right: number,
  glyphWidth: number
): number {
  if (
    !(height > 0 && glyphWidth >= 0 && glyphWidth <= right - left) ||
    !Number.isFinite(glyphWidth) ||
    zones.length === 0
  )
    return 0;
  // Rectangles alone can prove that no passage fits. A curved contour can only
  // remove more space; it cannot reopen those passages as its later bands widen.
  const rectangular = zones.filter(
    (zone) =>
      zone.input.mode === 'square' ||
      zone.input.mode === 'topAndBottom' ||
      (zone.input.mode === 'tight' && isRectangularContour(zone.input.polygon))
  );
  let relevant: readonly ExclusionZone[] | undefined;
  const relevantZones = () =>
    (relevant ??= zones.filter((zone) => crossesContent(zone, left, right)));
  const clearBlockingBands = (position: number): number => {
    let bottom = position;
    const ordered = [...relevantZones()].sort((a, b) => a.verticalBand.y - b.verticalBand.y);
    for (const zone of ordered) {
      if (zone.verticalBand.y >= bottom + height - EPSILON) break;
      bottom = Math.max(bottom, zone.verticalBand.y + zone.verticalBand.height);
    }
    return bottom - y;
  };
  let scanlines = 0;
  let combinedBlocked = false;
  let current = y;
  for (let attempt = 0; attempt < MAX_CLEARANCE_STEPS; attempt++) {
    const active = rectangular.filter(
      (zone) =>
        zone.verticalBand.y < current + height - EPSILON &&
        zone.verticalBand.y + zone.verticalBand.height > current + EPSILON
    );
    if (active.length === 0 && !combinedBlocked) return current - y;
    const wrapsTable = active.some(
      (zone) => zone.sourceKind === 'table' && crossesContent(zone, left, right)
    );
    // A leading control still needs the table's minimum passage. Clear before
    // publishing its zero-width span, which would prevent later line clearance.
    if (glyphWidth === 0 && !wrapsTable && !combinedBlocked) return current - y;

    // A line can start above the float while its lower glyph band intersects it.
    // Intersect all relevant scanlines instead of probing only the line's top.
    let available: readonly ScanlineInterval[] = [{ start: left, end: right }];
    const samples = [current + EPSILON, current + height - EPSILON];
    for (const zone of active) samples.push(Math.max(current, zone.verticalBand.y) + EPSILON);
    for (const sample of samples) {
      available = intersectScanlineIntervals(
        available,
        mergeAvailableIntervalsAtY(sample, rectangular, left, right)
      ).filter((interval) => interval.end - interval.start >= glyphWidth - EPSILON);
      if (available.length === 0) break;
    }
    if (available.length > 0) {
      // Preserve the existing curved-only path. This fallback is needed when a
      // table's minimum passage removes the last space beside a curved drawing.
      if (!combinedBlocked && (!wrapsTable || rectangular.length === zones.length))
        return current - y;
      const events = contourEvents(relevantZones(), current, current + height);
      if (!events) return clearBlockingBands(current);
      let combined: readonly ScanlineInterval[] = [{ start: left, end: right }];
      const probes = [current + EPSILON, current + height - EPSILON];
      for (const event of events) {
        if (event > current && event < current + height) {
          probes.push(Math.max(current + EPSILON, event - EPSILON));
          probes.push(Math.min(current + height - EPSILON, event + EPSILON));
        }
      }
      for (const probe of probes) {
        if (++scanlines > MAX_CURVED_SCANLINES) return clearBlockingBands(current);
        combined = intersectScanlineIntervals(
          combined,
          mergeAvailableIntervalsAtY(probe, zones, left, right)
        ).filter((interval) => interval.end - interval.start >= glyphWidth - EPSILON);
        if (combined.length === 0) break;
      }
      if (combined.length > 0) return current - y;
      combinedBlocked = true;
      // Recheck at the next contour event or line-height step. Unlike rectangles,
      // a curved exclusion can release a passage before its vertical band ends.
      current = Math.min(
        current + height,
        events.find((event) => event > current + EPSILON) ?? Infinity
      );
      continue;
    }
    if (wrapsTable && rectangular.length !== zones.length) combinedBlocked = true;
    let next = Infinity;
    for (const zone of active) {
      const bottom = zone.verticalBand.y + zone.verticalBand.height;
      if (bottom > current + EPSILON) next = Math.min(next, bottom);
    }
    if (!Number.isFinite(next) || next <= current || next - y > 100_000)
      return combinedBlocked ? clearBlockingBands(current) : current - y;
    current = next;
  }
  return combinedBlocked ? clearBlockingBands(current) : current - y;
}
