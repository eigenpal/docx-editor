// Paragraph order across the laid-out document.
//
// Ordering paragraphs is not a tree walk here: what a reader means by "before" is where the
// text SITS, and the layout is the only thing that knows that. It is taken from the LINES for
// the same reason — a resolved display mode can lay several paragraphs out as one fragment,
// and a paragraph missing from this order compares as before every other one, which would put
// a selection anchored in it at the top of the document.

import { lineSegments } from './line-segments.ts';
import { paragraphFragmentsOf } from './semantic-records.ts';
import type { SemanticLayout } from './semantic-records.ts';

// Memoized PER LAYOUT, which is sound because a published layout is immutable: a new revision
// is a new object. Without this every selection walk recomputed the order — and `lineOverlap`
// runs once per line, so `spansInSelection` on a large document recomputed a full-document
// scan thousands of times per keystroke. The toolbar reading formatting on every commit is
// what turned that into seconds.
const documentOrderCache = new WeakMap<SemanticLayout, string[]>();
const documentOrderIndexCache = new WeakMap<SemanticLayout, Map<string, number>>();

/** Paragraph ids in document order, deduplicated across fragments. */
export function documentOrder(layout: SemanticLayout): string[] {
  const cached = documentOrderCache.get(layout);
  if (cached) return cached;
  const seen = new Set<string>();
  const order: string[] = [];
  for (const page of layout.pages) {
    for (const fragment of paragraphFragmentsOf(page)) {
      // From the LINES, not the fragment. A merged fragment is named after one paragraph and
      // carries several, and a paragraph missing from this order compares as before every
      // other one — which would put a selection anchored in it at the top of the document.
      for (const line of fragment.lines) {
        for (const segment of lineSegments(line)) {
          if (seen.has(segment.paragraphId)) continue;
          seen.add(segment.paragraphId);
          order.push(segment.paragraphId);
        }
      }
      if (fragment.lines.length === 0 && !seen.has(fragment.paragraphId)) {
        seen.add(fragment.paragraphId);
        order.push(fragment.paragraphId);
      }
    }
  }
  documentOrderCache.set(layout, order);
  return order;
}

/** Document-order position by paragraph id, for O(1) ordering checks. */
export function documentOrderIndex(layout: SemanticLayout): Map<string, number> {
  const cached = documentOrderIndexCache.get(layout);
  if (cached) return cached;
  const index = new Map<string, number>();
  for (const [position, id] of documentOrder(layout).entries()) index.set(id, position);
  documentOrderIndexCache.set(layout, index);
  return index;
}
