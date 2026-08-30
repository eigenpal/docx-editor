// Publish a list-marker record from a resolved list item + measured first line.

import type { TextMeasurer } from './semantic-records.ts';
import type { ListMarkerRecord } from './semantic-records.ts';
import { listMarkerBox, type ResolvedListItem } from './list-resolve.ts';

/**
 * Build a marker record for the first fragment of a list paragraph.
 *
 * `originX` shifts cell-relative markers into page/content space (0 for body).
 * Returns undefined when the marker is empty, vanished, or has no geometry.
 */
export function publishListMarker(
  item: ResolvedListItem | undefined,
  measurer: TextMeasurer,
  firstLine: { y: number; height: number } | undefined,
  originX = 0
): ListMarkerRecord | undefined {
  if (!item || !item.markerText || !firstLine) return undefined;
  const width = measurer.measure(item.markerText, item.markerStyle);
  const box = listMarkerBox(item, width, firstLine.y, firstLine.height);
  if (!box) return undefined;
  return {
    text: item.markerText,
    style: item.markerStyle,
    box: { x: box.x + originX, y: box.y, width: box.width, height: box.height },
    level: item.ilvl,
    numId: item.numId,
    numFmt: item.numFmt,
    ...(item.ordinal === undefined ? {} : { ordinal: item.ordinal }),
  };
}
