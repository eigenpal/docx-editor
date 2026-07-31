// Header/footer story layout (phase 2 of the legacy-lane retirement).
//
// A header or footer is a STORY laid out once per variant at the section's content width,
// with no pagination: its height is whatever its blocks flow to. That flow height — never
// an anchored-object extent — is what sizes the box on every page (the #856 rule), and the
// shared record is attached per page by the body pass, which also pushes the content area
// down or up when the furniture is taller than the margin.

import type { OoxmlPart } from '@docx-editor.dev/core-contract/store';
import type { ParagraphLayoutCache } from './layout-cache.ts';
import type { PendingLine } from './paragraph-flow.ts';
import { flowBlocksInBox } from './semantic-table-layout.ts';
import type { BlockFragmentRecord, TextMeasurer } from './semantic-records.ts';
import { storyBlocks } from './story-roots.ts';

export interface HeaderFooterStoryLayout {
  readonly partName: string;
  /** Story-relative fragments; origin at the story box's top-left. */
  readonly fragments: readonly BlockFragmentRecord[];
  /** The height the blocks actually flow to — what sizes the box on every page. */
  readonly flowHeight: number;
}

/**
 * Lay one header/footer part out at `contentWidth`.
 *
 * Line ids are namespaced by part so the body's `line-N` counter — which incremental
 * convergence compares — never moves because a header changed.
 */
export function layoutHeaderFooterStory(
  part: OoxmlPart,
  contentWidth: number,
  measurer: TextMeasurer,
  producer: string,
  cache?: ParagraphLayoutCache<readonly PendingLine[]>
): HeaderFooterStoryLayout {
  const blocks = storyBlocks(part);
  let lineCounter = 0;
  const flow = flowBlocksInBox(blocks, 0, Math.max(1, contentWidth), 0, 0, {
    measurer,
    cache,
    producer,
    nextLineId: () => `hf-${part.name}-line-${lineCounter++}`,
  });
  return { partName: part.name, fragments: flow.blocks, flowHeight: flow.bottom };
}
