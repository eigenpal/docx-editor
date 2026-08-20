// Header/footer story layout (phase 2 of the legacy-lane retirement).
//
// A header or footer is a STORY laid out at the section's content width with no pagination:
// its height is whatever its blocks flow to. That flow height — never an anchored-object
// extent — is what sizes the box on every page (the #856 rule).
//
// Baseline stories are laid out once per variant for furniture height / content-area
// push-down. Allowlisted PAGE/NUMPAGES/SECTIONPAGES fields need context-sensitive projection
// because digit widths affect right-tab alignment. Callers obtain those via
// {@link HeaderFooterStoryLayout.withPageContext}:
//
//   - no dynamic fields → identity reuse of the baseline
//   - NUMPAGES only → one cached layout per page count
//   - SECTIONPAGES only → one cached layout per section page count
//   - PAGE (alone or combined) → bounded LRU over the distinct evaluated values
//
// Scope stays furniture-only; body field projection remains deferred.

import type { OoxmlPart } from '@docx-editor.dev/core/store';
import { stableHash } from '../store/comparators/canonical.ts';
import { canonicalOoxmlFingerprint } from '../store/package/ooxml-tree.ts';
import {
  detectStoryPageFields,
  fieldPageContextToken,
  storyNeedsPageFields,
  type FieldPageContext,
  type StoryPageFieldNeeds,
} from './field-projection.ts';
import type { ParagraphLayoutCache } from './layout-cache.ts';
import type { PendingLine } from './paragraph-flow.ts';
import { drawingResourceLayoutToken } from './inline-drawing-source.ts';
import { DEFAULT_REVISION_DISPLAY_MODE } from './revision-projection.ts';
import type { RevisionDisplayMode } from './revision-projection.ts';
import type { AnchoredDrawingRecord } from './drawing-layout.ts';
import { pageClipRegion, type DrawingAnchorFrameContext } from './drawing-layout.ts';
import {
  DrawingExclusionConvergenceError,
  MAX_DRAWING_EXCLUSION_REFLOW_PASSES,
  collectExclusionZonesFromDrawings,
  exclusionLayoutToken,
  type ExclusionZone,
} from './drawing-exclusion.ts';
import { flowBlocksInBox } from './semantic-table-layout.ts';
import { layoutTextboxStory } from './textbox-story-layout.ts';
import type {
  BlockFragmentRecord,
  HeaderFooterStoryRecord,
  LayoutBox,
  PageRecord,
  TextMeasurer,
} from './semantic-records.ts';
import type { StyleCascadeTable } from './style-cascade.ts';
import { storyBlocks } from './story-roots.ts';

/**
 * Distinct PAGE-dependent contexts retained before LRU eviction.
 *
 * Finalize stores projected furniture on each page record, so eviction cannot drop published
 * geometry. The bound only prevents the per-story cache from retaining every historical
 * `(pageNumber, pageCount)` pair across edits.
 */
export const DEFAULT_MAX_HF_PAGE_CONTEXT_ENTRIES = 128;

/** Page geometry for header/footer anchored frame resolution (story-relative layout space). */
export interface HeaderFooterPageContext {
  readonly pageNumber: number;
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly marginLeft: number;
  readonly marginRight: number;
  readonly marginTop: number;
  readonly marginBottom: number;
}

export interface HeaderFooterStoryLayout {
  readonly partName: string;
  /** Main-document relationship id when the furniture source knows it. */
  readonly rId?: string;
  /**
   * Bounded identity of the story's canonical OOXML content.
   *
   * Furniture cache keys must not rely on {@link flowHeight} alone: equal-height A→B edits
   * would otherwise reuse stale page furniture. Derived as a 16-hex FNV-1a over the part's
   * canonical fingerprint — never DOM identity or unbounded raw serialization in the key.
   * PAGE/NUMPAGES/SECTIONPAGES projection shares this key; page context is cached separately.
   */
  readonly contentKey: string;
  /** Story-relative fragments; origin at the story box's top-left. */
  readonly fragments: readonly BlockFragmentRecord[];
  /** The height the blocks actually flow to — what sizes the box on every page. */
  readonly flowHeight: number;
  /**
   * Allowlisted complex PAGE / NUMPAGES / SECTIONPAGES presence detected for this story.
   *
   * Callers use this to skip attaching a page-field projector when the baseline is enough.
   */
  readonly pageFieldNeeds: StoryPageFieldNeeds;
  /** Anchored drawings owned by this story, in story-relative coordinates. */
  readonly anchoredDrawings?: readonly AnchoredDrawingRecord[];
  /**
   * Re-layout this story under a page-field context.
   *
   * Field-free stories return `this`. Count-only stories cache by the counts they read.
   * PAGE stories cache by the distinct evaluated values (including format) with a bounded LRU.
   */
  readonly withPageContext: (ctx: FieldPageContext) => HeaderFooterStoryLayout;
}

/** Bounded digest of a header/footer part's canonical tree for furniture cache identity. */
export function headerFooterContentKey(part: OoxmlPart): string {
  return stableHash(canonicalOoxmlFingerprint(part));
}

function createBoundedContextCache(maxEntries: number): {
  get(key: string): HeaderFooterStoryLayout | undefined;
  set(key: string, value: HeaderFooterStoryLayout): void;
  readonly size: number;
} {
  const capacity = Math.max(1, Math.floor(maxEntries));
  const entries = new Map<string, HeaderFooterStoryLayout>();
  return {
    get(key) {
      const value = entries.get(key);
      if (value === undefined) return undefined;
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      if (entries.has(key)) entries.delete(key);
      entries.set(key, value);
      while (entries.size > capacity) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
    },
    get size() {
      return entries.size;
    },
  };
}

/**
 * Lay one header/footer part out at `contentWidth`.
 *
 * Line ids are namespaced by part so the body's `line-N` counter — which incremental
 * convergence compares — never moves because a header changed.
 *
 * When `pageContext` is set, allowlisted PAGE/NUMPAGES/SECTIONPAGES instructions project
 * live values; otherwise those fields contribute only cached result text (often empty).
 * Field-free stories ignore `pageContext` and share one baseline layout.
 *
 * `defaultTabStopPt` is the document's `w:settings/w:defaultTabStop` (ECMA-376 §17.15.1.25)
 * in points; absent keeps the 0.5" schema default. Furniture tabs on the SAME grid as the
 * body — a page-number tab in a metric-locale footer belongs on the document's interval, not
 * on a constant. It sits at the tail because the parameters ahead of it are already
 * positional; new callers should keep passing `undefined` for what they do not set.
 */
export function layoutHeaderFooterStory(
  part: OoxmlPart,
  contentWidth: number,
  measurer: TextMeasurer,
  producer: string,
  cache?: ParagraphLayoutCache<readonly PendingLine[]>,
  styleCascade?: StyleCascadeTable,
  pageContext?: FieldPageContext,
  maxPageContextEntries: number = DEFAULT_MAX_HF_PAGE_CONTEXT_ENTRIES,
  defaultTabStopPt?: number,
  displayMode: RevisionDisplayMode = DEFAULT_REVISION_DISPLAY_MODE,
  inlineDrawingLayout?: import('./drawing-layout.ts').InlineDrawingLayoutContext,
  drawingTokenForParagraph?: (paragraph: import('@docx-editor.dev/core/store').OoxmlNode) => string,
  drawingLayoutToken?: string,
  hfPageContext?: HeaderFooterPageContext,
  documentProperties?: import('@docx-editor.dev/core/store').DocumentProperties
): HeaderFooterStoryLayout {
  const needs = detectStoryPageFields(part.root);
  const contextCache = createBoundedContextCache(maxPageContextEntries);
  // WITH the display mode, like every other consumer of this list. The inline flow already
  // received it — a deleted run vanished from a header in `proposed` — while the block list
  // did not, so the paragraph a tracked mark merges away kept its own line, and a paragraph a
  // revision removed entirely kept a blank one. The cache is namespaced by mode below.
  const blocks = storyBlocks(part, displayMode);
  // Content identity is of the authored part, not of a page-field projection.
  const contentKey = headerFooterContentKey(part);
  let baseline: HeaderFooterStoryLayout | undefined;

  const layoutOnce = (ctx: FieldPageContext | undefined): HeaderFooterStoryLayout => {
    const effectiveCtx = storyNeedsPageFields(needs) || inlineDrawingLayout ? ctx : undefined;
    const pageNumber = effectiveCtx?.pageNumber ?? hfPageContext?.pageNumber ?? 1;
    const token =
      fieldPageContextToken(effectiveCtx, needs) + (inlineDrawingLayout ? `|pn:${pageNumber}` : '');

    if (token === '') {
      if (baseline) return baseline;
    } else {
      const cached = contextCache.get(token);
      if (cached) return cached;
    }

    let lineCounter = 0;
    const pendingAnchoredDrawings: AnchoredDrawingRecord[] = [];
    const anchorFrameBase = (): Omit<
      DrawingAnchorFrameContext,
      | 'paragraphBox'
      | 'anchorLineBox'
      | 'anchorCharacterX'
      | 'columnBox'
      | 'cellBox'
      | 'layoutInCell'
    > => {
      const pageNumber = effectiveCtx?.pageNumber ?? hfPageContext?.pageNumber ?? 1;
      const pageWidth = hfPageContext?.pageWidth ?? contentWidth;
      const pageHeight = hfPageContext?.pageHeight ?? Math.max(1, contentWidth);
      const marginLeft = hfPageContext?.marginLeft ?? 0;
      const marginRight = hfPageContext?.marginRight ?? 0;
      const marginTop = hfPageContext?.marginTop ?? 0;
      const marginBottom = hfPageContext?.marginBottom ?? 0;
      const hfContentHeight = Math.max(1, pageHeight - marginTop - marginBottom);
      return Object.freeze({
        pageNumber,
        pageWidth,
        pageHeight,
        marginLeft,
        marginRight,
        marginBottom,
        // ON PURPOSE, unlike the body story: a header/footer frame keeps the AUTHORED margin
        // here. Its origin is the story box, and `hfAnchorOnPageSheet` re-bases page-frame
        // axes by subtracting `verticalFrameOrigin`, so this value cancels exactly.
        contentInsetTop: marginTop,
        contentInsetBottom: marginBottom,
        contentWidth,
        contentHeight: hfContentHeight,
        contentBandHeight: hfContentHeight,
        ownerPartName: part.name,
        storyKind: part.name.includes('ftr') ? 'footer' : 'header',
      });
    };

    let exclusionZones: readonly ExclusionZone[] = Object.freeze([]);
    let flow!: { readonly blocks: BlockFragmentRecord[]; readonly bottom: number };

    if (inlineDrawingLayout) {
      let converged = false;
      for (let pass = 0; pass < MAX_DRAWING_EXCLUSION_REFLOW_PASSES; pass += 1) {
        pendingAnchoredDrawings.splice(0, pendingAnchoredDrawings.length);
        lineCounter = 0;
        flow = flowBlocksInBox(blocks, 0, Math.max(1, contentWidth), 0, 0, {
          measurer,
          cache,
          producer:
            producer +
            token +
            (displayMode === DEFAULT_REVISION_DISPLAY_MODE ? '' : `|rev:${displayMode}`),
          nextLineId: () => `hf-${part.name}-line-${lineCounter++}`,
          styleCascade,
          pageContext: effectiveCtx,
          ...(defaultTabStopPt !== undefined ? { defaultTabStopPt } : {}),
          displayMode,
          ...(documentProperties ? { documentProperties } : {}),
          inlineDrawingLayout,
          anchorFrameBase,
          pageContentClip: () => pageClipRegion(anchorFrameBase()),
          // Textbox stories flow with the SAME page-field context as the host story, so a
          // PAGE field inside an anchored footer text box evaluates per page like a direct
          // footer field. The context token already keys this cache entry.
          layoutTextboxStoryFor: (projection) =>
            layoutTextboxStory(projection, {
              measurer,
              producer:
                producer +
                token +
                (displayMode === DEFAULT_REVISION_DISPLAY_MODE ? '' : `|rev:${displayMode}`),
              cache,
              styleCascade,
              ...(effectiveCtx ? { pageContext: effectiveCtx } : {}),
              ...(defaultTabStopPt !== undefined ? { defaultTabStopPt } : {}),
              displayMode,
              ...(documentProperties ? { documentProperties } : {}),
              inlineDrawingLayout,
              ...(drawingTokenForParagraph ? { drawingTokenForParagraph } : {}),
            }),
          collectAnchoredDrawings: (drawings) => {
            pendingAnchoredDrawings.push(...drawings);
          },
          columnBoxForParagraph: (paragraphBox) =>
            Object.freeze({
              x: 0,
              y: paragraphBox.y,
              width: contentWidth,
              height: paragraphBox.height,
            }),
          pageExclusionZones: () => exclusionZones,
          ...(drawingTokenForParagraph
            ? { drawingTokenForParagraph }
            : drawingLayoutToken
              ? { drawingLayoutToken }
              : {}),
        });
        const nextZones = collectExclusionZonesFromDrawings(
          pendingAnchoredDrawings,
          inlineDrawingLayout,
          0,
          contentWidth
        );
        if (nextZones.length === 0) {
          converged = true;
          exclusionZones = nextZones;
          break;
        }
        if (pass > 0 && exclusionLayoutToken(exclusionZones) === exclusionLayoutToken(nextZones)) {
          converged = true;
          exclusionZones = nextZones;
          break;
        }
        exclusionZones = nextZones;
      }
      if (!converged) {
        throw new DrawingExclusionConvergenceError(
          `header/footer exclusion reflow did not converge within ${MAX_DRAWING_EXCLUSION_REFLOW_PASSES} passes`
        );
      }
    } else {
      flow = flowBlocksInBox(blocks, 0, Math.max(1, contentWidth), 0, 0, {
        measurer,
        cache,
        producer:
          producer +
          token +
          (displayMode === DEFAULT_REVISION_DISPLAY_MODE ? '' : `|rev:${displayMode}`),
        nextLineId: () => `hf-${part.name}-line-${lineCounter++}`,
        styleCascade,
        pageContext: effectiveCtx,
        ...(defaultTabStopPt !== undefined ? { defaultTabStopPt } : {}),
        displayMode,
        ...(documentProperties ? { documentProperties } : {}),
      });
    }

    const story: HeaderFooterStoryLayout = {
      partName: part.name,
      contentKey,
      fragments: flow.blocks,
      flowHeight: flow.bottom,
      pageFieldNeeds: needs,
      ...(pendingAnchoredDrawings.length > 0
        ? { anchoredDrawings: Object.freeze([...pendingAnchoredDrawings]) }
        : {}),
      withPageContext: (next) => {
        if (!storyNeedsPageFields(needs) && !story.anchoredDrawings?.length) {
          return baseline ?? story;
        }
        return layoutOnce(next);
      },
    };

    if (token === '') {
      baseline = story;
    } else {
      contextCache.set(token, story);
    }
    return story;
  };

  return layoutOnce(pageContext);
}

/**
 * Remap a section-local page onto the document sheet stack.
 *
 * Each section lays out with its own origin; the orchestrator assigns global indices and
 * cumulative Y so sheets of different heights still stack without gaps or overlaps.
 *
 * Furniture boxes must move with the sheet. The attach-time `pageFieldProjector` closes over
 * the section-local page box, so a bare shift of the current story box is not enough —
 * document-level page-field finalize would re-place at the pre-stack origin and paint
 * would compute `(story.box.y - page.box.y)` as a negative full-page offset onto the prior
 * sheet. Wrap the projector so projected furniture receives the same `dy`.
 */
export function remapPage(page: PageRecord, globalIndex: number, sheetY: number): PageRecord {
  const dy = sheetY - page.box.y;
  const shiftBox = (box: LayoutBox): LayoutBox => ({ ...box, y: box.y + dy });
  const shiftFurniture = (
    story: HeaderFooterStoryRecord | undefined
  ): HeaderFooterStoryRecord | undefined => {
    if (!story) return undefined;
    const shifted: HeaderFooterStoryRecord = {
      ...story,
      box: shiftBox(story.box),
      ...(story.anchoredDrawings ? { anchoredDrawings: story.anchoredDrawings } : {}),
    };
    if (!story.pageFieldProjector) return shifted;
    const project = story.pageFieldProjector;
    return {
      ...shifted,
      pageFieldProjector: (context) => {
        const projected = project(context);
        return { ...projected, box: shiftBox(projected.box) };
      },
    };
  };
  const shiftNoteArea = (
    area: import('./semantic-records.ts').NoteAreaRecord | undefined
  ): import('./semantic-records.ts').NoteAreaRecord | undefined => {
    if (!area) return undefined;
    return {
      ...area,
      box: shiftBox(area.box),
      ...(area.separator
        ? { separator: { ...area.separator, box: shiftBox(area.separator.box) } }
        : {}),
      notes: area.notes.map((note) => ({ ...note, box: shiftBox(note.box) })),
    };
  };
  const header = shiftFurniture(page.header);
  const footer = shiftFurniture(page.footer);
  const footnotes = shiftNoteArea(page.footnotes);
  const endnotes = shiftNoteArea(page.endnotes);
  return {
    ...page,
    id: `page-${globalIndex}`,
    index: globalIndex,
    box: shiftBox(page.box),
    contentBox: shiftBox(page.contentBox),
    ...(header ? { header } : {}),
    ...(footer ? { footer } : {}),
    ...(footnotes ? { footnotes } : {}),
    ...(endnotes ? { endnotes } : {}),
  };
}

/**
 * Resource identity of every image a header/footer story paints.
 *
 * Part of the session context, because the rest of what identifies a story — `contentKey`
 * and `flowHeight` — describes the AUTHORED part, and neither moves when an image finishes
 * decoding: the extent is authored, so the story is exactly as tall with a pending picture
 * as with a ready one. Without this the unchanged-pass early exit finds every key equal and
 * returns the previous pages BY IDENTITY, furniture included, so a header or footer image
 * stays a "loading" placeholder for the rest of the session — nothing will invalidate it
 * again. Body drawings have no such gap; they ride the per-paragraph flow keys.
 */
export function storyDrawingResourceToken(story: HeaderFooterStoryLayout): string {
  const tokens: string[] = [];
  const visitBlock = (block: BlockFragmentRecord): void => {
    if (block.kind === 'table') {
      for (const row of block.rows) {
        for (const cell of row.cells) for (const inner of cell.blocks) visitBlock(inner);
      }
      return;
    }
    for (const line of block.lines) {
      for (const drawing of line.drawings ?? []) {
        tokens.push(drawingResourceLayoutToken(drawing.resource));
      }
    }
  };
  for (const drawing of story.anchoredDrawings ?? []) {
    tokens.push(drawingResourceLayoutToken(drawing.resource));
  }
  for (const fragment of story.fragments) visitBlock(fragment);
  // Empty for the overwhelmingly common story with no pictures, so the context string for a
  // plain header is byte-for-byte what it was.
  return tokens.length === 0 ? '' : `!${tokens.join('!')}`;
}

/**
 * The furniture slice of a section's layout-session context: distances and flags, then each
 * variant's flow height, content key and drawing-resource token — everything a header or
 * footer edit can move that the body flow would not otherwise notice.
 */
export function furnitureLayoutContext(
  furniture:
    | {
        readonly titlePage?: boolean;
        readonly evenAndOddHeaders?: boolean;
        readonly headers: ReadonlyMap<string, HeaderFooterStoryLayout>;
        readonly footers: ReadonlyMap<string, HeaderFooterStoryLayout>;
      }
    | undefined,
  headerDistance: number,
  footerDistance: number
): string {
  if (!furniture) return '';
  const stories = (prefix: string, source: ReadonlyMap<string, HeaderFooterStoryLayout>) =>
    [...source]
      .map(
        ([variant, story]) =>
          `${prefix}${variant}=${story.flowHeight}@${story.contentKey}${storyDrawingResourceToken(story)}`
      )
      .sort()
      .join(',');
  return (
    `|hf:${headerDistance},${footerDistance},${furniture.titlePage ? 1 : 0}${furniture.evenAndOddHeaders ? 1 : 0};` +
    stories('h', furniture.headers) +
    ';' +
    stories('f', furniture.footers)
  );
}
