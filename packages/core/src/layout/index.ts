/**
 * `@docx-editor.dev/core/layout` — DOM-free pagination, shaping, and hit testing.
 *
 * Text is measured through an injected `TextMeasurer` and shaped through an injected
 * `TextShaper`, so the same code paginates in a browser and on a server. Points everywhere;
 * twips convert at property-read boundaries.
 *
 * Incremental by construction: per-block cache keys and flow checkpoints mean a pass that
 * changes nothing returns the previous pages by identity.
 *
 * @packageDocumentation
 * @public
 */
// Lane: layout. Responsibilities and dependency rules:
// docs/architecture/production-engine-packages.md.
//
// Resolved caches, dependency closure, shaping, convergent pagination, and the anchored
// DisplayItem[] IR. DOM-free — emits positioned geometry, never paints.

export {
  FontResolutionError,
  HARD_MAX_AGGREGATE_FONT_BYTES,
  HARD_MAX_FONT_BYTES,
  HARD_MAX_FONT_SOURCES,
  createFontResourceSnapshot,
  fontRequestKey,
  sha256FontBytes,
  boundedStructuralFontValidator,
  type FontRequest,
  type FontSubstitution,
  type ResolvedFont,
  type FontResolutionErrorCode,
  type FontResourceDefinition,
  type DeclaredFontSubstitution,
  type FontValidationResult,
  type FontByteValidator,
  type FontResourceSnapshot,
  type FontResourceSnapshotOptions,
  type FontResourceInstrumentation,
} from './font-resource.ts';
export {
  fixedPoint,
  createShapingEnvironment,
  createShapedRun,
  shapedRunComparatorInputs,
  shapingEnvironmentFingerprintInputs,
  shapingEnvironmentFingerprint,
  type FixedPoint,
  type TextDirection,
  type FixedPointRoundingMode,
  type NormalizationPolicy,
  type VersionedShapingLibrary,
  type ShapingEnvironmentInput,
  type ShapingEnvironment,
  type ShapeInput,
  type ShapedGlyph,
  type GlyphOutline,
  type ShapedCluster,
  type ShapedVerticalMetrics,
  type ShapedFontSpan,
  type ShapedRun,
  type ShapedRunComparatorInputs,
  type TextShaper,
  type ShapingEnvironmentFingerprintInputs,
  type FontFingerprintInputs,
} from './shaped-run.ts';
export {
  HARFBUZZ_SHAPING_LIBRARY,
  HarfBuzzShapingError,
  initializeHarfBuzz,
  isHarfBuzzInitialized,
  createHarfBuzzTextShaper,
  harfBuzzFontValidator,
  roundFontUnitToFixedPoint,
  type HarfBuzzShapingErrorCode,
  type HarfBuzzFaceCacheEvent,
  type HarfBuzzOutlineCacheEvent,
  type HarfBuzzShapeCacheEvent,
  type HarfBuzzTextShaper,
  type HarfBuzzTextShaperInstrumentation,
  type HarfBuzzTextShaperOptions,
} from './harfbuzz-shaper.ts';
export {
  UnsupportedScriptError,
  itemizeScriptFontSlots,
  type FontSlot,
  type ScriptItem,
} from './script-itemization.ts';
export type { BidiEmbeddingLevels } from './bidi.ts';
export {
  shapedHorizontalBoundaries,
  isWholeGraphemeHorizontalBoundary,
  isGeometryTrustedCaretOffset,
  isCumulativeGeometryTrustedFromLineOrigin,
  semanticHorizontalBoundaries,
} from './horizontal-boundary.ts';
export {
  type GraphemeBoundary,
  type GraphemeSegment,
  intlGraphemeBoundary,
  graphemeBoundaryEpoch,
  segmentGraphemes,
  graphemeCount,
  utf16OffsetToGrapheme,
  graphemeOffsetToUtf16,
  setGraphemeBoundary,
  resetGraphemeBoundary,
  isIntlSegmenterAvailable,
  GRAPHEME_SEGMENTER_LOCALE,
} from './grapheme.ts';
export {
  type WordBoundary,
  type WordSegment,
  type GraphemeWordSegmentRecord,
  type WordBoundaryResolverDeps,
  createIntlWordBoundary,
  createBoundedFallbackWordBoundary,
  createDefaultWordBoundary,
  resolveDefaultWordBoundary,
  segmentWords,
  wordSegmentsToGraphemeRecords,
  boundedFallbackWordSegments,
  isIntlWordSegmenterAvailable,
  WORD_SEGMENTER_LOCALE,
} from './word-segment.ts';
export {
  type OperationSnapshot,
  type OperationSnapshotField,
  type OperationSnapshotGuard,
  type ResourceDependencyProvenance,
  type CacheProvenance,
  type CacheMiss,
  type CacheLookup,
  ResolvedCache,
  captureOperationSnapshot,
  guardOperationSnapshot,
} from './resolved-cache.ts';
export {
  DEFAULT_PAGE_GEOMETRY,
  contentControlsOfLayout,
  effectiveContentControlLock,
  fragmentsOfParagraph,
  lineAtPosition,
  linesOf,
  paragraphFragmentsOf,
  paragraphFragmentsOfBlocks,
  unionLayoutBoxes,
  type BlockFragmentRecord,
  type ContentControlBoundaryRecord,
  type ContentControlGeometryFragment,
  type ContentControlLevel,
  type ContentControlLock,
  type ContentControlMappedType,
  type HeaderFooterStoryRecord,
  type LayoutBox,
  type LineRecord,
  type PageGeometry,
  type PageRecord,
  type ListMarkerRecord,
  type ParagraphBottomBorderRecord,
  type ParagraphBorderEdge,
  type ParagraphBorderSide,
  type ParagraphBorderStrokeRecord,
  type ParagraphFragmentRecord,
  type ParagraphIndent,
  type ParagraphSpacing,
  type SemanticLayout,
  type SourceRange,
  type SpanLinkRecord,
  type StyleSpanRecord,
  type TableCellFragmentRecord,
  type TableFragmentRecord,
  type TableRowFragmentRecord,
  type TextMeasurer,
} from './semantic-records.ts';
// Named on `StyleSpanRecord`, so a consumer reading spans needs to be able to name it too.
export type { FieldAtomMarker } from './field-pieces.ts';
export {
  AUTO_PARAGRAPH_SPACING_PT,
  MAX_BORDER_SPACE_PT,
  MAX_BORDER_WIDTH_PT,
  MAX_PARAGRAPH_SPACING_PT,
  PARAGRAPH_BORDER_SIDES,
  SINGLE_LINE_SPACING,
  appliedSpaceBefore,
  applyLineSpacing,
  paragraphBorderExtentPt,
  paragraphBorderStrokeWidthPt,
  bottomBorderExtentPt,
  cascadedParagraphBorders,
  collapsedSpaceBefore,
  paragraphBorders,
  paragraphBordersFingerprint,
  paragraphBreaksBefore,
  paragraphContextualSpacing,
  paragraphLineSpacing,
  paragraphSpacing,
  type LineSpacingRule,
  type ParagraphAutoSpacingContext,
  type ParagraphBorders,
  type ParagraphLineSpacing,
} from './paragraph-style.ts';
export {
  paragraphShading,
  paragraphShadingBox,
  resolveOoxmlShadingFill,
  resolveStrictHexFill,
  shadingFillFromElement,
} from './ooxml-shading.ts';
export {
  DEFAULT_TAB_INTERVAL_PT,
  DEFAULT_TAB_INTERVAL_TWIPS,
  EMPTY_TAB_STOPS,
  MAX_TAB_POSITION_TWIPS,
  MAX_TAB_STOPS,
  cascadedTabStops,
  defaultTabIntervalFromSettings,
  nextTabDestination,
  paragraphTabStops,
  tabAdvanceWidth,
  tabStopsFingerprint,
  withDefaultTabInterval,
  TAB_LEADER_GLYPH,
  type ResolvedTabStops,
  type TabAlignment,
  type TabDestination,
  type TabLeader,
  type TabStop,
} from './paragraph-tabs.ts';
export {
  createLayoutSession,
  layoutSemanticDocument,
  type HeaderFooterVariantName,
  type LayoutSession,
  type LayoutSessionStats,
  type PageFurniture,
  type SemanticLayoutOptions,
} from './semantic-layout.ts';
export {
  formatPageNumber,
  type FieldLinkProjector,
  type HyperlinkProjector,
} from './field-projection.ts';
export type { HyperlinkFieldSpec } from './field-link.ts';
export {
  EMPTY_NUMBERING_INDEX,
  MAX_LVL_OVERRIDES,
  MAX_NUMBERING_DEFINITIONS,
  buildNumberingIndex,
  resolveNumberingLevel,
  type AbstractNumDefinition,
  type LevelOverride,
  type ListMarkerAlign,
  type ListSuffix,
  type NumDefinition,
  type NumberingIndex,
  type NumberingLevel,
  type NumberingLevelIndent,
} from './numbering-index.ts';
export {
  MAX_LVL_TEXT_LENGTH,
  MAX_MARKER_TEXT_LENGTH,
  clampListValue,
  expandLvlText,
  formatDecimal,
  formatDecimalZero,
  formatLowerLetter,
  formatLowerRoman,
  formatNumFmt,
  formatUpperLetter,
  formatUpperRoman,
} from './numbering-format.ts';
export {
  createListCounterState,
  type ListCounterAdvance,
  type ListCounterState,
} from './list-counters.ts';
export {
  listMarkerBox,
  mergeListIndent,
  readNumPr,
  resolveStoryListItems,
  walkStoryParagraphs,
  withNumberingStyleLinks,
  withResolvedListItems,
  type ResolvedListItem,
} from './list-resolve.ts';
export { createFixedMeasurer } from './fixed-measurer.ts';
export {
  DEFAULT_CANVAS_FONT_STACK,
  isCanvasMeasurementAvailable,
  resolveDefaultSurfaceMeasurer,
  tryCreateCanvasMeasurer,
  type CanvasMeasurerOptions,
  type CanvasTextContext,
  type CanvasTextMetrics,
  type ResolvedSurfaceMeasurer,
} from './canvas-measurer.ts';
export { layoutHeaderFooterStory } from './hf-layout.ts';
export {
  deriveNoteDisplayMarks,
  deriveNoteDisplayMarksResolved,
  noteDisplayMarkMap,
  type NoteDisplayMark,
  type NoteReferenceSite,
} from './note-numbering.ts';
export {
  layoutNoteStory,
  layoutNoteById,
  layoutNoteSeparator,
  noteLineIdPrefix,
  normalNotesOf,
  findSeparatorNote,
  isMarkerOnlySeparatorNote,
  defaultNoteSeparatorRuleStyle,
  noteSeparatorAreaBox,
  syntheticSeparatorBox,
  MAX_NOTES_LAID_OUT,
  MAX_NOTE_FRAGMENTS,
  type NoteStoryLayout,
  type NoteStoryDrawings,
  type NoteSeparatorLayout,
  type NoteSeparatorRuleStyle,
  type NoteLayoutFallbackReason,
} from './note-layout.ts';
export {
  attachNotesToLayout,
  buildPageRefIndex,
  computeFootnoteReserves,
  filterRefsOnPage,
  fragmentOwnsAtomOffset,
  provisionalNoteMarks,
  MAX_NOTE_OVERFLOW_PAGES,
  MAX_NOTE_REFLOW_ATTEMPTS,
  MAX_EACH_PAGE_MARK_CANDIDATES,
  type NotesLayoutInput,
  type NotesAttachResult,
  type NotePaginationFallbackReason,
  type PageRefIndex,
} from './note-pagination.ts';
export { noteMarkKey, projectedNoteMarkText, type NoteMarkContext } from './note-projection.ts';
export { storyBlocks, noteStoryBlocks, MAX_SDT_NESTING } from './story-roots.ts';
export {
  emptyTocPlaceholderParagraphIds,
  emptyTocSuppressedResultParagraphIds,
  tocFieldChromeParagraphIds,
} from './toc-layout.ts';
export {
  collectFlowBlocks,
  contentControlContentChildren,
  isContentControl,
  isContentControlContent,
} from '../store/package/content-control-walk.ts';
// The boundary RECORD this barrel publishes is the one layout itself paints and hit-tests
// (`semantic-records.ts`). This module derives the same question for a part that is not the
// laid-out story, and its own record type stays module-local so `ContentControlBoundaryRecord`
// names one shape everywhere — `paginated-surface-contract.ts` imports it from here.
export {
  contentControlBoundaries,
  type ContentControlFragmentRecord,
} from './content-control-boundaries.ts';
export {
  W15_NAMESPACE_URI,
  type CommentAnchor,
  type CommentPosition,
  type CommentRecord,
  type CommentThreadState,
} from './review-support.ts';
// The review queue DERIVATION (`collectReviewItems` and its readers) is the pro
// review module's implementation and is deliberately NOT in this package — the
// engine receives it through the `EditorModule` seam. What remains public here
// is the vocabulary and its pure helpers.
export {
  activeReviewItem,
  reviewThreadRootOf,
  commentBodyText,
  commentInitials,
  firstReviewRange,
  paragraphOrderOfPart,
  reviewAnchorIndex,
  reviewItemGeometry,
  reviewItemKey,
  reviewItemPositionRank,
  reviewItemRanges,
  reviewItemsAt,
  type ReviewCommentItem,
  type ReviewCustomItem,
  type ReviewItem,
  type ReviewModelInput,
  type ReviewParagraphAnchor,
  type ReviewPosition,
  type ReviewRange,
  type ReviewRevisionItem,
  type ReviewRevisionKind,
} from './review-support.ts';
export {
  DEFAULT_REVISION_DISPLAY_MODE,
  formatRevisionOf,
  markRevisionRemovesMark,
  paragraphMarkFormatRevisionOf,
  paragraphMarkRevisionOf,
  paragraphMarkRevisionsOf,
  shownMarkRevision,
  revisionsAreDeletion,
  revisionsVisible,
  type RevisionAttribution,
  type RevisionDisplayMode,
  type RevisionKind,
} from './revision-projection.ts';
export {
  createShapedMeasurer,
  type LayoutShapingOptions,
  type ShapedMeasurerOptions,
} from './shaped-measurer.ts';
export {
  DEFAULT_SECTION_PROPERTIES,
  enumerateDocumentSections,
  enumerateDocumentSectionsBounded,
  geometryOfSection,
  MAX_DOCUMENT_SECTIONS,
  paragraphSectionNode,
  parsePageNumbering,
  parseSectionProperties,
  readSectionProperties,
  type DocumentSection,
  type DocumentSectionsEnumeration,
  type SectionBreakType,
  type SectionColumnDefinition,
  type SectionColumns,
  type SectionMargins,
  type SectionPageNumbering,
  type SectionProperties,
} from './section-properties.ts';
export { pagesToMaterialize, type MaterializationInput, type ViewportWindow } from './viewport.ts';
export {
  createParagraphLayoutCache,
  paragraphLayoutKey,
  type LayoutCacheStats,
  type ParagraphKeyInputs,
  type ParagraphLayoutCache,
  type ParagraphLayoutCacheOptions,
} from './layout-cache.ts';
export {
  createLayoutScheduler,
  type LayoutScheduler,
  type LayoutSchedulerOptions,
  type LayoutScope,
} from './layout-scheduler.ts';
export {
  DEFAULT_RUN_STYLE,
  baselineShiftPtOf,
  displayText,
  measureDisplayText,
  resolveRunStyle,
  runStylesEqual,
  type ResolvedRunStyle,
  type ResolvedUnderline,
  type VerticalAlign,
} from './run-style.ts';
export {
  MAX_STYLE_BASED_ON_DEPTH,
  MAX_STYLE_DEFINITIONS,
  buildStyleCascadeTable,
  cascadeParagraphFormatting,
  cascadeRunProperties,
  cascadedBottomBorder,
  isValidStyleId,
  resolveParagraphLayoutInputs,
  type CascadedParagraphFormatting,
  type ParagraphLayoutInputs,
  type StyleCascadeTable,
  type StyleDefinition,
  // Referenced by `SemanticTableCell`: what a table style says about a cell's paragraphs.
  type TableCellStyleFormatting,
} from './style-cascade.ts';
export {
  cellSelectionBetween,
  cellSelectionRects,
  cellSelectionText,
  paragraphsInCells,
  spansInCells,
  tableContextAt,
  type CellSelection,
  type PlacedCell,
  type TableCellContext,
} from './semantic-cell-selection.ts';
export {
  DEFAULT_VERTICAL_WEIGHT,
  contentControlAtPoint,
  findDrawingOverlayFrameInLayout,
  hitTestPage,
  hitTestSheet,
  isFurniturePoint,
  lineEndOffset,
  caretBoxOnLine,
  pageAtY,
  spanOffsetX,
  type DrawingOverlayFrame,
  type HitPoint,
  type HitTestOptions,
  type SemanticHit,
  type SemanticHitDrawing,
  type TableCellAddress,
} from './semantic-hit-test.ts';
export {
  caretAt,
  caretStops,
  caretStopsForBlocks,
  compositionAnchor,
  contentControlAtSemantic,
  contentControlsInLayout,
  documentOrder,
  // `hitTest` is already taken by the legacy painted-geometry lane; this one answers in
  // MODEL coordinates, so it is named for what it returns rather than shadowing that.
  hitTestSemantic,
  moveCaret,
  paragraphTextFromLayout,
  keyedRangeRects,
  selectionRects,
  spansInSelection,
  wordBoundary,
  type CaretAtOptions,
  type CaretGeometry,
  type MoveCaretOptions,
  type NavigationCommand,
  type KeyedRange,
  type SelectionRect,
  type SemanticPosition,
  type SemanticSelection,
} from './semantic-interaction.ts';
export {
  AUTO_PREFERRED_WIDTH,
  CELL_PAD,
  DEFAULT_CELL_MARGINS,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_NESTING,
  MAX_TABLE_ROW_HEIGHT_PT,
  readTableStructure,
  tableOriginX,
  type CellMarginsPt,
  type CellVerticalAlign,
  type PreferredWidth,
  type PreferredWidthType,
  type SemanticTableCell,
  type SemanticTableRow,
  type SemanticTableStructure,
  type TableAlignment,
  type TableRowHeight,
  type TableRowHeightRule,
} from './semantic-table.ts';
export { paragraphMarkDeleted, revisionRemovesParagraph } from './revision-visibility.ts';
export {
  MAX_TABLE_ROW_FRAGMENTS,
  TablePaginationError,
  type TablePaginationErrorCode,
} from './semantic-table-layout.ts';
export {
  borderExtentPt,
  borderWeight,
  COMPOUND_BORDER_MIN_GAP_PT,
  COMPOUND_BORDER_MIN_STROKE_PT,
  computeDoubleBorderMetricsPt,
  effectiveBorderSide,
  MAX_TABLE_BORDER_STROKES,
  readBorderSide,
  readCellBorders,
  readTableBorders,
  resolveBorderConflict,
  resolveTableCellBorderGrid,
  type BorderGridGeometry,
  type CellBorderBox,
  type CompoundBorderMetrics,
  type ResolvedCellBorders,
  type ResolvedTableBorderEdge,
  type ResolvedTableBorderEdgeSegment,
  type TableBorderBox,
  type TableBorderSide,
  type TableBorderSideName,
  type TableBorderStrokeRecord,
  type TableBorderStyle,
} from './table-borders.ts';
