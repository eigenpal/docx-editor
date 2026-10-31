// Body fit above a footnote area: a paragraph's space after must fit there too.
import { fragmentCursorBottomPt } from './note-fragment-geometry.ts';
import type { BlockFragmentRecord, LineRecord, PageRecord } from './semantic-records.ts';
import type { KeepNextLine, KeepNoteClosing } from './pagination-keeps.ts';

type SpannedLine = Pick<LineRecord, 'spans'>;

function citesFootnote(line: SpannedLine): boolean {
  return line.spans.some(
    (span) => span.noteNav?.direction === 'to-note' && span.noteNav.scopeId.startsWith('footnote:')
  );
}

/**
 * Whether the page being filled has a footnote area: a footnote reference is already on
 * it, or is on the paragraph line being placed.
 *
 * At the bottom of a plain page a paragraph's space after may cross the text margin. Above
 * a footnote area it must fit, so the body pass charges the closing line with it. A note
 * reserve alone does not prove an area: an eviction hold-out reserves room on a page
 * whose own text cites nothing.
 */
export function pageHoldsFootnoteReference(
  fragments: readonly BlockFragmentRecord[],
  pending: readonly SpannedLine[],
  line: SpannedLine
): boolean {
  if (citesFootnote(line) || pending.some(citesFootnote)) return true;
  return fragments.some(fragmentCitesFootnote);
}

/**
 * What a keep group priced before placement needs to charge closing space after as
 * {@link closingSpaceAfterPt} does: undefined without a note reserve, else whether the page
 * already cites a footnote and how to tell when a member's lines cite one.
 */
export function keepNoteClosing(
  reservePt: number | undefined,
  fragments: readonly BlockFragmentRecord[]
): KeepNoteClosing | undefined {
  if ((reservePt ?? 0) <= 0) return undefined;
  return { cited: fragments.some(fragmentCitesFootnote), cites: linesCiteFootnote };
}

const linesCiteFootnote = (lines: readonly KeepNextLine[]): boolean =>
  lines.some((line) => 'spans' in line && citesFootnote(line as SpannedLine));

/** Fragments are immutable records, so each is scanned once per pass however often asked. */
const fragmentCitations = new WeakMap<BlockFragmentRecord, boolean>();
function fragmentCitesFootnote(fragment: BlockFragmentRecord): boolean {
  let cites = fragmentCitations.get(fragment);
  if (cites === undefined) {
    cites = fragment.kind === 'paragraph' && fragment.lines.some(citesFootnote);
    fragmentCitations.set(fragment, cites);
  }
  return cites;
}

/**
 * The space after the body pass charges to a paragraph's closing line: the paragraph's
 * space after on a page that has a note reserve and cites a footnote, else 0.
 */
export function closingSpaceAfterPt(
  reservePt: number | undefined,
  fragments: readonly BlockFragmentRecord[],
  pending: readonly SpannedLine[],
  line: SpannedLine,
  spaceAfterPt: number
): number {
  if (spaceAfterPt <= 0 || (reservePt ?? 0) <= 0) return 0;
  return pageHoldsFootnoteReference(fragments, pending, line) ? spaceAfterPt : 0;
}

/**
 * The auto line spacing below a line's glyph band that the body pass leaves out of the
 * budget. At the bottom of a plain page it may cross the text margin. Above a footnote
 * area it must fit, the same as {@link closingSpaceAfterPt}, so none of it is dropped.
 */
export function droppableSpacingPt(
  reservePt: number | undefined,
  fragments: readonly BlockFragmentRecord[],
  pending: readonly SpannedLine[],
  line: SpannedLine & { readonly trailingSpacing: number }
): number {
  if (line.trailingSpacing <= 0 || (reservePt ?? 0) <= 0) return line.trailingSpacing;
  return pageHoldsFootnoteReference(fragments, pending, line) ? 0 : line.trailingSpacing;
}

/**
 * The space after that the body pass charges below the page's last line: the closing
 * paragraph's space after when the page cites a footnote, else 0. A reserve that holds
 * the body end in place must leave this room, or it pushes that paragraph out.
 */
export function chargedSpaceAfterPt(page: PageRecord): number {
  let last: BlockFragmentRecord | undefined;
  let lastBottom = -Infinity;
  for (const fragment of page.fragments) {
    const bottom = fragmentCursorBottomPt(fragment);
    if (bottom > lastBottom) {
      last = fragment;
      lastBottom = bottom;
    }
  }
  if (last?.kind !== 'paragraph' || !last.paragraphEnd) return 0;
  // No reserve check: this answer only matters while a hold-out sizes this page's reserve,
  // and a page it holds always has one.
  return pageCitesFootnote(page) ? last.spacing.after : 0;
}

/**
 * Whether a laid page cites a footnote, so its body must fit whole above the footnote
 * area: no spacing below a line's glyph band may cross into it.
 */
export function pageCitesFootnote(page: PageRecord): boolean {
  return page.fragments.some(fragmentCitesFootnote);
}
