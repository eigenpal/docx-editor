import { indexInlineDrawingProjectionsInPart } from '../store/package/drawing-projection.ts';
import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import {
  exclusionZoneFromAnchoredDrawing,
  localizeExclusionZones,
  type ExclusionZone,
} from './drawing-exclusion.ts';
import { headerFooterAnchoredDrawingOrigin } from './header-footer-drawing-origin.ts';
import type { PageFurniture } from './page-furniture-insets.ts';
import type { PageRecord } from './semantic-records.ts';

const projectionsByPart = new WeakMap<
  OoxmlPart,
  ReturnType<typeof indexInlineDrawingProjectionsInPart>
>();

export function hasFurnitureDrawingExclusions(furniture: PageFurniture | undefined): boolean {
  if (!furniture) return false;
  for (const stories of [furniture.headers, furniture.footers])
    for (const story of stories.values())
      if (
        story.anchoredDrawings?.some(
          (d) => !d.behindDocument && !['inline', 'behind', 'inFront'].includes(d.wrap)
        )
      )
        return true;
  return false;
}

/** Wrapping furniture affects body flow without changing the header/footer story's own height. */
export function furnitureDrawingExclusionsForPage(
  page: Pick<PageRecord, 'header' | 'footer' | 'box' | 'contentBox'>
): readonly ExclusionZone[] {
  const added: ExclusionZone[] = [];
  for (const story of [page.header, page.footer]) {
    if (!story?.part || !story.anchoredDrawings?.length) continue;
    let projections = projectionsByPart.get(story.part);
    if (!projections) {
      projections = indexInlineDrawingProjectionsInPart(story.part);
      projectionsByPart.set(story.part, projections);
    }
    for (const drawing of story.anchoredDrawings) {
      const projection = projections.get(drawing.drawingNodeId);
      if (!projection) continue;
      const zone = exclusionZoneFromAnchoredDrawing({
        drawing,
        projection,
        sourceOrder: -1,
        contentLeft: 0,
        contentRight: page.contentBox.width,
      });
      if (!zone) continue;
      const origin = headerFooterAnchoredDrawingOrigin(drawing, story.box, page.box);
      const [localized] = localizeExclusionZones(
        [zone],
        drawing.x - origin.x + page.contentBox.x,
        drawing.y - origin.y + page.contentBox.y,
        { left: 0, right: page.contentBox.width }
      );
      if (
        !localized ||
        localized.verticalBand.y >= page.contentBox.height ||
        localized.verticalBand.y + localized.verticalBand.height <= 0
      )
        continue;
      added.push(
        Object.freeze({
          ...localized,
          sourceKind: 'furniture',
          drawingNodeId: `${story.partName}:${drawing.drawingNodeId}`,
          anchorParagraphId: `${story.partName}:${drawing.anchorParagraphId}`,
        })
      );
    }
  }
  return Object.freeze(added);
}

/** The host sheet's header and footer records, for a section that continues on that sheet. */
export type ContinuedPageFurniture = Pick<PageRecord, 'header' | 'footer' | 'box'>;

/**
 * Wrap zones on the host sheet, relative to the content column of the section continuing on it.
 *
 * The host sheet keeps and paints its own header and footer, so a continued section's text on
 * that sheet wraps around THOSE drawings. The section's own furniture starts on its next sheet.
 * `contentLeft` and `contentWidth` are the continued section's column, which can differ from
 * the host's when the margins change.
 */
export function continuedPageFurnitureZones(
  host: ContinuedPageFurniture,
  insets: { readonly top: number; readonly height: number },
  contentLeft: number,
  contentWidth: number
): readonly ExclusionZone[] {
  return furnitureDrawingExclusionsForPage({
    header: host.header,
    footer: host.footer,
    box: host.box,
    contentBox: {
      x: host.box.x + contentLeft,
      y: host.box.y + insets.top,
      width: contentWidth,
      height: insets.height,
    },
  });
}
