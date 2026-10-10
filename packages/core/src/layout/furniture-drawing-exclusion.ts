import { indexInlineDrawingProjectionsInPart } from '../store/package/drawing-projection.ts';
import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import {
  DrawingExclusionConvergenceError,
  exclusionZoneFromAnchoredDrawing,
  localizeExclusionZones,
  type ExclusionZone,
} from './drawing-exclusion.ts';
import { furnitureTableZones, storyHasFloatingTable } from './furniture-table-exclusion.ts';
import { headerFooterAnchoredDrawingOrigin } from './header-footer-drawing-origin.ts';
import type { PageFurniture } from './page-furniture-insets.ts';
import { TablePaginationError } from './semantic-table-layout.ts';
import type { AnchoredDrawingRecord } from './drawing-layout.ts';
import type { HeaderFooterStoryRecord, PageRecord } from './semantic-records.ts';

const projectionsByPart = new WeakMap<
  OoxmlPart,
  ReturnType<typeof indexInlineDrawingProjectionsInPart>
>();

// Keep this check aligned with `exclusionZoneFromAnchoredDrawing`.
const wraps = (drawing: AnchoredDrawingRecord): boolean =>
  !['inline', 'behind', 'inFront'].includes(drawing.wrap);

function anyFurnitureDrawing(
  furniture: PageFurniture | undefined,
  test: (drawing: AnchoredDrawingRecord) => boolean
): boolean {
  if (!furniture) return false;
  for (const stories of [furniture.headers, furniture.footers])
    for (const story of stories.values()) if (story.anchoredDrawings?.some(test)) return true;
  return false;
}

/**
 * Whether any header or footer variant wraps body text, with a drawing or a floating table;
 * `omitHidden` skips hidden drawing records.
 */
export function hasFurnitureDrawingExclusions(
  furniture: PageFurniture | undefined,
  omitHidden = false
): boolean {
  if (!furniture) return false;
  for (const stories of [furniture.headers, furniture.footers])
    for (const story of stories.values()) if (storyHasFloatingTable(story)) return true;
  return anyFurnitureDrawing(
    furniture,
    (drawing) => wraps(drawing) && !(omitHidden && drawing.accessibility.hidden)
  );
}

const hiddenWrap = (drawing: AnchoredDrawingRecord): boolean =>
  drawing.accessibility.hidden && wraps(drawing);

/**
 * Whether a hidden record (the wrap footprint of a payload that cannot paint) wraps body text
 * in any header or footer variant of the section, or on the host sheet it continues on.
 *
 * A hidden payload must never make a document refuse to lay out. When a flow with such a
 * record refuses, the block layout lays it out once more without hidden furniture zones.
 */
export function furnitureHasHiddenWrap(
  furniture: PageFurniture | undefined,
  host: ContinuedPageFurniture | undefined
): boolean {
  if (anyFurnitureDrawing(furniture, hiddenWrap)) return true;
  const stories: readonly (HeaderFooterStoryRecord | undefined)[] = [host?.header, host?.footer];
  return stories.some((story) => story?.anchoredDrawings?.some(hiddenWrap) ?? false);
}

/**
 * Whether a refused flow lays out once more without hidden header and footer zones.
 *
 * Only a layout refusal (wrap exclusion, table pagination) of the outermost call, not yet
 * yielding, with a hidden wrapping record in its furniture. Visible zones stay in the retry,
 * so a refusal they cause repeats and propagates; any other error propagates at once.
 */
export function refusalYieldsHiddenFurniture(
  error: unknown,
  options: {
    readonly drawingExclusionPass?: number;
    readonly drawingExclusionConverged?: boolean;
    readonly yieldHiddenFurnitureZones?: boolean;
    readonly furniture?: PageFurniture;
    readonly continuedPageFurniture?: ContinuedPageFurniture;
  }
): boolean {
  if (
    options.drawingExclusionPass !== undefined ||
    options.drawingExclusionConverged ||
    options.yieldHiddenFurnitureZones ||
    !furnitureHasHiddenWrap(options.furniture, options.continuedPageFurniture)
  )
    return false;
  // Host callbacks can throw proxies whose prototype traps also throw. Preserve the
  // original failure instead of replacing it with an error from retry classification.
  try {
    return (
      error instanceof DrawingExclusionConvergenceError || error instanceof TablePaginationError
    );
  } catch {
    return false;
  }
}

/** Wrapping furniture affects body flow without changing the header/footer story's own height. */
export function furnitureDrawingExclusionsForPage(
  page: Pick<PageRecord, 'header' | 'footer' | 'box' | 'contentBox'>,
  /** Leave out hidden records: the bounded retry of {@link refusalYieldsHiddenFurniture}. */
  omitHidden = false
): readonly ExclusionZone[] {
  const added: ExclusionZone[] = [];
  for (const story of [page.header, page.footer]) {
    if (!story?.part) continue;
    // A floating table in the story wraps body text as a floating body table does.
    added.push(...furnitureTableZones(story, page.contentBox));
    if (!story.anchoredDrawings?.length) continue;
    let projections = projectionsByPart.get(story.part);
    if (!projections) {
      projections = indexInlineDrawingProjectionsInPart(story.part);
      projectionsByPart.set(story.part, projections);
    }
    for (const drawing of story.anchoredDrawings) {
      if (omitHidden && drawing.accessibility.hidden) continue;
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
          furnitureSource: Object.freeze({
            partName: story.partName,
            kind: 'drawing' as const,
            nodeId: drawing.drawingNodeId,
          }),
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
  contentWidth: number,
  omitHidden = false
): readonly ExclusionZone[] {
  return furnitureDrawingExclusionsForPage(
    {
      header: host.header,
      footer: host.footer,
      box: host.box,
      contentBox: {
        x: host.box.x + contentLeft,
        y: host.box.y + insets.top,
        width: contentWidth,
        height: insets.height,
      },
    },
    omitHidden
  );
}
