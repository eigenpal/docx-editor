/**
 * `@docx-editor.dev/core/contracts/modules` — the `EditorModule` seam.
 *
 * How a paid or optional capability contributes to the engine without the free tier importing
 * it: the review module and custom nodes both arrive through here, and their absence leaves the
 * corresponding chrome disabled with the engine's own reason.
 *
 * NOT a plugin system. The shape is closed: every contribution point is named
 * here, core iterates registered modules at its existing dispatch points, and
 * core never imports a capability package. A capability absent from this file
 * is not extendable from outside — deliberately, so the one-pipeline principle
 * survives the packaging boundary.
 * The free engine behaves identically with an empty registry: documents
 * round-trip losslessly, revisions render in their final-state projection, and
 * the review chrome slots stay disabled with the engine's own reason.
 *
 * @packageDocumentation
 * @public
 */

import type { OoxmlPart } from '@docx-editor.dev/core/store';
import type { CollaborationModuleContribution } from '../collaboration/index.ts';
import type { RevisionDisplayMode } from '../layout/revision-projection.ts';
import type {
  ReviewItem,
  ReviewModelInput,
  ReviewRevisionItem,
} from '../store/store/review-items.ts';

// `ReviewModuleContribution` hands all four of these to an implementor, so this entry point —
// the one a capability package is written against — has to let it name them. Re-exported here
// rather than left in `layout/` and `store/` for the same reason the editor contract re-exports
// its review vocabulary: a module author is not importing those lanes.
export type { ReviewModelInput };
export type { CommentRecord } from '../store/store/comment-reads.ts';
export type {
  ReviewCommentItem,
  ReviewCustomItem,
  ReviewItem,
  ReviewRange,
  ReviewPosition,
  ReviewRevisionItem,
  ReviewRevisionKind,
} from '../store/store/review-items.ts';
// `OoxmlPart` is the argument `revisionItemsOfParagraph` takes, so it belongs here. The rest of
// the canonical tree deliberately does NOT: re-exporting `OoxmlElement` pulls its ~85-member
// node union onto this entry point, which would make the module seam the second published
// definition of the document model. A module author reaches the tree at
// `@docx-editor.dev/core/store`, which is a published subpath written for exactly that.
export type { OoxmlPart, RevisionAddress } from '@docx-editor.dev/core/store';
export type { RevisionDisplayMode } from '../layout/revision-projection.ts';

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
 * The replica the surface attaches. The host passes a ready session.
 *
 * @public
 */
export type { CollaborationModuleContribution };

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
   * Collaboration replica. Absent, the editor stays single-user: local undo
   * stays the authority, and `snapshot().collaborationStatus` is `'inactive'`.
   */
  readonly collaboration?: CollaborationModuleContribution;
  /**
   * Custom inline node definitions. Reserved: the definition shape lands with
   * the custom-nodes lane; the registry carries them opaquely until then.
   */
  readonly customNodes?: readonly unknown[];
  /**
   * customXml payload namespaces this module OWNS, swept for orphans when a document opens.
   *
   * A payload lives in a customXml data part, and Word will not delete one when a user deletes
   * the control bound to it — nothing in OOXML asks it to. So a document can arrive holding
   * payloads for chips that no longer exist, and reconciling against what the story actually
   * binds is the only thing that collects them.
   *
   * The claim is what keeps the sweep off other people's stores: Word's own Cover Page
   * Properties store rides in most templates, and a sweep that walked every customXml part
   * would be deleting from it on the strength of a name collision. A namespace no module names
   * is never touched.
   */
  readonly customNodePayloadNamespaces?: readonly string[];
  /**
   * Told when the recognition pass finds something wrong with a node in THIS editor's document.
   *
   * Carried per module rather than kept by the capability package, so two editors on one page
   * hear only their own documents and a detached editor's listener goes with it. The shape is
   * opaque here for the same reason `customNodes` is: what a diagnostic means belongs to the
   * package that raised it.
   */
  readonly onCustomNodeDiagnostic?: (diagnostic: unknown) => void;
}

/**
 * The resolved registry the editor instance holds: at most one review
 * contribution and at most one collaboration contribution (first registration
 * wins for each), all custom node definitions in registration order.
 */
export interface EditorModuleRegistry {
  readonly review: ReviewModuleContribution | null;
  readonly collaboration: CollaborationModuleContribution | null;
  readonly customNodes: readonly unknown[];
  /** Every claimed payload namespace, deduplicated, in registration order. */
  readonly customNodePayloadNamespaces: readonly string[];
  /** Every registered diagnostic listener, in registration order. */
  readonly customNodeDiagnostics: readonly ((diagnostic: unknown) => void)[];
}

const EMPTY_REGISTRY: EditorModuleRegistry = Object.freeze({
  review: null,
  collaboration: null,
  customNodes: Object.freeze([]) as readonly unknown[],
  customNodePayloadNamespaces: Object.freeze([]) as readonly string[],
  customNodeDiagnostics: Object.freeze([]) as readonly ((diagnostic: unknown) => void)[],
});

/** Resolve construction-time modules into the registry the instance dispatches over. */
export function resolveEditorModules(
  modules: readonly EditorModule[] | undefined
): EditorModuleRegistry {
  if (!modules || modules.length === 0) return EMPTY_REGISTRY;
  let review: ReviewModuleContribution | null = null;
  let collaboration: CollaborationModuleContribution | null = null;
  const customNodes: unknown[] = [];
  const namespaces = new Set<string>();
  const diagnostics: ((diagnostic: unknown) => void)[] = [];
  for (const module of modules) {
    // First registration wins: two review modules is a configuration mistake,
    // and silently merging them would leave neither author able to say which
    // derivation runs. The second is ignored rather than throwing — a module
    // list assembled from independent sources must not take the editor down.
    if (module.review && review === null) review = module.review;
    // Same rule as review: two collaboration modules is a configuration
    // mistake, and silently merging two sessions would leave neither author
    // able to say which replica attaches. The second is ignored rather than
    // throwing — a module list assembled from independent sources must not
    // take the editor down.
    if (module.collaboration && collaboration === null) {
      collaboration = module.collaboration;
    }
    if (module.customNodes) customNodes.push(...module.customNodes);
    for (const namespace of module.customNodePayloadNamespaces ?? []) namespaces.add(namespace);
    if (module.onCustomNodeDiagnostic) diagnostics.push(module.onCustomNodeDiagnostic);
  }
  return {
    review,
    collaboration,
    customNodes,
    customNodePayloadNamespaces: [...namespaces],
    customNodeDiagnostics: diagnostics,
  };
}
