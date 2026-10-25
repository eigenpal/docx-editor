// The picture saved in a chart's `mc:Fallback`, as a resource on the chart's drawing record.
//
// A chart record shows one branch: the drawn chart, its fallback, or a placeholder. An output
// that cannot use a drawn chart (Markdown) exports the saved picture instead, so the record
// carries that picture's resource whichever branch the page shows. It resolves through the
// same resource path and cache as the record's own picture, keyed by its relationship, so a
// record that shows the fallback resolves it once.

import type { DrawingProjection } from '../store/package/drawing-projection.ts';
import type { ImageResourceState } from '../store/package/image-resources.ts';

/** The projection that resolves a chart's fallback picture, or null without one. */
function fallbackPictureProjection(projection: DrawingProjection): DrawingProjection | null {
  const picture = projection.chartFallbackPicture;
  if (!picture) return null;
  return {
    ...projection,
    picture,
    vectorShape: null,
    groupPicture: null,
    groupPictureLayers: undefined,
    legacyGraphic: undefined,
    footprintOnly: undefined,
  };
}

/** The resource of a chart's fallback picture; undefined for a drawing without one. */
export function chartFallbackResource(
  projection: DrawingProjection,
  resourceOf: (projection: DrawingProjection) => ImageResourceState
): ImageResourceState | undefined {
  const fallback = fallbackPictureProjection(projection);
  return fallback ? resourceOf(fallback) : undefined;
}

/** The `chartFallbackResource` field of a drawing record; empty for a drawing without one. */
export function chartFallbackFields(resource: ImageResourceState | undefined): {
  readonly chartFallbackResource?: ImageResourceState;
} {
  return resource ? { chartFallbackResource: resource } : {};
}
