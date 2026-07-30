// Page environment for the paginated surface (paginated-surface seam).
//
// This module owns what surrounds the text flow: the document's declared page geometry,
// the header/footer stories laid out once per part, and the arithmetic that decides which
// pages are worth materializing for the current viewport. The composition root supplies
// its session, measurer and cache; nothing here holds surface state beyond the per-part
// story memo.

import type { TreeDocxSession } from '@docx-editor.dev/core-contract/binding';
import type { OoxmlPart } from '@docx-editor.dev/core-contract/store';
import {
  caretAt,
  geometryOfSection,
  layoutHeaderFooterStory,
  pagesToMaterialize,
  readSectionProperties,
  type HeaderFooterVariantName,
  type PageFurniture,
  type SemanticLayout,
  type SemanticSelection,
  type TextMeasurer,
} from '@docx-editor.dev/core-contract/layout';

export interface FurnitureSource {
  /**
   * The page the DOCUMENT asks for, not a constant.
   *
   * Read once per pass rather than cached: a section property is part of the tree, so an
   * edit can change it, and paginating an A4 document onto Letter puts every page break in
   * the wrong place before anything is painted.
   */
  geometry(): ReturnType<typeof geometryOfSection>;
  furniture(): PageFurniture | undefined;
}

export function createFurnitureSource(env: {
  readonly session: TreeDocxSession;
  readonly measurer: TextMeasurer;
  readonly producer: string;
  readonly cache: Parameters<typeof layoutHeaderFooterStory>[4];
}): FurnitureSource {
  const { session, measurer, producer, cache } = env;

  /**
   * Header/footer stories, laid out once per part (phase 2, read-only).
   *
   * Keyed by part object identity plus width and producer: HF parts are immutable for the
   * session's lifetime, but a section-width edit or a late-arriving font re-measures them.
   */
  const hfStoryMemo = new WeakMap<
    object,
    { width: number; producer: string; story: ReturnType<typeof layoutHeaderFooterStory> }
  >();

  function geometry(): ReturnType<typeof geometryOfSection> {
    return geometryOfSection(readSectionProperties(session.part()));
  }

  function furniture(): PageFurniture | undefined {
    const parts = session.headerFooterParts();
    if (parts.headers.size === 0 && parts.footers.size === 0) return undefined;
    const currentGeometry = geometry();
    const width =
      currentGeometry.width - currentGeometry.margin.left - currentGeometry.margin.right;
    const storyOf = (part: OoxmlPart): ReturnType<typeof layoutHeaderFooterStory> => {
      const memo = hfStoryMemo.get(part);
      if (memo && memo.width === width && memo.producer === producer) return memo.story;
      const story = layoutHeaderFooterStory(part, width, measurer, producer, cache);
      hfStoryMemo.set(part, { width, producer, story });
      return story;
    };
    const mapStories = (
      source: ReadonlyMap<HeaderFooterVariantName, OoxmlPart>
    ): ReadonlyMap<HeaderFooterVariantName, ReturnType<typeof layoutHeaderFooterStory>> => {
      const laid = new Map<HeaderFooterVariantName, ReturnType<typeof layoutHeaderFooterStory>>();
      for (const [variant, part] of source) laid.set(variant, storyOf(part));
      return laid;
    };
    return {
      titlePage: readSectionProperties(session.part()).titlePage,
      evenAndOddHeaders: parts.evenAndOddHeaders,
      headers: mapStories(parts.headers),
      footers: mapStories(parts.footers),
    };
  }

  return { geometry, furniture };
}

/**
 * The pages worth building in detail.
 *
 * The viewport is read from the nearest scrolling ancestor. Without one — print, export, a
 * test — this returns every page, which is the safe reading: a wrong guess silently drops
 * content rather than merely slowing something down.
 */
export function visiblePageSet(
  container: HTMLElement,
  layout: SemanticLayout,
  selection: SemanticSelection,
  scale: number
): ReadonlySet<number> | undefined {
  const scroller = container.closest('.docx-editor__scroll-container') as HTMLElement | null;
  if (!scroller || scroller.clientHeight === 0) return undefined;
  const pinned: number[] = [];
  for (const position of [selection.anchor, selection.head]) {
    const caret = caretAt(layout, position);
    if (caret) pinned.push(caret.pageIndex);
  }
  return pagesToMaterialize({
    layout,
    // Surface coordinates back to layout units: the records are in points and the scroll
    // offset is in CSS pixels.
    viewport: {
      top: (scroller.scrollTop - container.offsetTop) / scale,
      height: scroller.clientHeight / scale,
    },
    overscanPages: 1,
    pinnedPages: pinned,
  });
}

export function equalPageSets(
  a: ReadonlySet<number> | undefined,
  b: ReadonlySet<number> | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b || a.size !== b.size) return false;
  for (const index of a) if (!b.has(index)) return false;
  return true;
}
