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
export const ENGINE_LAYOUT_PACKAGE = '@docx-editor.dev/engine-layout' as const;

export {
  type Anchor,
  type TextItem,
  type RectItem,
  type CaretEdgeItem,
  type VisualLineIdentity,
  type DisplayItem,
  type Page,
  type LayoutResult,
} from './display-item.ts';
export { type MetricsPort, DeterministicMetrics, HelveticaMetrics } from './metrics.ts';
export {
  type ShapingCapability,
  PER_GRAPHEME_SHAPING,
  ASCII_LATIN_SHAPING,
  UNSUPPORTED_SHAPING,
  type LigatureInteriorCaret,
  type CharacterAdvanceProvable,
} from './shaping.ts';
export { layoutParagraphInBox, type ParagraphLayoutSink } from './paragraph-layout.ts';
export {
  isWholeGraphemeHorizontalBoundary,
  isGeometryTrustedCaretOffset,
  isCumulativeGeometryTrustedFromLineOrigin,
  semanticHorizontalBoundaries,
} from './horizontal-boundary.ts';
export { type LayoutOptions, layoutBody, hitTest } from './layout.ts';
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
  type CacheProvenance,
  type CacheMiss,
  type CacheLookup,
  ResolvedCache,
} from './resolved-cache.ts';
