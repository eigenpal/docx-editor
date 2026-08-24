// Queries over the laid-out record graph (layout lane).
//
// Split out of semantic-records.ts, which is at its line cap. That module DECLARES the
// record shapes; this one only reads them — the depth-first fragment walks every consumer
// flattens per read, the line lookups caret navigation runs, and the content-control
// collapses. Re-exported from semantic-records.ts so importers keep one entry point.

import type {
  AnchoredDrawingRecord,
  BlockFragmentRecord,
  ContentControlBoundaryRecord,
  ContentControlLock,
  LayoutBox,
  LineRecord,
  PageRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
} from './semantic-records.ts';

/**
 * Depth-first paragraph fragments of one page, in reading order.
 *
 * Table interiors flatten through rows and cells; header-repeat rows are skipped unless
 * asked for, so interaction sees each caret stop exactly once while paint sees everything.
 */
export function paragraphFragmentsOf(
  page: PageRecord,
  includeHeaderRepeats = false
): ParagraphFragmentRecord[] {
  return paragraphFragmentsOfBlocks(page.fragments, includeHeaderRepeats);
}

/**
 * Depth-first paragraph fragments of one block list, in reading order.
 *
 * The same walk as {@link paragraphFragmentsOf} for fragment lists that do not sit on the
 * page directly — a header/footer story's fragments, a note story's.
 */
/**
 * Memoized per fragments array and variant: page fragment arrays are identity-stable
 * across incremental passes while every consumer (hit testing, selection, notes) flattens
 * them per read, which made the flatten itself a per-keystroke cost on long documents.
 */
const paragraphFragmentsMemos = new WeakMap<
  readonly BlockFragmentRecord[],
  { withRepeats?: ParagraphFragmentRecord[]; withoutRepeats?: ParagraphFragmentRecord[] }
>();

export function paragraphFragmentsOfBlocks(
  blocks: readonly BlockFragmentRecord[],
  includeHeaderRepeats = false
): ParagraphFragmentRecord[] {
  let memo = paragraphFragmentsMemos.get(blocks);
  const slot = includeHeaderRepeats ? 'withRepeats' : 'withoutRepeats';
  const cached = memo?.[slot];
  if (cached) return cached;
  const found: ParagraphFragmentRecord[] = [];
  const visitBlocks = (list: readonly BlockFragmentRecord[]): void => {
    for (const block of list) {
      if (block.kind === 'paragraph') {
        found.push(block);
        continue;
      }
      for (const row of block.rows) {
        if (row.isHeaderRepeat && !includeHeaderRepeats) continue;
        for (const cell of row.cells) visitBlocks(cell.blocks);
      }
    }
  };
  visitBlocks(blocks);
  if (!memo) {
    memo = {};
    paragraphFragmentsMemos.set(blocks, memo);
  }
  memo[slot] = found;
  return found;
}

/** Every line in a layout, in reading order — the order caret navigation walks. */
export function linesOf(layout: SemanticLayout): LineRecord[] {
  const lines: LineRecord[] = [];
  for (const page of layout.pages) {
    for (const fragment of paragraphFragmentsOf(page)) lines.push(...fragment.lines);
  }
  return lines;
}

/** Anchored drawings on one body page (page-content coordinates). */
export function anchoredDrawingsOf(page: PageRecord): readonly AnchoredDrawingRecord[] {
  return page.anchoredDrawings ?? [];
}

/** Every fragment belonging to one paragraph, in order, across page boundaries. */
export function fragmentsOfParagraph(
  layout: SemanticLayout,
  paragraphId: string
): ParagraphFragmentRecord[] {
  const fragments: ParagraphFragmentRecord[] = [];
  for (const page of layout.pages) {
    for (const fragment of paragraphFragmentsOf(page)) {
      if (fragment.paragraphId === paragraphId) fragments.push(fragment);
    }
  }
  return fragments.sort((a, b) => a.fragmentIndex - b.fragmentIndex);
}

/** The line containing a model position, or null when the position is not laid out. */
export function lineAtPosition(
  layout: SemanticLayout,
  paragraphId: string,
  offset: number,
  /** Lines to test, when the caller already knows which ones can carry the paragraph. */
  candidates?: Iterable<LineRecord>
): LineRecord | null {
  for (const line of candidates ?? linesOf(layout)) {
    // The part of the line this paragraph OWNS. A resolved display mode lays merged
    // paragraphs out on shared lines, and the half the line is not named after would
    // otherwise never match — its spans are there, its name is not.
    let start = line.range.paragraphId === paragraphId ? line.range.start : Number.NaN;
    let end = line.range.paragraphId === paragraphId ? line.range.end : Number.NaN;
    for (const span of line.spans) {
      if (span.range.paragraphId !== paragraphId) continue;
      start = Number.isNaN(start) ? span.range.start : Math.min(start, span.range.start);
      end = Number.isNaN(end) ? span.range.end : Math.max(end, span.range.end);
    }
    // An inline drawing is an ATOM with an offset of its own and no span to speak for it, so
    // a half that opens with a picture began at the picture, one offset before its first
    // character. Without this the caret there resolved to no line, and the image it was
    // sitting on could not be selected.
    for (const drawing of line.drawings ?? []) {
      if (drawing.paragraphId !== paragraphId) continue;
      start = Number.isNaN(start) ? drawing.start : Math.min(start, drawing.start);
      end = Number.isNaN(end) ? drawing.start + 1 : Math.max(end, drawing.start + 1);
    }
    if (Number.isNaN(start)) continue;
    // End-inclusive on the last line of a paragraph, so a caret at the very end resolves.
    if (offset >= start && offset <= end) return line;
  }
  return null;
}

/** Every content-control boundary on a layout, preferring the layout-level list. */
export function contentControlsOfLayout(
  layout: SemanticLayout
): readonly ContentControlBoundaryRecord[] {
  return layout.contentControls ?? [];
}

/**
 * Axis-aligned union of boxes, or null when the list is empty.
 *
 * Used when a control's content spans several fragments or spans on one page.
 */
export function unionLayoutBoxes(boxes: readonly LayoutBox[]): LayoutBox | null {
  if (boxes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Collapse raw + ancestor locks into one `ST_Lock` vocabulary value. */
export function effectiveContentControlLock(
  locks: readonly ContentControlLock[]
): ContentControlLock {
  let content = false;
  let removal = false;
  for (const lock of locks) {
    if (lock === 'contentLocked' || lock === 'sdtContentLocked') content = true;
    if (lock === 'sdtLocked' || lock === 'sdtContentLocked') removal = true;
  }
  if (content && removal) return 'sdtContentLocked';
  if (content) return 'contentLocked';
  if (removal) return 'sdtLocked';
  return 'unlocked';
}
