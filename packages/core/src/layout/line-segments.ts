// Which paragraph a line's offsets count in.
//
// Two lanes need this and neither may import the other: the interaction lane resolves a
// POSITION and the hit-test lane resolves a POINT, and they already meet through the records.

import type { InlineDrawingRecord } from './drawing-layout.ts';
import { documentOrderIndex } from './document-order.ts';
import { paragraphFragmentsOf, paragraphFragmentsOfBlocks } from './semantic-records.ts';
import type {
  LineRecord,
  PageRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
  StyleSpanRecord,
} from './semantic-records.ts';
import type { SemanticPosition } from './semantic-interaction.ts';

/**
 * The part of a line that belongs to ONE paragraph.
 *
 * A line normally belongs to one paragraph outright, and then this is the whole of it — the
 * same object every caller read before, so nothing about an ordinary document takes a new
 * path. A resolved display mode merges paragraphs that a tracked decision merges, and the line
 * carrying the join holds spans from two of them. Offsets there are ambiguous by themselves:
 * both paragraphs start at zero, so an offset means nothing without the paragraph it counts in.
 */
export interface LineSegment {
  readonly paragraphId: string;
  readonly start: number;
  readonly end: number;
  readonly spans: readonly StyleSpanRecord[];
  readonly drawings: readonly InlineDrawingRecord[];
}

/** Cached per line: a mixed line is rare, and asking costs a walk of every span. */
const lineSegmentsCache = new WeakMap<LineRecord, readonly LineSegment[]>();

/** Every paragraph a line carries, in visual order. One entry for an ordinary line. */
export function lineSegments(line: LineRecord): readonly LineSegment[] {
  const cached = lineSegmentsCache.get(line);
  if (cached) return cached;
  const whole: LineSegment = {
    paragraphId: line.range.paragraphId,
    start: line.range.start,
    end: line.range.end,
    spans: line.spans,
    drawings: line.drawings ?? [],
  };
  const mixed = line.spans.some((span) => span.range.paragraphId !== line.range.paragraphId);
  const segments = mixed ? splitLineByParagraph(line) : [whole];
  lineSegmentsCache.set(line, segments);
  return segments;
}

function splitLineByParagraph(line: LineRecord): readonly LineSegment[] {
  const segments: LineSegment[] = [];
  for (const span of line.spans) {
    const previous = segments[segments.length - 1];
    if (previous && previous.paragraphId === span.range.paragraphId) {
      segments[segments.length - 1] = {
        ...previous,
        start: Math.min(previous.start, span.range.start),
        end: Math.max(previous.end, span.range.end),
        spans: [...previous.spans, span],
      };
      continue;
    }
    segments.push({
      paragraphId: span.range.paragraphId,
      start: span.range.start,
      end: span.range.end,
      spans: [span],
      drawings: [],
    });
  }
  return segments.map((segment) => ({
    ...segment,
    drawings: (line.drawings ?? []).filter(
      (drawing) => drawing.paragraphId === segment.paragraphId
    ),
  }));
}

/** The segment a paragraph owns on this line, or null when it owns none of it. */
export function lineSegmentFor(line: LineRecord, paragraphId: string): LineSegment | null {
  return lineSegments(line).find((segment) => segment.paragraphId === paragraphId) ?? null;
}

/**
 * The part of ONE PARAGRAPH's share of `line` that a selection covers, in that paragraph's
 * offsets, or null when the selection does not reach it.
 *
 * Asked per segment rather than per line. A resolved display mode lays merged paragraphs out
 * on shared lines, and both members count from zero, so a line-wide answer highlighted the
 * wrong characters — or none, when the selection lay entirely in the member the line is not
 * named after.
 */
export function segmentOverlap(
  layout: SemanticLayout,
  segment: LineSegment,
  from: SemanticPosition,
  to: SemanticPosition
): { start: number; end: number } | null {
  const index = documentOrderIndex(layout);
  const lineParagraph = index.get(segment.paragraphId) ?? -1;
  const fromParagraph = index.get(from.paragraphId) ?? -1;
  const toParagraph = index.get(to.paragraphId) ?? -1;
  if (lineParagraph < fromParagraph || lineParagraph > toParagraph) return null;

  const start =
    lineParagraph === fromParagraph ? Math.max(segment.start, from.offset) : segment.start;
  const end = lineParagraph === toParagraph ? Math.min(segment.end, to.offset) : segment.end;
  return end > start ? { start, end } : null;
}

/**
 * The paragraphs drawn BEFORE this one inside the same paragraph box, nearest first.
 *
 * Empty for an ordinary paragraph. A resolved display mode lays a run of paragraphs out as
 * one, and the breaks between them are not breaks the reader can see — so a key that acts on
 * "the boundary before the caret" must know it is standing on one of them.
 */
export function mergedPredecessorsOf(
  layout: SemanticLayout,
  paragraphId: string
): readonly string[] {
  for (const page of layout.pages) {
    for (const fragment of paragraphFragmentsOf(page)) {
      const at = fragmentParagraphs(fragment).indexOf(paragraphId);
      if (at > 0) return fragmentParagraphs(fragment).slice(0, at).reverse();
    }
  }
  return [];
}

/** Cached per fragment: the answer is a walk of every line, and most callers ask repeatedly. */
const fragmentParagraphsCache = new WeakMap<ParagraphFragmentRecord, readonly string[]>();

/**
 * Every paragraph a fragment DRAWS, in visual order.
 *
 * `[fragment.paragraphId]` for an ordinary one, which is what it has always been. A resolved
 * display mode publishes a merged run as one fragment under the SURVIVOR's identity, so the
 * absorbed members have no fragment named after them. Anything keyed on `fragment.paragraphId`
 * alone reports those paragraphs as unlaid — no marker, no anchor, no note reference — while
 * the reader is looking straight at them.
 */
export function fragmentParagraphs(fragment: ParagraphFragmentRecord): readonly string[] {
  const cached = fragmentParagraphsCache.get(fragment);
  if (cached) return cached;
  // From the LINES, so the order is the order the reader meets them, and the fragment's own
  // name last if no line named it — an empty paragraph has no span to speak for it.
  const held: string[] = [];
  for (const line of fragment.lines ?? []) {
    for (const segment of lineSegments(line)) {
      if (!held.includes(segment.paragraphId)) held.push(segment.paragraphId);
    }
  }
  if (!held.includes(fragment.paragraphId)) held.push(fragment.paragraphId);
  fragmentParagraphsCache.set(fragment, held);
  return held;
}

/**
 * The extent of ONE paragraph inside a fragment, in that paragraph's own offsets.
 *
 * An ordinary fragment answers from its own `range`, unchanged and without touching a line —
 * the shape every caller has always read. Only a merged fragment pays for the walk.
 */
export function fragmentExtentOf(
  fragment: ParagraphFragmentRecord,
  paragraphId: string
): { readonly start: number; readonly end: number } | null {
  const held = fragmentParagraphs(fragment);
  if (held.length === 1) {
    return held[0] === paragraphId
      ? { start: fragment.range.start, end: fragment.range.end }
      : null;
  }
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const line of fragment.lines ?? []) {
    const segment = lineSegmentFor(line, paragraphId);
    if (!segment) continue;
    start = Math.min(start, segment.start);
    end = Math.max(end, segment.end);
  }
  return end >= start ? { start, end } : null;
}

/**
 * Whether a fragment draws `paragraphId` at `offset`.
 *
 * Half-open — `[start, end)` — so a boundary offset belongs to the later fragment, which is
 * the affinity every fragment-ownership question in the engine already uses.
 */
export function fragmentOwnsPosition(
  fragment: ParagraphFragmentRecord,
  paragraphId: string,
  offset: number
): boolean {
  const extent = fragmentExtentOf(fragment, paragraphId);
  return extent !== null && offset >= extent.start && offset < extent.end;
}

/**
 * The fragment that DRAWS a paragraph, wherever it is nested, or null.
 *
 * The fast path is the old lookup by name and returns on the first hit; the walk of the lines
 * runs only when no fragment claims the id, which is the merged case.
 */
export function fragmentHolding(
  layout: SemanticLayout,
  paragraphId: string
): ParagraphFragmentRecord | null {
  for (const page of layout.pages) {
    for (const fragment of paragraphFragmentsOnPage(page)) {
      if (fragment.paragraphId === paragraphId) return fragment;
    }
  }
  for (const page of layout.pages) {
    for (const fragment of paragraphFragmentsOnPage(page)) {
      if (fragmentParagraphs(fragment).includes(paragraphId)) return fragment;
    }
  }
  return null;
}

/**
 * Every paragraph fragment a page DRAWS, in any story.
 *
 * `page.fragments` is the body's alone. A header, a footer and each note hang their own
 * fragments off the page beside it, and a caret can be in any of them — so a walk that stops
 * at the body answers "this paragraph is not laid out" for a paragraph the user is looking at.
 * That is what made a `w:numPr` paragraph in a header read as "not a list", which in turn made
 * the list buttons unable to turn one off.
 */
function paragraphFragmentsOnPage(page: PageRecord): ParagraphFragmentRecord[] {
  const found = [...paragraphFragmentsOf(page)];
  for (const story of [page.header, page.footer]) {
    if (story) found.push(...paragraphFragmentsOfBlocks(story.fragments));
  }
  for (const area of [page.footnotes, page.endnotes]) {
    if (!area) continue;
    for (const note of area.notes) found.push(...paragraphFragmentsOfBlocks(note.fragments));
  }
  return found;
}
