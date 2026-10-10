// Where a review card sits beside the page.
//
// One index per layout, covering every story a card can be anchored in: the body, the
// headers and footers, and the notes. Split out of the editor facade because it is pure over
// a published layout — it reads records and returns geometry, and nothing about it needs the
// editor's state.
//
// The recurring subtlety is that a fragment answers for more than the paragraph it is named
// after. A resolved display mode publishes a merged run as ONE fragment under the survivor's
// identity, so a card anchored in an absorbed member has no fragment of its own. Registering
// only `fragment.paragraphId` left those cards with no geometry, and the rail drops a card it
// cannot place.

import {
  paragraphFragmentsOf,
  paragraphFragmentsOfBlocks,
  reviewAnchorIndex,
  type ReviewParagraphAnchor,
  type SemanticLayout,
} from '@docx-editor.dev/core/layout';
import { fragmentParagraphs } from '../layout/line-segments.ts';

/**
 * Paragraph anchors for every story on a layout, memoized on the layout OBJECT.
 *
 * A published layout is immutable, so the index is valid for exactly as long as that object
 * is the current one, and a new revision brings a new one.
 */
const bodyFragmentsOf = (page: SemanticLayout['pages'][number]) => paragraphFragmentsOf(page);

export function createAnchorIndex(): (
  layout: SemanticLayout
) => Map<string, ReviewParagraphAnchor> {
  const cache = new WeakMap<SemanticLayout, Map<string, ReviewParagraphAnchor>>();
  return (layout) => {
    const cached = cache.get(layout);
    if (cached) return cached;
    // The projection is passed as a STABLE reference, not an inline arrow: the index caches
    // each page's anchors under the projection that produced them, and a fresh closure per
    // call would miss that cache on every commit.
    const index = reviewAnchorIndex(layout, bodyFragmentsOf);
    for (const page of layout.pages) {
      // Header/footer stories join the same index so their cards get real geometry. A story's
      // box is sheet-absolute like a page's content box, and its fragments are story-relative
      // like body fragments are content-relative — the same two-space sum
      // `reviewItemGeometry` performs. FIRST page wins, matching the body rule: a shared part
      // painted on every page anchors its card where the reader first meets it.
      for (const story of [page.header, page.footer]) {
        if (!story) continue;
        register(index, story.fragments, page.index, story.box.y);
      }
      // Note stories, on the same terms. Without these a note card came back with
      // `anchorY: null` and `pageIndex: null`: the rail sorts a null page last, so a
      // footnote change on page 2 of a long document rendered below the final page's cards,
      // with no leader line to the text it belongs to.
      for (const area of [page.footnotes, page.endnotes]) {
        if (!area) continue;
        for (const note of area.notes) register(index, note.fragments, page.index, note.box.y);
      }
    }
    cache.set(layout, index);
    return index;
  };
}

function register(
  index: Map<string, ReviewParagraphAnchor>,
  fragments: Parameters<typeof paragraphFragmentsOfBlocks>[0],
  pageIndex: number,
  contentY: number
): void {
  for (const fragment of paragraphFragmentsOfBlocks(fragments)) {
    for (const paragraphId of fragmentParagraphs(fragment)) {
      if (index.has(paragraphId)) continue;
      index.set(paragraphId, {
        pageIndex,
        contentY,
        fragmentY: fragment.box.y,
        ...(fragment.lines ? { lines: fragment.lines } : {}),
      });
    }
  }
}
