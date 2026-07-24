// Measured display clusters derived from layout-published caret edges (task 5.5).

import type { SemanticTextSpan, ShapedCluster } from '@docx-editor.dev/core-contract/interaction';
import type { Rect } from '@docx-editor.dev/core-contract/types';
import type { Page } from '@docx-editor.dev/engine-layout';
import { segmentGraphemes } from '@docx-editor.dev/engine-layout';
import { caretAffinity, twipsToPx } from './semantic-index.ts';

const px = twipsToPx;

function caretXByGraphemeOffset(pages: readonly Page[], paragraphId: string): Map<number, number> {
  const map = new Map<number, number>();
  for (const page of pages) {
    for (const item of page.items) {
      if (item.type !== 'caretEdge' || item.paragraphId !== paragraphId) continue;
      const x = px(item.x);
      const prev = map.get(item.graphemeOffset);
      if (prev === undefined || x < prev) map.set(item.graphemeOffset, x);
    }
  }
  return map;
}

function horizontalNavigableOffsets(pages: readonly Page[], paragraphId: string): Set<number> {
  const out = new Set<number>();
  for (const page of pages) {
    for (const item of page.items) {
      if (item.type !== 'caretEdge' || item.paragraphId !== paragraphId) continue;
      if (item.horizontalNavigable) out.add(item.graphemeOffset);
    }
  }
  return out;
}

/** Build grapheme clusters for one painted slice from layout caret edges only. */
export function clustersFromLayoutCaretEdges(
  pages: readonly Page[],
  paragraphId: string,
  semantic: SemanticTextSpan,
  itemBox: Rect,
  sliceText: string,
  paragraphGraphemeCount: number,
  direction: 'ltr' | 'rtl' = 'ltr',
): ShapedCluster[] {
  const xByOffset = caretXByGraphemeOffset(pages, paragraphId);
  const horizontal = horizontalNavigableOffsets(pages, paragraphId);
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
