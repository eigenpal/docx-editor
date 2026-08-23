// Semantic paragraph layout over the canonical tree (tasks 7.1, 7.3).
//
// Produces the revision-tagged records in `semantic-records.ts`: pages, paragraph fragments,
// lines and style spans, each carrying a stable source range. It reads the CANONICAL TREE
// and a measurement port, never the DOM and never ProseMirror.
//
// A paragraph that does not fit the remaining page height is FRAGMENTED rather than moved
// wholesale: the lines that fit stay, the rest continue on the next page under the same
// paragraph id. That is what makes a cross-page paragraph one paragraph for selection and
// two boxes for pagination.

import type {
  DocumentProperties,
  OoxmlElement,
  OoxmlNode,
  OoxmlPart,
  OoxmlProperty,
} from '@docx-editor.dev/core/store';
import { WML_MAIN_DOCUMENT_PART } from '../store/package/opc-names.ts';
import {
  finalizePageFieldProjection,
  storyNeedsPageFields,
  summarizeFlushedPage,
  withPageFieldSources,
  type FieldLinkProjector,
  type HyperlinkProjector,
} from './field-projection.ts';
import {
  paragraphLayoutKey,
  registerTableCellBreakKeys,
  retainLiveBreakKeys,
  type ParagraphLayoutCache,
} from './layout-cache.ts';
import {
  alignSpans,
  alignDrawings,
  breakParagraph,
  pendingLineFlowExtentAtPlacement,
  type Alignment,
  type PendingLine,
} from './paragraph-flow.ts';
import {
  DEFAULT_REVISION_DISPLAY_MODE,
  markRevisionFields,
  paragraphMarkFormatRevisionOf,
  paragraphMarkRevisionsOf,
  type RevisionDisplayMode,
} from './revision-projection.ts';
import {
  appliedSpaceBefore,
  paragraphBorderExtentPt,
  paragraphBorderStrokeWidthPt,
  collapsedSpaceBefore,
  paragraphBordersFingerprint,
  paragraphBreaksBefore,
  type ParagraphBorders,
  type ParagraphLineSpacing,
  type ParagraphSpacing,
} from './paragraph-style.ts';
import { resolveParagraphBorders } from './paragraph-border-resolve.ts';
import {
  adjustedBreakIndex,
  keepNextFlowKeys,
  listMarkerFlowKeys,
  contextualSpacingFlowKeys,
  keepNextGroupHeight,
  paragraphKeeps,
  MAX_KEEP_NEXT_CHAIN,
  type ParagraphKeeps,
} from './pagination-keeps.ts';
import { DEFAULT_RUN_STYLE, resolveRunStyle } from './run-style.ts';
import {
  tabStopsFingerprint,
  withDefaultTabInterval,
  type ResolvedTabStops,
} from './paragraph-tabs.ts';
import {
  resolveParagraphLayoutInputs,
  cascadeRunProperties,
  type StyleCascadeTable,
} from './style-cascade.ts';
import { paragraphShadingBox } from './ooxml-shading.ts';
import {
  readTableStructure,
  tableFloatOriginX,
  tableOriginX,
  type SemanticTableRow,
  type TableAnchorFrames,
} from './semantic-table.ts';
import {
  createTableBorderOwnershipBudget,
  createTableVMergeResolveBudget,
  finalizeTableRows,
  initialCellCursors,
  layoutRowFragment,
  layoutRowFragmentBounded,
  measureRowHeight,
  MAX_TABLE_ROW_FRAGMENTS,
  paragraphDocumentOrderOf,
  rowWithSplitBorders,
  TablePaginationError,
  type CellPlaceCursor,
  type TableFlowDeps,
} from './semantic-table-layout.ts';
import { annotateTableFragmentGeometry } from './semantic-table-interaction.ts';
import { mergeBoundariesOf, remapMergedLines } from './merged-paragraph-ranges.ts';
import { paragraphMergeGroupOf, storyBlocks } from './story-roots.ts';
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import {
  clipInlineDrawingRecordToRegion,
  publishAnchoredDrawingsForParagraph,
  anchoredDrawingAtomsInParagraph,
  pageClipRegion,
  shiftAnchoredDrawingRecords,
  type AnchoredDrawingRecord,
  type DrawingAnchorFrameContext,
} from './drawing-layout.ts';
import {
  collectExclusionZonesByPage,
  DrawingExclusionConvergenceError,
  exclusionLayoutToken,
  exclusionMapsEqual,
  exclusionMapsToken,
  MAX_ANCHOR_PAGE_DEFERRALS,
  resolveOverlapDisplacement,
  shiftAnchoredDrawingY,
  sortDrawingsForPaint,
  synthesizeParagraphTopAndBottomZones,
  topAndBottomSkipBeforeLine,
  withAnchoredDrawingLayoutFallback,
  type ExclusionZone,
  MAX_DRAWING_EXCLUSION_REFLOW_PASSES,
} from './drawing-exclusion.ts';
import { drawingModelOffsetsInParagraph } from './drawing-layout.ts';
import { drawingTokenForTableBlock } from './inline-drawing-source.ts';
import { projectDrawingsInPart } from '../store/package/drawing-projection.ts';
import {
  emptyTocPlaceholderParagraphIds,
  emptyTocSuppressedResultParagraphIds,
  tocFieldChromeParagraphIds,
} from './toc-layout.ts';
import { furnitureLayoutContext, remapPage, type HeaderFooterStoryLayout } from './hf-layout.ts';
import { convergenceTailShiftAllowed } from './page-reuse-guards.ts';
import {
  attachContentControlBoundaries,
  contentControlContextToken,
  withContentControlMetadata,
} from './content-control-boundary-layout.ts';
import {
  DEFAULT_SECTION_PROPERTIES,
  enumerateDocumentSectionsFromBlocks,
  geometryOfSection,
  paragraphSectionNode,
  type SectionColumns,
} from './section-properties.ts';
import { resolveSectionColumns, type ResolvedSectionColumns } from './section-columns.ts';
import { inheritNotesLayoutInput, layoutSemanticDocumentWithNotes } from './note-pagination.ts';
import { noteMarksCacheToken } from './note-projection.ts';
import {
  DEFAULT_PAGE_GEOMETRY,
  type BlockFragmentRecord,
  type HeaderFooterStoryRecord,
  type LayoutBox,
  type LineRecord,
  type PageGeometry,
  type PageRecord,
  type ParagraphBorderStrokeRecord,
  type ParagraphBottomBorderRecord,
  type SemanticLayout,
  type TableRowFragmentRecord,
  type TextMeasurer,
} from './semantic-records.ts';
import type { NumberingIndex } from './numbering-index.ts';
import { firstLineShift, withResolvedListItems, type ResolvedListItem } from './list-resolve.ts';
import { publishListMarker } from './list-marker.ts';
import {
  NO_DEFERRED_DRAWINGS,
  NO_DEFER_COUNTS,
  sameAnchoredDrawings,
  sameDeferCounts,
  sameFragments,
} from './semantic-fragment-signature.ts';
import { type FlowCheckpoint, type LayoutSession } from './layout-session.ts';
import { furnitureForSection, layoutMultiSectionDocument } from './multi-section-layout.ts';
import { layoutTextboxStory } from './textbox-story-layout.ts';

/** Extra full-document layouts after the reflow pass budget to detect a stable 2-cycle. */
const MAX_DRAWING_EXCLUSION_STABILIZATION_PASSES = 2;

export {
  createLayoutSession,
  type LayoutSession,
  type LayoutSessionStats,
} from './layout-session.ts';

/** Which header/footer variant a page shows (ECMA-376 §17.10.5). */
export type HeaderFooterVariantName = 'default' | 'first' | 'even';

/**
 * Pre-laid page furniture, supplied by the host (phase 2).
 *
 * Baseline stories are laid out once per variant (`layoutHeaderFooterStory`) for furniture
 * height. Stories that actually contain allowlisted PAGE/NUMPAGES fields attach a projector
 * so document-level finalize can re-layout under the known page count; field-free furniture
 * reuses the baseline on every sheet.
 */
export interface PageFurniture {
  readonly titlePage: boolean;
  readonly evenAndOddHeaders: boolean;
  readonly headers: ReadonlyMap<HeaderFooterVariantName, HeaderFooterStoryLayout>;
  readonly footers: ReadonlyMap<HeaderFooterVariantName, HeaderFooterStoryLayout>;
}

/**
 * Everything a layout pass needs beyond the document itself.
 *
 * `measurer` is the only required field — layout is DOM-free and measures through whatever is
 * injected here, which is what lets the same code paginate on a server and in a browser.
 */
export interface SemanticLayoutOptions {
  readonly geometry?: PageGeometry;
  readonly measurer: TextMeasurer;
  /**
   * Reuse of measured-and-broken paragraphs across revisions (task 9.2).
   *
   * Only the BREAK is cached. Placement — y, fragments, page cuts — is always redone, so
   * an edit high in the document still repaginates everything below it while paragraphs
   * nobody touched are never measured again.
   */
  readonly cache?: ParagraphLayoutCache<readonly PendingLine[]>;
  /**
   * Collector for the cache keys a pass wants retained, instead of retaining directly.
   * Supplied by the multi-section orchestrator, which retains once over the union —
   * retaining per section evicted every other section's entries. `false` skips retention
   * for this pass entirely (the orchestrator strides sweeps). See
   * {@link retainLiveBreakKeys}.
   */
  readonly retainKeys?: Set<string> | false;
  /**
   * Part-level drawing projection/resource epoch for the section prepass memo.
   *
   * Moves whenever any drawing projection or resource state in the part does, standing in
   * for the per-paragraph drawing tokens the memo would otherwise have to recompute to
   * validate. A caller that supplies `drawingTokenForParagraph` without this epoch keeps
   * the recompute path — the memo must never miss a token move it cannot see.
   */
  readonly drawingLayoutEpoch?: string;
  /**
   * Who produced the measurements, folded into every cache key.
   *
   * A font arriving after first paint changes every advance in the document while no
   * content changes; without this the cache would serve the pre-font layout forever.
   */
  readonly producer?: string;
  /**
   * Incremental placement across revisions (task 9.3).
   *
   * Holds the previous complete layout and a flow checkpoint per paragraph, so a pass can
   * resume just before the first affected paragraph instead of re-placing the document from
   * the top, and can stop early when the flow reconverges with the previous run.
   *
   * Multi-section documents keep per-section child sessions on {@link LayoutSession.multi}.
   */
  readonly session?: LayoutSession;
  /** Header/footer stories to attach per page; absent means no furniture. */
  readonly furniture?: PageFurniture;
  /**
   * Which tracked revisions this pass resolves away (ECMA-376 §17.13).
   *
   * `all-markup` (the default) lays out both halves of every change. `proposed` lays out what
   * the document becomes if every change is accepted; `original` what it was before any of
   * them. Both are LAYOUT INPUTS: neither applies a `TreeDocOp` nor publishes a `ModelChange`,
   * so a user who switches to the proposed result, saves, and sends the file has not silently
   * accepted every proposal in it.
   */
  readonly displayMode?: RevisionDisplayMode;
  /**
   * Per-section furniture, index-aligned with `enumerateDocumentSections`.
   *
   * When present, multi-section layout attaches each section's own headers/footers (after
   * OOXML inheritance). `furniture` remains the single-section / last-section fallback.
   */
  readonly sectionFurniture?: readonly (PageFurniture | undefined)[];
  /** Authored column count/gap for anchored `relativeFrom="column"` frame resolution. */
  readonly sectionColumns?: SectionColumns;
  /**
   * Styles-part cascade table (docDefaults + `w:style` last-wins). Absent keeps direct
   * formatting only — the pre-cascade behaviour, used by unit tests that never open a
   * package.
   */
  readonly styleCascade?: StyleCascadeTable;
  /**
   * Projection of `/word/numbering.xml`. Absent keeps pre-list behaviour (no markers /
   * level indents). The index is immutable for a session; list counter state is derived
   * per layout pass from document order.
   */
  readonly numberingIndex?: NumberingIndex;
  /**
   * Optional precomputed list items for the body story. When absent and
   * {@link numberingIndex} is set, layout walks the full body (including table cells)
   * once so counters continue across section boundaries and table document order.
   */
  readonly listItems?: ReadonlyMap<string, ResolvedListItem>;
  /**
   * `w:settings/w:defaultTabStop` in points (ECMA-376 §17.15.1.25); absent keeps the 0.5"
   * schema default.
   *
   * It arrives as an option because the paragraph cascade cannot see `settings.xml`. A
   * metric-locale template declares 1134 twips (2cm) and every default-interval tab in the
   * document belongs on that grid. Constant for a session — the settings part is immutable
   * here — which is why the prepared-block memo does not key on it.
   */
  readonly defaultTabStopPt?: number;
  /**
   * Turns a typed `w:hyperlink` into the SANITIZED record its spans carry.
   *
   * An option because resolving `r:id` needs the package's relationships, which layout — a
   * per-part walk — cannot see. Absent means link runs still measure, break and paint;
   * they simply carry no link, so nothing is clickable and no text is lost. That is the
   * degradation a headless test or a furniture-only pass gets, and it is the safe one.
   */
  readonly projectLink?: HyperlinkProjector;
  /**
   * Turns a parsed HYPERLINK field instruction into the SANITIZED record its result carries.
   *
   * An option for the same reason as {@link projectLink}: the raw target must cross the
   * surface's href trust boundary, which layout cannot see. Absent means the field's cached
   * result still measures, breaks and paints — it simply is not clickable.
   */
  readonly projectFieldLink?: FieldLinkProjector;
  /**
   * The document's parsed metadata, for document-property fields (TITLE, AUTHOR, …). Read once
   * by the surface and shared across body, table, note and header/footer flows.
   */
  readonly documentProperties?: DocumentProperties;
  /**
   * Footnote/endnote layout input. When present, body layout projects note marks and a
   * post-pass attaches note areas (with bounded reflow for pageBottom reservation).
   */
  readonly notes?: import('./note-pagination.ts').NotesLayoutInput;
  /**
   * Per-page bottom reserves (points) subtracted from content height before line placement.
   * Produced by the note reflow loop; absent means full content column.
   */
  readonly pageBottomReserves?: ReadonlyMap<number, number>;
  /** Derived note marks for body/note projection (provisional or final). */
  readonly noteMarks?: import('./note-projection.ts').NoteMarkContext;
  /** Inline drawing projection for typed `w:drawing` / `wp:inline` nodes. */
  readonly inlineDrawingLayout?: InlineDrawingLayoutContext;
  /** Per-paragraph drawing projection/resource token for break cache keys. */
  readonly drawingTokenForParagraph?: (paragraph: OoxmlNode) => string;
  /** @deprecated Prefer {@link drawingTokenForParagraph}. */
  readonly drawingLayoutToken?: string;
  /** Internal: reflow pass index while wrap exclusions converge. */
  readonly drawingExclusionPass?: number;
  /** Internal: converged exclusion zones — skips the reflow loop when set with zones. */
  readonly drawingExclusionConverged?: boolean;
  /** Internal: exclusion zones from the prior reflow pass, keyed by page index. */
  readonly drawingExclusionZonesByPage?: ReadonlyMap<number, readonly ExclusionZone[]>;
  /** Canonical drawing traversal order within the owner story part. */
  readonly drawingSourceOrder?: ReadonlyMap<string, number>;
  /**
   * Cross-paragraph TOC field begin/end paragraph ids. Empty chrome on these ids suppresses
   * the caret placeholder line in layout while the tree nodes stay intact for refresh/save.
   */
  readonly tocFieldChromeParagraphIds?: ReadonlySet<string>;
  /**
   * Begin-paragraph ids of empty TOCs. These keep one layout line so paint can host an
   * identifiable empty-TOC furniture placeholder (overrides chrome suppression).
   */
  readonly emptyTocPlaceholderParagraphIds?: ReadonlySet<string>;
  /**
   * Empty result-paragraph ids inside empty TOCs. Suppressed like field chrome so blank
   * cached rows do not stack under the empty placeholder.
   */
  readonly emptyTocSuppressedResultParagraphIds?: ReadonlySet<string>;
}

/** Prepass results by block node, valid while the width and producer both hold. */
type PreparedBlock =
  | {
      readonly kind: 'paragraph';
      readonly paragraph: OoxmlElement;
      readonly props: OoxmlProperty[];
      readonly indent: { left: number; right: number; hanging: number; firstLine: number };
      readonly available: number;
      readonly alignment: Alignment;
      readonly spacing: ParagraphSpacing;
      readonly lineSpacing: ParagraphLineSpacing;
      readonly contextualSpacing: boolean;
      readonly styleId: string | null;
      readonly borders: ParagraphBorders;
      /**
       * Border identity + indent, for the `w:between` group rule.
       *
       * Indent participates because a group whose members sit at different indents would need
       * a stepped outline; splitting the group there gives each member its own closed box,
       * which is the near miss rather than a rule drawn through the text.
       */
      readonly borderGroupKey: string;
      readonly shading: string | undefined;
      readonly inheritedRunProperties: readonly OoxmlProperty[];
      readonly markRunProperties: readonly OoxmlProperty[];
      readonly tabStops: ResolvedTabStops;
      /** `w:widowControl` / `w:keepNext` / `w:keepLines`, after the style cascade. */
      readonly keeps: ParagraphKeeps;
      readonly listItem?: ResolvedListItem;
      readonly key: string;
    }
  | { readonly kind: 'table'; readonly table: OoxmlElement; readonly key: string };

interface PreparedBlockMemo {
  readonly contentWidth: number;
  readonly producer: string;
  readonly drawingToken: string;
  /**
   * The resolved list item this entry was prepared under, by its own cache token.
   *
   * The entry embeds the item's indent, its available width and its break-cache key, and none
   * of the other three validators can see a numbering change. The producer used to carry the
   * item COUNT, which hid this by going cold on any list edit — and by re-laying out every
   * paragraph in the document for one Enter in a list. With the count gone, this is the guard
   * that has to be right.
   */
  readonly listToken: string;
  readonly entry: PreparedBlock;
}

/** Aggregate the list tokens of every paragraph a table contains, for its memo key. */
function listTokenForTableBlock(
  table: OoxmlNode,
  listItems: ReadonlyMap<string, ResolvedListItem> | undefined
): string {
  if (!listItems || listItems.size === 0) return '';
  const tokens: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'paragraph') {
      const token = listItems.get(node.id)?.cacheToken;
      if (token) tokens.push(token);
      return;
    }
    if ('children' in node) for (const child of node.children) visit(child);
  };
  visit(table);
  return tokens.join(';');
}

const preparedBlocks = new WeakMap<OoxmlNode, PreparedBlockMemo>();

/**
 * One section's whole prepass — prepared entries, cache keys, flow keys and document
 * order — kept on the section's {@link LayoutSession} and reused verbatim while every
 * input it derives from is unchanged. Stored through the session's opaque `prepass` slot.
 */
interface SectionPrepass {
  readonly bodies: readonly OoxmlElement[];
  readonly producer: string;
  readonly contentWidth: number;
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly listItems: ReadonlyMap<string, ResolvedListItem> | undefined;
  readonly drawingEpoch: string;
  readonly prepared: PreparedBlock[];
  readonly keys: string[];
  readonly paragraphDocumentOrder: ReadonlyMap<string, number>;
  readonly keepsNext: boolean[];
  readonly markerTexts: (string | undefined)[];
  readonly flowKeys: string[];
}
const drawingSourceOrderByContext = new WeakMap<
  InlineDrawingLayoutContext,
  ReadonlyMap<string, number>
>();

/**
 * Lay one story part out into pages.
 *
 * The engine's layout entry point. Walks body, header, footer and note roots, flattens block
 * SDTs, paginates tables with header-row repeats and vertical merges, and resolves every
 * paragraph through the style cascade.
 *
 * Incremental when given a {@link LayoutSession}: per-block cache keys plus flow checkpoints mean
 * a pass that changes nothing returns the previous pages by identity.
 */
export function layoutSemanticDocument(
  part: OoxmlPart,
  revision: number,
  options: SemanticLayoutOptions
): SemanticLayout {
  // ONE display mode for both. `blockStart` / `blockEndExclusive` index into this exact block
  // list, so enumerating sections over a differently-filtered one slices with indices that
  // do not belong to it and lands body text under the wrong section's page geometry.
  const displayMode = options.displayMode ?? DEFAULT_REVISION_DISPLAY_MODE;
  const blocks = storyBlocks(part, displayMode);
  const sections = enumerateDocumentSectionsFromBlocks(part, blocks).sections;
  // Wrapper-only metadata (alias/tag/lock/…) lives outside flattened paragraph nodes. Fold a
  // fingerprint into the producer so incremental identity reuse cannot keep stale boundaries.
  const controlToken = contentControlContextToken(part);
  const optionsWithControlContext: SemanticLayoutOptions = {
    ...options,
    producer: `${options.producer ?? 'unversioned-measurer'}|cc:${controlToken}`,
    tocFieldChromeParagraphIds:
      options.tocFieldChromeParagraphIds ?? tocFieldChromeParagraphIds(part),
    emptyTocPlaceholderParagraphIds:
      options.emptyTocPlaceholderParagraphIds ?? emptyTocPlaceholderParagraphIds(part),
    emptyTocSuppressedResultParagraphIds:
      options.emptyTocSuppressedResultParagraphIds ?? emptyTocSuppressedResultParagraphIds(part),
  };
  // Full-body list resolve so counters continue across sections and table cells.
  let drawingSourceOrder = options.drawingSourceOrder;
  if (!drawingSourceOrder && options.inlineDrawingLayout) {
    drawingSourceOrder = drawingSourceOrderByContext.get(options.inlineDrawingLayout);
    if (!drawingSourceOrder) {
      drawingSourceOrder = (() => {
        const order = new Map<string, number>();
        projectDrawingsInPart(part).forEach((projection, index) => {
          order.set(projection.drawingNodeId, index);
        });
        return order;
      })();
      drawingSourceOrderByContext.set(options.inlineDrawingLayout, drawingSourceOrder);
    }
  }
  const optionsWithLists = withResolvedListItems(
    drawingSourceOrder
      ? {
          ...optionsWithControlContext,
          drawingSourceOrder,
        }
      : optionsWithControlContext,
    blocks
  );

  const runBody = (opts: SemanticLayoutOptions): SemanticLayout => {
    if (sections.length > 1) {
      return layoutMultiSectionDocument(blocks, sections, revision, opts, layoutBlocksWithGeometry);
    }

    const section = sections[0];
    const geometry =
      opts.geometry ?? (section ? geometryOfSection(section.properties) : DEFAULT_PAGE_GEOMETRY);
    const furniture = furnitureForSection(opts, 0, sections.length) ?? opts.furniture;
    const laid = layoutBlocksWithGeometry(blocks, revision, {
      ...opts,
      geometry,
      furniture,
      sectionColumns: section?.properties.columns ?? DEFAULT_SECTION_PROPERTIES.columns,
    });
    const numbering = section?.properties.pageNumbering;
    // Carry boundary metadata through field annotation so a no-change resume still early-exits
    // in `attachContentControlBoundaries` instead of allocating a fresh `pages` array.
    const annotated: SemanticLayout = withContentControlMetadata(
      {
        revision: laid.layout.revision,
        pages: withPageFieldSources(
          laid.pages,
          numbering?.start ?? 1,
          laid.pages.length,
          numbering?.fmt
        ),
      },
      laid.layout
    );
    const finalized = finalizePageFieldProjection(annotated);
    if (opts.session) {
      opts.session.multi = null;
      opts.session.previous = finalized;
    }
    return finalized;
  };

  const finish = (layout: SemanticLayout): SemanticLayout => {
    const withBoundaries = attachContentControlBoundaries(layout, part, controlToken);
    if (options.session) {
      options.session.previous = withBoundaries;
    }
    return withBoundaries;
  };

  if (!options.notes) {
    return finish(runBody(optionsWithLists));
  }

  // Notes inherit the body's projector seams and document properties (link, field link, doc
  // props) unless the notes input pinned its own — see `inheritNotesLayoutInput`.
  const notesInput = inheritNotesLayoutInput(options.notes, options);
  return finish(
    layoutSemanticDocumentWithNotes(part, sections, optionsWithLists, notesInput, runBody)
  );
}

interface BlockLayoutResult {
  readonly layout: SemanticLayout;
  readonly pages: readonly PageRecord[];
  readonly lineCounter: number;
  /** Used height of the LAST page's content column, for a section that continues onto it. */
  readonly endCursorY: number;
  /** Trailing paragraph spacing at the end of the flow, for adjacent-spacing collapse. */
  readonly endSpaceAfter: number;
  /**
   * Whether the last page is the one the flow was still filling.
   *
   * False when the flow closed a page and opened nothing after it — an explicit
   * `w:br w:type="page"` on the last paragraph. `endCursorY` is 0 in BOTH cases, so a
   * section that continues onto this one cannot tell "empty column at the top of a fresh
   * sheet" from "that sheet is full and the break already ended it" without this.
   */
  readonly endsOpenPage: boolean;
}

type BlockLayoutOptions = SemanticLayoutOptions & {
  readonly geometry: PageGeometry;
  readonly sectionColumns?: SectionColumns;
  readonly lineCounterStart?: number;
  readonly flowStartY?: number;
  readonly spaceBeforeCarry?: number;
  readonly pageIndexStart?: number;
  /**
   * Balance this section's columns (ECMA-376 §17.6.4): Word divides the content of a
   * multi-column section that ends in a continuous section break evenly across its
   * columns instead of filling each to the page bottom first.
   */
  readonly balanceColumns?: boolean;
  /**
   * Column-height limit (content-box-relative bottom, points) applied to the FIRST page
   * only. Internal to the balance search: overflow pages keep the full content height so
   * an over-tall block always makes progress exactly as it does today.
   */
  readonly columnRegionBottom?: number;
};

/**
 * Body line ids are paragraph-local rather than document-ordinal.
 *
 * An edit that adds a line before an explicit page break changes the document-wide line count
 * but not any line after that break. Keeping those tail ids stable lets incremental layout reuse
 * the old pages once geometry reconverges.
 */
function bodyLineId(
  paragraphId: string,
  start: number,
  lineIndex: number,
  occurrence?: string
): string {
  const local = `line:${paragraphId}:${lineIndex}:${start}`;
  return occurrence === undefined ? local : `${local}:occ:${occurrence}`;
}

function layoutBlocksPass(
  bodies: readonly OoxmlElement[],
  revision: number,
  options: BlockLayoutOptions
): BlockLayoutResult {
  const geometry = options.geometry;
  const contentWidthForReflow = geometry.width - geometry.margin.left - geometry.margin.right;
  const columns = resolveSectionColumns(
    options.sectionColumns ?? DEFAULT_SECTION_PROPERTIES.columns,
    contentWidthForReflow
  );
  if (
    options.inlineDrawingLayout &&
    options.drawingExclusionPass === undefined &&
    !options.drawingExclusionConverged
  ) {
    const sourceOrderOf = (drawingNodeId: string) => options.drawingSourceOrder?.get(drawingNodeId);
    const exclusionColumnLayout = Object.freeze({
      columnCount: columns.count,
      columnGapPt: columns.gaps[0] ?? 0,
      contentWidth: contentWidthForReflow,
      columnLefts: columns.lefts,
      columnWidths: columns.widths,
    });
    let zonesByPage: ReadonlyMap<number, readonly ExclusionZone[]> = new Map();
    let result: BlockLayoutResult | null = null;
    let converged = false;
    const seenZoneTokens = new Set<string>();
    const previousPages = options.session?.previous?.pages;
    if (previousPages) {
      zonesByPage = collectExclusionZonesByPage(
        previousPages,
        options.inlineDrawingLayout,
        contentWidthForReflow,
        sourceOrderOf,
        exclusionColumnLayout
      );
      result = layoutBlocksWithGeometry(bodies, revision, {
        ...options,
        drawingExclusionPass: 0,
        drawingExclusionZonesByPage: zonesByPage,
      });
      const nextZones = collectExclusionZonesByPage(
        result.pages,
        options.inlineDrawingLayout,
        contentWidthForReflow,
        sourceOrderOf,
        exclusionColumnLayout
      );
      if (exclusionMapsEqual(zonesByPage, nextZones)) return result;
      zonesByPage = new Map(nextZones);
      seenZoneTokens.add(exclusionMapsToken(nextZones));
    }
    for (let pass = 0; pass < MAX_DRAWING_EXCLUSION_REFLOW_PASSES; pass += 1) {
      result = layoutBlocksWithGeometry(bodies, revision, {
        ...options,
        session: undefined,
        drawingExclusionPass: pass,
        drawingExclusionZonesByPage: zonesByPage,
      });
      const nextZones = collectExclusionZonesByPage(
        result.pages,
        options.inlineDrawingLayout,
        contentWidthForReflow,
        sourceOrderOf,
        exclusionColumnLayout
      );
      if (nextZones.size === 0) {
        converged = true;
        zonesByPage = nextZones;
        break;
      }
      const nextToken = exclusionMapsToken(nextZones);
      if (seenZoneTokens.has(nextToken)) {
        converged = true;
        zonesByPage = nextZones;
        break;
      }
      seenZoneTokens.add(nextToken);
      if (pass > 0 && exclusionMapsEqual(zonesByPage, nextZones)) {
        converged = true;
        zonesByPage = nextZones;
        break;
      }
      zonesByPage = new Map(nextZones);
    }
    if (!converged) {
      for (
        let stab = 0;
        stab < MAX_DRAWING_EXCLUSION_STABILIZATION_PASSES && !converged;
        stab += 1
      ) {
        result = layoutBlocksWithGeometry(bodies, revision, {
          ...options,
          session: undefined,
          drawingExclusionPass: MAX_DRAWING_EXCLUSION_REFLOW_PASSES + stab,
          drawingExclusionZonesByPage: zonesByPage,
        });
        const nextZones = collectExclusionZonesByPage(
          result.pages,
          options.inlineDrawingLayout,
          contentWidthForReflow,
          sourceOrderOf,
          exclusionColumnLayout
        );
        const nextToken = exclusionMapsToken(nextZones);
        if (exclusionMapsEqual(zonesByPage, nextZones) || seenZoneTokens.has(nextToken)) {
          converged = true;
          zonesByPage = nextZones;
          break;
        }
        seenZoneTokens.add(nextToken);
        zonesByPage = new Map(nextZones);
      }
    }
    if (!converged) {
      throw new DrawingExclusionConvergenceError(
        `wrap exclusion reflow did not converge within ${MAX_DRAWING_EXCLUSION_REFLOW_PASSES} passes`
      );
    }
    return layoutBlocksWithGeometry(bodies, revision, {
      ...options,
      drawingExclusionConverged: true,
      drawingExclusionZonesByPage: zonesByPage,
    });
  }

  const measurer = options.measurer;
  const cache = options.cache;
  // Defaults to a constant deliberately NAMED for the risk: fonts resolve asynchronously, so
  // a caller that swaps the measurer without changing this is served the pre-font layout for
  // the rest of the session. The style-cascade token is folded in so a different styles part
  // cannot reuse breaks measured under another inheritance table.
  const styleCascade = options.styleCascade;
  const listItems = options.listItems;
  // The default-tab interval moves every default-interval tab, and the prepared-block memo
  // is keyed by producer — so it belongs here rather than only in the per-paragraph token.
  const defaultTabStopPt = options.defaultTabStopPt;
  // The display mode changes what every paragraph contains, so it changes every break. Folding
  // it into `producer` is what makes a mode switch invalidate the break cache AND the session
  // checkpoints without a `ModelChange`: the document did not change, the projection of it did.
  const displayMode = options.displayMode ?? DEFAULT_REVISION_DISPLAY_MODE;
  const showsMarkup = displayMode === 'all-markup';
  const tocChromeParagraphIds = options.tocFieldChromeParagraphIds;
  const emptyTocPlaceholderIds = options.emptyTocPlaceholderParagraphIds;
  const emptyTocSuppressedResultIds = options.emptyTocSuppressedResultParagraphIds;
  const producer =
    (options.producer ?? 'unversioned-measurer') +
    (styleCascade ? `|sc:${styleCascade.cacheToken}` : '') +
    // In `producer`, not beside it in the section context: a note mark is measured INTO the
    // broken lines, so the break cache holds the citation's width under a key built from
    // this. Keying only the section left a warm cache serving `1`-wide slots to roman marks.
    (options.noteMarks ? `|nm:${noteMarksCacheToken(options.noteMarks)}` : '') +
    // NOT THE NUMBER OF LIST ITEMS. `producer` is in the session context, in every paragraph's
    // break-cache key and in the prepared-block memo, so folding a COUNT in meant one Enter in
    // a list re-measured every paragraph in the document and rebuilt every page — while two
    // different numbering states with the same count still hashed the same. What a numbering
    // change actually affects is each list paragraph, and each one carries its own
    // `listItem.cacheToken` in its key and in the memo above.

    (defaultTabStopPt !== undefined ? `|dts:${defaultTabStopPt}` : '') +
    (displayMode === DEFAULT_REVISION_DISPLAY_MODE ? '' : `|rev:${displayMode}`);

  // Prepass and incremental keys use the first region. Placement re-prepares a block when it
  // enters an unequal-width later column; multi-column passes conservatively skip resume.
  const contentWidth = columns.widths[0]!;

  // PAGE FURNITURE. A header taller than the top-margin remainder pushes the content area
  // down (Word's behaviour), computed as the worst case over the variants in use so the
  // content column is one height for every page. Capped at 40% of the sheet per edge: a
  // hostile header of five hundred paragraphs must not shrink the content area to nothing,
  // because pagination into a zero-height column never terminates.
  const furniture = options.furniture;
  const headerDistance = geometry.headerDistance ?? 36;
  const footerDistance = geometry.footerDistance ?? 36;
  const maxFlow = (stories: ReadonlyMap<string, HeaderFooterStoryLayout> | undefined): number => {
    let max = 0;
    for (const story of stories?.values() ?? []) max = Math.max(max, story.flowHeight);
    return max;
  };
  const furnitureCap = geometry.height * 0.4;
  const effectiveTop = Math.min(
    furnitureCap,
    Math.max(geometry.margin.top, furniture ? headerDistance + maxFlow(furniture.headers) : 0)
  );
  const effectiveBottom = Math.min(
    furnitureCap,
    Math.max(geometry.margin.bottom, furniture ? footerDistance + maxFlow(furniture.footers) : 0)
  );
  const baseContentHeight = geometry.height - effectiveTop - effectiveBottom;
  const pageBottomReserves = options.pageBottomReserves;
  const session = options.session;
  const lineCounterStart = options.lineCounterStart ?? 0;
  const furnitureContext = furnitureLayoutContext(furniture, headerDistance, footerDistance);
  const flowStartY = options.flowStartY ?? 0;
  const spaceBeforeCarry = options.spaceBeforeCarry ?? 0;
  // Where this section's first sheet lands in the DOCUMENT. Even/odd header selection
  // alternates by page number, so it is not a section-local question.
  const pageIndexStart = options.pageIndexStart ?? 0;
  const notesReserveKey = pageBottomReserves
    ? `|nr:${[...pageBottomReserves].map(([i, h]) => `${i}=${h}`).join(',')}`
    : '';
  const columnRegionBottom = options.columnRegionBottom;
  const columnsContext = `|cols:${columns.widths.join(',')};${columns.gaps.join(',')};${columns.separator ? 1 : 0}${columnRegionBottom !== undefined ? `;bal:${columnRegionBottom}` : ''}`;
  // Body line ids are paragraph-local, so a changed line count in an earlier section does
  // not invalidate this section. Geometry and flow start still do. The document page index
  // is deliberately NOT here — numbers re-project at finalize and shells renumber at remap;
  // keying on it re-laid every section below an Enter that added one page. The one real
  // dependence, page PARITY, is checked by `comparable` through the session parity fields.
  const context = `${producer}|${geometry.width}x${geometry.height}|${geometry.margin.top},${geometry.margin.right},${geometry.margin.bottom},${geometry.margin.left}|fs:${flowStartY},${spaceBeforeCarry}${furnitureContext}${notesReserveKey}${columnsContext}`;
  const startPageParity = pageIndexStart & 1;
  /** Set when this pass places an anchored drawing whose geometry reads page parity. */
  let usedPageParity = false;
  /** Cell break keys of the table currently laying out, for the retention registry. */
  let collectingCellBreakKeys: string[] | null = null;
  const markPageParityRead = (): void => {
    usedPageParity = true;
  };

  const pages: PageRecord[] = [];
  /**
   * Available body height on the page currently being filled (`pages.length`).
   *
   * A balance-search limit binds the FIRST page only: content pushed past it lands on a
   * full-height overflow page, so a block taller than the limit still terminates, and the
   * search reads "produced a second page" as "does not fit".
   */
  const contentHeight = (): number => {
    const base = Math.max(1, baseContentHeight - (pageBottomReserves?.get(pages.length) ?? 0));
    return columnRegionBottom !== undefined && pages.length === 0
      ? Math.max(1, Math.min(base, columnRegionBottom))
      : base;
  };

  // Prepass: everything needed to KEY a paragraph, before any of them is placed. Resuming
  // means knowing where the first change is, and that cannot be discovered while walking.
  //
  // Memoized on NODE IDENTITY: a paragraph the commit did not touch is the same object, and
  // its properties, indents and key derive from nothing but the node, the available width
  // and the producer. Recomputing the key — a serialization of the paragraph's subtree —
  // for every paragraph on every pass made the prepass, not placement, the cost of an
  // incremental layout: a one-character edit re-keyed the entire document.
  const prepareBlock = (block: OoxmlElement, availableWidth: number): PreparedBlock => {
    const paragraphDrawingToken =
      block.kind === 'paragraph'
        ? (options.drawingTokenForParagraph?.(block) ?? options.drawingLayoutToken ?? '')
        : block.kind === 'table' && options.drawingTokenForParagraph
          ? drawingTokenForTableBlock(block, options.drawingTokenForParagraph)
          : '';
    // A TABLE'S LIST STATE IS ITS CELLS'. `listItems` is keyed by PARAGRAPH, and a numbered
    // list that continues inside a table cell has its markers there — so reading the table's
    // own id gave an empty token, and a renumbering that left the table's flow key untouched
    // reused the cell markers verbatim. The drawing token aggregates the same way, for the
    // same reason.
    const listToken =
      block.kind === 'table'
        ? listTokenForTableBlock(block, listItems)
        : (listItems?.get(block.id)?.cacheToken ?? '');
    const memo = preparedBlocks.get(block);
    if (
      memo &&
      memo.contentWidth === availableWidth &&
      memo.producer === producer &&
      memo.drawingToken === paragraphDrawingToken &&
      memo.listToken === listToken
    ) {
      return memo.entry;
    }
    let entry: PreparedBlock;
    if (block.kind === 'table') {
      // `nodeToken` hashes the whole subtree, so one key covers every cell edit.
      entry = {
        kind: 'table',
        table: block,
        key: paragraphLayoutKey({
          paragraph: block,
          properties: [],
          width: availableWidth,
          producer,
          ...(paragraphDrawingToken ? { drawingToken: paragraphDrawingToken } : {}),
        }),
      };
    } else {
      const listItem = listItems?.get(block.id);
      const preparedParagraph = resolveParagraphLayoutInputs(
        block,
        availableWidth,
        styleCascade,
        listItem
      );
      const {
        props,
        indent,
        available,
        alignment,
        spacing,
        lineSpacing,
        contextualSpacing,
        styleId,
        shading,
        inheritedRunProperties,
        markRunProperties,
      } = preparedParagraph;
      const borders = resolveParagraphBorders(
        block.children.find((child) => child.kind === 'paragraphProperties'),
        styleCascade
      );
      const bordersToken = paragraphBordersFingerprint(borders);
      // `w:defaultTabStop` lives in settings.xml, which the paragraph cascade never reads.
      const tabStops = withDefaultTabInterval(preparedParagraph.tabStops, defaultTabStopPt);
      const tabStopsCacheToken =
        tabStops === preparedParagraph.tabStops
          ? preparedParagraph.tabStopsCacheToken
          : tabStopsFingerprint(tabStops);
      entry = {
        kind: 'paragraph',
        paragraph: block,
        props,
        indent,
        available,
        alignment,
        spacing,
        lineSpacing,
        contextualSpacing,
        styleId,
        borders,
        borderGroupKey:
          bordersToken === '' ? '' : `${bordersToken}@${indent.left},${indent.left + available}`,
        shading,
        inheritedRunProperties,
        markRunProperties,
        tabStops,
        keeps: paragraphKeeps(props),
        ...(listItem ? { listItem } : {}),
        key: paragraphLayoutKey({
          paragraph: block,
          properties: [
            ...props,
            ...inheritedRunProperties,
            ...markRunProperties,
            { localName: 'tabStops', attributes: { token: tabStopsCacheToken } },
            ...(listItem
              ? [{ localName: 'list', attributes: { token: listItem.cacheToken } }]
              : []),
          ],
          width: available,
          producer,
          ...(paragraphDrawingToken ? { drawingToken: paragraphDrawingToken } : {}),
        }),
      };
    }
    preparedBlocks.set(block, {
      contentWidth: availableWidth,
      producer,
      drawingToken: paragraphDrawingToken,
      listToken,
      entry,
    });
    return entry;
  };
  // SECTION PREPASS MEMO. Everything derived below is a pure function of the block list
  // plus the inputs the memo compares, and on a typing pass in a many-section document
  // every section but the edited one has an IDENTICAL block list — while rebuilding these
  // arrays anyway made the prepass, not placement, the floor cost of a keystroke.
  // `drawingLayoutEpoch` stands in for the per-block drawing tokens (the epoch moves
  // whenever any drawing projection or resource in the part does); a caller that threads
  // per-paragraph drawing tokens WITHOUT an epoch keeps the recompute path, because the
  // memo could not see a token move.
  const drawingEpoch =
    options.drawingTokenForParagraph === undefined && options.drawingLayoutToken === undefined
      ? (options.drawingLayoutEpoch ?? '')
      : (options.drawingLayoutEpoch ?? null);
  const prepassMemo = session?.prepass as SectionPrepass | null | undefined;
  const prepassValid =
    prepassMemo != null &&
    drawingEpoch !== null &&
    prepassMemo.drawingEpoch === drawingEpoch &&
    prepassMemo.producer === producer &&
    prepassMemo.contentWidth === contentWidth &&
    prepassMemo.styleCascade === styleCascade &&
    prepassMemo.listItems === listItems &&
    prepassMemo.bodies.length === bodies.length &&
    prepassMemo.bodies.every((block, index) => block === bodies[index]);
  const prepass: SectionPrepass = prepassValid ? prepassMemo : buildSectionPrepass();
  function buildSectionPrepass(): SectionPrepass {
    const prepared = bodies.map((block) => prepareBlock(block, contentWidth));
    const keys = prepared.map((entry) => entry.key);
    const keepsNext = prepared.map((entry) => entry.kind === 'paragraph' && entry.keeps.keepNext);
    const markerTexts = prepared.map((entry) =>
      entry.kind === 'paragraph' ? listItems?.get(entry.paragraph.id)?.markerText : undefined
    );
    // The two inputs `w:contextualSpacing` reads from the blocks on either side. A table
    // answers null, which is what `sameStyleAs` means by "not a paragraph of this style".
    const contextualSpacings = prepared.map(
      (entry) => entry.kind === 'paragraph' && entry.contextualSpacing
    );
    const styleIds = prepared.map((entry) => (entry.kind === 'paragraph' ? entry.styleId : null));
    return {
      bodies,
      producer,
      contentWidth,
      styleCascade,
      listItems,
      drawingEpoch: drawingEpoch ?? '',
      prepared,
      keys,
      paragraphDocumentOrder: paragraphDocumentOrderOf(
        prepared,
        contentWidth,
        styleCascade,
        displayMode
      ),
      keepsNext,
      markerTexts,
      // FLOW keys — what incremental resume compares. `keys` stays what the break cache is
      // stored under; the CROSS-BLOCK properties make the two differ: `w:keepNext`
      // (§17.3.1.15), the list marker, and `w:contextualSpacing` (§17.3.1.9), each of which
      // makes a block's placement depend on a block it does not contain.
      flowKeys: listMarkerFlowKeys(
        contextualSpacingFlowKeys(
          keepNextFlowKeys(keys, (index) => keepsNext[index]!),
          (index) => contextualSpacings[index]!,
          (index) => styleIds[index] ?? null
        ),
        (index) => markerTexts[index]
      ),
    };
  }
  if (session && drawingEpoch !== null && !prepassValid) session.prepass = prepass;
  const { prepared, keys, paragraphDocumentOrder, keepsNext, flowKeys } = prepass;
  /** Retain the whole document's live keys — block keys plus recorded table-cell keys. */
  const publishRetainedKeys = (): void => {
    // `false` is the orchestrator saying this pass skips the sweep; a standalone pass asks
    // its own cache's stride.
    if (options.retainKeys === false) return;
    if (options.retainKeys === undefined && cache && !(cache.retentionPassDue?.() ?? true)) {
      return;
    }
    retainLiveBreakKeys(
      cache,
      options.retainKeys,
      keys,
      prepared.flatMap((entry) => (entry.kind === 'table' ? [entry.table] : []))
    );
  };
  const previous = session?.previous ?? null;
  // A geometry or producer change invalidates every checkpoint, because it moves every
  // break; resuming from one would place new content against a stale flow. A parity flip
  // only matters when the previous pass actually read parity (even/odd headers or an
  // inside/outside-anchored drawing).
  const comparable =
    previous !== null &&
    session !== undefined &&
    session.context === context &&
    (!session.parityDependent || session.startPageParity === startPageParity);
  const resumable = columns.count === 1 && comparable;

  /** The first paragraph whose layout inputs differ from the previous pass. */
  let firstChanged = 0;
  if (comparable) {
    const limit = Math.min(flowKeys.length, session.keys.length);
    while (firstChanged < limit && flowKeys[firstChanged] === session.keys[firstChanged]) {
      firstChanged += 1;
    }
  }

  /**
   * How many trailing paragraphs are unchanged.
   *
   * Where the flow may reconverge: everything after an edit can only be reused verbatim if
   * it is the same content AND lands in the same place, and this bounds the first half of
   * that question.
   */
  let commonSuffix = 0;
  if (resumable) {
    const maxSuffix = Math.min(flowKeys.length, session.keys.length) - firstChanged;
    while (
      commonSuffix < maxSuffix &&
      flowKeys[flowKeys.length - 1 - commonSuffix] ===
        session.keys[session.keys.length - 1 - commonSuffix]
    ) {
      commonSuffix += 1;
    }
  }

  // NOTHING CHANGED. Every key matches and the document is the same length, so the previous
  // layout still describes it exactly — re-placing it would allocate a second set of
  // identical records and destroy the identity a consumer uses to skip repainting.
  if (comparable && firstChanged === prepared.length && prepared.length === session.keys.length) {
    // Keep prior content-control boundaries: `finish` re-attaches them and must see the same
    // token/list to return `pages` by identity rather than mapping a twin array.
    const unchanged: SemanticLayout = withContentControlMetadata(
      { revision, pages: previous!.pages },
      previous!
    );
    const translatedEndLineCounter =
      lineCounterStart + (session.endLineCounter - session.startLineCounter);
    session.previous = unchanged;
    session.startLineCounter = lineCounterStart;
    session.endLineCounter = translatedEndLineCounter;
    // `comparable` already required parity equality whenever the session depends on it.
    session.startPageParity = startPageParity;
    session.stats = {
      placed: 0,
      total: prepared.length,
      reusedPages: previous!.pages.length,
      fullPasses: session.stats.fullPasses,
    };
    publishRetainedKeys();
    return {
      layout: unchanged,
      pages: unchanged.pages,
      lineCounter: translatedEndLineCounter,
      endCursorY: session.endCursorY,
      endSpaceAfter: session.endSpaceAfter,
      endsOpenPage: session.endsOpenPage,
    };
  }

  let pageFragments: BlockFragmentRecord[] = [];
  let columnIndex = 0;
  let regionFragmentStart = 0;
  const columnLeft = (): number => columns.lefts[columnIndex]!;
  const columnWidth = (): number => columns.widths[columnIndex]!;
  /**
   * The boxes `w:horzAnchor` can name, in the content-box coordinates every fragment box is
   * reported in: x=0 is the left margin, so the sheet starts one left margin before it.
   */
  const anchorFrames = (): TableAnchorFrames => ({
    text: { left: columnLeft(), width: columnWidth() },
    margin: { left: 0, width: contentWidthForReflow },
    page: { left: -geometry.margin.left, width: geometry.width },
  });
  const regionHasFragments = (): boolean => pageFragments.length > regionFragmentStart;
  let pendingAnchoredDrawings: AnchoredDrawingRecord[] = [];
  let deferredAnchoredDrawings: AnchoredDrawingRecord[] = [];
  const anchorPageDeferCounts = new Map<string, number>();
  // A continuous section resumes the previous section's column rather than opening a
  // sheet, so its first block starts at that column's used height and its first paragraph
  // is NOT at a page top — page-top space-before suppression must not apply to it, and the
  // preceding paragraph's space-after still collapses against its space-before.
  let cursorY = flowStartY;
  // A continuous section can open its column region below content already on the sheet.
  let columnRegionTop = flowStartY;
  let flowColumnIndex = 0;
  let lineCounter = lineCounterStart;
  let previousSpaceAfter = spaceBeforeCarry;
  const checkpoints: FlowCheckpoint[] = [];
  /** The flow as it stands: what a later pass resumes from and converges against. The
   * deferred anchor state is copied only when there is some — this runs once per block. */
  const checkpointNow = (): FlowCheckpoint => ({
    pageCount: pages.length,
    pageFragments: [...pageFragments],
    pendingAnchoredDrawings: [...pendingAnchoredDrawings],
    deferredAnchoredDrawings:
      deferredAnchoredDrawings.length > 0 ? [...deferredAnchoredDrawings] : NO_DEFERRED_DRAWINGS,
    anchorPageDeferCounts:
      anchorPageDeferCounts.size > 0 ? new Map(anchorPageDeferCounts) : NO_DEFER_COUNTS,
    cursorY,
    lineCounter,
    previousSpaceAfter,
    flowColumnIndex,
  });
  let startIndex = 0;
  let placed = 0;
  let reusedPages = 0;
  let firstParagraphOfSection = flowStartY === 0;

  // RESUME. The checkpoint before the first changed paragraph describes a flow the new
  // document still agrees with, so the pages completed by then are carried over by
  // REFERENCE — unchanged pages keep their identity, which is what lets a consumer skip
  // repainting them (task 9.4).
  if (resumable && firstChanged > 0 && firstChanged < session.checkpoints.length) {
    const checkpoint = session.checkpoints[firstChanged]!;
    pages.push(...previous!.pages.slice(0, checkpoint.pageCount));
    pageFragments = [...checkpoint.pageFragments];
    pendingAnchoredDrawings = [...checkpoint.pendingAnchoredDrawings];
    deferredAnchoredDrawings = [...checkpoint.deferredAnchoredDrawings];
    anchorPageDeferCounts.clear();
    for (const [id, n] of checkpoint.anchorPageDeferCounts) anchorPageDeferCounts.set(id, n);
    cursorY = checkpoint.cursorY;
    flowColumnIndex = checkpoint.flowColumnIndex;
    columnIndex = checkpoint.flowColumnIndex;
    lineCounter = checkpoint.lineCounter;
    previousSpaceAfter = checkpoint.previousSpaceAfter;
    startIndex = firstChanged;
    firstParagraphOfSection = false;
    reusedPages = pages.length;
    checkpoints.push(...session.checkpoints.slice(0, firstChanged));
  }

  const pageBox = (index: number): LayoutBox => ({
    x: 0,
    y: index * (geometry.height + 24), // 24pt gutter between sheets, for the scroll surface
    width: geometry.width,
    height: geometry.height,
  });

  /**
   * The variant page `index` shows: title page first, then even/odd when declared.
   *
   * `w:titlePg` (17.6.55) is a property of the SECTION, so its first page is the section's
   * own first — the local index. `w:evenAndOddHeaders` (17.10.1) lives in settings.xml and
   * alternates by the page's number in the DOCUMENT, so it reads through `pageIndexStart`:
   * a section that begins on an even page must open with the even header, and `remapPage`
   * renumbers a page without ever re-picking its variant.
   */
  const variantFor = (index: number): HeaderFooterVariantName =>
    furniture?.titlePage && index === 0
      ? 'first'
      : furniture?.evenAndOddHeaders && (pageIndexStart + index + 1) % 2 === 0
        ? 'even'
        : 'default';

  const furnitureFor = (
    kind: 'header' | 'footer',
    index: number,
    box: LayoutBox
  ): HeaderFooterStoryRecord | undefined => {
    if (!furniture) return undefined;
    const variant = variantFor(index);
    const story = (kind === 'header' ? furniture.headers : furniture.footers).get(variant);
    // An absent variant shows nothing — Word falls back to blank, not to `default`.
    if (!story) return undefined;
    const place = (laid: HeaderFooterStoryLayout): HeaderFooterStoryRecord => {
      const y =
        kind === 'header'
          ? box.y + headerDistance
          : box.y + geometry.height - footerDistance - laid.flowHeight;
      return {
        kind,
        variant,
        partName: laid.partName,
        ...(laid.rId ? { rId: laid.rId } : {}),
        box: {
          x: box.x + geometry.margin.left,
          y,
          width: contentWidthForReflow,
          height: laid.flowHeight,
        },
        fragments: laid.fragments,
        ...(laid.anchoredDrawings ? { anchoredDrawings: laid.anchoredDrawings } : {}),
      };
    };
    const pageNumber = pageIndexStart + index + 1;
    const pageContext: import('./field-projection.ts').FieldPageContext = {
      pageNumber,
      pageCount: Math.max(pageNumber, pages.length + 1),
      sectionPageCount: index + 1,
    };
    const needs = story.pageFieldNeeds;
    const needsPerPageLayout =
      storyNeedsPageFields(needs) || (story.anchoredDrawings?.length ?? 0) > 0;
    const laid = needsPerPageLayout ? story.withPageContext(pageContext) : story;
    const placed = place(laid);
    if (storyNeedsPageFields(needs)) {
      return {
        ...placed,
        pageFieldProjector: (context) => place(story.withPageContext(context)),
      };
    }
    return placed;
  };

  const columnCount = columns.count;
  const columnOffsetX = columnLeft;

  const anchorColumnBox = (_paragraphBox: LayoutBox): LayoutBox =>
    Object.freeze({
      x: columns.lefts[flowColumnIndex] ?? 0,
      y: _paragraphBox.y,
      width: columns.widths[flowColumnIndex] ?? contentWidth,
      height: _paragraphBox.height,
    });

  const anchorFrameBase = (): Omit<
    DrawingAnchorFrameContext,
    'paragraphBox' | 'anchorLineBox' | 'anchorCharacterX' | 'columnBox' | 'cellBox' | 'layoutInCell'
  > =>
    Object.freeze({
      pageNumber: pageIndexStart + pages.length + 1,
      onPageParityRead: markPageParityRead,
      pageWidth: geometry.width,
      pageHeight: geometry.height,
      marginLeft: geometry.margin.left,
      marginRight: geometry.margin.right,
      marginBottom: geometry.margin.bottom,
      // THE INSETS, NOT `w:pgMar`. The page content box starts at `effectiveTop`, which a
      // header taller than the top margin pushes past it, and paint places every anchored
      // drawing relative to that box. Handing the authored margin here made a
      // `relativeFrom="page"` anchor land `effectiveTop − margin.top` too low — the whole
      // header height for a `w:posOffset` of 0 (#274).
      contentInsetTop: effectiveTop,
      contentInsetBottom: effectiveBottom,
      contentWidth,
      contentHeight: contentHeight(),
      contentBandHeight: baseContentHeight,
      ownerPartName: options.inlineDrawingLayout?.ownerPartName ?? WML_MAIN_DOCUMENT_PART,
      storyKind: 'body',
    });

  const pageContentClip = (): LayoutBox => pageClipRegion(anchorFrameBase());

  const sourceOrderOf = (drawingNodeId: string): number | undefined =>
    options.drawingSourceOrder?.get(drawingNodeId);

  const collectAnchoredDrawings = (drawings: readonly AnchoredDrawingRecord[]): void => {
    if (drawings.length === 0) return;
    for (const drawing of drawings) {
      if (
        pendingAnchoredDrawings.some((existing) => existing.drawingNodeId === drawing.drawingNodeId)
      ) {
        continue;
      }
      pendingAnchoredDrawings.push(
        drawing.sourceOrder === undefined && sourceOrderOf(drawing.drawingNodeId) !== undefined
          ? Object.freeze({ ...drawing, sourceOrder: sourceOrderOf(drawing.drawingNodeId) })
          : drawing
      );
    }
    if (!options.inlineDrawingLayout) return;
    const resolved = resolveOverlapDisplacement(pendingAnchoredDrawings, {
      pageBottom: contentHeight(),
    });
    pendingAnchoredDrawings.splice(0, pendingAnchoredDrawings.length, ...resolved.drawings);
    if (resolved.deferred.length > 0) {
      for (const drawing of resolved.deferred) {
        const count = (anchorPageDeferCounts.get(drawing.drawingNodeId) ?? 0) + 1;
        anchorPageDeferCounts.set(drawing.drawingNodeId, count);
        if (count >= MAX_ANCHOR_PAGE_DEFERRALS) {
          pendingAnchoredDrawings.push(
            withAnchoredDrawingLayoutFallback(drawing, 'page-defer-exhausted')
          );
        } else {
          deferredAnchoredDrawings.push(drawing);
        }
      }
    }
  };

  const carryDeferredToNextPage = (): void => {
    if (deferredAnchoredDrawings.length === 0) return;
    const carried = deferredAnchoredDrawings.map((drawing) =>
      shiftAnchoredDrawingY(drawing, cursorY - drawing.y)
    );
    deferredAnchoredDrawings = [];
    collectAnchoredDrawings(carried);
  };

  const flushPage = (): void => {
    const index = pages.length;
    const box = pageBox(index);
    const header = furnitureFor('header', index, box);
    const footer = furnitureFor('footer', index, box);
    const { usedBottom, hasBodyPageFields } = summarizeFlushedPage(pageFragments, columnRegionTop);
    pages.push({
      id: `page-${index}`,
      index,
      box,
      contentBox: {
        x: box.x + geometry.margin.left,
        y: box.y + effectiveTop,
        width: contentWidthForReflow,
        height: baseContentHeight,
      },
      fragments: pageFragments,
      hasBodyPageFields,
      ...(columns.separator
        ? {
            columnSeparators: columns.gaps.map((gap, separatorIndex) => ({
              x: columns.lefts[separatorIndex]! + columns.widths[separatorIndex]! + gap / 2 - 0.375,
              y: columnRegionTop,
              width: 0.75,
              height: Math.max(0, usedBottom - columnRegionTop),
            })),
          }
        : {}),
      ...(pendingAnchoredDrawings.length > 0
        ? { anchoredDrawings: sortDrawingsForPaint(pendingAnchoredDrawings) }
        : {}),
      ...(header ? { header } : {}),
      ...(footer ? { footer } : {}),
    });
    pageFragments = [];
    pendingAnchoredDrawings = [];
    cursorY = 0;
    columnIndex = 0;
    flowColumnIndex = 0;
    columnRegionTop = 0;
    regionFragmentStart = 0;
  };

  /**
   * Whether a laid-out paragraph would put nothing on the sheet.
   *
   * Asked of a section break mark before letting it skip pagination, so the exemption covers
   * only a mark with nothing to show: any glyph, marker, drawing, rule or shading makes the
   * paragraph content, and content paginates.
   */
  const paintsNothing = (entry: PreparedBlock, lines: readonly PendingLine[]): boolean => {
    if (entry.kind !== 'paragraph') return false;
    if (entry.listItem !== undefined || entry.shading !== undefined) return false;
    const { top, bottom, left, right, between } = entry.borders;
    if (top ?? bottom ?? left ?? right ?? between) return false;
    const drawingContext = options.inlineDrawingLayout;
    if (
      drawingContext &&
      anchoredDrawingAtomsInParagraph(entry.paragraph, drawingContext).length > 0
    ) {
      return false;
    }
    return lines.every(
      (line) =>
        line.drawings.length === 0 &&
        !line.pageBreakAfter &&
        !line.columnBreakAfter &&
        line.spans.every((span) => span.text.length === 0)
    );
  };

  const advanceColumn = (): void => {
    if (columnIndex + 1 < columns.count) {
      columnIndex += 1;
      flowColumnIndex = columnIndex;
      cursorY = columnRegionTop;
      previousSpaceAfter = 0;
      regionFragmentStart = pageFragments.length;
      return;
    }
    flushPage();
    carryDeferredToNextPage();
  };

  // Body textbox stories flow without a page-field context: body PAGE projection stays
  // deferred, so a PAGE field inside a body text box contributes only its cached result,
  // consistent with direct body fields today.
  const layoutTextboxStoryForBody = (
    projection: import('../store/package/drawing-projection.ts').DrawingProjection
  ) =>
    layoutTextboxStory(projection, {
      measurer,
      producer,
      cache,
      styleCascade,
      ...(defaultTabStopPt !== undefined ? { defaultTabStopPt } : {}),
      ...(displayMode ? { displayMode } : {}),
      ...(options.documentProperties ? { documentProperties: options.documentProperties } : {}),
      inlineDrawingLayout: options.inlineDrawingLayout,
      drawingTokenForParagraph: options.drawingTokenForParagraph,
    });

  // Table layout shares the flow's line count, paragraph cache, and precomputed list items
  // (counters already advanced in document order, including cell paragraphs).
  // Border ownership intervals and vMerge cell visits are budgeted once per pass so nested
  // finalize cannot amplify past the shared ceilings.
  const tableDeps: TableFlowDeps = {
    measurer,
    cache,
    producer,
    // Recorded per table node, so retention can name cell entries of tables a later
    // resumed pass never places.
    onCellBreakKey: (key) => void collectingCellBreakKeys?.push(key),
    nextLineId: (paragraphId, start, lineIndex, occurrence) => {
      lineCounter += 1;
      return bodyLineId(paragraphId, start, lineIndex, occurrence);
    },
    // SECTION-LOCAL page index: the occurrence only disambiguates the same header row
    // across this section's own pages, and an absolute index went stale on any remap.
    pageOccurrenceKey: () => String(pages.length),
    styleCascade,
    listItems,
    ...(defaultTabStopPt !== undefined ? { defaultTabStopPt } : {}),
    ...(options.projectLink ? { projectLink: options.projectLink } : {}),
    ...(options.projectFieldLink ? { projectFieldLink: options.projectFieldLink } : {}),
    ...(options.documentProperties ? { documentProperties: options.documentProperties } : {}),
    // Body flow: page fields in table cells paint a placeholder for document finalize to fill.
    bodyPageFields: true,
    ...(options.noteMarks ? { noteMarks: options.noteMarks } : {}),
    ...(options.inlineDrawingLayout ? { inlineDrawingLayout: options.inlineDrawingLayout } : {}),
    ...(options.drawingTokenForParagraph
      ? { drawingTokenForParagraph: options.drawingTokenForParagraph }
      : options.drawingLayoutToken
        ? { drawingLayoutToken: options.drawingLayoutToken }
        : {}),
    ...(options.inlineDrawingLayout
      ? {
          anchorFrameBase,
          pageContentClip,
          layoutTextboxStoryFor: layoutTextboxStoryForBody,
          publishAnchoredDrawings: collectAnchoredDrawings,
          collectAnchoredDrawings,
          columnBoxForParagraph: anchorColumnBox,
          pageExclusionZones: () =>
            options.drawingExclusionZonesByPage?.get(pages.length) ?? Object.freeze([]),
          paragraphOrderIndex: (paragraphId) => paragraphDocumentOrder.get(paragraphId),
          onAnchorShift: (paragraphId, dy) =>
            shiftAnchoredDrawingRecords(pendingAnchoredDrawings, paragraphId, dy),
          onAnchorRepublish: (paragraphId, drawings) => {
            for (let index = pendingAnchoredDrawings.length - 1; index >= 0; index -= 1) {
              if (pendingAnchoredDrawings[index]!.anchorParagraphId === paragraphId) {
                pendingAnchoredDrawings.splice(index, 1);
              }
            }
            pendingAnchoredDrawings.push(...drawings);
          },
        }
      : {}),
    borderOwnershipBudget: createTableBorderOwnershipBudget(),
    vMergeResolveBudget: createTableVMergeResolveBudget(),
    displayMode,
  };

  type PreparedParagraph = Extract<PreparedBlock, { kind: 'paragraph' }>;

  // Current-pass list map first, so marker ordinals stay fresh when the memo reuses inputs.
  const firstLineOffsetOf = (entry: PreparedParagraph): number =>
    firstLineShift(
      listItems?.get(entry.paragraph.id) ?? entry.listItem,
      entry.indent,
      measurer,
      entry.tabStops,
      entry.available
    );

  // Shared by placement and by the `w:keepNext` lookahead, which needs the height of the
  // blocks it keeps WITH. Both read the same cache entry, so the lookahead re-measures nothing.
  const breakBlock = (entry: PreparedParagraph, entryIndex: number, startOffset = 0) => {
    const paragraphId = entry.paragraph.id;
    const keepEmptyTocPlaceholder = emptyTocPlaceholderIds?.has(paragraphId) ?? false;
    const suppressChrome =
      !keepEmptyTocPlaceholder &&
      ((tocChromeParagraphIds?.has(paragraphId) ?? false) ||
        (emptyTocSuppressedResultIds?.has(paragraphId) ?? false));
    const available = entry.available;
    const columnX = columnOffsetX();
    const allPageZones =
      options.drawingExclusionZonesByPage?.get(pages.length) ?? Object.freeze([]);
    const pageZones = allPageZones.filter((zone) => {
      const entryOrder = paragraphDocumentOrder.get(entry.paragraph.id);
      const anchorOrder = paragraphDocumentOrder.get(zone.anchorParagraphId);
      if (entryOrder !== undefined && anchorOrder !== undefined) {
        if (anchorOrder > entryOrder) return false;
      } else {
        const anchorIndex = prepared.findIndex(
          (block) => block.kind === 'paragraph' && block.paragraph.id === zone.anchorParagraphId
        );
        if (anchorIndex < 0 || anchorIndex > entryIndex) return false;
      }
      if (columnCount > 1 && zone.columnIndex !== flowColumnIndex) return false;
      return true;
    });
    const exclusionToken = exclusionLayoutToken(pageZones);
    const drawingKeyed =
      options.drawingTokenForParagraph?.(entry.paragraph) ??
      options.drawingLayoutToken ??
      (options.inlineDrawingLayout ? 'drawing' : undefined);
    const cacheKey =
      cache && !suppressChrome
        ? exclusionToken || drawingKeyed
          ? paragraphLayoutKey({
              paragraph: entry.paragraph,
              properties: entry.props,
              width: available,
              producer,
              ...(drawingKeyed ? { drawingToken: drawingKeyed } : {}),
              // `cursorY` belongs in the key: the zones are page-content bands, so the same
              // text at the same width breaks differently depending on where down the page
              // it starts. Keying on zone geometry alone lets a paragraph clear of the float
              // reuse the wrapped break of an identical one that crosses it.
              ...(exclusionToken
                ? { exclusionToken: `${flowColumnIndex}|${cursorY.toFixed(3)}|${exclusionToken}` }
                : {}),
              ...(startOffset > 0 ? { startOffset } : {}),
            })
          : startOffset === 0
            ? entry.key
            : `${entry.key}|from:${startOffset}`
        : null;
    const usePageColumnCoords = columnCount > 1;
    return breakParagraph(
      entry.paragraph,
      paragraphId,
      entry.indent.left,
      available,
      measurer,
      cache,
      cacheKey,
      entry.inheritedRunProperties,
      entry.tabStops,
      undefined,
      styleCascade
        ? (inherited: readonly OoxmlProperty[], direct: readonly OoxmlProperty[]) =>
            cascadeRunProperties(inherited, direct, styleCascade)
        : undefined,
      {
        lineSpacing: entry.lineSpacing,
        firstLineOffset: startOffset === 0 ? firstLineOffsetOf(entry) : 0,
        startOffset,
        marginExtent: { left: 0, right: entry.indent.left + available + entry.indent.right },
        ...(options.projectLink ? { projectLink: options.projectLink } : {}),
        ...(options.projectFieldLink ? { projectFieldLink: options.projectFieldLink } : {}),
        ...(options.documentProperties ? { documentProperties: options.documentProperties } : {}),
        // Body flow: an empty-cache page field paints a placeholder finalize substitutes per page.
        bodyPageFields: true,
        displayMode,
        ...(options.noteMarks ? { noteMarks: options.noteMarks } : {}),
        ...(options.inlineDrawingLayout
          ? { inlineDrawingLayout: options.inlineDrawingLayout }
          : {}),
        contentLeft: usePageColumnCoords ? columnX : 0,
        contentRight: usePageColumnCoords
          ? columnX + columnWidth()
          : entry.indent.left + available + entry.indent.right,
        paragraphStartY: cursorY,
        ...(pageZones.length > 0 ? { pageExclusionZones: pageZones } : {}),
        ...(suppressChrome ? { suppressEmptyPlaceholderLine: true } : {}),
        ...(styleCascade ? { themeFonts: styleCascade.themeFonts } : {}),
        markRunProperties: entry.markRunProperties,
      }
    );
  };

  const pageExclusionZonesForEntry = (
    entry: PreparedParagraph,
    entryIndex: number
  ): readonly ExclusionZone[] => {
    const allPageZones =
      options.drawingExclusionZonesByPage?.get(pages.length) ?? Object.freeze([]);
    return allPageZones.filter((zone) => {
      const entryOrder = paragraphDocumentOrder.get(entry.paragraph.id);
      const anchorOrder = paragraphDocumentOrder.get(zone.anchorParagraphId);
      if (entryOrder !== undefined && anchorOrder !== undefined) {
        if (anchorOrder > entryOrder) return false;
      } else {
        const anchorIndex = prepared.findIndex(
          (block) => block.kind === 'paragraph' && block.paragraph.id === zone.anchorParagraphId
        );
        if (anchorIndex < 0 || anchorIndex > entryIndex) return false;
      }
      if (columnCount > 1 && zone.columnIndex !== flowColumnIndex) return false;
      if (zone.anchorParagraphId === entry.paragraph.id && zone.input.mode === 'topAndBottom') {
        return false;
      }
      return true;
    });
  };

  const placementZonesForLine = (
    entry: PreparedParagraph,
    entryIndex: number,
    brokenLines: readonly PendingLine[],
    lineIndex: number,
    fragmentFirstLine: number,
    fragmentParagraphStartY: number,
    appliedSkipByLineIndex: ReadonlyMap<number, number>
  ): readonly ExclusionZone[] => {
    const pageZones = pageExclusionZonesForEntry(entry, entryIndex);
    if (!options.inlineDrawingLayout || lineIndex <= fragmentFirstLine) return pageZones;
    const offsets = drawingModelOffsetsInParagraph(entry.paragraph);
    const anchorLineTopByModelStart = new Map<number, number>();
    let extent = 0;
    for (let index = fragmentFirstLine; index < lineIndex; index += 1) {
      const brokenLine = brokenLines[index]!;
      for (const modelStart of offsets.values()) {
        if (modelStart >= brokenLine.start && modelStart < brokenLine.end) {
          anchorLineTopByModelStart.set(modelStart, extent);
        }
      }
      const skip =
        appliedSkipByLineIndex.get(index) ?? brokenLines[index]!.exclusionSkipBefore ?? 0;
      extent += skip + brokenLines[index]!.height;
    }
    if (anchorLineTopByModelStart.size === 0) return pageZones;
    const usePageColumnCoords = columnCount > 1;
    const available = entry.available;
    const columnX = columnOffsetX();
    const synthesized = synthesizeParagraphTopAndBottomZones({
      paragraph: entry.paragraph,
      paragraphId: entry.paragraph.id,
      drawingLayout: options.inlineDrawingLayout,
      contentLeft: usePageColumnCoords ? columnX : 0,
      contentRight: usePageColumnCoords
        ? columnX + columnWidth()
        : entry.indent.left + available + entry.indent.right,
      paragraphStartY: fragmentParagraphStartY,
      anchorLineTopByModelStart,
      columnIndex: flowColumnIndex,
    });
    return Object.freeze([...pageZones, ...synthesized]);
  };

  const placementSkipBefore = (
    entry: PreparedParagraph,
    entryIndex: number,
    brokenLines: readonly PendingLine[],
    lineIndex: number,
    fragmentFirstLine: number,
    fragmentParagraphStartY: number,
    pendingLine: PendingLine,
    appliedSkipByLineIndex: ReadonlyMap<number, number>
  ): number => {
    if (options.inlineDrawingLayout) {
      const anchorStarts = [...drawingModelOffsetsInParagraph(entry.paragraph).values()];
      if (anchorStarts.length > 0) {
        const firstAnchor = Math.min(...anchorStarts);
        if (pendingLine.end <= firstAnchor) return 0;
        if (
          anchorStarts.some((start) => start >= pendingLine.start && start < pendingLine.end) &&
          pendingLine.end <= firstAnchor + 1
        ) {
          return 0;
        }
      }
    }
    const zones = placementZonesForLine(
      entry,
      entryIndex,
      brokenLines,
      lineIndex,
      fragmentFirstLine,
      fragmentParagraphStartY,
      appliedSkipByLineIndex
    );
    const live =
      zones.length > 0 ? topAndBottomSkipBeforeLine(cursorY, pendingLine.height, zones) : 0;
    const breakSkip = pendingLine.exclusionSkipBefore ?? 0;
    return live > 0.001 ? live : breakSkip;
  };

  /**
   * Lay out one top-level table with OOXML-aligned row pagination.
   *
   * Preflights the real unsplit row height (not a one-line estimate). A row that fits on a
   * fresh page but not the current remainder moves whole. A row taller than a fresh page
   * fragments at paragraph/line boundaries when splittable; `w:cantSplit` and unsafe nested
   * cuts fail closed via {@link TablePaginationError} instead of overflowing contentHeight().
   * Contiguous leading `w:tblHeader` rows form one atomic repeated group: preflighted and
   * placed together, moved whole when the remainder is too short, re-emitted complete atop
   * each continuation page, and rejected when the group itself exceeds a fresh content page.
   */
  const layoutTableInFlow = (table: OoxmlElement): void => {
    const regionWidth = columnWidth();
    const structure = readTableStructure(table, regionWidth, 0, styleCascade, displayMode);
    if (!structure || structure.rows.length === 0) return;
    // `w:tblInd` / `w:jc` place the table inside the text column, `w:tblpPr` against a wider
    // anchor box; every row and the fragment box share the one origin so cell geometry and
    // the reported box cannot drift apart.
    const tableWidthPt = structure.columnWidthsPt.reduce((sum, column) => sum + column, 0);
    const originX = (): number =>
      structure.float
        ? tableFloatOriginX(structure.float, tableWidthPt, anchorFrames())
        : columnLeft() + tableOriginX(structure, columnWidth());
    let tableLeft = originX();
    // `w:tblpY` against the text anchor is an offset from where the table would otherwise
    // sit, so it moves the table within the flow. The page and margin anchors state an
    // absolute position on the sheet, which this layout does not model — those stay in flow.
    if (structure.float && structure.float.vertAnchor === 'text' && !structure.float.ySpec) {
      cursorY = Math.max(0, Math.min(cursorY + structure.float.yPt, contentHeight()));
    }
    const headerRows: SemanticTableRow[] = [];
    for (const row of structure.rows) {
      if (row.isHeader) headerRows.push(row);
      else break;
    }
    let fragmentIndex = 0;
    let fragmentTop = cursorY;
    let rows: TableRowFragmentRecord[] = [];
    const rowOrdinals = new Map<string, number>();
    // Authored rows backing the open fragment (includes header repeats) for finalize.
    let sourceRows: (typeof structure.rows)[number][] = [];
    const closeTableFragment = (): void => {
      if (rows.length === 0) return;
      const finalized = finalizeTableRows(
        rows,
        structure,
        sourceRows,
        tableDeps.borderOwnershipBudget,
        tableDeps.vMergeResolveBudget,
        undefined,
        (paragraphId, dy) => {
          shiftAnchoredDrawingRecords(pendingAnchoredDrawings, paragraphId, dy);
        },
        tableDeps
      );
      const last = finalized[finalized.length - 1]!;
      pageFragments.push(
        annotateTableFragmentGeometry(
          {
            kind: 'table',
            id: `${table.id}#f${fragmentIndex}`,
            tableId: table.id,
            fragmentIndex,
            rows: finalized,
            box: {
              x: tableLeft,
              y: fragmentTop,
              width: structure.columnWidthsPt.reduce((sum, columnWidth) => sum + columnWidth, 0),
              height: last.box.y + last.box.height - fragmentTop,
            },
          },
          structure.columnWidthsPt,
          0,
          rowOrdinals
        )
      );
      fragmentIndex += 1;
      rows = [];
      sourceRows = [];
    };

    /**
     * Place the contiguous leading header rows as one group. Never splits the group across
     * pages; fails closed when the group itself is taller than a fresh content page.
     */
    const placeHeaderGroup = (asRepeat: boolean): void => {
      if (headerRows.length === 0) return;

      let groupHeight = 0;
      for (const headerRow of headerRows) {
        groupHeight += measureRowHeight(
          headerRow,
          structure.columnWidthsPt,
          tableLeft,
          0,
          tableDeps,
          structure.cellSpacingPt
        );
      }
      if (groupHeight > contentHeight() + 0.001) {
        throw new TablePaginationError(
          'table-row-overheight',
          `Table header group (${headerRows.length} row(s)) is taller than the page content box`
        );
      }
      if (cursorY + groupHeight > contentHeight() + 0.001 && cursorY > 0) {
        closeTableFragment();
        advanceColumn();
        tableLeft = originX();
        // The cursor, not 0: a same-sheet column advance opens at the column REGION top
        // (a continuous section shares its sheet), and a fragment box anchored at 0 would
        // stretch over whatever the earlier section already painted above the region.
        fragmentTop = cursorY;
      }

      for (const headerRow of headerRows) {
        const placed = layoutRowFragment(
          headerRow,
          structure.columnWidthsPt,
          tableLeft,
          cursorY,
          asRepeat,
          0,
          tableDeps,
          structure.cellSpacingPt
        );
        if (placed.bottom > contentHeight() + 0.001) {
          throw new TablePaginationError(
            'table-row-overheight',
            `Table header row ${headerRow.id} overflowed the page content box`
          );
        }
        rows.push(placed.record);
        sourceRows.push(headerRow);
        cursorY = placed.bottom;
      }
    };

    const breakForContinuation = (emitHeaders: boolean): void => {
      closeTableFragment();
      advanceColumn();
      tableLeft = originX();
      // See placeHeaderGroup: the new fragment opens at the advanced cursor, which is the
      // column region top on a shared sheet and 0 only when a fresh page was opened.
      fragmentTop = cursorY;
      if (emitHeaders) placeHeaderGroup(true);
    };

    // Initial authored header group (not repeats) — atomic with body-row pagination below.
    placeHeaderGroup(false);

    for (const row of structure.rows.slice(headerRows.length)) {
      const naturalHeight = measureRowHeight(
        row,
        structure.columnWidthsPt,
        tableLeft,
        0,
        tableDeps,
        structure.cellSpacingPt
      );
      let cursors: CellPlaceCursor[] = initialCellCursors(row);
      let isContinuation = false;
      let fragmentsForRow = 0;
      let movedToFreshPage = false;

      // Whole-row move: fits a fresh page but not the remaining band.
      if (
        naturalHeight <= contentHeight() + 0.001 &&
        cursorY + naturalHeight > contentHeight() + 0.001 &&
        cursorY > 0
      ) {
        breakForContinuation(true);
        movedToFreshPage = true;
      }

      for (;;) {
        fragmentsForRow += 1;
        if (fragmentsForRow > MAX_TABLE_ROW_FRAGMENTS) {
          throw new TablePaginationError(
            'table-row-fragment-limit',
            `Table row ${row.id} exceeded ${MAX_TABLE_ROW_FRAGMENTS} page fragments`
          );
        }

        const remaining = contentHeight() - cursorY;
        if (remaining <= 0.001 && cursorY > 0) {
          if (movedToFreshPage) {
            throw new TablePaginationError(
              'table-row-overheight',
              `Table row ${row.id} cannot fit after repeated header rows`
            );
          }
          breakForContinuation(true);
          movedToFreshPage = true;
          continue;
        }

        // Prefer an unsplit placement when the natural height fits the remaining band.
        if (!isContinuation && naturalHeight <= remaining + 0.001) {
          const placed = layoutRowFragment(
            row,
            structure.columnWidthsPt,
            tableLeft,
            cursorY,
            false,
            0,
            tableDeps,
            structure.cellSpacingPt
          );
          if (placed.bottom > contentHeight() + 0.001) {
            throw new TablePaginationError(
              'table-row-overheight',
              `Table row ${row.id} overflowed the page content box after placement`
            );
          }
          rows.push(placed.record);
          sourceRows.push(row);
          cursorY = placed.bottom;
          break;
        }

        // Does not fit the remaining band.
        // Exact rows are atomic (Word clips overflow inside the fixed box; they do not
        // continue across pages). Same keep-together path as `w:cantSplit`.
        if (row.cantSplit || row.height.rule === 'exact') {
          if (cursorY > 0 && !movedToFreshPage) {
            breakForContinuation(true);
            movedToFreshPage = true;
            continue;
          }
          throw new TablePaginationError(
            'table-row-overheight',
            row.height.rule === 'exact'
              ? `Table row ${row.id} has w:trHeight hRule=exact taller than the available page content`
              : `Table row ${row.id} has w:cantSplit and is taller than the available page content`
          );
        }

        const placed = layoutRowFragmentBounded(
          row,
          structure.columnWidthsPt,
          tableLeft,
          cursorY,
          contentHeight(),
          false,
          isContinuation,
          0,
          tableDeps,
          cursors,
          structure.cellSpacingPt
        );

        // First attempt on a non-empty page placed nothing useful → move to next page.
        if (!placed.fitted && cursorY > 0 && !movedToFreshPage) {
          breakForContinuation(true);
          movedToFreshPage = true;
          continue;
        }

        if (!placed.fitted) {
          throw new TablePaginationError(
            placed.nestedSplitBlocked ? 'table-row-split-unsupported' : 'table-row-overheight',
            placed.nestedSplitBlocked
              ? `Table row ${row.id} contains a nested table taller than the page content box`
              : `Table row ${row.id} has content that cannot fit a page content box`
          );
        }

        if (placed.bottom > contentHeight() + 0.001) {
          throw new TablePaginationError(
            'table-row-overheight',
            `Table row ${row.id} overflowed the page content box`
          );
        }

        const hasMore = placed.remainder !== null;
        const source = rowWithSplitBorders(row, isContinuation, hasMore);
        rows.push(placed.record);
        sourceRows.push(source);
        cursorY = placed.bottom;

        if (!hasMore) break;

        cursors = placed.remainder!;
        isContinuation = true;
        movedToFreshPage = false;
        breakForContinuation(true);
      }
    }
    closeTableFragment();
  };

  let converged = false;
  let convergedAt = prepared.length;
  /** Whole pages the convergence tail moved by; reused checkpoints shift with it. */
  let convergedPageDelta = 0;
  for (let index = startIndex; index < prepared.length; index += 1) {
    const entry = prepareBlock(bodies[index]!, columnWidth());

    // The flow as it stands BEFORE this block: what a later pass resumes from.
    checkpoints[index] = checkpointNow();

    // CONVERGENCE. Once inside the unchanged tail, if the IN-PAGE flow returns to exactly
    // the state the previous pass was in at this same paragraph — cursor, pending fragments
    // (compared structurally), anchor state — everything after lays out identically, and the
    // rest of the previous layout is reused: verbatim when the completed page count also
    // matches, remapped whole sheets over when it does not.
    //
    // Tested at EVERY paragraph of the unchanged tail, not just its first: an edit puts the
    // flow out of step for the rest of the page it lands on, and the state only comes back
    // into line once the page it disturbed has been completed.
    if (resumable && commonSuffix > 0 && index >= prepared.length - commonSuffix) {
      const mark = session.checkpoints[index + (session.keys.length - prepared.length)];
      if (
        mark &&
        mark.cursorY === cursorY &&
        mark.previousSpaceAfter === previousSpaceAfter &&
        mark.flowColumnIndex === flowColumnIndex &&
        sameFragments(mark.pageFragments, pageFragments) &&
        sameAnchoredDrawings(mark.pendingAnchoredDrawings, pendingAnchoredDrawings) &&
        // A flow that still owes the next page a drawing is not one that owes it nothing.
        sameAnchoredDrawings(mark.deferredAnchoredDrawings, deferredAnchoredDrawings) &&
        sameDeferCounts(mark.anchorPageDeferCounts, anchorPageDeferCounts)
      ) {
        // The in-page flow matches. At delta 0 the previous pages are appended by identity;
        // at a nonzero delta the tail is identical content `delta` sheets away and is reused
        // through `remapPage`, gated by `convergenceTailShiftAllowed`.
        const delta = pages.length - mark.pageCount;
        const shiftable = convergenceTailShiftAllowed({
          delta,
          titlePage: furniture?.titlePage === true,
          evenAndOddHeaders: furniture?.evenAndOddHeaders === true,
          parityDependent: session.parityDependent,
          usedPageParity,
          markPageCount: mark.pageCount,
          hasNoteReserves: pageBottomReserves !== undefined,
          hasExclusionZones: (options.drawingExclusionZonesByPage?.size ?? 0) > 0,
        });
        if (shiftable) {
          const tail =
            delta === 0
              ? previous!.pages.slice(mark.pageCount)
              : previous!.pages
                  .slice(mark.pageCount)
                  .map((page, offset) =>
                    remapPage(page, pages.length + offset, pageBox(pages.length + offset).y)
                  );
          pages.push(...tail);
          reusedPages += tail.length;
          converged = true;
          convergedAt = index;
          convergedPageDelta = delta;
          // Line ids are paragraph-local, so a changed line count before this join does not
          // invalidate the tail. Still carry the tail's line COUNT so a multi-section
          // orchestrator receives the correct terminal count for this revision.
          lineCounter += session.endLineCounter - mark.lineCounter;
          break;
        }
      }
    }

    placed += 1;

    if (entry.kind === 'table') {
      previousSpaceAfter = 0;
      collectingCellBreakKeys = [];
      try {
        layoutTableInFlow(entry.table);
        registerTableCellBreakKeys(entry.table, collectingCellBreakKeys);
      } finally {
        collectingCellBreakKeys = null;
      }
      continue;
    }

    const {
      paragraph,
      props,
      spacing: authoredSpacing,
      contextualSpacing,
      styleId,
      borders,
      shading,
      keeps,
    } = entry;
    let { indent, alignment, markRunProperties } = entry;
    let available = entry.available;
    // `w:contextualSpacing` (17.3.1.9) drops the gap between paragraphs of the SAME style.
    // Word's own ListParagraph sets it, so without this every Word-authored list carries a
    // paragraph gap between its items.
    const previousEntry = index > 0 ? prepared[index - 1] : undefined;
    const nextEntry = prepared[index + 1];
    const sameStyleAs = (other: PreparedBlock | undefined): boolean =>
      other?.kind === 'paragraph' && other.styleId === styleId && styleId !== null;
    const spacing: ParagraphSpacing = contextualSpacing
      ? {
          before: sameStyleAs(previousEntry) ? 0 : authoredSpacing.before,
          after: sameStyleAs(nextEntry) ? 0 : authoredSpacing.after,
        }
      : authoredSpacing;
    const listItem = listItems?.get(paragraph.id) ?? entry.listItem;
    // `w:firstLine` moves the first line right of the indent, `w:hanging` moves it left.
    // The schema treats them as mutually exclusive; where a producer writes both, hanging
    // wins, which is how Word reads it.
    // A NUMBERED/BULLETED paragraph's first-line slot belongs to the MARKER: `listMarkerBox`
    // places it at `left - hanging`, and Word's `w:suff` puts the text back at `left` — or
    // after the marker, or at the next tab stop past an overflowing one (§17.9.30).
    let firstLineOffset = firstLineOffsetOf(entry);
    const paragraphId = paragraph.id;
    // `w:between` (§17.3.1.24): consecutive paragraphs with IDENTICAL border settings are ONE
    // bordered block in Word — the box opens above the first and closes below the last, and
    // each interior boundary carries `w:between` or nothing. Applying a box to three selected
    // paragraphs in Word draws one box, not three, and this is why.
    const borderGroupKey = entry.borderGroupKey;
    const inSameBorderGroup = (other: PreparedBlock | undefined): boolean =>
      borderGroupKey !== '' &&
      other?.kind === 'paragraph' &&
      other.borderGroupKey === borderGroupKey;
    const continuesAbove = inSameBorderGroup(previousEntry);
    const continuesBelow = inSameBorderGroup(nextEntry);
    const topEdge = continuesAbove ? undefined : borders.top;
    // What closes the paragraph: the bottom rule, or the `between` rule when the block runs on.
    const closingEdge = continuesBelow ? borders.between : borders.bottom;
    const topExtent = paragraphBorderExtentPt(topEdge);
    const borderExtent = paragraphBorderExtentPt(closingEdge);

    if (paragraphBreaksBefore(props) && (pageFragments.length > 0 || pages.length === 0)) {
      flushPage();
      previousSpaceAfter = 0;
    }

    let lines = breakBlock(entry, index);
    if (lines.length === 0) {
      // Cross-paragraph TOC field chrome: tree preserved, no painted row or flow height.
      continue;
    }
    // A SECTION BREAK IS NOT CONTENT. The paragraph mark that carries a paragraph-level
    // `w:sectPr` (ECMA-376 §17.6.18) IS the section break; `w:type` (§17.6.22) says where the
    // NEXT section starts, never that the mark itself claims a sheet. So a mark that paints
    // nothing may not OPEN A SHEET: it rides out the bottom of the page its section already
    // ended on. Without this a mark missing the bottom margin by a point flushed a sheet, the
    // following `nextPage` section started after it, and the document rendered a wholly blank
    // page between two sections Word sets adjacent.
    //
    // Only the sheet. Moving into the next COLUMN of the same sheet manufactures nothing, and
    // the mark is part of what a balanced multi-column section distributes (§17.6.4) — so a
    // balance trial, which asks how short the region can be while still holding one sheet,
    // has to see the mark's own demand for room or it converges on a band too tight for it.
    const marksSectionBreak =
      paragraphSectionNode(paragraph) !== undefined && paintsNothing(entry, lines);
    const holdsSheet = (): boolean =>
      marksSectionBreak && columnRegionBottom === undefined && columnIndex + 1 >= columns.count;
    const rebreakInCurrentColumn = (startOffset: number): void => {
      const next = prepareBlock(paragraph, columnWidth());
      if (next.kind !== 'paragraph') return;
      indent = next.indent;
      alignment = next.alignment;
      available = next.available;
      markRunProperties = next.markRunProperties;
      firstLineOffset = startOffset === 0 ? firstLineOffsetOf(next) : 0;
      lines = [...breakBlock(next, index, startOffset)];
    };

    // Fit uses unsuppressed lead; top-of-page suppression applies after any flush below.
    {
      const lead = collapsedSpaceBefore(spacing.before, previousSpaceAfter);
      const emptyStyle =
        markRunProperties.length === 0
          ? DEFAULT_RUN_STYLE
          : resolveRunStyle(markRunProperties, styleCascade?.themeFonts);
      const firstTail = lines.length <= 1 ? borderExtent + spacing.after : 0;
      const prospectiveFirstTop = cursorY + lead + topExtent;
      const firstZones = placementZonesForLine(
        entry,
        index,
        lines,
        0,
        0,
        prospectiveFirstTop,
        new Map()
      );
      const firstExtent = lines[0]
        ? pendingLineFlowExtentAtPlacement(prospectiveFirstTop, lines[0], firstZones, firstTail)
        : measurer.lineMetrics(emptyStyle).height + firstTail;
      let needed = lead + topExtent + firstExtent;
      // `w:keepNext` (§17.3.1.15): this paragraph may not be the last thing on its page. Priced
      // ONCE per chain, at its head — a member whose predecessor keeps too already moved with
      // the group. A chain that cannot fit a page of its own is abandoned.
      if (keeps.keepNext && !keepsNext[index - 1]) {
        const group = keepNextGroupHeight(prepared, index, previousSpaceAfter, (at) => {
          const member = prepared[at];
          return member?.kind === 'paragraph' ? breakBlock(member, at).map((l) => l.height) : [];
        });
        if (group !== null && group + topExtent <= contentHeight()) {
          needed = Math.max(needed, group + topExtent);
        }
      }
      if (cursorY + needed > contentHeight() && cursorY > 0 && !holdsSheet()) {
        advanceColumn();
        previousSpaceAfter = 0;
        rebreakInCurrentColumn(0);
      }
    }

    const atTopOfPage = cursorY === 0 && !regionHasFragments();
    const appliedBefore = appliedSpaceBefore(
      spacing.before,
      previousSpaceAfter,
      atTopOfPage,
      firstParagraphOfSection
    );
    if (appliedBefore > 0) cursorY += appliedBefore;
    // The top rule and its gap are flow height above the first line, exactly as the bottom
    // rule is flow height below the last — pagination has to see both or a boxed paragraph
    // overhangs the bottom margin by the height of its own frame.
    if (topExtent > 0) cursorY += topExtent;
    firstParagraphOfSection = false;

    // Place the lines, fragmenting at page boundaries.
    let fragmentIndex = 0;
    let pending: LineRecord[] = [];
    let fragmentStart = lines[0]?.start ?? 0;
    let fragmentBefore = appliedBefore;
    // Reserved above the FIRST fragment only: a paragraph continued onto the next page opens
    // once, the same way it closes once.
    let fragmentTopExtent = topExtent;
    let endedWithPageBreak = false;
    let fragmentParagraphStartY = cursorY;
    /** Clearance applied above the fragment's first placed line, for anchor framing. */
    let fragmentFirstLineSkip = 0;
    const appliedSkipByLineIndex = new Map<number, number>();
    previousSpaceAfter = 0;
    const paragraphHasAnchors =
      options.inlineDrawingLayout !== undefined &&
      anchoredDrawingAtomsInParagraph(entry.paragraph, options.inlineDrawingLayout).length > 0;
    let paragraphAnchorsPublished = false;
    let paragraphAnchorOrigin: Readonly<{
      columnX: number;
      columnWidth: number;
      startY: number;
    }> | null = null;

    const markRevisions = paragraphMarkRevisionsOf(entry.paragraph);
    const mergeGroup = paragraphMergeGroupOf(entry.paragraph);
    const mergeBoundaries = mergeGroup ? mergeBoundariesOf(mergeGroup) : null;

    /**
     * How much of the first placed line's topAndBottom skip this paragraph's own anchor caused.
     *
     * The placement skip mixes two sources: bands inherited from earlier paragraphs, which
     * genuinely move this paragraph down the page, and a band from an anchor inside it, which
     * only moves its text away from a picture pinned to the paragraph origin. Re-running the
     * clearance with the inherited zones alone isolates the second.
     */
    const ownTopAndBottomSkipOnFirstLine = (): number => {
      const firstLine = pending[0];
      if (!firstLine) return 0;
      const applied = fragmentFirstLineSkip;
      if (applied <= 0.001) return 0;
      const inherited = topAndBottomSkipBeforeLine(
        fragmentParagraphStartY,
        firstLine.box.height,
        pageExclusionZonesForEntry(entry, index)
      );
      return Math.max(0, applied - inherited);
    };

    const flushFragment = (isLast: boolean): void => {
      if (pending.length === 0) return;
      const regionX = columnLeft();
      const columnX = columnOffsetX();
      const linesTop = pending[0]!.box.y;
      const top = linesTop - fragmentBefore - fragmentTopExtent;
      const linesBottom =
        pending[pending.length - 1]!.box.y + pending[pending.length - 1]!.box.height;
      const appliedAfter = isLast ? spacing.after : 0;
      const strokes: ParagraphBorderStrokeRecord[] = [];
      let bottomBorderRecord: ParagraphBottomBorderRecord | undefined;
      let contentTop = linesTop;
      let contentBottom = linesBottom;
      // THE FOUR EDGES ARE ONE BOX. The side rules sit outside the text column by their own
      // `w:space`, so a top rule drawn only across the column stops short of them and the
      // frame reads as two horizontal rules with two detached vertical bars beside it —
      // which is what a callout looked like. Word closes the rectangle, so the horizontal
      // rules span from the left rule's outer edge to the right rule's.
      // Stroke thickness uses the inflated compound band for `double`/etc. so thin authored
      // doubles still publish a box paint can draw as two lines (shared with table borders).
      const leftStroke = borders.left ? paragraphBorderStrokeWidthPt(borders.left) : 0;
      const rightStroke = borders.right ? paragraphBorderStrokeWidthPt(borders.right) : 0;
      const boxLeft = borders.left
        ? regionX + indent.left - borders.left.spacePt - leftStroke
        : regionX + indent.left;
      const boxRight = borders.right
        ? regionX + indent.left + available + borders.right.spacePt + rightStroke
        : regionX + indent.left + available;
      const boxWidth = Math.max(boxRight - boxLeft, 0);
      if (fragmentTopExtent > 0 && topEdge) {
        const topStroke = paragraphBorderStrokeWidthPt(topEdge);
        const ruleY = linesTop - topEdge.spacePt - topStroke;
        strokes.push({
          side: 'top',
          edge: topEdge,
          box: { x: boxLeft, y: ruleY, width: boxWidth, height: topStroke },
        });
        contentTop = ruleY;
      }
      if (isLast && closingEdge) {
        const closeStroke = paragraphBorderStrokeWidthPt(closingEdge);
        const ruleY = linesBottom + closingEdge.spacePt;
        const box = {
          x: boxLeft,
          y: ruleY,
          width: boxWidth,
          height: closeStroke,
        };
        strokes.push({ side: continuesBelow ? 'between' : 'bottom', edge: closingEdge, box });
        // `bottomBorder` stays the BOTTOM rule alone: a `between` rule closing a grouped
        // paragraph is a different edge, and a consumer reading it as the box's bottom would
        // draw the block's frame at every interior boundary.
        if (!continuesBelow) bottomBorderRecord = { edge: closingEdge, box };
        contentBottom = ruleY + closeStroke;
      }
      if (isLast) cursorY = Math.max(cursorY, contentBottom + appliedAfter);
      const height = Math.max(contentBottom + appliedAfter - top, 0);
      // Side rules run the height of the bordered block, and inside a group they run THROUGH
      // the inter-paragraph gap so the box reads as one outline rather than a ladder.
      const sideTop = continuesAbove && fragmentIndex === 0 ? top : contentTop;
      const sideBottom = continuesBelow && isLast ? top + height : contentBottom;
      const sideHeight = Math.max(sideBottom - sideTop, 0);
      if (borders.left) {
        strokes.push({
          side: 'left',
          edge: borders.left,
          box: {
            x: regionX + indent.left - borders.left.spacePt - leftStroke,
            y: sideTop,
            width: leftStroke,
            height: sideHeight,
          },
        });
      }
      if (borders.right) {
        strokes.push({
          side: 'right',
          edge: borders.right,
          box: {
            x: regionX + indent.left + available + borders.right.spacePt,
            y: sideTop,
            width: rightStroke,
            height: sideHeight,
          },
        });
      }
      // `w:bar` is the change-bar rule beside the paragraph. It belongs to the paragraph, not
      // to the block, so it neither opens nor closes with the group.
      if (borders.bar) {
        const barStroke = paragraphBorderStrokeWidthPt(borders.bar);
        strokes.push({
          side: 'bar',
          edge: borders.bar,
          box: {
            x: regionX + indent.left - borders.bar.spacePt - barStroke,
            y: linesTop,
            width: barStroke,
            height: Math.max(linesBottom - linesTop, 0),
          },
        });
      }
      // A resolved view lays a run of paragraphs out as one. The layout is what the document
      // becomes; the identity has to stay what the document HAS, or an edit in the merged half
      // addresses a position the store does not hold.
      const mergedLines = mergeBoundaries ? remapMergedLines(pending, mergeBoundaries) : null;
      const rawMarker =
        fragmentIndex === 0
          ? publishListMarker(
              listItem,
              measurer,
              pending[0] ? { y: pending[0].box.y, height: pending[0].box.height } : undefined
            )
          : undefined;
      const marker = rawMarker
        ? { ...rawMarker, box: { ...rawMarker.box, x: rawMarker.box.x + regionX } }
        : undefined;
      pageFragments.push({
        kind: 'paragraph',
        id: `${paragraphId}#f${fragmentIndex}`,
        paragraphId,
        fragmentIndex,
        range: mergedLines
          ? // A merged fragment holds more than one paragraph and this field holds one range,
            // so it cannot be the fragment's extent. It takes the one its LAST line reports —
            // where the fragment ENDS — and everything that resolves a position reads spans
            // instead, which name their own paragraphs. `pushLineCaretStops` reads `start`
            // from here only to dedupe a continuation line's first stop, and a merged
            // fragment's lines are compared against their own segment starts anyway.
            mergedLines[mergedLines.length - 1]!.range
          : {
              paragraphId,
              start: fragmentStart,
              end: pending[pending.length - 1]!.range.end,
            },
        props,
        spacing: { before: fragmentBefore, after: appliedAfter },
        indent,
        ...(bottomBorderRecord ? { bottomBorder: bottomBorderRecord } : {}),
        ...(strokes.length > 0 ? { borders: strokes } : {}),
        ...(shading === undefined
          ? {}
          : {
              shading,
              // A BORDERED paragraph is shaded across the whole frame, not just the text
              // band: Word fills the box its borders draw, `w:space` padding included, so a
              // fill that stopped at the line area left a pale stripe floating inside an
              // empty rectangle. Unbordered shading keeps the line area, which is what Word
              // fills there. Borders paint after this, so the frame is never covered.
              // Gated on a real FRAME — a side rule is what makes the fill a box. A heading
              // with only `w:bottom` is the common single-edge case, and widening its fill
              // down to the rule would be a silent change in the opposite direction.
              shadingBox:
                borders.left || borders.right
                  ? {
                      x: boxLeft,
                      y: contentTop,
                      width: boxWidth,
                      height: Math.max(contentBottom - contentTop, 0),
                    }
                  : paragraphShadingBox(pending, regionX + indent.left, available)!,
            }),
        tabStops: entry.tabStops,
        ...(marker ? { marker } : {}),
        // Final fragment only — a paragraph split across pages must not draw two pilcrows —
        // and `all-markup` only, as Word draws attribution in All Markup alone. The record's
        // own declaration carries the rest of the reasoning.
        ...(isLast && showsMarkup
          ? markRevisionFields(markRevisions, paragraphMarkFormatRevisionOf(entry.paragraph))
          : {}),
        lines: mergedLines ?? pending,
        box: { x: columnX + indent.left, y: top, width: available, height },
      });
      if (options.inlineDrawingLayout && paragraphHasAnchors && !paragraphAnchorsPublished) {
        paragraphAnchorsPublished = true;
        const anchorOffsets = [...drawingModelOffsetsInParagraph(entry.paragraph).values()];
        const pendingCoversAnchors =
          anchorOffsets.length > 0 &&
          anchorOffsets.every((offset) =>
            pending.some((line) => offset >= line.range.start && offset < line.range.end)
          );
        let publishLines: typeof pending;
        let publishParagraphBox: LayoutBox;
        let publishColumnBox: LayoutBox;
        if (pendingCoversAnchors) {
          // A `wrapTopAndBottom` anchor pushed its OWN paragraph's lines down to clear the
          // band. Framing the anchor against those lines chases the displacement it caused —
          // the picture lands on the text it just moved. `positionV relativeFrom="paragraph"`
          // means where the paragraph would begin without its own band, so that skip comes
          // back off here. A band inherited from an earlier paragraph is NOT removed: it
          // moved this paragraph for real, and the anchor travels with it.
          const anchorTop = top - ownTopAndBottomSkipOnFirstLine();
          publishLines = pending;
          publishParagraphBox = {
            x: columnX + indent.left,
            y: anchorTop,
            width: available,
            height,
          };
          publishColumnBox = anchorColumnBox({
            x: columnX + indent.left,
            y: anchorTop,
            width: available,
            height,
          });
        } else {
          const origin = paragraphAnchorOrigin ?? {
            columnX,
            columnWidth: columnWidth(),
            startY: top,
          };
          let syntheticY = origin.startY;
          publishLines = lines.map((brokenLine, brokenIndex) => {
            const lineRecord = {
              id: `anchor-line-${brokenIndex}`,
              range: { paragraphId, start: brokenLine.start, end: brokenLine.end },
              box: {
                x: origin.columnX + indent.left,
                y: syntheticY,
                width: available,
                height: brokenLine.height,
              },
              // Synthetic frame geometry only — these lines are never aligned, painted or
              // caret-tested, so the content origin is just where their spans were placed.
              contentX:
                brokenLine.spans.length > 0
                  ? brokenLine.spans[0]!.box.x + origin.columnX
                  : origin.columnX + indent.left,
              baseline: brokenLine.baseline,
              leading: brokenLine.leading,
              trailingSpacing: brokenLine.trailingSpacing,
              spans: brokenLine.spans.map((span) => ({
                ...span,
                box: { ...span.box, x: span.box.x + origin.columnX, y: syntheticY },
              })),
            };
            syntheticY += brokenLine.height + (brokenLine.exclusionSkipBefore ?? 0);
            return lineRecord;
          });
          const paragraphTop = origin.startY;
          publishParagraphBox = {
            x: origin.columnX + indent.left,
            y: paragraphTop,
            width: available,
            height: Math.max(syntheticY - paragraphTop, pending[0]?.box.height ?? 0),
          };
          publishColumnBox = anchorColumnBox(publishParagraphBox);
        }
        collectAnchoredDrawings(
          publishAnchoredDrawingsForParagraph({
            paragraph: entry.paragraph,
            paragraphId,
            paragraphBox: publishParagraphBox,
            lines: publishLines,
            drawingLayout: options.inlineDrawingLayout,
            frameBase: anchorFrameBase(),
            columnBox: publishColumnBox,
            cellBox: null,
            pageClip: pageContentClip(),
            measurer,
            sourceOrderOf,
            layoutTextboxStory: layoutTextboxStoryForBody,
          })
        );
      }
      fragmentIndex += 1;
      fragmentStart = pending[pending.length - 1]!.range.end;
      pending = [];
      fragmentBefore = 0;
      fragmentTopExtent = 0;
    };

    // First line of this paragraph on the CURRENT page: the anchor a keep rule retreats to.
    // Not always 0 — a paragraph already cut by a page boundary keeps what it kept. Each
    // retreat moves a line onto a later page, so the walk terminates; `maxRetreats` guards a
    // future rule that could cycle, and fails OPEN at the natural break rather than throwing.
    let fragmentFirstLine = 0;
    let retreats = 0;
    let maxRetreats = lines.length + MAX_KEEP_NEXT_CHAIN;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const pendingLine = lines[lineIndex]!;
      const isLastLine = lineIndex === lines.length - 1;
      const tail = isLastLine ? borderExtent + spacing.after : 0;
      if (lineIndex === fragmentFirstLine) {
        fragmentParagraphStartY = cursorY;
        if (paragraphHasAnchors && paragraphAnchorOrigin === null && fragmentIndex === 0) {
          paragraphAnchorOrigin = Object.freeze({
            columnX: columnOffsetX(),
            columnWidth: columnWidth(),
            startY: fragmentParagraphStartY,
          });
        }
      }
      const skipBefore = placementSkipBefore(
        entry,
        index,
        lines,
        lineIndex,
        fragmentFirstLine,
        fragmentParagraphStartY,
        pendingLine,
        appliedSkipByLineIndex
      );
      // Word can let auto/atLeast spacing below the glyph band cross the bottom text
      // margin. The painted line keeps its full box; only the pagination budget drops that
      // trailing external depth.
      const lineExtent =
        skipBefore + Math.max(0, pendingLine.height - pendingLine.trailingSpacing) + tail;
      const overflowsPage =
        cursorY + lineExtent > contentHeight() &&
        !holdsSheet() &&
        (pending.length > 0 || pageFragments.length > 0 || pages.length > 0);
      if (overflowsPage) {
        // `w:widowControl` (§17.3.1.44) / `w:keepLines` (§17.3.1.16) change where a paragraph
        // may be CUT, not where it fits: retreat off a stranded line, or off keepLines whole.
        const alone = !regionHasFragments();
        const breakAt =
          retreats < maxRetreats
            ? adjustedBreakIndex(lineIndex, fragmentFirstLine, lines.length, keeps, alone)
            : lineIndex;
        const retreated = breakAt < lineIndex;
        // Un-placing hands line ids BACK: a line re-placed on the next page must carry the id
        // it already took, or every id below it is out of step with a clean pass.
        for (let back = lineIndex; back > breakAt; back -= 1) {
          pending.pop();
          const removedPending = lines[back - 1]!;
          const removedSkip =
            appliedSkipByLineIndex.get(back - 1) ?? removedPending.exclusionSkipBefore ?? 0;
          appliedSkipByLineIndex.delete(back - 1);
          cursorY -= removedPending.height + removedSkip;
          lineCounter -= 1;
        }
        // Moving WHOLE means it now OPENS a page: space-before drops, the top rule travels.
        const movesWhole = retreated && pending.length === 0 && fragmentIndex === 0;
        const nextOffset = lines[breakAt]!.start;
        const priorColumnWidth = columnWidth();
        flushFragment(false);
        advanceColumn();
        fragmentBefore = 0;
        if (movesWhole) cursorY = fragmentTopExtent;
        else fragmentTopExtent = 0;
        if (columnWidth() !== priorColumnWidth) {
          rebreakInCurrentColumn(nextOffset);
          maxRetreats = Math.max(maxRetreats, lines.length + MAX_KEEP_NEXT_CHAIN);
          fragmentFirstLine = 0;
          if (retreated) retreats += 1;
          lineIndex = -1;
          continue;
        }
        fragmentFirstLine = breakAt;
        fragmentParagraphStartY = cursorY;
        if (retreated) {
          retreats += 1;
          lineIndex = breakAt - 1;
          continue;
        }
      }
      const columnX = columnOffsetX();
      appliedSkipByLineIndex.set(lineIndex, skipBefore);
      cursorY += skipBefore;
      const lineIndent = columnX + indent.left + (lineIndex === 0 ? firstLineOffset : 0);
      const lineAvailableWidth = Math.max(1, available - (lineIndex === 0 ? firstLineOffset : 0));
      const placedSpans = pendingLine.spans.map((span) => ({
        ...span,
        range: { ...span.range, paragraphId },
        box: { ...span.box, x: span.box.x + columnX, y: cursorY },
      }));
      const alignedSpans = alignSpans(
        placedSpans,
        measurer,
        lineIndent,
        lineAvailableWidth,
        alignment,
        isLastLine,
        alignment === 'center' || alignment === 'right' ? pendingLine.width : undefined
      );
      // A line with no spans still aligns: an empty centred paragraph puts its (zero width)
      // content — and so the caret — at the middle of the measure, not at the left edge.
      const alignOffset =
        placedSpans.length > 0 && alignedSpans.length > 0
          ? alignedSpans[0]!.box.x - placedSpans[0]!.box.x
          : alignment !== 'left' && alignment !== 'both'
            ? (() => {
                const slack = lineAvailableWidth - pendingLine.width;
                if (slack <= 0) return 0;
                return alignment === 'center' ? slack / 2 : slack;
              })()
            : 0;
      const pageClip = Object.freeze({
        x: 0,
        y: 0,
        width: contentWidth,
        height: contentHeight(),
      });
      const placedDrawings = pendingLine.drawings.map((drawing) => {
        const placed = Object.freeze({
          ...drawing,
          paragraphId,
          x: columnX + drawing.x,
          y: cursorY + drawing.y,
          advanceStart: drawing.advanceStart + columnX,
          advanceEnd: drawing.advanceEnd + columnX,
          paintBounds: Object.freeze({
            ...drawing.paintBounds,
            x: columnX + drawing.paintBounds.x,
            y: cursorY + drawing.paintBounds.y,
          }),
          hitBounds: Object.freeze({
            ...drawing.hitBounds,
            x: columnX + drawing.hitBounds.x,
            y: cursorY + drawing.hitBounds.y,
          }),
        });
        return clipInlineDrawingRecordToRegion(placed, pageClip);
      });
      const alignedDrawings = alignDrawings(placedDrawings, alignOffset);
      const record: LineRecord = {
        id: bodyLineId(paragraph.id, pendingLine.start, lineIndex),
        range: { paragraphId, start: pendingLine.start, end: pendingLine.end },
        spans: alignedSpans,
        box: {
          x: columnOffsetX() + indent.left,
          y: cursorY,
          width: available,
          height: pendingLine.height,
        },
        contentX: alignedSpans[0]?.box.x ?? lineIndent + alignOffset,
        baseline: pendingLine.baseline,
        leading: pendingLine.leading,
        trailingSpacing: pendingLine.trailingSpacing,
        ...(pendingLine.deletedRanges ? { deletedRanges: pendingLine.deletedRanges } : {}),
        ...(alignedDrawings.length > 0 ? { drawings: alignedDrawings } : {}),
      };
      lineCounter += 1;
      if (pending.length === 0) fragmentFirstLineSkip = skipBefore;
      pending.push(record);
      cursorY += pendingLine.height;
      if (pendingLine.columnBreakAfter) {
        const priorColumnWidth = columnWidth();
        flushFragment(isLastLine);
        advanceColumn();
        fragmentBefore = 0;
        fragmentTopExtent = 0;
        endedWithPageBreak = true;
        if (!isLastLine && columnWidth() !== priorColumnWidth) {
          rebreakInCurrentColumn(pendingLine.end);
          maxRetreats = Math.max(maxRetreats, lines.length + MAX_KEEP_NEXT_CHAIN);
          fragmentFirstLine = 0;
          lineIndex = -1;
          continue;
        }
        fragmentFirstLine = lineIndex + 1;
      } else if (pendingLine.pageBreakAfter) {
        flushFragment(isLastLine);
        flushPage();
        fragmentBefore = 0;
        fragmentTopExtent = 0;
        endedWithPageBreak = true;
        // An explicit break is the author's cut; the keep rules apply afresh after it.
        fragmentFirstLine = lineIndex + 1;
      }
    }
    flushFragment(true);
    previousSpaceAfter = endedWithPageBreak ? 0 : spacing.after;
  }

  // A TERMINAL checkpoint, describing the flow after the last paragraph. Without it,
  // appending a paragraph gives `firstChanged === paragraphCount` — "resume after the end" —
  // for which nothing was stored, so the most ordinary edit there is, typing at the bottom of
  // a document and pressing Enter, re-placed everything.
  if (!converged) {
    checkpoints[prepared.length] = checkpointNow();
  }

  // Captured BEFORE the terminal flush, which zeroes the cursor. A converged pass stopped
  // early and never walked the tail, so its end state is the one the previous pass stored.
  const endCursorY = converged && session ? session.endCursorY : cursorY;
  const endSpaceAfter = converged && session ? session.endSpaceAfter : previousSpaceAfter;
  // The terminal flush closes the page the flow was still filling. When it does NOT run,
  // the last page was already closed by a page break and the cursor sits at the top of a
  // sheet that was never opened — nothing may be appended to what is in `pages`.
  const flushesOpenPage = !converged && (pageFragments.length > 0 || pages.length === 0);
  const endsOpenPage = converged && session ? session.endsOpenPage : flushesOpenPage;

  if (flushesOpenPage) flushPage();
  let terminalFlushAttempts = 0;
  const maxTerminalFlushAttempts = MAX_ANCHOR_PAGE_DEFERRALS * 4 + 8;
  while (
    (pendingAnchoredDrawings.length > 0 || deferredAnchoredDrawings.length > 0) &&
    terminalFlushAttempts < maxTerminalFlushAttempts
  ) {
    terminalFlushAttempts += 1;
    if (pendingAnchoredDrawings.length === 0) carryDeferredToNextPage();
    flushPage();
  }
  if (deferredAnchoredDrawings.length > 0) {
    pendingAnchoredDrawings.push(
      ...deferredAnchoredDrawings.map((drawing) =>
        withAnchoredDrawingLayoutFallback(drawing, 'page-defer-exhausted')
      )
    );
    deferredAnchoredDrawings = [];
    flushPage();
  }
  // Entries for paragraphs this pass never asked for are gone from the document, or their
  // context changed; holding them would let the cache grow with the session rather than
  // with the document.
  // Retain by the keys of every paragraph in the DOCUMENT, not just those this pass
  // re-placed: a resumed pass never visits the prefix, and evicting its entries would make
  // the next full pass measure the whole document again.
  publishRetainedKeys();
  const layout: SemanticLayout = { revision, pages };
  if (session) {
    session.previous = layout;
    // A converged pass stops early, so the tail's checkpoints were never recomputed. The
    // previous pass's remain valid precisely because the flow matched at the join — with
    // their completed-page counts moved by however many sheets the reused tail moved.
    session.checkpoints = converged
      ? [
          ...checkpoints.slice(0, convergedAt),
          ...session.checkpoints
            .slice(convergedAt + (session.keys.length - prepared.length))
            .map((checkpoint) =>
              convergedPageDelta === 0
                ? checkpoint
                : { ...checkpoint, pageCount: checkpoint.pageCount + convergedPageDelta }
            ),
        ]
      : checkpoints;
    session.keys = flowKeys;
    session.context = context;
    // Sticky whenever any part of the previous layout was reused: a resumed pass never
    // re-places the prefix and a converged pass never re-places the tail, so their
    // parity-reading anchors could not fire `onPageParityRead` this pass. Only a pass that
    // placed EVERYTHING (full start, no convergence) may clear the flag.
    const passParityDependent = usedPageParity || furniture?.evenAndOddHeaders === true;
    session.parityDependent =
      startIndex === 0 && !converged
        ? passParityDependent
        : session.parityDependent || passParityDependent;
    session.startPageParity = startPageParity;
    session.startLineCounter = lineCounterStart;
    session.endLineCounter = lineCounter;
    session.endCursorY = endCursorY;
    session.endSpaceAfter = endSpaceAfter;
    session.endsOpenPage = endsOpenPage;
    session.stats = {
      placed,
      total: prepared.length,
      reusedPages,
      fullPasses: session.stats.fullPasses + (startIndex === 0 ? 1 : 0),
    };
  }
  return { layout, pages, lineCounter, endCursorY, endSpaceAfter, endsOpenPage };
}

/** Content-relative bottom of each column's content on one page, floored at the region top. */
function columnBottomsOf(
  page: PageRecord,
  columns: ResolvedSectionColumns,
  regionTop: number
): number[] {
  const bottoms = columns.lefts.map(() => regionTop);
  for (const fragment of page.fragments) {
    let column = 0;
    // A fragment starts at its column's left edge plus indents; assign it to the LAST
    // column whose origin it does not precede (half-point slack for table indents).
    for (let index = columns.count - 1; index >= 0; index -= 1) {
      if (fragment.box.x + 0.5 >= columns.lefts[index]!) {
        column = index;
        break;
      }
    }
    bottoms[column] = Math.max(bottoms[column]!, fragment.box.y + fragment.box.height);
  }
  return bottoms;
}

/** The balance search stops once the fitting bound is known this tightly (points). */
const BALANCE_TOLERANCE_PT = 0.25;
const MAX_BALANCE_STEPS = 20;

/**
 * Lay a block run out under its section geometry, balancing columns when asked.
 *
 * Word balances the columns of a multi-column section that ends in a continuous section
 * break (ECMA-376 §17.6.4): the content divides across the columns instead of filling the
 * first one to the page bottom. The flow itself already knows how to advance columns —
 * balancing is finding the SHORTEST first-page column height that still keeps the section
 * on its single sheet, which is monotone in the height, so a binary search over trial
 * passes finds it. Trials run session-less; only the final pass publishes.
 *
 * Conservative bounds: only a section whose natural layout is one open sheet balances.
 * A section that already fills pages keeps Word's fill-then-flow shape for those pages,
 * and balancing just its tail sheet is deferred.
 */
function layoutBlocksWithGeometry(
  bodies: readonly OoxmlElement[],
  revision: number,
  options: BlockLayoutOptions
): BlockLayoutResult {
  const columns = resolveSectionColumns(
    options.sectionColumns ?? DEFAULT_SECTION_PROPERTIES.columns,
    options.geometry.width - options.geometry.margin.left - options.geometry.margin.right
  );
  if (!options.balanceColumns || columns.count < 2 || options.columnRegionBottom !== undefined) {
    if (options.session) options.session.balanceLimit = null;
    return layoutBlocksPass(bodies, revision, options);
  }

  const session = options.session;
  const regionTop = options.flowStartY ?? 0;
  const { session: _trialSession, ...trialOptions } = options;
  const balancedResult = (final: BlockLayoutResult): BlockLayoutResult => {
    const page = final.pages[0];
    // The next continuous section resumes BELOW the whole balanced region, not below the
    // last column's own cursor.
    const endCursorY = page
      ? Math.max(...columnBottomsOf(page, columns, regionTop))
      : final.endCursorY;
    if (session) session.endCursorY = endCursorY;
    return { ...final, endCursorY };
  };

  // Unchanged content early-exits on ONE attempt at the remembered limit, skipping the
  // natural pass and the search. A stale limit just means this attempt is wasted work:
  // the section changed, so the search below reruns and overwrites everything it stored.
  if (session && session.balanceLimit !== null) {
    const remembered = session.balanceLimit;
    const attempt = layoutBlocksPass(bodies, revision, {
      ...options,
      columnRegionBottom: remembered,
    });
    if (session.stats.placed === 0 && session.stats.reusedPages === attempt.pages.length) {
      session.balanceLimit = remembered;
      return balancedResult(attempt);
    }
  }

  const natural = layoutBlocksPass(bodies, revision, trialOptions);
  if (natural.pages.length !== 1 || !natural.endsOpenPage) {
    if (session) session.balanceLimit = null;
    return layoutBlocksPass(bodies, revision, options);
  }

  const naturalBottoms = columnBottomsOf(natural.pages[0]!, columns, regionTop);
  const total = naturalBottoms.reduce((sum, bottom) => sum + Math.max(0, bottom - regionTop), 0);
  if (total <= 0) {
    if (session) session.balanceLimit = null;
    return layoutBlocksPass(bodies, revision, options);
  }

  // The natural single-sheet layout fits its own bottom by construction; the ideal split
  // cannot be shorter than an even division of the flowed content.
  let low = regionTop + total / columns.count;
  let high = Math.max(...naturalBottoms) + 0.01;
  const fits = (limit: number): boolean => {
    try {
      const trial = layoutBlocksPass(bodies, revision, {
        ...trialOptions,
        columnRegionBottom: limit,
      });
      return trial.pages.length === 1 && trial.endsOpenPage;
    } catch {
      // Keep rules or atomic rows can refuse a band this short; that is "does not fit".
      return false;
    }
  };
  for (let step = 0; step < MAX_BALANCE_STEPS && high - low > BALANCE_TOLERANCE_PT; step += 1) {
    const mid = (low + high) / 2;
    if (fits(mid)) high = mid;
    else low = mid;
  }

  const final = layoutBlocksPass(bodies, revision, { ...options, columnRegionBottom: high });
  if (session) session.balanceLimit = high;
  return balancedResult(final);
}

export { createFixedMeasurer } from './fixed-measurer.ts';

// Boundary records moved to their own module; re-exported here because the editor facade
// and the tests import them from the layout entry they always did.
export {
  attachContentControlBoundaries,
  contentControlContextToken,
  type ContentControlBoundaryWork,
} from './content-control-boundary-layout.ts';
