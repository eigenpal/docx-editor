// Wrap zones a continued section inherits from the sheet it continues on.
//
// A `continuous` section break keeps the next section on the same sheet. The floating tables
// and wrapping pictures an earlier section placed there still occupy that sheet, so the new
// section's text flows beside them, and below them only where no room is left. The section
// does not restart below the lowest float: the earlier objects are obstacles on the shared
// sheet, the same as the header and footer drawings that sheet paints.
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import {
  collectExclusionZonesFromDrawings,
  localizeExclusionZones,
  type ExclusionZone,
} from './drawing-exclusion.ts';
import {
  continuedPageFurnitureZones,
  type ContinuedPageFurniture,
} from './furniture-drawing-exclusion.ts';
import type { PageRecord } from './semantic-records.ts';
import { addFloatingTableExclusions } from './table-float-exclusion.ts';

/** The host sheet a continued section lays its first page onto. */
export type ContinuedPageHost = ContinuedPageFurniture &
  Partial<Pick<PageRecord, 'contentBox' | 'fragments' | 'anchoredDrawings'>>;

/**
 * Wrap zones of the floating tables and wrapping pictures already on the host sheet.
 *
 * Returned in the continued section's own content coordinates. `contentLeft` and
 * `contentWidth` are that section's column, which can differ from the host's when the margins
 * change. Each zone is marked {@link ExclusionZone.earlierSection}: its anchor lies in an
 * earlier section, so it reaches every line and column of the continued section on this sheet.
 */
export function earlierSectionZones(
  host: ContinuedPageHost,
  contentLeft: number,
  contentWidth: number,
  drawingLayout: InlineDrawingLayoutContext | undefined
): readonly ExclusionZone[] {
  if (!host.contentBox || !host.fragments) return Object.freeze([]);
  const hostWidth = host.contentBox.width;
  const layout = Object.freeze({ columnCount: 1, columnGapPt: 0, contentWidth: hostWidth });
  const drawings =
    drawingLayout && host.anchoredDrawings?.length
      ? collectExclusionZonesFromDrawings(
          host.anchoredDrawings,
          drawingLayout,
          0,
          hostWidth,
          undefined,
          layout
        )
      : [];
  const zones =
    addFloatingTableExclusions(
      [{ fragments: host.fragments }],
      new Map([[0, drawings]]),
      layout
    ).get(0) ?? [];
  if (zones.length === 0) return Object.freeze([]);
  const hostLeft = host.contentBox.x - host.box.x;
  return Object.freeze(
    localizeExclusionZones(zones, contentLeft - hostLeft, 0, {
      left: 0,
      right: contentWidth,
    }).map((zone) => Object.freeze({ ...zone, earlierSection: true }))
  );
}

/**
 * Every wrap zone on a continued section's local page 0: the host sheet's header and footer
 * drawings, then the floats earlier sections placed on it.
 */
export function continuedPageZones(
  host: ContinuedPageHost,
  insets: { readonly top: number; readonly height: number },
  contentLeft: number,
  contentWidth: number,
  options: {
    readonly omitHiddenFurniture?: boolean;
    readonly drawingLayout?: InlineDrawingLayoutContext;
  }
): readonly ExclusionZone[] {
  const furniture = continuedPageFurnitureZones(
    host,
    insets,
    contentLeft,
    contentWidth,
    options.omitHiddenFurniture
  );
  const body = earlierSectionZones(host, contentLeft, contentWidth, options.drawingLayout);
  return body.length ? Object.freeze([...furniture, ...body]) : furniture;
}

/**
 * Whether page furniture wraps this pass's text (`furnitureHasWrap`), and whether it keeps the
 * pass's positioned tables in flow (`furnitureHoldsTables`). Floats an earlier section left on
 * the host sheet wrap text but do not keep this section's floating tables in flow.
 */
export function continuedWrapFlags(
  ownFurnitureWraps: boolean,
  continuedZones: readonly ExclusionZone[] | undefined
): { readonly furnitureHasWrap: boolean; readonly furnitureHoldsTables: boolean } {
  return {
    furnitureHasWrap: ownFurnitureWraps || (continuedZones?.length ?? 0) > 0,
    furnitureHoldsTables:
      ownFurnitureWraps || (continuedZones?.some((zone) => !zone.earlierSection) ?? false),
  };
}
