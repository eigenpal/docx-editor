// Page environment for the paginated surface (paginated-surface seam).
//
// This module owns what surrounds the text flow: the document's declared page geometry,
// the header/footer stories laid out once per part, and the arithmetic that decides which
// pages are worth materializing for the current viewport. The composition root supplies
// its session, measurer and cache; nothing here holds surface state beyond the per-part
// story memo.

import type { TreeDocxSession } from '@docx-editor.dev/core/binding';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '@docx-editor.dev/core/store';
import { resolveRelationship } from '@docx-editor.dev/core/store';
import {
  buildNumberingIndex,
  buildStyleCascadeTable,
  caretAt,
  defaultTabIntervalFromSettings,
  enumerateDocumentSections,
  geometryOfSection,
  layoutHeaderFooterStory,
  pagesToMaterialize,
  paragraphSectionNode,
  storyBlocks,
  type HeaderFooterVariantName,
  type NotesLayoutInput,
  type NumberingIndex,
  type PageFurniture,
  type SemanticLayout,
  type SemanticSelection,
  type StyleCascadeTable,
  type TextMeasurer,
} from '@docx-editor.dev/core/layout';
import {
  authoredDocumentEndnoteProperties,
  authoredDocumentFootnoteProperties,
  authoredEndnotePropertiesFromSectPr,
  authoredFootnotePropertiesFromSectPr,
  resolveEndnoteProperties,
  resolveFootnoteProperties,
  settingsPartOf,
} from '../store/package/note-properties.ts';
import { resolveNotesPart } from '../store/package/note-references.ts';

export interface FurnitureSource {
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
  /**
   * `w:settings/w:defaultTabStop` in points. Furniture tabs on the document's grid, so a
   * page-number tab in a metric-locale footer lands where Word puts it.
   */
  readonly defaultTabStopPt?: number;
  /**
   * The document's revision display mode, so furniture answers it too.
   *
   * A header is a story like any other. Without this it was laid out in the layout default
   * whatever the document was being shown in: a resolved view kept a break the body had
   * merged away, and All Markup drew no attribution on a header's own tracked mark.
   */
  readonly displayMode?: import('../layout/revision-projection.ts').RevisionDisplayMode;
  readonly inlineDrawingLayoutForPart?: (
    partName: string
  ) => import('../layout/drawing-layout.ts').InlineDrawingLayoutContext | undefined;
  /** Per-part resource epoch — memo invalidates when pending resources settle. */
  readonly drawingLayoutTokenForPart?: (partName: string) => string;
  readonly drawingTokenForParagraphForPart?: (
    partName: string,
    paragraph: import('@docx-editor.dev/core/store').OoxmlNode
  ) => string;
}): FurnitureSource {
  const {
    session,
    measurer,
    producer,
    cache,
    styleCascade,
    defaultTabStopPt,
    displayMode,
    inlineDrawingLayoutForPart,
    drawingLayoutTokenForPart,
    drawingTokenForParagraphForPart,
  } = env;

  /**
   * Header/footer stories, laid out once per distinct part object for baseline height.
   *
   * Keyed by part object identity plus width and producer. Edited HF parts are new objects
   * (store replace), so the WeakMap cannot serve a stale story after a commit — callers must
   * still re-resolve parts from `session.currentPackage()` / `headerFooterPartsBySection()`.
   * PAGE/NUMPAGES projection is applied later only for stories that contain those fields,
   * via `withPageContext` during layout finalize — not paint-time substitution.
   */
  const hfStoryMemo = new WeakMap<
    object,
    {
      width: number;
      pageHeight: number;
      marginTop: number;
      marginBottom: number;
      marginLeft: number;
      marginRight: number;
      producer: string;
      displayMode?: import('../layout/revision-projection.ts').RevisionDisplayMode;
      drawingLayoutToken: string;
      story: ReturnType<typeof layoutHeaderFooterStory>;
    }
  >();

  let rIdByPartName: Map<string, string> | null = null;
  let rIdMapPackageRevision = -1;

  function rIdOfPart(partName: string): string | undefined {
    const revision = session.packageRevision();
    if (!rIdByPartName || rIdMapPackageRevision !== revision) {
      rIdByPartName = headerFooterRIdIndex(session.currentPackage());
      rIdMapPackageRevision = revision;
    }
    return rIdByPartName.get(partName);
  }

  function storyOf(
    part: OoxmlPart,
    width: number,
    sectionGeometry?: ReturnType<typeof geometryOfSection>
  ): ReturnType<typeof layoutHeaderFooterStory> {
    const partDrawingToken = drawingLayoutTokenForPart?.(part.name) ?? '';
    const pageHeight = sectionGeometry?.height ?? 0;
    const marginTop = sectionGeometry?.margin.top ?? 0;
    const marginBottom = sectionGeometry?.margin.bottom ?? 0;
    const marginLeft = sectionGeometry?.margin.left ?? 0;
    const marginRight = sectionGeometry?.margin.right ?? 0;
    const memo = hfStoryMemo.get(part);
    if (
      memo &&
      memo.width === width &&
      memo.pageHeight === pageHeight &&
      memo.marginTop === marginTop &&
      memo.marginBottom === marginBottom &&
      memo.marginLeft === marginLeft &&
      memo.marginRight === marginRight &&
      memo.producer === producer &&
      memo.displayMode === displayMode &&
      memo.drawingLayoutToken === partDrawingToken
    ) {
      return memo.story;
    }
    const inlineDrawingLayout = inlineDrawingLayoutForPart?.(part.name);
    const baseline = layoutHeaderFooterStory(
      part,
      width,
      measurer,
      producer,
      cache,
      styleCascade,
      undefined,
      undefined,
      defaultTabStopPt,
      displayMode,
      inlineDrawingLayout,
      drawingTokenForParagraphForPart
        ? (paragraph) => drawingTokenForParagraphForPart(part.name, paragraph)
        : undefined,
      undefined,
      sectionGeometry
        ? {
            pageNumber: 1,
            pageWidth: sectionGeometry.width,
            pageHeight: sectionGeometry.height,
            marginLeft: sectionGeometry.margin.left,
            marginRight: sectionGeometry.margin.right,
            marginTop: sectionGeometry.margin.top,
            marginBottom: sectionGeometry.margin.bottom,
          }
        : undefined,
      session.documentProperties()
    );
    const rId = rIdOfPart(part.name);
    const story = rId ? stampStoryRId(baseline, rId) : baseline;
    hfStoryMemo.set(part, {
      width,
      pageHeight,
      marginTop,
      marginBottom,
      marginLeft,
      marginRight,
      producer,
      ...(displayMode ? { displayMode } : {}),
      drawingLayoutToken: partDrawingToken,
      story,
    });
    return story;
  }

  function mapStories(
    source: ReadonlyMap<HeaderFooterVariantName, OoxmlPart>,
    width: number,
    sectionGeometry: ReturnType<typeof geometryOfSection>
  ): ReadonlyMap<HeaderFooterVariantName, ReturnType<typeof layoutHeaderFooterStory>> {
    const laid = new Map<HeaderFooterVariantName, ReturnType<typeof layoutHeaderFooterStory>>();
    for (const [variant, part] of source) laid.set(variant, storyOf(part, width, sectionGeometry));
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
      headers: mapStories(parts.headers, width, sectionGeometry),
      footers: mapStories(parts.footers, width, sectionGeometry),
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

  return { furniture, sectionFurniture };
}

const HEADER_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
const FOOTER_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';

/** Map header/footer part names to the main-document relationship id that targets them. */
function headerFooterRIdIndex(
  pkg: ReturnType<TreeDocxSession['currentPackage']>
): Map<string, string> {
  const index = new Map<string, string>();
  const relationships = pkg.relationships.get(pkg.mainDocumentPart) ?? [];
  for (const record of relationships) {
    if (record.type !== HEADER_REL && record.type !== FOOTER_REL) continue;
    const resolved = resolveRelationship(record);
    if (resolved.mode !== 'Internal' || !resolved.target.ok) continue;
    const partName = resolved.target.partName;
    if (!index.has(partName)) index.set(partName, record.id);
  }
  return index;
}

function stampStoryRId(
  story: ReturnType<typeof layoutHeaderFooterStory>,
  rId: string
): ReturnType<typeof layoutHeaderFooterStory> {
  if (story.rId === rId) return story;
  return {
    ...story,
    rId,
    withPageContext: (ctx) => stampStoryRId(story.withPageContext(ctx), rId),
  };
}

/** Immutable-in-session style + numbering projections shared by body and furniture layout. */
export function createSurfaceStyleDeps(session: TreeDocxSession): {
  readonly styleCascade: StyleCascadeTable | undefined;
  /**
   * `w:settings/w:defaultTabStop` in points. Read once: the settings part is immutable
   * in-session, like the styles part.
   */
  readonly defaultTabStopPt: number;
  /**
   * Read per layout pass, not captured once.
   *
   * The styles part is immutable in-session, but the numbering part is NOT: turning on
   * bullets creates a definition, and a captured index would keep reporting the document
   * as unnumbered. `session.numberingRoot()` is memoized until that happens, so re-reading
   * costs a map lookup on every other pass.
   */
  numberingIndex(): NumberingIndex;
} {
  let root: OoxmlElement | null | undefined;
  let index: NumberingIndex | undefined;
  return {
    styleCascade: buildStyleCascadeTable(session.stylesRoot(), session.documentThemeFonts()),
    defaultTabStopPt: defaultTabIntervalFromSettings(session.settingsRoot()),
    numberingIndex() {
      const current = session.numberingRoot();
      if (index === undefined || current !== root) {
        root = current;
        index = buildNumberingIndex(current);
      }
      return index;
    },
  };
}

/**
 * The pages worth building in detail.
 *
 * The viewport is read from the nearest scrolling ancestor. Without one — print, export, a
 * test — this returns every page, which is the safe reading: a wrong guess silently drops
 * content rather than merely slowing something down.
 */
/**
 * The scroll container a mounted surface lives in, or null when it is not in one.
 *
 * ONE definition, because "where does this document scroll" has to be the same answer for
 * the code that decides which pages to build and the code that scrolls to one — a reveal
 * that moved a different element than materialization watches would scroll to a blank page.
 */
export function surfaceScroller(container: HTMLElement): HTMLElement | null {
  return container.closest('.docx-editor__scroll-container') as HTMLElement | null;
}

function viewportInLayout(
  container: HTMLElement,
  scroller: HTMLElement,
  scale: number
): { top: number; height: number } {
  const containerRect = container.getBoundingClientRect();
  const scrollerRect = scroller.getBoundingClientRect();
  // Real browsers move the container rect as the ancestor scrolls. happy-dom leaves both
  // rects at zero, so retain the offset fallback for DOM-free geometry tests.
  const topPx =
    scroller.scrollTop !== 0 && containerRect.top === 0 && scrollerRect.top === 0
      ? scroller.scrollTop - container.offsetTop
      : scrollerRect.top + scroller.clientTop - containerRect.top;
  return { top: topPx / scale, height: scroller.clientHeight / scale };
}

/**
 * The one-based page under the viewport centre, derived from semantic page records.
 *
 * `null` means there is no measurable viewport, so a caller can fall back to the caret
 * rather than inventing a scroll position. A centre in a page gap belongs to the following
 * page, matching the page a reader is scrolling toward.
 */
export function viewportPage(
  container: HTMLElement,
  layout: SemanticLayout,
  scale: number
): number | null {
  const scroller = surfaceScroller(container);
  if (!scroller || scroller.clientHeight <= 0 || layout.pages.length === 0 || scale <= 0) {
    return null;
  }
  const viewport = viewportInLayout(container, scroller, scale);
  const centerY = viewport.top + viewport.height / 2;
  for (const page of layout.pages) {
    if (centerY < page.box.y + page.box.height) return page.index + 1;
  }
  return layout.pages.length;
}

export function visiblePageSet(
  container: HTMLElement,
  layout: SemanticLayout,
  selection: SemanticSelection,
  scale: number
): ReadonlySet<number> | undefined {
  const scroller = surfaceScroller(container);
  if (!scroller || scroller.clientHeight === 0) return undefined;
  const viewport = viewportInLayout(container, scroller, scale);
  const pinned: number[] = [];
  for (const position of [selection.anchor, selection.head]) {
    const caret = caretAt(layout, position);
    if (caret) pinned.push(caret.pageIndex);
  }
  return pagesToMaterialize({
    layout,
    // Surface coordinates back to layout units: the records are in points and the viewport
    // may be nested below positioned wrappers inside the scroller.
    viewport,
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

/**
 * Build {@link NotesLayoutInput} from the live package for semantic layout.
 *
 * Returns `undefined` when the package has neither footnotes nor endnotes parts — body
 * layout then skips the notes path entirely (no reservation, no mark projection).
 */
export function createNotesLayoutInput(env: {
  readonly session: TreeDocxSession;
  readonly measurer: TextMeasurer;
  readonly producer: string;
  readonly cache: Parameters<typeof layoutHeaderFooterStory>[4];
  readonly styleCascade?: StyleCascadeTable;
  readonly defaultTabStopPt?: number;
  readonly inlineDrawingLayoutForPart?: (
    partName: string
  ) => import('../layout/drawing-layout.ts').InlineDrawingLayoutContext | undefined;
  readonly drawingTokenForParagraphForPart?: (
    partName: string,
    paragraph: import('@docx-editor.dev/core/store').OoxmlNode
  ) => string;
}): NotesLayoutInput | undefined {
  const pkg = env.session.currentPackage();
  const footnotesPart = resolveNotesPart(pkg, 'footnote');
  const endnotesPart = resolveNotesPart(pkg, 'endnote');
  if (!footnotesPart && !endnotesPart) return undefined;

  const settings = settingsPartOf(pkg);
  const docFnAuthored = authoredDocumentFootnoteProperties(settings);
  const docEnAuthored = authoredDocumentEndnoteProperties(settings);
  const documentFootnoteProps = resolveFootnoteProperties(undefined, docFnAuthored);
  const documentEndnoteProps = resolveEndnoteProperties(undefined, docEnAuthored);

  const part = env.session.part();
  const sections = enumerateDocumentSections(part);
  const sectPrBySection = sectionSectPrNodes(part, sections);
  const footnotePropsBySection = sections.map((_, index) =>
    resolveFootnoteProperties(
      authoredFootnotePropertiesFromSectPr(sectPrBySection[index]),
      docFnAuthored
    )
  );
  const endnotePropsBySection = sections.map((_, index) =>
    resolveEndnoteProperties(
      authoredEndnotePropertiesFromSectPr(sectPrBySection[index]),
      docEnAuthored
    )
  );

  const inlineDrawingLayoutForPart = env.inlineDrawingLayoutForPart;
  const drawingTokenForParagraphForPart = env.drawingTokenForParagraphForPart;
  // A notes part carries its own relationships, so its pictures resolve against a context
  // built for THAT part — the body context would look their `r:embed` up in document.xml.rels.
  const drawingsForPart = inlineDrawingLayoutForPart
    ? (partName: string) => {
        const inlineDrawingLayout = inlineDrawingLayoutForPart(partName);
        if (!inlineDrawingLayout) return undefined;
        return {
          inlineDrawingLayout,
          ...(drawingTokenForParagraphForPart
            ? {
                drawingTokenForParagraph: (paragraph: OoxmlNode) =>
                  drawingTokenForParagraphForPart(partName, paragraph),
              }
            : {}),
        };
      }
    : undefined;

  return {
    footnotesPart,
    endnotesPart,
    footnotePropsBySection:
      footnotePropsBySection.length > 0 ? footnotePropsBySection : [documentFootnoteProps],
    endnotePropsBySection:
      endnotePropsBySection.length > 0 ? endnotePropsBySection : [documentEndnoteProps],
    documentFootnoteProps,
    documentEndnoteProps,
    measurer: env.measurer,
    producer: env.producer,
    cache: env.cache,
    styleCascade: env.styleCascade,
    defaultTabStopPt: env.defaultTabStopPt,
    ...(drawingsForPart ? { drawingsForPart } : {}),
  };
}

/** SectPr nodes index-aligned with {@link enumerateDocumentSections}. */
function sectionSectPrNodes(
  part: OoxmlPart,
  sections: ReturnType<typeof enumerateDocumentSections>
): readonly (OoxmlElement | undefined)[] {
  const blocks = storyBlocks(part);
  const nodes: (OoxmlElement | undefined)[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    if (block.kind !== 'paragraph') continue;
    const sectPr = paragraphSectionNode(block);
    if (!sectPr) continue;
    nodes.push(sectPr);
  }
  while (nodes.length < sections.length) nodes.push(undefined);
  return nodes;
}
