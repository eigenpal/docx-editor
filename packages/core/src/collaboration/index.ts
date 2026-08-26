/**
 * `@docx-editor.dev/core/collaboration` — provider-neutral collaboration contracts.
 *
 * This lane names the attachment between the canonical tree and an optional replication
 * implementation. It performs no networking and imports no CRDT.
 *
 * @packageDocumentation
 * @public
 */

import type { TreeModelChange } from '../store/store/tree-store.ts';
import type { StoryScope } from '../store/store/tree-package-store.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import type { CanonicalPrimitiveJournal } from './primitive-journal.ts';

/** Lifecycle state of one collaboration replica. @public */
export type CollaborationStatus = 'initializing' | 'ready' | 'disconnected' | 'error' | 'destroyed';

/** Human or automation identity attached to authored collaboration transactions. @public */
export interface CollaborationIdentity {
  readonly actorId: string;
  readonly name: string;
  readonly color?: string;
  readonly role?: 'human' | 'agent';
}

/** One validated identity visible through ephemeral collaboration presence. @public */
export interface CollaborationParticipant extends CollaborationIdentity {
  readonly isLocal: boolean;
}

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
}

/**
 * One endpoint of a published selection: a stable paragraph id and a UTF-16 offset.
 *
 * The wire payload carries only these two endpoints. The receiver walks its own canonical
 * tree to find the paragraphs between them, so a select-all does not grow with document size.
 *
 * @public
 */
export interface CollaborationSelectionAddress {
  readonly paragraphId: string;
  readonly offset: number;
}

/**
 * How a published selection covers the document.
 *
 * Absent or omitted means a character range. `cells` means the table rectangle whose
 * corner cells contain the two endpoints. The payload still carries only those endpoints,
 * so a large table selection does not grow with the number of selected cells.
 *
 * @public
 */
export type CollaborationSelectionKind = 'cells';

/**
 * One endpoint of a remote selection resolved into this replica's canonical addresses.
 *
 * `paragraphId` is the stable `w14:paraId`. `nodeId` is replica-local and is used to paint.
 *
 * @public
 */
export interface CollaborationRemoteSelectionAddress {
  readonly paragraphId: string;
  readonly nodeId: string;
  readonly offset: number;
}

/**
 * Stable remote selection resolved into this replica's canonical paragraph addresses.
 *
 * Anchor and head may name different paragraphs. A collapsed caret is the same address twice.
 *
 * @public
 */
export interface CollaborationRemoteSelection {
  readonly actorId: string;
  readonly name: string;
  readonly color?: string;
  readonly anchor: CollaborationRemoteSelectionAddress;
  readonly head: CollaborationRemoteSelectionAddress;
  readonly kind?: CollaborationSelectionKind;
}

/**
 * Selection published by the local editor through ephemeral awareness.
 *
 * Publish an anchor address and a head address. Do not materialize every covered paragraph.
 *
 * @public
 */
export interface CollaborationLocalSelection {
  readonly anchor: CollaborationSelectionAddress;
  readonly head: CollaborationSelectionAddress;
  readonly kind?: CollaborationSelectionKind;
}

/**
 * Optional replication session attached to an editor or headless automation host.
 *
 * Implementations own replication state only. The attached document port remains the authored
 * authority for reads, layout, paint, and save.
 *
 * @public
 */
export interface EditorCollaborationSession {
  readonly documentId: string;
  /** Unique identity for this attachment lifetime. It prevents operation ID reuse after reconnect. */
  readonly sessionId: string;
  readonly identity: CollaborationIdentity;
  status(): CollaborationStatus;
  subscribeStatus(listener: (status: CollaborationStatus, reason?: string) => void): () => void;
  attach(port: CollaborationDocumentPort): () => void;
  gateOperations(ops: readonly TreeDocOp[], scope: StoryScope): string | null;
  canUndo(): boolean;
  canRedo(): boolean;
  undo(): boolean;
  redo(): boolean;
  setLocalSelection(selection: CollaborationLocalSelection | null): void;
  participants(): readonly CollaborationParticipant[];
  subscribeParticipants(
    listener: (participants: readonly CollaborationParticipant[]) => void
  ): () => void;
  remoteSelections(): readonly CollaborationRemoteSelection[];
  subscribeRemoteSelections(
    listener: (selections: readonly CollaborationRemoteSelection[]) => void
  ): () => void;
  /**
   * Publish queued local journals to shared state.
   *
   * Local typing does not wait for replication. Undo, destroy, and page hide call this
   * so a queued journal is never dropped.
   */
  flushPendingJournals(): void;
  destroy(): void;
}

/**
 * Build a replica from the opened document id. Core calls this at most once
 * per mount. `EditorModule` still has no lifecycle hooks.
 *
 * @public
 */
export type CollaborationSessionFactory = (documentId: string) => EditorCollaborationSession;

/**
 * What a collaboration module contributes: the replica the surface attaches.
 *
 * @public
 */
export interface CollaborationModuleContribution {
  /**
   * A ready session, or a factory invoked once at surface mount with the
   * opened package's document id.
   *
   * A ready session is the ordinary path. The host creates the Yjs room, then
   * wraps it with `collaborationModule({ session })`.
   */
  readonly session: EditorCollaborationSession | CollaborationSessionFactory;
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
