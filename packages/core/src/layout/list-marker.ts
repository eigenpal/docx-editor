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
 * What a list marker contributes to its paragraph's FIRST line, as flow options.
 *
 * The marker is furniture the paragraph flow never sees, yet Word sets it on the first
 * line's baseline like any other run, so it sizes that line:
 *
 * - A picture bullet sits ON the baseline, so it imposes a baseline floor — the same floor
 *   an inline image imposes. The extent is AUTHORED, so this is known before the bytes
 *   resolve and a settling image never re-breaks a line.
 * - A glyph marker reserves its own face's ASCENT above that baseline, so a level
 *   `w:rFonts`/`w:sz` with a taller face pushes the whole line down. It does NOT deepen the
 *   line below the baseline: a captured control sets a 12pt list in a 12pt face whose
 *   descent is 2.27pt and markers in two faces that descend further (2.53pt and 3.60pt),
 *   and both of those lines keep the plain line's height to within the reference's paint
 *   grid, while the one marker face with a taller ascent grows its line by the excess.
 *
 * The face is the RESOLVED one. When an unavailable symbol font was translated to its
 * Unicode equivalent, the line is sized by whatever face actually draws the replacement —
 * measurement and paint never disagree about which face the marker is in.
 *
 * `w:vanish` markers are not measured, so they contribute nothing (§17.3.2.41).
 */
export function listMarkerFirstLineMetrics(
  item: ResolvedListItem | undefined,
  measurer: TextMeasurer
): {
  readonly firstLineMinimumBaseline?: number;
  readonly firstLineMarkerAscent?: number;
} {
  if (!item) return {};
  // A picture bullet REPLACES `w:lvlText`, so the glyph metrics never apply beside it.
  if (item.picBullet) return { firstLineMinimumBaseline: item.picBullet.height };
  if (item.markerText.length === 0 || item.markerStyle.hidden) return {};
  const { baseline } = measurer.lineMetrics(item.markerStyle, item.markerText);
  return baseline > 0 ? { firstLineMarkerAscent: baseline } : {};
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
    readonly firstLineMarkerAscent?: number;
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
    firstLineFloorOf: (entry) => listMarkerFirstLineMetrics(itemOf(entry), measurer),
  };
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
