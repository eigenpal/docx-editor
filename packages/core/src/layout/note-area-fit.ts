// Body fit above a footnote area: a paragraph's space after must fit there too.
import { fragmentCursorBottomPt } from './note-fragment-geometry.ts';
import type { BlockFragmentRecord, LineRecord, PageRecord } from './semantic-records.ts';

function citesFootnote(line: LineRecord): boolean {
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
  pending: readonly LineRecord[],
  line: LineRecord
): boolean {
  if (citesFootnote(line) || pending.some(citesFootnote)) return true;
  return fragments.some(
    (fragment) => fragment.kind === 'paragraph' && fragment.lines.some(citesFootnote)
  );
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
  const cites = page.fragments.some(
    (fragment) => fragment.kind === 'paragraph' && fragment.lines.some(citesFootnote)
  );
  return cites ? last.spacing.after : 0;
}
