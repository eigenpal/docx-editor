// Publish a list-marker record from a resolved list item + measured first line.

import type { ResolvedTabStops } from './paragraph-tabs.ts';
import type { TextMeasurer } from './semantic-records.ts';
import type { ImageResourceState } from '../store/package/image-resources.ts';
import type { LayoutBox, ListMarkerRecord } from './semantic-records.ts';
import type { ResolvedListItem } from './list-resolve.ts';
import type { OoxmlProperty } from '../store/store/tree-op-types.ts';
import { firstLineShift, listMarkerBox, listMarkerWidth } from './list-marker-geometry.ts';
import { paragraphIsRtl } from './rtl-paragraph.ts';

/**
 * What a picture-bullet marker needs from the package, resolved by the host.
 *
 * A function rather than a record on the item because the bytes settle asynchronously while
 * the AUTHORED extent — which is what decides the line's height — is known from the file.
 */
export type ListPictureBulletResolver = (
  relationshipId: string
) => { readonly ownerPartName: string; readonly resource: ImageResourceState } | null;

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
/**
 * The first-line baseline floor a picture-bullet marker imposes, as flow options.
 *
 * The marker is furniture the paragraph flow never sees, but its image still sits ON the
 * first line's baseline, so the line has to be at least that tall — the same floor an inline
 * image imposes. The extent is AUTHORED, so this is known before the bytes resolve and a
 * settling image never re-breaks a line.
 */
export function listMarkerBaselineFloor(item: ResolvedListItem | undefined): {
  readonly firstLineMinimumBaseline?: number;
} {
  return item?.picBullet ? { firstLineMinimumBaseline: item.picBullet.height } : {};
}

/** What the first-line metrics read off one prepared paragraph. */
export interface ListFirstLineEntry {
  readonly paragraph: { readonly id: string };
  readonly listItem?: ResolvedListItem;
  readonly indent: {
    readonly left: number;
    readonly right: number;
    readonly hanging: number;
    readonly firstLine: number;
  };
  readonly tabStops: ResolvedTabStops;
  readonly available: number;
  readonly props: readonly OoxmlProperty[];
}

/**
 * The two list-dependent first-line facts one story walk needs, over its current item map.
 *
 * Current-pass map first, so marker ordinals stay fresh when the memo reuses inputs; both
 * facts have to read the SAME item, which is why they are minted together.
 */
export function createListFirstLineMetrics(
  listItems: ReadonlyMap<string, ResolvedListItem> | undefined,
  measurer: TextMeasurer
): {
  readonly firstLineOffsetOf: (entry: ListFirstLineEntry) => number;
  readonly firstLineFloorOf: (entry: ListFirstLineEntry) => {
    readonly firstLineMinimumBaseline?: number;
  };
} {
  const itemOf = (entry: ListFirstLineEntry): ResolvedListItem | undefined =>
    listItems?.get(entry.paragraph.id) ?? entry.listItem;
  return {
    firstLineOffsetOf: (entry) =>
      directionalListFirstLineShift(
        itemOf(entry),
        entry.indent,
        measurer,
        entry.tabStops,
        entry.available,
        paragraphIsRtl(entry.props)
      ),
    firstLineFloorOf: (entry) => listMarkerBaselineFloor(itemOf(entry)),
  };
}

export function publishListMarker(
  item: ResolvedListItem | undefined,
  measurer: TextMeasurer,
  firstLine: { readonly box: LayoutBox; readonly baseline: number } | undefined,
  originX = 0,
  rtlExtent?: number,
  resolvePictureBullet?: ListPictureBulletResolver
): ListMarkerRecord | undefined {
  if (!item || !firstLine) return undefined;
  if (!item.markerText && !item.picBullet) return undefined;
  const width = listMarkerWidth(item, measurer);
  const box = listMarkerBox(
    directionalItem(item, rtlExtent !== undefined),
    width,
    firstLine.box.y,
    firstLine.box.height
  );
  if (!box) return undefined;
  const x = originX + (rtlExtent === undefined ? box.x : rtlExtent - box.x - box.width);
  // The image sits with its BOTTOM on the first line's baseline, which is where Word puts it
  // and why `firstLineMinimumBaseline` made the line tall enough for it.
  const picBullet = item.picBullet;
  const resolved =
    picBullet && resolvePictureBullet ? resolvePictureBullet(picBullet.relationshipId) : null;
  const picture =
    picBullet && resolved
      ? {
          picture: {
            ownerPartName: resolved.ownerPartName,
            relationshipId: picBullet.relationshipId,
            box: {
              x,
              y: firstLine.box.y + firstLine.baseline - picBullet.height,
              width: picBullet.width,
              height: picBullet.height,
            },
            resource: resolved.resource,
          },
        }
      : {};
  return {
    text: item.markerText,
    style: item.markerStyle,
    box: {
      x,
      y: box.y,
      width: box.width,
      height: box.height,
    },
    level: item.ilvl,
    numId: item.numId,
    numFmt: item.numFmt,
    ...(item.ordinal === undefined ? {} : { ordinal: item.ordinal }),
    ...picture,
  };
}
