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

import type { OoxmlNode, OoxmlPart } from '@docx-editor.dev/core/store';
import { stableHash } from '../store/comparators/canonical.ts';
import { canonicalOoxmlFingerprint } from '../store/package/ooxml-tree.ts';
import {
  carryStrippedPageFieldProjection,
  detectStoryPageFields,
  fieldPageContextToken,
  storyNeedsPageFields,
  type FieldPageContext,
  type StoryPageFieldNeeds,
} from './field-projection.ts';
import { framedTokenJoin, type ParagraphLayoutCache } from './layout-cache.ts';
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
import { forEachStoryDrawing, forEachStoryParagraphFragment } from './semantic-record-queries.ts';
import { withResolvedListItems, type ResolvedListItem } from './list-resolve.ts';
import type { NumberingIndex } from './numbering-index.ts';
import { hostedStoryFlowDeps, layoutTextboxStory } from './textbox-story-layout.ts';
import type {
  BlockFragmentRecord,
  HeaderFooterStoryRecord,
  LayoutBox,
  PageRecord,
  TextMeasurer,
} from './semantic-records.ts';
import type { StyleCascadeTable } from './style-cascade.ts';
import { storyBlocks } from './story-roots.ts';
import { positionLegacyFooterPageFrame } from './legacy-footer-page-frame.ts';

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

/** Per-sheet geometry needed to resolve header/footer anchors before wrap and clipping. */
export interface HeaderFooterLayoutPageContext extends FieldPageContext {
  /** Effective content-box inset after this page's header/footer reserves are applied. */
  readonly contentInsetTop?: number;
  /** Effective bottom content-box inset after footer reserve. */
  readonly contentInsetBottom?: number;
  /** Story-box top measured from the physical sheet top. */
  readonly storyTop?: number;
}

export interface HeaderFooterStoryLayout {
  readonly partName: string;
  /**
   * The part this story was laid out from.
   *
   * Carried because a derivation that runs over the finished layout cannot reach it otherwise:
   * the layout receives furniture as fragments plus a NAME, and a name is not a tree. The
   * content-control boundary pass needs the tree to know which controls exist at all.
   */
  readonly part?: OoxmlPart;
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
  /** Snapshot identity for projected links and live document-property fields in this story. */
  readonly projectionEpoch?: string;
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
   * Re-layout this story under page-field and optional attached-page geometry context.
   *
   * Field-free stories return `this`. Count-only stories cache by the counts they read.
   * PAGE stories cache by the distinct evaluated values (including format) with a bounded LRU.
   */
  readonly withPageContext: (ctx: HeaderFooterLayoutPageContext) => HeaderFooterStoryLayout;
}

/** Memoized per immutable part: the fingerprint+hash walk is pure and parts never mutate. */
const headerFooterContentKeys = new WeakMap<OoxmlPart, string>();

/** Bounded digest of a header/footer part's canonical tree for furniture cache identity. */
export function headerFooterContentKey(part: OoxmlPart): string {
  const cached = headerFooterContentKeys.get(part);
  if (cached !== undefined) return cached;
  const key = stableHash(canonicalOoxmlFingerprint(part));
  headerFooterContentKeys.set(part, key);
  return key;
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
 * Story-level inputs the body path has always had and furniture never did.
 *
 * A BAG, not more positional parameters. The signature below already carries fifteen, and its
 * own doc comment used to tell new callers to "keep passing `undefined` for what they do not
 * set" — which is why `numberingIndex` was never added and a numbered paragraph in a header
 * painted no marker for as long as headers have been editable. Everything new goes here.
 */
export interface HeaderFooterStoryInputs {
  /**
   * `numbering.xml`, so a `w:numPr` paragraph in this story resolves a marker — directly or
   * inside an anchored text box, which lays out with its own per-box counters.
   *
   * Absent, the story lays out exactly as before: no marker record, and no numbering indent
   * merged into the paragraph's own.
   */
  readonly numberingIndex?: NumberingIndex;
  /** Sanitized hyperlink seams scoped to this header/footer part. */
  readonly projectLink?: import('./field-pieces.ts').HyperlinkProjector;
  readonly projectFieldLink?: import('./field-pieces.ts').FieldLinkProjector;
  /** Per-paragraph identity for links and live document-property projection. */
  readonly projectionTokenForParagraph?: (paragraph: OoxmlNode) => string;
  /** Memoized aggregate projection identity for table subtrees. */
  readonly projectionTokenForTable?: (table: OoxmlNode) => string;
  /** Aggregate identity of link and live-field projections for furniture reuse keys. */
  readonly projectionEpoch?: string;
  /** Reviewers whose changes project as accepted in this story. */
  readonly revisionAuthorFilter?: import('./revision-projection.ts').RevisionAuthorFilter;
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
 *
 * NEW inputs belong in {@link HeaderFooterStoryInputs}, the trailing bag, rather than as a
 * sixteenth position. Fifteen is what stopped `numberingIndex` being threaded here at all.
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
  documentProperties?: import('@docx-editor.dev/core/store').DocumentProperties,
  inputs?: HeaderFooterStoryInputs
): HeaderFooterStoryLayout {
  const revisionAuthorFilter = inputs?.revisionAuthorFilter;
  const needs = detectStoryPageFields(part.root);
  const contextCache = createBoundedContextCache(maxPageContextEntries);
  // WITH the display mode, like every other consumer of this list. The inline flow already
  // received it — a deleted run vanished from a header in `proposed` — while the block list
  // did not, so the paragraph a tracked mark merges away kept its own line, and a paragraph a
  // revision removed entirely kept a blank one. The cache is namespaced by mode below.
  const blocks = storyBlocks(part, displayMode, revisionAuthorFilter);
  // The story's own list-item map, resolved once per layout of this part.
  //
  // Per STORY, not continuing the body's counters: `createListCounterState` is created fresh
  // per story walk, and a header repeats on every page, so a numbered header list restarts at
  // `w:start` and shows the same number on page 3 as on page 1. That matches Word, which keeps
  // furniture numbering independent of the body's.
  const listItems: ReadonlyMap<string, ResolvedListItem> | undefined = withResolvedListItems(
    { numberingIndex: inputs?.numberingIndex, styleCascade },
    blocks
  ).listItems;
  // Content identity is of the authored part, not of a page-field projection.
  const contentKey = headerFooterContentKey(part);
  let baseline: HeaderFooterStoryLayout | undefined;

  const layoutOnce = (ctx: HeaderFooterLayoutPageContext | undefined): HeaderFooterStoryLayout => {
    const effectiveCtx = storyNeedsPageFields(needs) || inlineDrawingLayout ? ctx : undefined;
    const pageNumber = effectiveCtx?.pageNumber ?? hfPageContext?.pageNumber ?? 1;
    const anchorPageToken =
      inlineDrawingLayout &&
      effectiveCtx?.contentInsetTop !== undefined &&
      effectiveCtx.contentInsetBottom !== undefined &&
      effectiveCtx.storyTop !== undefined
        ? `|hf:${effectiveCtx.contentInsetTop},${effectiveCtx.contentInsetBottom},${effectiveCtx.storyTop}`
        : '';
    const token =
      fieldPageContextToken(effectiveCtx, needs) +
      (inlineDrawingLayout ? `|pn:${pageNumber}` : '') +
      anchorPageToken;

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
      const verticalMarginFrame =
        effectiveCtx?.contentInsetTop !== undefined &&
        effectiveCtx.contentInsetBottom !== undefined &&
        effectiveCtx.storyTop !== undefined
          ? Object.freeze({
              top: effectiveCtx.contentInsetTop - effectiveCtx.storyTop,
              height: Math.max(
                1,
                pageHeight - effectiveCtx.contentInsetTop - effectiveCtx.contentInsetBottom
              ),
            })
          : undefined;
      return Object.freeze({
        pageNumber,
        pageWidth,
        pageHeight,
        marginLeft,
        marginRight,
        marginBottom,
        // ON PURPOSE, unlike the body story: the established page/topMargin/bottomMargin
        // frames keep the AUTHORED margin here. `hfAnchorOnPageSheet` re-bases page-frame
        // axes by subtracting `verticalFrameOrigin`, so this value cancels exactly. The
        // vertical margin frame above carries the effective content-box geometry separately.
        contentInsetTop: marginTop,
        contentInsetBottom: marginBottom,
        contentWidth,
        ...(verticalMarginFrame ? { verticalMarginFrame } : {}),
        contentHeight: hfContentHeight,
        contentBandHeight: hfContentHeight,
        ownerPartName: part.name,
        storyKind: part.name.includes('ftr') ? 'footer' : 'header',
      });
    };

    // Textbox stories flow with the SAME page-field context as the host story, so a PAGE
    // field inside an anchored footer text box evaluates per page like a direct footer
    // field. The context token already keys this cache entry.
    const layoutTextboxStoryFor = (
      projection: import('../store/package/drawing-projection.ts').DrawingProjection
    ) =>
      layoutTextboxStory(projection, {
        measurer,
        producer:
          producer +
          token +
          (displayMode === DEFAULT_REVISION_DISPLAY_MODE ? '' : `|rev:${displayMode}`) +
          (revisionAuthorFilter ? `|reviewers:${revisionAuthorFilter.cacheKey}` : ''),
        cache,
        styleCascade,
        ...(effectiveCtx ? { pageContext: effectiveCtx } : {}),
        ...(defaultTabStopPt !== undefined ? { defaultTabStopPt } : {}),
        displayMode,
        ...(revisionAuthorFilter ? { revisionAuthorFilter } : {}),
        ...(documentProperties ? { documentProperties } : {}),
        ...(inputs?.projectLink ? { projectLink: inputs.projectLink } : {}),
        ...(inputs?.projectFieldLink ? { projectFieldLink: inputs.projectFieldLink } : {}),
        inlineDrawingLayout,
        ...(drawingTokenForParagraph ? { drawingTokenForParagraph } : {}),
        ...(inputs?.projectionTokenForParagraph
          ? { projectionTokenForParagraph: inputs.projectionTokenForParagraph }
          : {}),
        ...(inputs?.projectionTokenForTable
          ? { projectionTokenForTable: inputs.projectionTokenForTable }
          : {}),
        ...(inputs?.numberingIndex ? { numberingIndex: inputs.numberingIndex } : {}),
      });
    // ONE capability for the whole projected story — every exclusion reflow pass uses the
    // same layout callback and list-token provider, structurally paired for table-cell flow.
    const hostedStory = inlineDrawingLayout
      ? hostedStoryFlowDeps(
          layoutTextboxStoryFor,
          inputs?.numberingIndex,
          styleCascade,
          displayMode,
          revisionAuthorFilter
        )
      : undefined;

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
            (displayMode === DEFAULT_REVISION_DISPLAY_MODE ? '' : `|rev:${displayMode}`) +
            (revisionAuthorFilter ? `|reviewers:${revisionAuthorFilter.cacheKey}` : ''),
          nextLineId: () => `hf-${part.name}-line-${lineCounter++}`,
          styleCascade,
          ...(listItems ? { listItems } : {}),
          hostedStory,
          pageContext: effectiveCtx,
          ...(defaultTabStopPt !== undefined ? { defaultTabStopPt } : {}),
          displayMode,
          ...(revisionAuthorFilter ? { revisionAuthorFilter } : {}),
          ...(documentProperties ? { documentProperties } : {}),
          ...(inputs?.projectLink ? { projectLink: inputs.projectLink } : {}),
          ...(inputs?.projectFieldLink ? { projectFieldLink: inputs.projectFieldLink } : {}),
          ...(inputs?.projectionTokenForParagraph
            ? { projectionTokenForParagraph: inputs.projectionTokenForParagraph }
            : {}),
          ...(inputs?.projectionTokenForTable
            ? { projectionTokenForTable: inputs.projectionTokenForTable }
            : {}),
          inlineDrawingLayout,
          anchorFrameBase,
          pageContentClip: () => {
            const frame = anchorFrameBase();
            return effectiveCtx?.storyTop !== undefined
              ? Object.freeze({
                  x: -frame.marginLeft,
                  y: -effectiveCtx.storyTop,
                  width: frame.pageWidth,
                  height: frame.pageHeight,
                })
              : pageClipRegion(frame);
          },
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
          ...(inputs?.projectionTokenForParagraph
            ? { projectionTokenForParagraph: inputs.projectionTokenForParagraph }
            : {}),
          ...(inputs?.projectionTokenForTable
            ? { projectionTokenForTable: inputs.projectionTokenForTable }
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
          (displayMode === DEFAULT_REVISION_DISPLAY_MODE ? '' : `|rev:${displayMode}`) +
          (revisionAuthorFilter ? `|reviewers:${revisionAuthorFilter.cacheKey}` : ''),
        nextLineId: () => `hf-${part.name}-line-${lineCounter++}`,
        styleCascade,
        ...(listItems ? { listItems } : {}),
        pageContext: effectiveCtx,
        ...(defaultTabStopPt !== undefined ? { defaultTabStopPt } : {}),
        displayMode,
        ...(revisionAuthorFilter ? { revisionAuthorFilter } : {}),
        ...(documentProperties ? { documentProperties } : {}),
        ...(inputs?.projectLink ? { projectLink: inputs.projectLink } : {}),
        ...(inputs?.projectFieldLink ? { projectFieldLink: inputs.projectFieldLink } : {}),
        ...(inputs?.projectionTokenForParagraph
          ? { projectionTokenForParagraph: inputs.projectionTokenForParagraph }
          : {}),
        ...(inputs?.projectionTokenForTable
          ? { projectionTokenForTable: inputs.projectionTokenForTable }
          : {}),
      });
    }

    flow = positionLegacyFooterPageFrame(part, flow, contentWidth, hfPageContext);
    const story: HeaderFooterStoryLayout = {
      partName: part.name,
      part,
      contentKey,
      ...(inputs?.projectionEpoch ? { projectionEpoch: inputs.projectionEpoch } : {}),
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
    if (!story.pageFieldProjector) {
      // A published (already-finalized) story keeps its projector on the side; carry it onto
      // the shifted twin so a moved reused sheet can still re-project at a new page count.
      carryStrippedPageFieldProjection(story, shifted, dy);
      return shifted;
    }
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

/** Memoized per story object, exactly like {@link storyDrawingResourceTokens}. */
const storyListMarkerTokens = new WeakMap<HeaderFooterStoryLayout, string>();

/**
 * Marker identity of every list item a header/footer story paints.
 *
 * The exact sibling of {@link storyDrawingResourceToken}, and for the same reason. What
 * otherwise identifies a story — `contentKey` and `flowHeight` — describes the AUTHORED part,
 * and neither moves when `numbering.xml` changes: the definition lives in a different part, and
 * a marker sits in the hanging-indent slot, so the story is exactly as tall with `1.` as with
 * `vii.`. Without this the unchanged-pass early exit finds every key equal and returns the
 * previous pages BY IDENTITY, furniture included.
 *
 * Measured before this existed: a body edit that also changed the numbering left six reused
 * pages showing the old header marker and the one rebuilt page showing the new one — two
 * different numbers for the same header in one section.
 *
 * Walks with {@link forEachStoryParagraphFragment}, which descends into each anchored
 * drawing's text-box story exactly like {@link storyDrawingResourceToken}'s walk does: a
 * `w:numPr` paragraph inside a `wps:txbx` carries a marker record too, and a `numbering.xml`
 * edit moves neither `contentKey` nor `flowHeight`, so without the descent a reused page
 * kept showing the old number inside the box.
 */
export function storyListMarkerToken(story: HeaderFooterStoryLayout): string {
  const cached = storyListMarkerTokens.get(story);
  if (cached !== undefined) return cached;
  const tokens: string[] = [];
  forEachStoryParagraphFragment(story, (fragment) => {
    const marker = fragment.marker;
    if (marker) {
      // Length-framed at both levels: `marker.text` is expanded `w:lvlText` and `numFmt`
      // is read verbatim from the file, so any separator the content can contain lets two
      // different marker states concatenate to one token and reuse a header page showing
      // the old numbers.
      tokens.push(
        framedTokenJoin([fragment.paragraphId, marker.text, marker.numFmt, String(marker.level)])
      );
    }
  });
  const token = tokens.length === 0 ? '' : `|list:${framedTokenJoin(tokens)}`;
  storyListMarkerTokens.set(story, token);
  return token;
}

/**
 * Memoized per story object: a story layout is immutable, and `hfStoryMemo` keeps the
 * object identity stable across passes, so the walk would otherwise repeat per section per
 * layout pass on the keystroke path.
 */
const storyDrawingResourceTokens = new WeakMap<HeaderFooterStoryLayout, string>();

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
 *
 * Walks with {@link forEachStoryDrawing}, which descends into each anchored drawing's
 * text-box story: a picture inside a `wps:txbx` in a header settles on the same
 * asynchronous clock as a direct one, so its resource has to move this token too.
 *
 * CLIPPED drawings ride along (#467). This token is computed from the BASELINE story, and
 * `layoutTextboxStory` drops fragments below the box's content height — while a
 * `withPageContext` projection of the same story can wrap differently (PAGE digits) and
 * paint a drawing the baseline clipped out. Painted plus clipped is the story's full source
 * set, a superset of what any projection paints, so a settle always moves this token no
 * matter which projection shows the picture.
 */
export function storyDrawingResourceToken(story: HeaderFooterStoryLayout): string {
  const cached = storyDrawingResourceTokens.get(story);
  if (cached !== undefined) return cached;
  const tokens: string[] = [];
  forEachStoryDrawing(story, (drawing) => {
    tokens.push(drawingResourceLayoutToken(drawing.resource));
    if (drawing.kind === 'anchoredDrawing' && drawing.textboxStory?.clippedResourceToken) {
      tokens.push(`clip:${drawing.textboxStory.clippedResourceToken}`);
    }
  });
  // Empty for the overwhelmingly common story with no pictures, so the context string for a
  // plain header is byte-for-byte what it was. Length-framed: resource keys embed
  // relationship ids and part names read verbatim from the file, and the clip token is
  // itself a framed list, so no separator — printable or NUL — stays unforgeable.
  const token = tokens.length === 0 ? '' : `!${framedTokenJoin(tokens)}`;
  storyDrawingResourceTokens.set(story, token);
  return token;
}

/**
 * One framed furniture story entry — shared by `furnitureLayoutContext` here and the
 * multi-section `furnitureStoryEntries` fingerprint, so a rider token added to one reuse
 * key can never be forgotten by the other. `contentKey` describes the AUTHORED part, so the
 * drawing-resource and list-marker tokens ride along for everything a story resolves from
 * ANOTHER part; without them a reused section keeps a stale header.
 */
export function framedStoryEntry(label: string, story: HeaderFooterStoryLayout): string {
  return framedTokenJoin([
    label,
    String(story.flowHeight),
    story.contentKey,
    story.projectionEpoch ?? '',
    storyDrawingResourceToken(story),
    storyListMarkerToken(story),
  ]);
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
  // Length-framed fields, entries, and sections: the marker token embeds expanded
  // `w:lvlText` and the resource token embeds relationship-derived identity, so any
  // separator boundary the content can reproduce would let one variant's file-controlled
  // text forge another variant's entry and reuse pages showing the stale variant.
  const stories = (prefix: string, source: ReadonlyMap<string, HeaderFooterStoryLayout>) =>
    framedTokenJoin(
      [...source].map(([variant, story]) => framedStoryEntry(`${prefix}${variant}`, story)).sort()
    );
  return (
    `|hf:${headerDistance},${footerDistance},${furniture.titlePage ? 1 : 0}${furniture.evenAndOddHeaders ? 1 : 0};` +
    framedTokenJoin([stories('h', furniture.headers), stories('f', furniture.footers)])
  );
}
