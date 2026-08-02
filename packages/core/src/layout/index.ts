// @docx-editor.dev/engine-layout
//
// Layout: resolved caches, dependency closure, shaping, convergent pagination, and the anchored DisplayItem[] IR. DOM-free — emits positioned geometry, never paints.
//
// Production placement is fixed by document-engine task 1.4. Responsibilities and
// dependency rules: docs/architecture/production-engine-packages.md. This is a
// greenfield skeleton; capability implementation lands in the sections that own it.
//
// ADR-S9: production modules MUST NOT import from packages/core/spike/**.

/** Stable package identity used by the import-graph / package-authority checks. */
export const ENGINE_LAYOUT_PACKAGE = '@docx-editor.dev/core-contract/layout' as const;

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
  fragmentsOfParagraph,
  lineAtPosition,
  linesOf,
  paragraphFragmentsOf,
  type BlockFragmentRecord,
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
  type ParagraphSpacing,
  type SemanticLayout,
  type SourceRange,
  type StyleSpanRecord,
  type TableCellFragmentRecord,
  type TableFragmentRecord,
  type TableRowFragmentRecord,
  type TextMeasurer,
} from './semantic-records.ts';
export {
  MAX_BORDER_SPACE_PT,
  MAX_BORDER_WIDTH_PT,
  MAX_PARAGRAPH_SPACING_PT,
  PARAGRAPH_BORDER_SIDES,
  SINGLE_LINE_SPACING,
  appliedSpaceBefore,
  applyLineSpacing,
  paragraphBorderExtentPt,
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
export { storyBlocks } from './story-roots.ts';
export {
  createShapedMeasurer,
  type LayoutShapingOptions,
  type ShapedMeasurerOptions,
} from './shaped-measurer.ts';
export {
  DEFAULT_SECTION_PROPERTIES,
  enumerateDocumentSections,
  geometryOfSection,
  paragraphSectionNode,
  parseSectionProperties,
  readSectionProperties,
  type DocumentSection,
  type SectionBreakType,
  type SectionMargins,
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
  displayText,
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
  paragraphsInCells,
  spansInCells,
  type CellSelection,
  type PlacedCell,
} from './semantic-cell-selection.ts';
export {
  DEFAULT_VERTICAL_WEIGHT,
  hitTestPage,
  hitTestSheet,
  isFurniturePoint,
  lineEndOffset,
  pageAtY,
  type HitPoint,
  type HitTestOptions,
  type SemanticHit,
  type TableCellAddress,
} from './semantic-hit-test.ts';
export {
  caretAt,
  caretStops,
  compositionAnchor,
  documentOrder,
  // `hitTest` is already taken by the legacy painted-geometry lane; this one answers in
  // MODEL coordinates, so it is named for what it returns rather than shadowing that.
  hitTestSemantic,
  moveCaret,
  paragraphTextFromLayout,
  selectionRects,
  spansInSelection,
  wordBoundary,
  type CaretGeometry,
  type NavigationCommand,
  type SelectionRect,
  type SemanticPosition,
  type SemanticSelection,
} from './semantic-interaction.ts';
export {
  CELL_PAD,
  DEFAULT_CELL_MARGINS,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_NESTING,
  readTableStructure,
  type CellMarginsPt,
  type CellVerticalAlign,
  type SemanticTableCell,
  type SemanticTableRow,
  type SemanticTableStructure,
} from './semantic-table.ts';
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
