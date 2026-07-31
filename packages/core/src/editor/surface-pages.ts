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
  buildNumberingIndex,
  buildStyleCascadeTable,
  caretAt,
  enumerateDocumentSections,
  geometryOfSection,
  layoutHeaderFooterStory,
  pagesToMaterialize,
  readSectionProperties,
  type HeaderFooterVariantName,
  type NumberingIndex,
  type PageFurniture,
  type SemanticLayout,
  type SemanticSelection,
  type StyleCascadeTable,
  type TextMeasurer,
} from '@docx-editor.dev/core-contract/layout';

export interface FurnitureSource {
  /**
   * The page the DOCUMENT's final section asks for.
   *
   * Prefer `sectionFurniture` for pagination: multi-section documents carry per-section
   * geometry inside layout. This remains for chrome (ruler) that wants one geometry.
   */
  geometry(): ReturnType<typeof geometryOfSection>;
  /** Single-section / final-section furniture fallback. */
  furniture(): PageFurniture | undefined;
  /**
   * Per-section furniture, index-aligned with `enumerateDocumentSections`.
   *
   * A cover section with no header/footer references yields `undefined` at that index; later
   * sections that declare (or inherit) refs yield laid-out stories.
   */
  sectionFurniture(): readonly (PageFurniture | undefined)[];
}

export function createFurnitureSource(env: {
  readonly session: TreeDocxSession;
  readonly measurer: TextMeasurer;
  readonly producer: string;
  readonly cache: Parameters<typeof layoutHeaderFooterStory>[4];
  readonly styleCascade?: Parameters<typeof layoutHeaderFooterStory>[5];
}): FurnitureSource {
  const { session, measurer, producer, cache, styleCascade } = env;

  /**
   * Header/footer stories, laid out once per part for baseline height (phase 2, read-only).
   *
   * Keyed by part object identity plus width and producer: HF parts are immutable for the
   * session's lifetime, but a section-width edit or a late-arriving font re-measures them.
   * PAGE/NUMPAGES projection is applied later only for stories that contain those fields,
   * via `withPageContext` during layout finalize — not paint-time substitution.
   */
  const hfStoryMemo = new WeakMap<
    object,
    { width: number; producer: string; story: ReturnType<typeof layoutHeaderFooterStory> }
  >();

  function geometry(): ReturnType<typeof geometryOfSection> {
    return geometryOfSection(readSectionProperties(session.part()));
  }

  function storyOf(part: OoxmlPart, width: number): ReturnType<typeof layoutHeaderFooterStory> {
    const memo = hfStoryMemo.get(part);
    if (memo && memo.width === width && memo.producer === producer) return memo.story;
    const story = layoutHeaderFooterStory(part, width, measurer, producer, cache, styleCascade);
    hfStoryMemo.set(part, { width, producer, story });
    return story;
  }

  function mapStories(
    source: ReadonlyMap<HeaderFooterVariantName, OoxmlPart>,
    width: number
  ): ReadonlyMap<HeaderFooterVariantName, ReturnType<typeof layoutHeaderFooterStory>> {
    const laid = new Map<HeaderFooterVariantName, ReturnType<typeof layoutHeaderFooterStory>>();
    for (const [variant, part] of source) laid.set(variant, storyOf(part, width));
    return laid;
  }

  function furnitureFromParts(
    parts: ReturnType<TreeDocxSession['headerFooterPartsBySection']>[number] | undefined,
    sectionGeometry: ReturnType<typeof geometryOfSection>
  ): PageFurniture | undefined {
    if (!parts) return undefined;
    if (parts.headers.size === 0 && parts.footers.size === 0) return undefined;
    const width =
      sectionGeometry.width - sectionGeometry.margin.left - sectionGeometry.margin.right;
    return {
      titlePage: parts.titlePage,
      evenAndOddHeaders: parts.evenAndOddHeaders,
      headers: mapStories(parts.headers, width),
      footers: mapStories(parts.footers, width),
    };
  }

  function sectionFurniture(): readonly (PageFurniture | undefined)[] {
    const sections = enumerateDocumentSections(session.part());
    const bySection = session.headerFooterPartsBySection();
    return sections.map((section, index) =>
      furnitureFromParts(bySection[index], geometryOfSection(section.properties))
    );
  }

  function furniture(): PageFurniture | undefined {
    const all = sectionFurniture();
    return all[all.length - 1];
  }

  return { geometry, furniture, sectionFurniture };
}

/** Immutable-in-session style + numbering projections shared by body and furniture layout. */
export function createSurfaceStyleDeps(session: TreeDocxSession): {
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly numberingIndex: NumberingIndex;
} {
  return {
    styleCascade: buildStyleCascadeTable(session.stylesRoot()),
    numberingIndex: buildNumberingIndex(session.numberingRoot()),
  };
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

/** Surface sizing derived from layout records, in layout points (not CSS pixels). */
export interface SurfaceExtent {
  /** Width the surface container should occupy. */
  readonly width: number;
  /** Total document height (always from every page, for scroll extent). */
  readonly height: number;
  /**
   * Extra horizontal offset per page, in layout points, so narrower sheets centre inside a
   * mixed-width materialized window. Absent entries mean no offset beyond layout `box.x`.
   */
  readonly pageOffsetX: ReadonlyMap<number, number>;
}

/**
 * How wide and tall the paginated surface should be.
 *
 * When `materialize` is set — virtualization is active — width follows only those pages so a
 * distant landscape section does not stretch a portrait viewport. Without it (print, export,
 * tests with no scroller) every page contributes, which is the safe reading.
 */
export function surfaceExtent(
  layout: SemanticLayout,
  materialize: ReadonlySet<number> | undefined
): SurfaceExtent {
  const pages = layout.pages;
  const last = pages[pages.length - 1];
  const height = last ? last.box.y + last.box.height : 0;

  const widthPages = materialize ? pages.filter((page) => materialize.has(page.index)) : pages;

  let width = 0;
  for (const page of widthPages) {
    const right = page.box.x + page.box.width;
    if (right > width) width = right;
  }

  const widths = new Set(widthPages.map((page) => page.box.width));
  const pageOffsetX = new Map<number, number>();
  if (widthPages.length > 0 && widths.size > 1) {
    for (const page of pages) {
      pageOffsetX.set(page.index, (width - page.box.width) / 2 - page.box.x);
    }
  }

  return { width, height, pageOffsetX };
}

export function equalSurfaceExtents(a: SurfaceExtent, b: SurfaceExtent): boolean {
  if (a.width !== b.width || a.height !== b.height || a.pageOffsetX.size !== b.pageOffsetX.size) {
    return false;
  }
  for (const [index, offset] of a.pageOffsetX) {
    if (b.pageOffsetX.get(index) !== offset) return false;
  }
  return true;
}
