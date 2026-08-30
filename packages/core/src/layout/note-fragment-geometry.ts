// Fragment geometry for note pagination: story-relative shifts, flow bottoms, and the
// body band a page must keep so its footnote references stay with their first fragment.

import { fragmentOwnsPosition, lineSegments, segmentOwnsAtomOffset } from './line-segments.ts';
import type {
  BlockFragmentRecord,
  PageRecord,
  ParagraphFragmentRecord,
} from './semantic-records.ts';

/** Translate one paragraph fragment (and every box inside it) by `dy`. */
export function shiftParagraphFragment(
  fragment: ParagraphFragmentRecord,
  dy: number
): ParagraphFragmentRecord {
  if (dy === 0) return fragment;
  return {
    ...fragment,
    box: { ...fragment.box, y: fragment.box.y + dy },
    ...(fragment.shadingBox
      ? { shadingBox: { ...fragment.shadingBox, y: fragment.shadingBox.y + dy } }
      : {}),
    ...(fragment.bottomBorder
      ? {
          bottomBorder: {
            ...fragment.bottomBorder,
            box: { ...fragment.bottomBorder.box, y: fragment.bottomBorder.box.y + dy },
          },
        }
      : {}),
    ...(fragment.borders
      ? {
          borders: fragment.borders.map((stroke) => ({
            ...stroke,
            box: { ...stroke.box, y: stroke.box.y + dy },
          })),
        }
      : {}),
    ...(fragment.marker
      ? {
          marker: {
            ...fragment.marker,
            box: { ...fragment.marker.box, y: fragment.marker.box.y + dy },
          },
        }
      : {}),
    lines: fragment.lines.map((line) => ({
      ...line,
      box: { ...line.box, y: line.box.y + dy },
      spans: line.spans.map((span) => ({
        ...span,
        box: { ...span.box, y: span.box.y + dy },
      })),
    })),
  };
}

/** Translate a block list by `dy` (paragraphs deep, other blocks by their outer box). */
export function shiftFragments(
  fragments: readonly BlockFragmentRecord[],
  dy: number
): BlockFragmentRecord[] {
  if (dy === 0) return [...fragments];
  return fragments.map((fragment) => {
    if (fragment.kind === 'paragraph') return shiftParagraphFragment(fragment, dy);
    return {
      ...fragment,
      box: { ...fragment.box, y: fragment.box.y + dy },
    };
  });
}

/** Bottom-most fragment edge of a story-relative block list. */
export function fragmentFlowBottom(fragments: readonly BlockFragmentRecord[]): number {
  let bottom = 0;
  for (const fragment of fragments) {
    bottom = Math.max(bottom, fragment.box.y + fragment.box.height);
  }
  return bottom;
}

/**
 * Body bottom (content-relative pt) the note passes BUDGET against.
 *
 * MINUS each paragraph's trailing after-spacing: the page-fit decision admits a paragraph
 * without charging its `w:spacing w:after` (it moves to the next page with the flow), but
 * the fragment BOX includes it — so a page whose last paragraph carries after-spacing
 * "uses" more height here than the fit rule budgeted, the reserve the reflow settles on
 * under-claims by that amount, and the attach pass splits a note the reserve fit whole.
 * Word lets the footnote area rise into that blank band the same way. PLACEMENT of an
 * area that hangs off the body keeps {@link fragmentFlowBottom} unless the room is needed.
 */
export function bodyFitBottomPt(page: PageRecord): number {
  let bottom = 0;
  for (const fragment of page.fragments) {
    bottom = Math.max(bottom, fragmentFitBottomPt(fragment));
  }
  return bottom;
}

/** One fragment's fit-rule bottom — its box minus a paragraph's trailing after-spacing. */
export function fragmentFitBottomPt(fragment: BlockFragmentRecord): number {
  const trailingAfter = fragment.kind === 'paragraph' ? fragment.spacing.after : 0;
  return fragment.box.y + fragment.box.height - trailingAfter;
}

/**
 * Top (content-relative pt) of the page's topmost body content, or 0 on an empty page.
 *
 * The MINIMUM over every fragment, not the first one's: document order is not y order
 * when a float exclusion zone displaces the first paragraph below a later block, and the
 * eviction guard that reads this must never conclude a page's true first line has content
 * above it.
 */
export function firstBodyContentTopPt(page: PageRecord): number {
  let top = Number.POSITIVE_INFINITY;
  for (const fragment of page.fragments) {
    const fragmentTop =
      fragment.kind === 'paragraph' ? (fragment.lines[0]?.box.y ?? fragment.box.y) : fragment.box.y;
    top = Math.min(top, fragmentTop);
  }
  return Number.isFinite(top) ? top : 0;
}

/**
 * The body band (content-relative pt) of the line on `page` that carries `ref`.
 *
 * `bottom` is the band body text must KEEP for this reference when its footnote reserve is
 * measured. Word's rule: a footnote STARTS on the page that references it. A reserve capped
 * only by the minimum body band (`MIN_FOOTNOTE_BODY_BAND_PT`) can exceed the room below the
 * referencing line, which evicts that line — and with it the reference — to the next page.
 * The next reserve pass then follows the reference forward, the reflow loop oscillates
 * between the two placements, and the fingerprint lock freezes whichever phase it happens
 * to be in: the referencing page ends with body only, and a later page keeps a reservation
 * nothing fills. Flooring the reserve at this line keeps the reference together with the
 * note's first fragment and gives the loop a fixed point.
 *
 * PER REFERENCE, never the page's lowest reference: notes accumulate top-down, and each
 * note may push body down to ITS OWN reference line. On a page carrying many references, a
 * single floor at the lowest one strangles every note above it to the sliver under that
 * line — and that state is a fixed point, so the reflow loop keeps it. The caller sizes
 * note `i`'s room against reference `i`'s floor; a reference whose note cannot even START
 * in that room moves forward instead: `top` is where the reserve must reach to evict the
 * reference's own line, so the next pass finds the reference — and lays its note whole —
 * on the page the shrunken body pushes it to.
 *
 * `evictable` is false when the line's geometry cannot support that move: a ref inside a
 * table (nested line geometry is not in page-content coordinates; the band is the TABLE
 * fragment's box, and evicting a whole table for one note is not the conservative reading),
 * and a ref no fragment on this page owns (band zero).
 */
export interface NoteReferenceLineBand {
  /** Top of the referencing line (content-relative pt); reserve past this evicts the line. */
  readonly top: number;
  /** Bottom of the referencing line — the floor a same-page reserve must not rise above. */
  readonly bottom: number;
  /** Top of the owning block's fragment — where the line lands when its block moves whole. */
  readonly blockTop: number;
  /** Whether the reserve may claim the line itself to move the reference forward. */
  readonly evictable: boolean;
}

/**
 * Memoized per fragments-array identity and ref object identity: the reserve pass asks for
 * the same page's bands as `bodyPage` and again as the previous page's hold-out neighbour,
 * every reflow round, and both the fragment arrays and the ref objects are identity-stable
 * across rounds.
 */
const referenceLineBandMemos = new WeakMap<
  readonly BlockFragmentRecord[],
  WeakMap<object, NoteReferenceLineBand>
>();

export function noteReferenceLineBandPt(
  page: PageRecord,
  ref: { readonly paragraphId: string; readonly atomOffset: number }
): NoteReferenceLineBand {
  let perPage = referenceLineBandMemos.get(page.fragments);
  if (!perPage) {
    perPage = new WeakMap();
    referenceLineBandMemos.set(page.fragments, perPage);
  }
  const cached = perPage.get(ref);
  if (cached) return cached;
  const band = computeReferenceLineBand(page, ref);
  perPage.set(ref, band);
  return band;
}

function computeReferenceLineBand(
  page: PageRecord,
  ref: { readonly paragraphId: string; readonly atomOffset: number }
): NoteReferenceLineBand {
  let top = 0;
  let bottom = 0;
  let blockTop = 0;
  let evictable = false;
  for (const block of page.fragments) {
    if (block.kind === 'paragraph') {
      if (!fragmentOwnsPosition(block, ref.paragraphId, ref.atomOffset)) continue;
      const line = referenceLineBand(block, ref);
      const lineTop = line?.top ?? block.box.y;
      const lineBottom = line?.bottom ?? block.box.y + block.box.height;
      if (lineBottom > bottom) {
        top = lineTop;
        bottom = lineBottom;
        blockTop = block.box.y;
        // Only a located LINE may be evicted; an ownership match without a line segment
        // (merged/projected offsets) falls back to the fragment band and stays put.
        evictable = line !== null;
      }
      continue;
    }
    if (tableOwnsAnyRef(block, [ref])) {
      const blockBottom = block.box.y + block.box.height;
      if (blockBottom > bottom) {
        top = block.box.y;
        bottom = blockBottom;
        evictable = false;
      }
    }
  }
  const clamp = (value: number): number => Math.min(Math.max(0, value), page.contentBox.height);
  const clampedTop = clamp(top);
  const clampedBottom = clamp(bottom);
  return {
    top: clampedTop,
    bottom: clampedBottom,
    blockTop: clamp(blockTop),
    // A band the clamp collapsed (a line at or below the content bottom — overflow the
    // body pass tolerated) must not evict: the eviction reserve computed from its top
    // would be zero, and the reference's note would be neither placed nor carried.
    evictable: evictable && clampedBottom > clampedTop,
  };
}

/** The owning line's band inside a fragment already known to own the ref, or null. */
function referenceLineBand(
  fragment: ParagraphFragmentRecord,
  ref: { readonly paragraphId: string; readonly atomOffset: number }
): { readonly top: number; readonly bottom: number } | null {
  for (const line of fragment.lines) {
    for (const segment of lineSegments(line)) {
      if (!segmentOwnsAtomOffset(segment, ref.paragraphId, ref.atomOffset)) continue;
      return { top: line.box.y, bottom: line.box.y + line.box.height };
    }
  }
  return null;
}

function tableOwnsAnyRef(
  table: Extract<BlockFragmentRecord, { kind: 'table' }>,
  refs: readonly { readonly paragraphId: string; readonly atomOffset: number }[]
): boolean {
  const visit = (blocks: readonly BlockFragmentRecord[]): boolean => {
    for (const block of blocks) {
      if (block.kind === 'paragraph') {
        for (const ref of refs) {
          if (fragmentOwnsPosition(block, ref.paragraphId, ref.atomOffset)) return true;
        }
        continue;
      }
      for (const row of block.rows) {
        if (row.isHeaderRepeat) continue;
        for (const cell of row.cells) {
          if (visit(cell.blocks)) return true;
        }
      }
    }
    return false;
  };
  for (const row of table.rows) {
    if (row.isHeaderRepeat) continue;
    for (const cell of row.cells) {
      if (visit(cell.blocks)) return true;
    }
  }
  return false;
}

/** Remove note-pass output before recomputing it from canonical references. */
export function bodyOnlyPage(page: PageRecord): PageRecord {
  // IDENTITY WHEN THERE IS NOTHING TO STRIP. The rest-destructure allocates a new object
  // every time, and a page record is what the painter reuses BY IDENTITY — so a document
  // with a notes part and no notes at all handed the painter a whole new set of pages on
  // every pass, and every visible page's DOM was rebuilt on every keystroke. The lane runs
  // for any package that HAS a footnotes or endnotes part, which is nearly every Word file.
  // Its three siblings — `withPageFieldSources`, `attachContentControlBoundaries` and
  // `reprojectBodyNoteMarks` — all return the original page when nothing moved.
  if (
    page.footnotes === undefined &&
    page.endnotes === undefined &&
    page.noteStream === undefined
  ) {
    return page;
  }
  const { footnotes, endnotes, noteStream, ...body } = page;
  void footnotes;
  void endnotes;
  void noteStream;
  return body;
}
