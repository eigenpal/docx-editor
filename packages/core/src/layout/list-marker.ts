// Publish a list-marker record from a resolved list item + measured first line.

import type { ResolvedTabStops } from './paragraph-tabs.ts';
import type { TextMeasurer } from './semantic-records.ts';
import type { ListMarkerRecord } from './semantic-records.ts';
import { firstLineShift, listMarkerBox, type ResolvedListItem } from './list-resolve.ts';

/** Use a left-to-right local axis for list slot and suffix calculations. */
function directionalItem(item: ResolvedListItem, rtl: boolean): ResolvedListItem {
  if (!rtl) return item;
  return {
    ...item,
    indent: { ...item.indent, left: item.indent.right, right: item.indent.left },
    markerAlign:
      item.markerAlign === 'left' ? 'right' : item.markerAlign === 'right' ? 'left' : 'center',
  };
}

export function directionalListFirstLineShift(
  item: ResolvedListItem | undefined,
  indent: {
    readonly left: number;
    readonly right: number;
    readonly hanging: number;
    readonly firstLine: number;
  },
  measurer: TextMeasurer,
  tabStops: ResolvedTabStops,
  available: number,
  rtl: boolean
): number {
  return firstLineShift(
    item ? directionalItem(item, rtl) : item,
    rtl && item ? { ...indent, left: indent.right } : indent,
    measurer,
    tabStops,
    available
  );
}

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
  originX = 0,
  rtlExtent?: number
): ListMarkerRecord | undefined {
  if (!item || !item.markerText || !firstLine) return undefined;
  const width = measurer.measure(item.markerText, item.markerStyle);
  const box = listMarkerBox(
    directionalItem(item, rtlExtent !== undefined),
    width,
    firstLine.y,
    firstLine.height
  );
  if (!box) return undefined;
  return {
    text: item.markerText,
    style: item.markerStyle,
    box: {
      x: originX + (rtlExtent === undefined ? box.x : rtlExtent - box.x - box.width),
      y: box.y,
      width: box.width,
      height: box.height,
    },
    level: item.ilvl,
    numId: item.numId,
    numFmt: item.numFmt,
    ...(item.ordinal === undefined ? {} : { ordinal: item.ordinal }),
  };
}
