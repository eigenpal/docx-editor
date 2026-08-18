// Where a selection paints.
//
// Rectangles, not positions: the interaction lane answers "which position is this point", and
// this answers "which pixels does this range cover". They meet at `segmentOverlap`, which is
// the one part of both that has to know a line can carry more than one paragraph.

import { lineSegments, segmentOverlap } from './line-segments.ts';
import { xWithinLine } from './line-geometry.ts';
import { paragraphFragmentsOf } from './semantic-records.ts';
import type { SemanticLayout, TextMeasurer } from './semantic-records.ts';
import { orderPositions } from './semantic-interaction.ts';
import type { SemanticPosition, SemanticSelection, SelectionRect } from './semantic-interaction.ts';

/** The rectangles covering a selection, one per line it spans. */
export function selectionRects(
  layout: SemanticLayout,
  selection: SemanticSelection
): SelectionRect[] {
  const ordered = orderPositions(layout, selection);
  if (!ordered) return [];
  const rects: SelectionRect[] = [];
  for (const page of layout.pages) {
    for (const fragment of paragraphFragmentsOf(page)) {
      for (const line of fragment.lines) {
        for (const segment of lineSegments(line)) {
          const overlap = segmentOverlap(layout, segment, ordered.from, ordered.to);
          if (!overlap) continue;
          const startX = xWithinLine(line, overlap.start, undefined, segment);
          const endX = xWithinLine(line, overlap.end, undefined, segment);
          rects.push({
            pageIndex: page.index,
            x: Math.min(startX, endX),
            y: line.box.y,
            width: Math.abs(endX - startX),
            height: line.box.height,
          });
        }
      }
    }
  }
  return rects;
}

/** A model range to highlight, and the key the caller knows it by. */
export interface KeyedRange {
  readonly key: string;
  readonly from: SemanticPosition;
  readonly to: SemanticPosition;
}

/**
 * Rectangles for MANY ranges in ONE pass over the lines.
 *
 * Not `selectionRects` in a loop. That walks every page, fragment and line per range, and a
 * contract with two hundred comments would re-walk the whole document two hundred times on
 * every layout — the highlight would cost more than the layout it decorates. One pass tests
 * each line against every range instead, which is the same work a single selection does.
 */
export function keyedRangeRects(
  layout: SemanticLayout,
  ranges: readonly KeyedRange[],
  /**
   * Pages to measure, or every page when absent.
   *
   * A band that is not on screen is not painted, so measuring it is pure cost — and it is
   * cost paid per keystroke, because an edit republishes the layout. Bounding this to the
   * materialized pages is what keeps typing in a heavily reviewed document as fast as
   * typing in a clean one.
   */
  pages?: ReadonlySet<number>
): Map<string, SelectionRect[]> {
  const found = new Map<string, SelectionRect[]>();
  if (ranges.length === 0) return found;
  for (const page of layout.pages) {
    if (pages && !pages.has(page.index)) continue;
    for (const fragment of paragraphFragmentsOf(page)) {
      for (const line of fragment.lines) {
        for (const segment of lineSegments(line))
          for (const range of ranges) {
            const overlap = segmentOverlap(layout, segment, range.from, range.to);
            if (!overlap) continue;
            const startX = xWithinLine(line, overlap.start, undefined, segment);
            const endX = xWithinLine(line, overlap.end, undefined, segment);
            const rects = found.get(range.key) ?? [];
            rects.push({
              pageIndex: page.index,
              x: Math.min(startX, endX),
              y: line.box.y,
              width: Math.abs(endX - startX),
              height: line.box.height,
            });
            found.set(range.key, rects);
          }
      }
    }
  }
  return found;
}
