import type { SemanticLayout } from '../layout/semantic-records.ts';
import { translateParagraphFragment } from '../layout/paragraph-frame.ts';

const cache = new WeakMap<SemanticLayout, SemanticLayout>();

/** Include textbox paragraphs in the geometry used to paint remote carets and ranges. */
export function textboxPresenceLayout(layout: SemanticLayout): SemanticLayout {
  const cached = cache.get(layout);
  if (cached) return cached;
  const pages = layout.pages.map((page) => {
    const fragments = (page.anchoredDrawings ?? []).flatMap((drawing) => {
      const story = drawing.textboxStory;
      if (!story || drawing.accessibility.hidden) return [];
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
    return fragments.length ? { ...page, fragments: [...page.fragments, ...fragments] } : page;
  });
  const projected = pages.every((page, index) => page === layout.pages[index])
    ? layout
    : { ...layout, pages };
  cache.set(layout, projected);
  return projected;
}
