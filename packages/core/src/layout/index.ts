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
  type Anchor,
  type TextItem,
  type TextGlyphCluster,
  type RectItem,
  type CaretEdgeItem,
  type VisualLineIdentity,
  type DisplayItem,
  type Page,
  type LayoutResult,
} from './display-item.ts';
export {
  type LayoutShapingOptions,
  type DeterministicLayoutShapingOptions,
  createDeterministicLayoutShaping,
} from './metrics.ts';
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
export { layoutParagraphInBox, type ParagraphLayoutSink } from './paragraph-layout.ts';
export {
  shapedHorizontalBoundaries,
  isWholeGraphemeHorizontalBoundary,
  isGeometryTrustedCaretOffset,
  isCumulativeGeometryTrustedFromLineOrigin,
  semanticHorizontalBoundaries,
} from './horizontal-boundary.ts';
export {
  LayoutNormalizationError,
  LayoutOperationRestartError,
  type LayoutOptions,
  layoutBody,
  hitTest,
} from './layout.ts';
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
  type LayoutBuilder,
  type BlockLayoutContext,
  type BlockLayout,
  type BlockDependencies,
  registerBlockLayout,
  layoutBlock,
  hasBlockLayout,
  assertLayoutLaneComplete,
  registerBlockDependencies,
  blockDependencies,
  registerBlockSemanticRole,
  blockSemanticRole,
  hitOwner,
  hasLayoutMetadata,
} from './block-layout.ts';
export {
  type DependencyKind,
  type DependencyKey,
  keyId,
  DependencyGraph,
} from './dependency-graph.ts';
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
  type LayoutBox,
  type LineRecord,
  type PageGeometry,
  type PageRecord,
  type ParagraphFragmentRecord,
  type SemanticLayout,
  type SourceRange,
  type StyleSpanRecord,
  type TextMeasurer,
} from './semantic-records.ts';
export {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
  type LayoutSession,
  type LayoutSessionStats,
  type SemanticLayoutOptions,
} from './semantic-layout.ts';
export { createShapedMeasurer, type ShapedMeasurerOptions } from './shaped-measurer.ts';
export {
  DEFAULT_SECTION_PROPERTIES,
  geometryOfSection,
  readSectionProperties,
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
