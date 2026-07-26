// Measured display clusters derived from layout-published caret edges (task 5.5).

import type { SemanticTextSpan, ShapedCluster } from '@docx-editor.dev/core-contract/interaction';
import type { Rect } from '@docx-editor.dev/core-contract/types';
import type { Page } from '@docx-editor.dev/engine-layout';
import { segmentGraphemes } from '@docx-editor.dev/engine-layout';
import { caretAffinity, twipsToPx } from './semantic-index.ts';

const px = twipsToPx;

interface ParagraphEdgeIndex {
  readonly xByOffset: Map<number, number>;
  readonly horizontal: Set<number>;
}

/**
 * Caret-edge index for EVERY paragraph, built in one pass over the pages.
 *
 * These two helpers each scanned every item on every page and were called once per
 * painted text item, so publishing a display list was O(items x items). Independent
 * review attributed 33.6% of a 6-second `createEditor()` to exactly these two
 * functions in a CPU profile, and measured the whole bridge at growth exponent 1.95
 * over four doublings.
 *
 * Keyed on the `pages` array identity: `layoutBody` returns a fresh array per
 * layout, so a new layout naturally gets a new index without explicit eviction, and
 * a WeakMap lets the old one be collected with its pages. One entry is enough
 * because `toDisplayPages` processes one layout at a time, but a WeakMap costs
 * nothing extra and is robust if that stops being true.
 */
const edgeIndexCache = new WeakMap<readonly Page[], Map<string, ParagraphEdgeIndex>>();

function edgeIndexFor(pages: readonly Page[], paragraphId: string): ParagraphEdgeIndex {
  let byParagraph = edgeIndexCache.get(pages);
  if (!byParagraph) {
    byParagraph = new Map();
    // ONE pass over every page, indexing all paragraphs at once.
    for (const page of pages) {
      for (const item of page.items) {
        if (item.type !== 'caretEdge') continue;
        let entry = byParagraph.get(item.paragraphId);
        if (!entry) {
          entry = { xByOffset: new Map<number, number>(), horizontal: new Set<number>() };
          byParagraph.set(item.paragraphId, entry);
        }
        const x = px(item.x);
        const prev = entry.xByOffset.get(item.graphemeOffset);
        if (prev === undefined || x < prev) entry.xByOffset.set(item.graphemeOffset, x);
        if (item.horizontalNavigable) entry.horizontal.add(item.graphemeOffset);
      }
    }
    edgeIndexCache.set(pages, byParagraph);
  }
  return byParagraph.get(paragraphId) ?? { xByOffset: new Map(), horizontal: new Set() };
}

/** Build grapheme clusters for one painted slice from layout caret edges only. */
export function clustersFromLayoutCaretEdges(
  pages: readonly Page[],
  paragraphId: string,
  semantic: SemanticTextSpan,
  itemBox: Rect,
  sliceText: string,
  paragraphGraphemeCount: number,
  direction: 'ltr' | 'rtl' = 'ltr'
): ShapedCluster[] {
  const { xByOffset, horizontal } = edgeIndexFor(pages, paragraphId);
  const segments = segmentGraphemes(sliceText);
  if (segments.length === 0) return [];

  const spanFrom = semantic.graphemeFrom;
  const spanTo = spanFrom + segments.length;
  const boundaries: number[] = [];
  for (let offset = spanFrom; offset <= spanTo; offset += 1) {
    if (horizontal.has(offset)) boundaries.push(offset);
  }
  if (boundaries.length < 2) return [];

  const clusters: ShapedCluster[] = [];
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const graphemeFrom = boundaries[i]!;
    const graphemeTo = boundaries[i + 1]!;
    if (graphemeTo <= graphemeFrom) continue;
    const left = xByOffset.get(graphemeFrom);
    const right = xByOffset.get(graphemeTo);
    if (left === undefined || right === undefined || right <= left) continue;
    const relFrom = graphemeFrom - spanFrom;
    const relTo = graphemeTo - spanFrom;
    const firstSeg = segments[relFrom];
    const lastSeg = segments[relTo - 1];
    if (!firstSeg || !lastSeg) continue;
    const clusterIndex = clusters.length;
    clusters.push({
      clusterIndex,
      graphemeFrom,
      graphemeTo,
      utf16From: semantic.utf16From + firstSeg.utf16From,
      utf16To: semantic.utf16From + lastSeg.utf16To,
      box: { x: left, y: itemBox.y, width: right - left, height: itemBox.height },
      logicalOrder: direction === 'rtl' ? boundaries.length - 2 - clusterIndex : clusterIndex,
      direction,
      affinity: caretAffinity(graphemeFrom, paragraphGraphemeCount),
    });
  }
  return clusters;
}
