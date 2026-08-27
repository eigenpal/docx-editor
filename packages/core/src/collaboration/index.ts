/**
 * `@docx-editor.dev/core/collaboration` — provider-neutral collaboration contracts.
 *
 * This lane names the attachment between the canonical tree and an optional replication
 * implementation. It performs no networking and imports no CRDT.
 *
 * @packageDocumentation
 * @public
 */

import type { StoryScope } from '../store/store/tree-package-store.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';
import type { CollaborationDocumentPort } from './replication.ts';

export { safeParticipantColor } from './participant-color.ts';
export {
  createCollaborationStatusTracker,
  isCollaborationFailureCode,
  type CollaborationFailure,
  type CollaborationFailureCode,
  type CollaborationStatus,
  type CollaborationStatusSnapshot,
} from './failure.ts';
import type {
  CollaborationFailureCode,
  CollaborationStatus,
  CollaborationStatusSnapshot,
} from './failure.ts';

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
  /**
   * Cached status, current reason, and last failure.
   *
   * Same reference until any of those values change. A host that mounts after a
   * recovered error still reads {@link CollaborationStatusSnapshot.lastFailure}.
   */
  statusSnapshot(): CollaborationStatusSnapshot;
  subscribeStatus(
    listener: (
      status: CollaborationStatus,
      reason?: CollaborationFailureCode,
      detail?: string
    ) => void
  ): () => void;
  attach(port: CollaborationDocumentPort): () => void;
  /**
   * Whether an editor has attached its document port to this replica.
   *
   * False means edits do not replicate, whatever `status()` says — the usual cause is a host
   * that did not remount the editor when the session appeared, so `collaborationModule`
   * never attached. That mistake used to be reachable only as a `console.warn`, which a
   * production build discards; this is the same fact as a value a host can render.
   */
  readonly attached: boolean;
  gateOperations(ops: readonly TreeDocOp[], scope: StoryScope): CollaborationFailureCode | null;
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
 * What a collaboration module contributes: the replica the surface attaches.
 *
 * @public
 */
export interface CollaborationModuleContribution {
  /**
   * A ready session. The host creates the Yjs room, then wraps it with
   * `collaborationModule({ session })`.
   *
   * Core does not build a session from a document id: the opened package has
   * no collaboration room identity. That identity is chosen before mount.
   */
  readonly session: EditorCollaborationSession;
}
