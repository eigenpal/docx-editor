// Framework-neutral client/content coordinate mapping (interactive-paginated-editing 3.5).
// Frame-authoritative stacked page geometry; explicit host metrics only in production.

import type {
  AffineTransform,
  InteractionFrame,
  InteractionHostMetrics,
} from '@docx-editor.dev/core-contract/interaction';
import type { Point, Rect } from '@docx-editor.dev/core-contract/types';

export type CoordinateRejectCode =
  | 'nonFinite'
  | 'invalidZoom'
  | 'singularTransform'
  | 'outOfBounds'
  | 'staleFrame';

export type CoordinateOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: CoordinateRejectCode; readonly reason: string };

/** Named identity metrics for deterministic tests only — never used in production paths. */
export const IDENTITY_HOST_METRICS: InteractionHostMetrics = {
  clientOrigin: { x: 0, y: 0 },
  scrollOffset: { x: 0, y: 0 },
  zoom: 1,
};

function isFinitePoint(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

function isFiniteRect(rect: Rect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height)
  );
}

function isFiniteMetrics(metrics: InteractionHostMetrics): boolean {
  // Shape first. This used to dereference `metrics.clientOrigin.x` directly, so a
  // host returning a partial metrics object threw instead of producing the typed
  // rejection the contract promises.
  if (typeof metrics.clientOrigin !== 'object' || metrics.clientOrigin === null) return false;
  if (typeof metrics.scrollOffset !== 'object' || metrics.scrollOffset === null) return false;
  return isFinitePoint(metrics.clientOrigin) && isFinitePoint(metrics.scrollOffset) && Number.isFinite(metrics.zoom);
}

export function validateHostMetrics(metrics: InteractionHostMetrics | undefined): CoordinateOutcome<InteractionHostMetrics> {
  if (!metrics) {
    return { ok: false, code: 'nonFinite', reason: 'explicit InteractionHostMetrics are required' };
  }
  if (!isFiniteMetrics(metrics)) {
    return { ok: false, code: 'nonFinite', reason: 'host metrics are not finite' };
  }
  if (metrics.zoom <= 0) {
    return { ok: false, code: 'invalidZoom', reason: 'zoom must be positive' };
  }
  return { ok: true, value: metrics };
}

export function clientToContent(point: Point, metrics: InteractionHostMetrics): CoordinateOutcome<Point> {
  const valid = validateHostMetrics(metrics);
  if (!valid.ok) return valid;
  if (!isFinitePoint(point)) {
    return { ok: false, code: 'nonFinite', reason: 'client point is not finite' };
  }
  return {
    ok: true,
    value: {
      x: (point.x - metrics.clientOrigin.x) / metrics.zoom + metrics.scrollOffset.x,
      y: (point.y - metrics.clientOrigin.y) / metrics.zoom + metrics.scrollOffset.y,
    },
  };
}

export function contentToClient(point: Point, metrics: InteractionHostMetrics): CoordinateOutcome<Point> {
  const valid = validateHostMetrics(metrics);
  if (!valid.ok) return valid;
  if (!isFinitePoint(point)) {
    return { ok: false, code: 'nonFinite', reason: 'content point is not finite' };
  }
  return {
    ok: true,
    value: {
      x: metrics.clientOrigin.x + (point.x - metrics.scrollOffset.x) * metrics.zoom,
      y: metrics.clientOrigin.y + (point.y - metrics.scrollOffset.y) * metrics.zoom,
    },
  };
}

export function applyAffine(transform: AffineTransform, point: Point): Point {
  return {
    x: transform.a * point.x + transform.c * point.y + transform.tx,
    y: transform.b * point.x + transform.d * point.y + transform.ty,
  };
}

export function invertAffine(transform: AffineTransform): AffineTransform | null {
  const det = transform.a * transform.d - transform.b * transform.c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const invDet = 1 / det;
  const a = transform.d * invDet;
  const b = -transform.b * invDet;
  const c = -transform.c * invDet;
  const d = transform.a * invDet;
  const tx = -(a * transform.tx + c * transform.ty);
  const ty = -(b * transform.tx + d * transform.ty);
  if (![a, b, c, d, tx, ty].every(Number.isFinite)) return null;
  return { a, b, c, d, tx, ty };
}

export function applyInverseAffine(transform: AffineTransform, point: Point): Point | null {
  const inverse = invertAffine(transform);
  if (!inverse) return null;
  return applyAffine(inverse, point);
}

export function pageStackBox(frame: InteractionFrame, pageIndex: number): Rect | null {
  return frame.pageGeometry.find((p) => p.index === pageIndex)?.box ?? null;
}

export interface PageLocalPoint {
  readonly pageIndex: number;
  readonly local: Point;
}

export function contentToPageLocal(content: Point, frame: InteractionFrame): CoordinateOutcome<PageLocalPoint> {
  if (!isFinitePoint(content)) {
    return { ok: false, code: 'nonFinite', reason: 'content point is not finite' };
  }
  for (let i = frame.pageGeometry.length - 1; i >= 0; i -= 1) {
    const stacked = pageStackBox(frame, i);
    if (!stacked) continue;
    const nextTop = frame.scrollGeometry.pageTops[i + 1];
    const gapEnd = nextTop ?? stacked.y + stacked.height;
    if (content.x < stacked.x || content.x >= stacked.x + stacked.width) continue;
    if (content.y >= stacked.y && content.y < stacked.y + stacked.height) {
      return {
        ok: true,
        value: { pageIndex: i, local: { x: content.x - stacked.x, y: content.y - stacked.y } },
      };
    }
    if (content.y >= stacked.y + stacked.height && content.y < gapEnd) {
      return { ok: false, code: 'outOfBounds', reason: 'pointer is in an inter-page gap' };
    }
  }
  return { ok: false, code: 'outOfBounds', reason: 'content point is outside page geometry' };
}

export function pageLocalToContent(pageIndex: number, local: Point, frame: InteractionFrame): CoordinateOutcome<Point> {
  if (!isFinitePoint(local)) {
    return { ok: false, code: 'nonFinite', reason: 'page-local point is not finite' };
  }
  const stacked = pageStackBox(frame, pageIndex);
  if (!stacked) {
    return { ok: false, code: 'outOfBounds', reason: 'unknown page index' };
  }
  return { ok: true, value: { x: stacked.x + local.x, y: stacked.y + local.y } };
}

export function pointInRect(point: Point, rect: Rect): boolean {
  return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height;
}

export function intersectRects(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

function rectCorners(rect: Rect): Point[] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height },
  ];
}

function aabbFromPoints(points: readonly Point[]): Rect | null {
  if (points.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    if (!isFinitePoint(p)) return null;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function transformRectToAabb(transform: AffineTransform, rect: Rect): Rect | null {
  if (!isFiniteRect(rect)) return null;
  const corners = rectCorners(rect).map((corner) => applyAffine(transform, corner));
  return aabbFromPoints(corners);
}

export function stackedContentRect(
  frame: InteractionFrame,
  pageIndex: number,
  pageLocal: Rect,
  transform?: AffineTransform,
): Rect | null {
  const stacked = pageStackBox(frame, pageIndex);
  if (!stacked) return null;
  let local = pageLocal;
  if (transform) {
    const transformed = transformRectToAabb(transform, pageLocal);
    if (!transformed) return null;
    local = transformed;
  }
  if (!isFiniteRect(local)) return null;
  return { x: stacked.x + local.x, y: stacked.y + local.y, width: local.width, height: local.height };
}

export function clipStackedRect(frame: InteractionFrame, pageIndex: number, rect: Rect, clip?: Rect): Rect | null {
  if (!isFiniteRect(rect)) return null;
  if (!clip) return rect;
  const stackedClip = stackedContentRect(frame, pageIndex, clip);
  if (!stackedClip) return null;
  return intersectRects(rect, stackedClip);
}

export function validateFrameIdentity(
  frame: InteractionFrame,
  expectedId?: { readonly value: number },
): CoordinateOutcome<InteractionFrame> {
  if (expectedId && expectedId.value !== frame.id.value) {
    return { ok: false, code: 'staleFrame', reason: 'interaction frame identity mismatch' };
  }
  return { ok: true, value: frame };
}
