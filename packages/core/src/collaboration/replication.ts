/**
 * `@docx-editor.dev/core/collaboration/replication` — the seam a replication implementation
 * binds to, not the surface a host consumes.
 *
 * Everything here exists for the layer BETWEEN a CRDT and the canonical tree: the document
 * port an adapter writes through, the primitive journal it reads, and the descriptors that
 * journal is made of. A host that renders presence and reads a status needs none of it, which
 * is why it lives behind its own subpath — autocomplete on
 * `@docx-editor.dev/core/collaboration` should not offer `putXmlPart` and `spliceChildren` to
 * somebody wiring up an avatar stack.
 *
 * Reach for this when you are writing a provider. `@docx-editor.dev/pro` is one.
 *
 * @packageDocumentation
 * @public
 */

import type { TreeModelChange } from '../store/store/tree-store.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import type { CanonicalPrimitiveJournal } from './primitive-journal.ts';

/** One existing body paragraph exposed to the replication adapter. @public */
export interface CollaborationParagraph {
  /** Uppercase `w14:paraId`, stable across save and reopen. */
  readonly paragraphId: string;
  /** Replica-local canonical node identity. Never sent as wire identity. */
  readonly nodeId: string;
  /** Current canonical UTF-16 text. */
  readonly text: string;
}

/** Attribution for one collaboration-derived canonical publication. @public */
export interface CollaborationMutation {
  readonly origin: string;
  readonly actorId: string;
  readonly operationId: string;
}

/** One paragraph text value in an atomic collaboration publication. @public */
export interface CollaborationParagraphTextUpdate {
  readonly paragraphId: string;
  readonly text: string;
}

/** Result of replacing one supported paragraph's canonical text. @public */
export type CollaborationApplyResult =
  | { readonly ok: true; readonly changed: boolean }
  | { readonly ok: false; readonly reason: string };

/**
 * Narrow canonical document capability handed to a collaboration implementation.
 *
 * It deliberately exposes no mutable package or tree store. Every write returns through the
 * same validated transaction path as browser and automation edits.
 *
 * @public
 */
export interface CollaborationDocumentPort {
  readonly documentId: string;
  paragraphs(): readonly CollaborationParagraph[];
  paragraphByNodeId(nodeId: string): CollaborationParagraph | null;
  /**
   * Resolve a stable `w14:paraId` in any story this replica holds.
   *
   * `paragraphs()` stays body-only because text publication transacts against the body
   * store. Presence may name a header, a footer, a note, or a cell, so this lookup covers
   * those parts too. It resolves through an index, not a scan, because a remote caret
   * resolves two addresses per selection on every caret move.
   */
  paragraphByStableId(paragraphId: string): CollaborationParagraph | null;
  applyParagraphText(
    paragraphId: string,
    text: string,
    mutation: CollaborationMutation
  ): CollaborationApplyResult;
  applyParagraphTexts(
    updates: readonly CollaborationParagraphTextUpdate[],
    mutation: CollaborationMutation
  ): CollaborationApplyResult;
  /**
   * Publish one remotely materialized canonical package as one revision.
   *
   * The package is frozen canonical state. This port exposes no mutable store or CRDT.
   */
  applyRemotePackage(pkg: OoxmlPackage, mutation: CollaborationMutation): CollaborationApplyResult;
  revision(): number;
  subscribe(listener: (change: TreeModelChange) => void): () => void;
  /**
   * Observe one settled primitive journal per committed canonical transaction.
   *
   * Disabled observation allocates no journal. This is the collaboration write seam;
   * adapters never write a CRDT through this port.
   */
  observePrimitiveJournal(listener: (journal: CanonicalPrimitiveJournal) => void): () => void;
  /** True when a committed journal has not yet been frozen or delivered to observers. */
  hasPendingJournals(): boolean;
  /**
   * Freeze and deliver queued journals in production order.
   *
   * Local edit, layout, and paint do not wait for this. Tests and teardown call it
   * instead of sleeping on the publication timer.
   */
  flushPendingJournals(): void;
  save(): Uint8Array;
  /** Bytes of one binary package part, or null when the part is absent. */
  binaryPart(storageKey: string): Uint8Array | null;
}

export {
  createCollaborationDocumentPort,
  type CreateCollaborationDocumentPortOptions,
} from './document-port.ts';
export type {
  CanonicalAttributeName,
  CanonicalBinaryDescriptor,
  CanonicalElementNodeDescriptor,
  CanonicalNodeDescriptor,
  CanonicalPrimitiveEffect,
  CanonicalPrimitiveJournal,
  CanonicalRelationshipRecord,
  CanonicalTextNodeDescriptor,
} from './primitive-journal.ts';
