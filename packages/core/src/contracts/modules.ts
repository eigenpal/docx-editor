/**
 * `EditorModule` — the narrow seam capability packages register through.
 *
 * NOT a plugin system. The shape is closed: every contribution point is named
 * here, core iterates registered modules at its existing dispatch points, and
 * core never imports a capability package. A capability absent from this file
 * is not extendable from outside — deliberately, so the one-pipeline principle
 * survives the packaging boundary.
 *
 * The free engine behaves identically with an empty registry: documents
 * round-trip losslessly, revisions render in their final-state projection, and
 * the review chrome slots stay disabled with the engine's own reason.
 */

import type { OoxmlPart } from '@docx-editor.dev/core/store';
import type { RevisionDisplayMode } from '../layout/revision-projection.ts';
import type { ReviewItem, ReviewModelInput, ReviewRevisionItem } from '../layout/review-support.ts';

export type { ReviewModelInput };

/**
 * Derives the review queue — every pending revision decision and comment
 * thread — from one story part plus its comment parts. Implemented by the pro
 * review module; the free engine has no implementation and reports an empty
 * queue.
 *
 * @public
 */
export type CollectReviewItems = (input: ReviewModelInput) => readonly ReviewItem[];

/**
 * What a review module contributes: the queue derivation, and the revision
 * display modes the editor may enter beyond the free tier's final-state
 * projection.
 *
 * @public
 */
export interface ReviewModuleContribution {
  /**
   * Display modes this module unlocks (the free engine renders `proposed` only).
   *
   * Currently DECLARATIVE: any registered review module restores the layout
   * default (`all-markup`), and no runtime mode switch exists yet. The list is
   * carried so the future `setRevisionDisplayMode` command can validate against
   * it without a breaking module-shape change.
   */
  readonly displayModes: readonly RevisionDisplayMode[];
  /** The review queue derivation. */
  readonly collectReviewItems: CollectReviewItems;
  /**
   * Revisions wholly inside one paragraph — for the conservative local review
   * patch after a text-local body edit.
   */
  readonly revisionItemsOfParagraph: (
    part: OoxmlPart,
    paragraphId: string
  ) => readonly ReviewRevisionItem[];
}

/**
 * One registered capability module. Registration is construction-time
 * (`createDocxEditor({ modules })`) and immutable for the instance's lifetime.
 *
 * @public
 */
export interface EditorModule {
  /** Diagnostic identity (`'review'`, `'custom-nodes'`); not a dispatch key. */
  readonly id: string;
  /** Review capability: queue derivation, commands gate, display modes. */
  readonly review?: ReviewModuleContribution;
  /**
   * Custom inline node definitions. Reserved: the definition shape lands with
   * the custom-nodes lane; the registry carries them opaquely until then.
   */
  readonly customNodes?: readonly unknown[];
}

/**
 * The resolved registry the editor instance holds: at most one review
 * contribution (first registration wins), all custom node definitions in
 * registration order.
 */
export interface EditorModuleRegistry {
  readonly review: ReviewModuleContribution | null;
  readonly customNodes: readonly unknown[];
}

const EMPTY_REGISTRY: EditorModuleRegistry = Object.freeze({
  review: null,
  customNodes: Object.freeze([]) as readonly unknown[],
});

/** Resolve construction-time modules into the registry the instance dispatches over. */
export function resolveEditorModules(
  modules: readonly EditorModule[] | undefined
): EditorModuleRegistry {
  if (!modules || modules.length === 0) return EMPTY_REGISTRY;
  let review: ReviewModuleContribution | null = null;
  const customNodes: unknown[] = [];
  for (const module of modules) {
    // First registration wins: two review modules is a configuration mistake,
    // and silently merging them would leave neither author able to say which
    // derivation runs. The second is ignored rather than throwing — a module
    // list assembled from independent sources must not take the editor down.
    if (module.review && review === null) review = module.review;
    if (module.customNodes) customNodes.push(...module.customNodes);
  }
  return { review, customNodes };
}
