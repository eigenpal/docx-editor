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
