import type { PageGeometry } from './semantic-records.ts';

/** Declarative device grid for resolved page geometry. @internal */
export interface PageGeometryGridPolicy {
  /** Finite positive grid unit in points. */
  readonly unitPt: number;
  /** Snap to the nearest grid unit, with half-grid ties away from zero. */
  readonly rounding: 'nearest';
  /** Quantize the source content span before deriving the opposite page margin. */
  readonly contentExtent?: 'source-span-nearest';
}

/** Validate and freeze one page-geometry grid policy at a host boundary. @internal */
export function normalizePageGeometryGridPolicy(
  policy: PageGeometryGridPolicy | undefined
): PageGeometryGridPolicy | undefined {
  if (policy === undefined) return undefined;
  if (!Number.isFinite(policy.unitPt) || policy.unitPt <= 0) {
    throw new TypeError('pageGeometryPolicy.unitPt must be a finite positive number');
  }
  if (policy.rounding !== 'nearest') {
    throw new TypeError('pageGeometryPolicy.rounding must be "nearest"');
  }
  if (policy.contentExtent !== undefined && policy.contentExtent !== 'source-span-nearest') {
    throw new TypeError('pageGeometryPolicy.contentExtent must be "source-span-nearest"');
  }
  return Object.freeze({
    unitPt: policy.unitPt,
    rounding: policy.rounding,
    ...(policy.contentExtent ? { contentExtent: policy.contentExtent } : {}),
  });
}

function quantizeNearest(value: number, unitPt: number): number {
  const magnitude = Math.floor(Math.abs(value) / unitPt + 0.5) * unitPt;
  return Object.is(value, -0) || value < 0 ? -magnitude : magnitude;
}

/** Quantize one semantic geometry component before later arithmetic. @internal */
export function quantizePageGeometryComponent(
  value: number,
  policy: PageGeometryGridPolicy | undefined
): number {
  return policy ? quantizeNearest(value, policy.unitPt) : value;
}

/** Apply one validated policy to immutable resolved page geometry. @internal */
export function applyPageGeometryGridPolicy(
  geometry: PageGeometry,
  policy: PageGeometryGridPolicy | undefined
): PageGeometry {
  if (!policy) return geometry;
  const quantize = (value: number): number => quantizeNearest(value, policy.unitPt);
  const width = quantize(geometry.width);
  const height = quantize(geometry.height);
  const left = quantize(geometry.margin.left);
  const top = quantize(geometry.margin.top);
  const sourceContentWidth = geometry.width - geometry.margin.left - geometry.margin.right;
  const sourceContentHeight = geometry.height - geometry.margin.top - geometry.margin.bottom;
  const margin = Object.freeze({
    top,
    right:
      policy.contentExtent === 'source-span-nearest'
        ? width - left - quantize(sourceContentWidth)
        : quantize(geometry.margin.right),
    bottom:
      policy.contentExtent === 'source-span-nearest'
        ? height - top - quantize(sourceContentHeight)
        : quantize(geometry.margin.bottom),
    left,
  });
  if (width <= 0 || height <= 0 || width - margin.left - margin.right <= 0) {
    throw new RangeError('pageGeometryPolicy produced invalid horizontal page geometry');
  }
  if (height - margin.top - margin.bottom <= 0) {
    throw new RangeError('pageGeometryPolicy produced invalid vertical page geometry');
  }
  return Object.freeze({
    width,
    height,
    margin,
    ...(geometry.headerDistance === undefined
      ? {}
      : { headerDistance: quantize(geometry.headerDistance) }),
    ...(geometry.footerDistance === undefined
      ? {}
      : { footerDistance: quantize(geometry.footerDistance) }),
  });
}
