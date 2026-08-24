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
  applyParagraphText(
    paragraphId: string,
    text: string,
    mutation: CollaborationMutation
  ): CollaborationApplyResult;
  revision(): number;
  subscribe(listener: (change: TreeModelChange) => void): () => void;
  save(): Uint8Array;
}

/** Stable remote selection resolved into this replica's canonical paragraph address. @public */
export interface CollaborationRemoteSelection {
  readonly actorId: string;
  readonly name: string;
  readonly color?: string;
  readonly paragraphId: string;
  readonly nodeId: string;
  readonly start: number;
  readonly end: number;
}

/** Selection published by the local editor through ephemeral awareness. @public */
export interface CollaborationLocalSelection {
  readonly paragraphId: string;
  readonly start: number;
  readonly end: number;
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
  destroy(): void;
}

export {
  createCollaborationDocumentPort,
  type CreateCollaborationDocumentPortOptions,
} from './document-port.ts';
