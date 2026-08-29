// Fragment geometry for note pagination: story-relative shifts, flow bottoms, and the
// body band a page must keep so its footnote references stay with their first fragment.

import { fragmentOwnsPosition, lineSegments } from './line-segments.ts';
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
 * Bottom (content-relative pt) of the body line on `page` that carries `ref` — the band
 * body text must KEEP for this reference when its footnote reserve is measured.
 *
 * Word's rule: a footnote STARTS on the page that references it. A reserve capped only by
 * the minimum body band (`MIN_FOOTNOTE_BODY_BAND_PT`) can exceed the room below the
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
 * note `i`'s room against reference `i`'s floor; references whose room reaches zero simply
 * carry forward, and the next pass finds them on the page body pushed them to.
 *
 * A ref inside a table floors at the TABLE fragment's bottom: nested line geometry is not
 * in page-content coordinates, and keeping the whole block band is the conservative reading
 * of the same rule. A ref no fragment on this page owns floors at zero.
 */
export function noteReferenceFloorPt(
  page: PageRecord,
  ref: { readonly paragraphId: string; readonly atomOffset: number }
): number {
  let floor = 0;
  for (const block of page.fragments) {
    if (block.kind === 'paragraph') {
      if (!fragmentOwnsPosition(block, ref.paragraphId, ref.atomOffset)) continue;
      floor = Math.max(floor, referenceLineBottom(block, ref) ?? block.box.y + block.box.height);
      continue;
    }
    if (tableOwnsAnyRef(block, [ref])) {
      floor = Math.max(floor, block.box.y + block.box.height);
    }
  }
  return Math.min(Math.max(0, floor), page.contentBox.height);
}

/** The owning line's bottom inside a fragment already known to own the ref, or null. */
function referenceLineBottom(
  fragment: ParagraphFragmentRecord,
  ref: { readonly paragraphId: string; readonly atomOffset: number }
): number | null {
  for (const line of fragment.lines) {
    for (const segment of lineSegments(line)) {
      if (segment.paragraphId !== ref.paragraphId) continue;
      if (ref.atomOffset < segment.start || ref.atomOffset >= segment.end) continue;
      return line.box.y + line.box.height;
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
