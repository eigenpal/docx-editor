// Header/footer story layout (phase 2 of the legacy-lane retirement).
//
// A header or footer is a STORY laid out at the section's content width with no pagination:
// its height is whatever its blocks flow to. That flow height — never an anchored-object
// extent — is what sizes the box on every page (the #856 rule).
//
// Baseline stories (no page context) are laid out once per variant for furniture height /
// content-area push-down. Allowlisted PAGE/NUMPAGES fields need per-page (or per distinct
// field-value) projection because digit widths affect right-tab alignment; callers obtain
// those via {@link HeaderFooterStoryLayout.withPageContext}, which caches by context key.

import type { OoxmlPart } from '@docx-editor.dev/core-contract/store';
import {
  fieldPageContextToken,
  type FieldPageContext,
} from './field-projection.ts';
import type { ParagraphLayoutCache } from './layout-cache.ts';
import type { PendingLine } from './paragraph-flow.ts';
import { flowBlocksInBox } from './semantic-table-layout.ts';
import type {
  BlockFragmentRecord,
  HeaderFooterStoryRecord,
  LayoutBox,
  PageRecord,
  TextMeasurer,
} from './semantic-records.ts';
import type { StyleCascadeTable } from './style-cascade.ts';
import { storyBlocks } from './story-roots.ts';

export interface HeaderFooterStoryLayout {
  readonly partName: string;
  /** Story-relative fragments; origin at the story box's top-left. */
  readonly fragments: readonly BlockFragmentRecord[];
  /** The height the blocks actually flow to — what sizes the box on every page. */
  readonly flowHeight: number;
  /**
   * Re-layout this story under a page-field context.
   *
   * Cached by distinct `(pageNumber, pageCount)` so pages that share field values reuse
   * geometry. Returns `this` when `ctx` is absent-equivalent to the baseline layout.
   */
  readonly withPageContext: (ctx: FieldPageContext) => HeaderFooterStoryLayout;
}

/**
 * Lay one header/footer part out at `contentWidth`.
 *
 * Line ids are namespaced by part so the body's `line-N` counter — which incremental
 * convergence compares — never moves because a header changed.
 *
 * When `pageContext` is set, allowlisted PAGE/NUMPAGES instructions project live values;
 * otherwise those fields contribute only cached result text (often empty).
 */
export function layoutHeaderFooterStory(
  part: OoxmlPart,
  contentWidth: number,
  measurer: TextMeasurer,
  producer: string,
  cache?: ParagraphLayoutCache<readonly PendingLine[]>,
  styleCascade?: StyleCascadeTable,
  pageContext?: FieldPageContext
): HeaderFooterStoryLayout {
  const contextCache = new Map<string, HeaderFooterStoryLayout>();

  const layoutOnce = (ctx: FieldPageContext | undefined): HeaderFooterStoryLayout => {
    const token = fieldPageContextToken(ctx);
    const cached = contextCache.get(token);
    if (cached) return cached;

    const blocks = storyBlocks(part);
    let lineCounter = 0;
    const flow = flowBlocksInBox(blocks, 0, Math.max(1, contentWidth), 0, 0, {
      measurer,
      cache,
      producer: producer + token,
      nextLineId: () => `hf-${part.name}-line-${lineCounter++}`,
      styleCascade,
      pageContext: ctx,
    });

    const story: HeaderFooterStoryLayout = {
      partName: part.name,
      fragments: flow.blocks,
      flowHeight: flow.bottom,
      withPageContext: (next) => layoutOnce(next),
    };
    contextCache.set(token, story);
    return story;
  };

  return layoutOnce(pageContext);
}

/**
 * Remap a section-local page onto the document sheet stack.
 *
 * Each section lays out with its own origin; the orchestrator assigns global indices and
 * cumulative Y so sheets of different heights still stack without gaps or overlaps.
 *
 * Furniture boxes must move with the sheet. The attach-time `pageFieldProjector` closes over
 * the section-local page box, so a bare shift of the current story box is not enough —
 * document-level PAGE/NUMPAGES finalize would re-place at the pre-stack origin and paint
 * would compute `(story.box.y - page.box.y)` as a negative full-page offset onto the prior
 * sheet. Wrap the projector so projected furniture receives the same `dy`.
 */
export function remapPage(page: PageRecord, globalIndex: number, sheetY: number): PageRecord {
  const dy = sheetY - page.box.y;
  const shiftBox = (box: LayoutBox): LayoutBox => ({ ...box, y: box.y + dy });
  const shiftFurniture = (
    story: HeaderFooterStoryRecord | undefined
  ): HeaderFooterStoryRecord | undefined => {
    if (!story) return undefined;
    const shifted: HeaderFooterStoryRecord = { ...story, box: shiftBox(story.box) };
    if (!story.pageFieldProjector) return shifted;
    const project = story.pageFieldProjector;
    return {
      ...shifted,
      pageFieldProjector: (context) => {
        const projected = project(context);
        return { ...projected, box: shiftBox(projected.box) };
      },
    };
  };
  const header = shiftFurniture(page.header);
  const footer = shiftFurniture(page.footer);
  return {
    ...page,
    id: `page-${globalIndex}`,
    index: globalIndex,
    box: shiftBox(page.box),
    contentBox: shiftBox(page.contentBox),
    ...(header ? { header } : {}),
    ...(footer ? { footer } : {}),
  };
}
