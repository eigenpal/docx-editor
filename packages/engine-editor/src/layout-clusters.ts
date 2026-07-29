// Measured display clusters derived from layout-published caret edges (task 5.5).

import type { SemanticTextSpan, ShapedCluster } from '@docx-editor.dev/core-contract/contracts/interaction';
import type { Rect } from '@docx-editor.dev/core-contract/contracts/types';
import type { Page } from '@docx-editor.dev/engine-layout';
import { segmentGraphemes } from '@docx-editor.dev/engine-layout';
import { twipsToPx } from './semantic-index.ts';

const px = twipsToPx;

interface ParagraphEdgeIndex {
  readonly byOffset: Map<
    number,
    {
      readonly x: number;
      readonly lineId: string;
      readonly affinity: 'upstream' | 'downstream';
      readonly horizontal: boolean;
    }[]
  >;
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
          entry = { byOffset: new Map() };
          byParagraph.set(item.paragraphId, entry);
        }
        const x = px(item.x);
        const edges = entry.byOffset.get(item.graphemeOffset);
        const edge = {
          x,
          lineId: item.line.lineId,
          affinity: item.affinity,
          horizontal: item.horizontalNavigable,
        } as const;
        if (edges) edges.push(edge);
        else entry.byOffset.set(item.graphemeOffset, [edge]);
      }
    }
    edgeIndexCache.set(pages, byParagraph);
  }
  return byParagraph.get(paragraphId) ?? { byOffset: new Map() };
}

/** Build grapheme clusters for one painted slice from layout caret edges only. */
export function clustersFromLayoutCaretEdges(
  pages: readonly Page[],
  paragraphId: string,
  semantic: SemanticTextSpan,
  itemBox: Rect,
  sliceText: string,
  _paragraphGraphemeCount: number,
  lineId: string,
  direction: 'ltr' | 'rtl',
  bidiLevel: number
): ShapedCluster[] {
  const { byOffset } = edgeIndexFor(pages, paragraphId);
  const segments = segmentGraphemes(sliceText);
  if (segments.length === 0) return [];

  const spanFrom = semantic.graphemeFrom;
  const spanTo = spanFrom + segments.length;
  const boundaries: number[] = [];
  for (let offset = spanFrom; offset <= spanTo; offset += 1) {
    if (byOffset.get(offset)?.some((edge) => edge.horizontal && edge.lineId === lineId)) {
      boundaries.push(offset);
    }
  }
  if (boundaries.length < 2) return [];

  const clusters: ShapedCluster[] = [];
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const graphemeFrom = boundaries[i]!;
    const graphemeTo = boundaries[i + 1]!;
    if (graphemeTo <= graphemeFrom) continue;
    const edgeFor = (offset: number, logicalStart: boolean) => {
      const candidates = (byOffset.get(offset) ?? []).filter(
        (edge) =>
          edge.horizontal &&
          edge.lineId === lineId &&
          edge.x >= itemBox.x - 1e-9 &&
          edge.x <= itemBox.x + itemBox.width + 1e-9
      );
      if (candidates.length === 0) return undefined;
      const preferMaximum = direction === 'rtl' ? logicalStart : !logicalStart;
      return candidates.reduce((selected, edge) =>
        preferMaximum
          ? edge.x > selected.x
            ? edge
            : selected
          : edge.x < selected.x
            ? edge
            : selected
      );
    };
    const fromEdge = edgeFor(graphemeFrom, true);
    const toEdge = edgeFor(graphemeTo, false);
    if (!fromEdge || !toEdge || fromEdge.x === toEdge.x) continue;
    const left = Math.min(fromEdge.x, toEdge.x);
    const right = Math.max(fromEdge.x, toEdge.x);
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
      bidiLevel,
      affinity: fromEdge.affinity,
    });
  }
  return clusters;
}
