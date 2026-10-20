import type {
  PageRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
} from '../layout/semantic-records.ts';
import { translateParagraphFragment } from '../layout/paragraph-frame.ts';
import { textboxDrawingsOnPage } from '../layout/textbox-drawing-records.ts';
import { forEachStoryParagraphFragment } from '../layout/semantic-record-queries.ts';
import { headerFooterAnchoredDrawingOrigin } from '../layout/header-footer-drawing-origin.ts';

const cache = new WeakMap<SemanticLayout, SemanticLayout>();

/** Header and footer text-box paragraphs, moved into the page's content coordinates. */
function furnitureTextboxFragments(page: PageRecord): ParagraphFragmentRecord[] {
  const fragments: ParagraphFragmentRecord[] = [];
  const pageOrigin = { x: page.box.x, y: page.box.y };
  for (const story of [page.header, page.footer]) {
    if (!story) continue;
    const origin = { x: story.box.x, y: story.box.y };
    forEachStoryParagraphFragment(
      story,
      (fragment, context) => {
        if (context.textboxDepth === 0 || context.textboxOwner?.accessibility.hidden) return;
        fragments.push(
          translateParagraphFragment(
            fragment,
            context.storyOrigin.x - page.contentBox.x,
            context.storyOrigin.y - page.contentBox.y
          )
        );
      },
      origin,
      (drawing) => headerFooterAnchoredDrawingOrigin(drawing, origin, pageOrigin)
    );
  }
  return fragments;
}

/**
 * Include text-box paragraphs in the geometry used to paint remote carets, ranges, and
 * highlights: body boxes, anchored or inline, and boxes in headers and footers.
 */
export function textboxPresenceLayout(layout: SemanticLayout): SemanticLayout {
  const cached = cache.get(layout);
  if (cached) return cached;
  const pages = layout.pages.map((page) => {
    const fragments = textboxDrawingsOnPage(page).flatMap((drawing) => {
      const story = drawing.textboxStory;
      return story.fragments.flatMap((fragment) =>
        fragment.kind === 'paragraph'
          ? [
              translateParagraphFragment(
                fragment,
                drawing.x + story.contentOffset.x,
                drawing.y + story.contentOffset.y
              ),
            ]
          : []
      );
    });
    fragments.push(...furnitureTextboxFragments(page));
    return fragments.length ? { ...page, fragments: [...page.fragments, ...fragments] } : page;
  });
  const projected = pages.every((page, index) => page === layout.pages[index])
    ? layout
    : { ...layout, pages };
  cache.set(layout, projected);
  return projected;
}
