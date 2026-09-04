// Paragraph order across the laid-out document.
//
// Ordering paragraphs is not a tree walk here: what a reader means by "before" is where the
// text SITS, and the layout is the only thing that knows that. It is taken from the LINES for
// the same reason — a resolved display mode can lay several paragraphs out as one fragment,
// and a paragraph missing from this order compares as before every other one, which would put
// a selection anchored in it at the top of the document.

import { lineSegments } from './line-segments.ts';
import { paragraphFragmentsOf, paragraphFragmentsOfBlocks } from './semantic-records.ts';
import type {
  BlockFragmentRecord,
  PageRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
} from './semantic-records.ts';

// Memoized PER LAYOUT, which is sound because a published layout is immutable: a new revision
// is a new object. Without this every selection walk recomputed the order — and `lineOverlap`
// runs once per line, so `spansInSelection` on a large document recomputed a full-document
// scan thousands of times per keystroke. The toolbar reading formatting on every commit is
// what turned that into seconds.
const documentOrderCache = new WeakMap<SemanticLayout, string[]>();
const documentOrderIndexCache = new WeakMap<SemanticLayout, Map<string, number>>();
const everyStoryOrderCache = new WeakMap<SemanticLayout, string[]>();

/**
 * Paragraph ids on ONE page, in order, remembered on the page record.
 *
 * Incremental layout hands an untouched page back as the same object, so a keystroke only
 * ever walks the lines of the page it landed on. The whole-document walk this replaces ran
 * on every commit — the order is rebuilt each revision because the layout object is new —
 * and at several hundred pages that walk cost more than the edit itself.
 */
const pageOrderCache = new WeakMap<PageRecord, readonly string[]>();

function* takeFragmentOrder(
  fragments: readonly ParagraphFragmentRecord[],
  seen: Set<string>
): Generator<string> {
  for (const fragment of fragments) {
    // From the LINES, not the fragment. A merged fragment is named after one paragraph and
    // carries several, and a paragraph missing from this order compares as before every
    // other one — which would put a selection anchored in it at the top of the document.
    for (const line of fragment.lines) {
      for (const segment of lineSegments(line)) {
        if (seen.has(segment.paragraphId)) continue;
        seen.add(segment.paragraphId);
        yield segment.paragraphId;
      }
    }
    // A paragraph with no lines still has a position; without this it compares as before
    // every other one, which puts a selection anchored in it at the top of its story.
    if (fragment.lines.length === 0 && !seen.has(fragment.paragraphId)) {
      seen.add(fragment.paragraphId);
      yield fragment.paragraphId;
    }
  }
}

/**
 * Same unique-id order as {@link takeFragmentOrder}, plus a `null` for every extra scanned
 * line or segment. Cooperative order preparation counts those scans; the unique-id walk
 * used by selection does not pay a yield per duplicate line.
 */
function* scanFragmentOrder(
  fragments: readonly ParagraphFragmentRecord[],
  seen: Set<string>
): Generator<string | null> {
  for (const fragment of fragments) {
    for (const line of fragment.lines) {
      const segments = lineSegments(line);
      if (segments.length === 0) {
        yield null;
        continue;
      }
      for (const segment of segments) {
        if (seen.has(segment.paragraphId)) {
          yield null;
          continue;
        }
        seen.add(segment.paragraphId);
        yield segment.paragraphId;
      }
    }
    if (fragment.lines.length === 0) {
      if (seen.has(fragment.paragraphId)) {
        yield null;
        continue;
      }
      seen.add(fragment.paragraphId);
      yield fragment.paragraphId;
    }
  }
}

function* iteratePageBodyOrder(page: PageRecord): Generator<string> {
  const cached = pageOrderCache.get(page);
  if (cached) {
    for (const paragraphId of cached) yield paragraphId;
    return;
  }
  const seen = new Set<string>();
  const order: string[] = [];
  for (const paragraphId of takeFragmentOrder(paragraphFragmentsOf(page), seen)) {
    order.push(paragraphId);
    yield paragraphId;
  }
  pageOrderCache.set(page, order);
}

function pageOrder(page: PageRecord): readonly string[] {
  const cached = pageOrderCache.get(page);
  if (cached) return cached;
  for (const _ of iteratePageBodyOrder(page)) {
    /* Populate the page memo one id at a time. */
  }
  return pageOrderCache.get(page) ?? [];
}

/** Paragraph ids in document order, deduplicated across fragments. */
export function documentOrder(layout: SemanticLayout): string[] {
  const cached = documentOrderCache.get(layout);
  if (cached) return cached;
  const seen = new Set<string>();
  const order: string[] = [];
  for (const page of layout.pages) {
    for (const paragraphId of pageOrder(page)) {
      // Deduplicated ACROSS pages as well as within one: a paragraph split by a page break
      // is ordered where it starts.
      if (seen.has(paragraphId)) continue;
      seen.add(paragraphId);
      order.push(paragraphId);
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

/**
 * Yield each paragraph id in {@link everyStoryOrder} without allocating the complete array.
 *
 * This walk does not fill the layout-level array cache; {@link everyStoryOrder} still
 * materializes that snapshot. Duplicate lines are skipped without yielding; cooperative
 * order preparation uses {@link iterateEveryStoryOrderScans} instead.
 * @internal
 */
export function* iterateEveryStoryOrder(layout: SemanticLayout): Generator<string> {
  const cached = everyStoryOrderCache.get(layout);
  if (cached) {
    for (const paragraphId of cached) yield paragraphId;
    return;
  }
  const seen = new Set<string>();
  const take = function* (blocks: readonly BlockFragmentRecord[]): Generator<string> {
    yield* takeFragmentOrder(paragraphFragmentsOfBlocks(blocks), seen);
  };
  for (const page of layout.pages) {
    // The body first, through the same page-level memo the body-only order uses.
    for (const paragraphId of iteratePageBodyOrder(page)) {
      if (seen.has(paragraphId)) continue;
      seen.add(paragraphId);
      yield paragraphId;
    }
    for (const story of [page.header, page.footer]) {
      if (story) yield* take(story.fragments);
    }
    for (const area of [page.footnotes, page.endnotes]) {
      if (!area) continue;
      if (area.separator) yield* take(area.separator.fragments);
      for (const note of area.notes) yield* take(note.fragments);
    }
  }
}

/**
 * Yield unique paragraph ids in {@link everyStoryOrder}, and `null` for every extra
 * scanned line or segment so a cooperative consumer can pause during duplicate work.
 *
 * A warm layout-level cache yields those unique ids and performs no line or segment
 * scan. Repeated-line scan cost exists only on a cold cache.
 *
 * This walk does not fill the layout-level array cache.
 * @internal
 */
export function* iterateEveryStoryOrderScans(layout: SemanticLayout): Generator<string | null> {
  const cached = everyStoryOrderCache.get(layout);
  if (cached) {
    // A warm cache has no line or segment scan. Work is one yield per unique id.
    // iterateSemanticParagraphOrder already checkpoints those yielded ids.
    for (const paragraphId of cached) yield paragraphId;
    return;
  }
  const seen = new Set<string>();
  const take = function* (blocks: readonly BlockFragmentRecord[]): Generator<string | null> {
    yield* scanFragmentOrder(paragraphFragmentsOfBlocks(blocks), seen);
  };
  for (const page of layout.pages) {
    yield* scanFragmentOrder(paragraphFragmentsOf(page), seen);
    for (const story of [page.header, page.footer]) {
      if (story) yield* take(story.fragments);
    }
    for (const area of [page.footnotes, page.endnotes]) {
      if (!area) continue;
      if (area.separator) yield* take(area.separator.fragments);
      for (const note of area.notes) yield* take(note.fragments);
    }
  }
}

/**
 * Paragraph ids of EVERY story the layout paints, in the order they sit on the page.
 *
 * Body, then each page's header and footer, then its note areas — per page, so a story's own
 * paragraphs stay adjacent and in reading order. That is all any caller needs: a selection
 * cannot span two stories (the engine refuses one), so only the order WITHIN a story is ever
 * compared, and this gets that right for all of them at once.
 *
 * What a caller passes when it has no story in hand — `selectionRects` and
 * `spansInSelection` both REQUIRE an order rather than defaulting to one, deliberately.
 * {@link documentOrder} is the body alone, and
 * using it as a default is what let selection reads silently answer about the wrong story —
 * two paragraphs selected in a header both ranked -1, the walk gave up, and the run properties
 * came back short. A caller that DOES know its story should still pass that story's order:
 * it is smaller, and it cannot match a paragraph the caret is not among.
 */
export function everyStoryOrder(layout: SemanticLayout): string[] {
  const cached = everyStoryOrderCache.get(layout);
  if (cached) return cached;
  const order: string[] = [];
  for (const paragraphId of iterateEveryStoryOrder(layout)) order.push(paragraphId);
  everyStoryOrderCache.set(layout, order);
  return order;
}
