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
import { weakRefOf, type WeakRefOf } from '../store/package/weak-ref.ts';

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
  let last: {
    readonly pages: WeakRefOf<SemanticLayout['pages']>;
    readonly index: WeakRefOf<Map<string, ReviewParagraphAnchor>>;
  } | null = null;
  return (layout) => {
    const cached = cache.get(layout);
    if (cached) return cached;
    const carried = last && carriedIndex(last, layout);
    if (carried) {
      cache.set(layout, carried);
      last = { pages: weakRefOf(layout.pages), index: weakRefOf(carried) };
      return carried;
    }
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
    last = { pages: weakRefOf(layout.pages), index: weakRefOf(index) };
    return index;
  };
}

function sameKeys(a: ReadonlyMap<string, unknown>, b: ReadonlyMap<string, unknown>): boolean {
  if (a.size !== b.size) return false;
  for (const key of a.keys()) if (!b.has(key)) return false;
  return true;
}

/** One page's note anchors, registered as the full index registers them. */
function noteAnchorsOf(page: SemanticLayout['pages'][number]): Map<string, ReviewParagraphAnchor> {
  const anchors = new Map<string, ReviewParagraphAnchor>();
  for (const area of [page.footnotes, page.endnotes]) {
    if (!area) continue;
    for (const note of area.notes) register(anchors, note.fragments, page.index, note.box.y);
  }
  return anchors;
}

/** One page's body anchors, from the per-page cache the full index reads. */
const bodyAnchorsOf = (page: SemanticLayout['pages'][number]) =>
  reviewAnchorIndex({ pages: [page] }, bodyFragmentsOf);

/**
 * The previous index with each changed page's anchors swapped in, when nothing else can have
 * moved. A keystroke publishes a new layout whose pages are the previous objects but the one it
 * landed on, and the whole index was built again per keystroke. A changed page qualifies when
 * its header and footer are the same objects and its body and note areas anchor the same
 * paragraphs; an entry is replaced only where the previous index took it from that page, since
 * the first page wins.
 */
function carriedIndex(
  last: {
    readonly pages: WeakRefOf<SemanticLayout['pages']>;
    readonly index: WeakRefOf<Map<string, ReviewParagraphAnchor>>;
  },
  layout: SemanticLayout
): Map<string, ReviewParagraphAnchor> | null {
  const previous = last.pages.deref();
  const lastIndex = last.index.deref();
  if (!previous || !lastIndex || previous.length !== layout.pages.length) return null;
  let index: Map<string, ReviewParagraphAnchor> | null = null;
  for (const [position, page] of layout.pages.entries()) {
    const before = previous[position]!;
    if (page === before) continue;
    if (page.header !== before.header || page.footer !== before.footer) return null;
    const anchors = bodyAnchorsOf(page);
    const was = bodyAnchorsOf(before);
    if (!sameKeys(anchors, was)) return null;
    // A pass lays the page's note areas out again; their paragraphs must be the ones it held.
    const notes = noteAnchorsOf(page);
    if (!sameKeys(notes, noteAnchorsOf(before))) return null;
    index ??= new Map(lastIndex);
    for (const [id, anchor] of anchors)
      if (lastIndex.get(id) === was.get(id)) index.set(id, anchor);
    // A note entry came from this page when it names this page; an earlier page's stays.
    for (const [id, anchor] of notes)
      if (lastIndex.get(id)?.pageIndex === page.index) index.set(id, anchor);
  }
  return index ?? lastIndex;
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

const warmsPending = new WeakSet<object>();

/**
 * Run `warm` once the window is idle, at most once at a time per `key`.
 *
 * A layout can replace every page record without a change a host hears about (a background
 * pass settling footnote reserves does). The review rail then re-anchors every page on the
 * next keystroke instead, and that keystroke waited for it. Warming the index in idle time
 * moves that work off the keystroke.
 */
export function warmAnchorsWhenIdle(key: object, view: Window, warm: () => void): void {
  if (warmsPending.has(key)) return;
  warmsPending.add(key);
  const run = (): void => {
    warmsPending.delete(key);
    warm();
  };
  if (typeof view.requestIdleCallback === 'function')
    view.requestIdleCallback(run, { timeout: 1000 });
  else view.setTimeout(run, 200);
}
