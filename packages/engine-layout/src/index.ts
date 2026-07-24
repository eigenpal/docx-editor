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
  type DisplayItem,
  type Page,
  type LayoutResult,
} from './display-item.ts';
export { type MetricsPort, DeterministicMetrics, HelveticaMetrics } from './metrics.ts';
export { type LayoutOptions, layoutBody, hitTest } from './layout.ts';
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
export { type DependencyKind, type DependencyKey, keyId, DependencyGraph } from './dependency-graph.ts';
export {
  type OperationSnapshot,
  type CacheProvenance,
  type CacheMiss,
  type CacheLookup,
  ResolvedCache,
} from './resolved-cache.ts';
