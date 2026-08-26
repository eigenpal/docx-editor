/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Full-document collaboration over the canonical primitive journal.
 *
 * Local direction: the canonical store commits, emits ONE journal, and the journal is applied
 * to shared state in one Yjs transaction. Remote direction: a shared-state change materializes
 * one canonical package, which the port publishes as one revision. The two never chase each
 * other, because a remote publication deliberately emits no journal.
 */

import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import {
  ORIGIN_IDS,
  TreePackageStore,
  normalizeParagraphIdentity,
  readOoxmlPackage,
  writeOoxmlPackage,
  type OoxmlPackage,
  type StoryScope,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import type {
  CanonicalPrimitiveJournal,
  CollaborationDocumentPort,
  CollaborationFailure,
  CollaborationFailureCode,
  CollaborationIdentity,
  CollaborationLocalSelection,
  CollaborationParticipant,
  CollaborationRemoteSelection,
  CollaborationStatus,
  CollaborationStatusSnapshot,
} from '@docx-editor.dev/core/collaboration';
import { createCollaborationStatusTracker } from '@docx-editor.dev/core/collaboration';
import {
  DocumentRegistry,
  PackageMaterializer,
  applyPrimitiveJournal,
  seedPackage,
} from './document/index.ts';
import {
  binaryPartReaderOf,
  collectJournalBinaryPayloads,
  publishBinaryPayloads,
  type BinaryPayload,
} from './document/seed.ts';
import { droppedContentDetail } from './document/schema.ts';
import { SharedBlobStore, limitFailure } from './shared-blob-store.ts';
import { LogicalIdentityMap } from './document-identity.ts';
import { CollaborationSchemaError } from './schema.ts';
import type {
  CollaborationBootstrap,
  CollaborationHandle,
  TextCollaborationSession,
} from './session.ts';

const AWARENESS_FIELD = 'docxEditor';
const BLOBS_KEY = 'docx-package-blobs-v1';
const MAX_IDENTITY_LENGTH = 256;
const MAX_AWARENESS_STATES = 256;
const MAX_BASELINE_BYTES = 20 * 1024 * 1024;
const DEFAULT_INITIALIZATION_TIMEOUT_MS = 30_000;
/** One refused journal recovers; a run of them means the next edit refuses too. */
const MAX_REFUSALS_IN_A_ROW = 3;
/** Local journals inside this window share one actor undo item. */
const UNDO_CAPTURE_TIMEOUT_MS = 5_000;

interface EncodedSelectionAddress {
  readonly paragraphId: string;
  readonly offset: number;
}

interface EncodedSelection {
  readonly anchor: EncodedSelectionAddress;
  readonly head: EncodedSelectionAddress;
  readonly kind?: 'cells';
}

interface AwarenessPayload {
  readonly actorId: string;
  readonly name: string;
  readonly color?: string;
  readonly role: 'human' | 'agent';
  readonly selection?: EncodedSelection;
}

function validateIdentity(identity: CollaborationIdentity): CollaborationIdentity {
  const actorId = identity.actorId.trim();
  const name = identity.name.trim();
  if (
    actorId.length === 0 ||
    actorId.length > MAX_IDENTITY_LENGTH ||
    name.length === 0 ||
    name.length > MAX_IDENTITY_LENGTH
  ) {
    throw new CollaborationSchemaError('invalid-identity');
  }
  if (identity.color !== undefined && identity.color.length > 64) {
    throw new CollaborationSchemaError('invalid-identity-color');
  }
  return Object.freeze({
    actorId,
    name,
    ...(identity.color ? { color: identity.color } : {}),
    role: identity.role ?? 'human',
  });
}

function validateDocumentId(value: string): string {
  const documentId = value.trim();
  if (documentId.length === 0 || documentId.length > MAX_IDENTITY_LENGTH) {
    throw new CollaborationSchemaError('invalid-document-id');
  }
  return documentId;
}

function sessionIdentity(value: string | undefined): string {
  const sessionId = value?.trim() || globalThis.crypto.randomUUID();
  if (sessionId.length > MAX_IDENTITY_LENGTH) {
    throw new CollaborationSchemaError('invalid-session-id');
  }
  return sessionId;
}

/** Normalized canonical package for the creator's baseline bytes. */
function openBaselinePackage(bytes: Uint8Array): OoxmlPackage {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new CollaborationSchemaError('invalid-baseline');
  }
  if (bytes.byteLength > MAX_BASELINE_BYTES) {
    throw new CollaborationSchemaError('baseline-too-large');
  }
  const loaded = readOoxmlPackage(bytes, {
    zip: { maxEntries: 10_000, maxTotalBytes: MAX_BASELINE_BYTES, maxRatio: 200 },
  });
  if (!loaded.ok) throw new CollaborationSchemaError('invalid-baseline');
  const main = loaded.package.parts.get(loaded.package.mainDocumentPart);
  if (!main) throw new CollaborationSchemaError('no-main-document-part');
  const store = new TreePackageStore(loaded.package, normalizeParagraphIdentity(main));
  return store.currentPackage();
}

function encodedSelectionAddress(value: unknown): EncodedSelectionAddress | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.paragraphId !== 'string' ||
    record.paragraphId.length !== 8 ||
    !Number.isSafeInteger(record.offset) ||
    (record.offset as number) < 0
  ) {
    return null;
  }
  return { paragraphId: record.paragraphId.toUpperCase(), offset: record.offset as number };
}

function encodedSelection(value: unknown): EncodedSelection | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const selected = value as Record<string, unknown>;
  const anchor = encodedSelectionAddress(selected.anchor);
  const head = encodedSelectionAddress(selected.head);
  if (anchor && head) {
    return selected.kind === 'cells' ? { anchor, head, kind: 'cells' } : { anchor, head };
  }
  if (
    typeof selected.paragraphId === 'string' &&
    selected.paragraphId.length === 8 &&
    Number.isSafeInteger(selected.start) &&
    Number.isSafeInteger(selected.end) &&
    (selected.start as number) >= 0 &&
    (selected.end as number) >= 0
  ) {
    const paragraphId = selected.paragraphId.toUpperCase();
    return {
      anchor: { paragraphId, offset: selected.start as number },
      head: { paragraphId, offset: selected.end as number },
    };
  }
  return undefined;
}

function awarenessPayload(value: unknown): AwarenessPayload | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.actorId !== 'string' ||
    record.actorId.length === 0 ||
    record.actorId.length > MAX_IDENTITY_LENGTH ||
    typeof record.name !== 'string' ||
    record.name.length === 0 ||
    record.name.length > MAX_IDENTITY_LENGTH
  ) {
    return null;
  }
  const color =
    typeof record.color === 'string' && record.color.length <= 64 ? record.color : undefined;
  const role: 'human' | 'agent' = record.role === 'agent' ? 'agent' : 'human';
  const base = { actorId: record.actorId, name: record.name, ...(color ? { color } : {}), role };
  const selection = encodedSelection(record.selection);
  return selection ? { ...base, selection } : base;
}

class DocumentSession implements DocumentCollaborationSession {
  readonly documentId: string;
  readonly sessionId: string;
  readonly identity: CollaborationIdentity;
  private readonly statusState = createCollaborationStatusTracker();
  private readonly statusListeners = new Set<
    (status: CollaborationStatus, reason?: CollaborationFailureCode, detail?: string) => void
  >();
  private readonly selectionListeners = new Set<
    (selections: readonly CollaborationRemoteSelection[]) => void
  >();
  private readonly participantListeners = new Set<
    (participants: readonly CollaborationParticipant[]) => void
  >();
  private readonly localOrigin = Object.freeze({ kind: 'docx-document-local' });
  private readonly undoManager: Y.UndoManager;
  private port: CollaborationDocumentPort | null = null;
  private detachPort: (() => void) | null = null;
  private applyingRemote = false;
  private realignedInBatch = false;
  private remoteCounter = 0;
  private destroyed = false;
  private refusedInARow = 0;
  private readonly stopBlobWatch: () => void;

  constructor(
    private readonly ydoc: Y.Doc,
    private readonly awareness: Awareness,
    documentId: string,
    sessionId: string,
    identity: CollaborationIdentity,
    private readonly registry: DocumentRegistry,
    private readonly materializer: PackageMaterializer,
    private readonly identityMap: LogicalIdentityMap,
    private readonly blobs: SharedBlobStore
  ) {
    this.documentId = documentId;
    this.sessionId = sessionId;
    this.identity = identity;
    this.undoManager = new Y.UndoManager([...registry.trackedTypes()], {
      trackedOrigins: new Set([this.localOrigin]),
      captureTimeout: UNDO_CAPTURE_TIMEOUT_MS,
      deleteFilter: registry.undoDeleteFilter(),
    });
    ydoc.on('afterTransaction', this.onYjsTransaction);
    awareness.on('change', this.onAwarenessChange);
    this.stopBlobWatch = blobs.observeChanges((digests) => {
      const poisoned = blobs.verifyNow(digests);
      if (poisoned) this.setStatus('error', 'blob-digest-mismatch', poisoned);
    });
    this.publishAwareness();
    this.setStatus('ready');
  }

  status(): CollaborationStatus {
    return this.statusState.status();
  }

  statusSnapshot(): CollaborationStatusSnapshot {
    return this.statusState.snapshot();
  }

  subscribeStatus(
    listener: (
      status: CollaborationStatus,
      reason?: CollaborationFailureCode,
      detail?: string
    ) => void
  ): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  setTransportStatus(status: 'ready' | 'disconnected' | 'error', reason?: string): void {
    if (this.destroyed) return;
    if (this.statusState.status() === 'error' && status !== 'error') return;
    if (reason !== undefined && reason.length > 0) {
      this.setStatus(status, 'transport', reason);
      return;
    }
    this.setStatus(status);
  }

  attach(port: CollaborationDocumentPort): () => void {
    // Hosts call this from a layout effect. A throw unmounts the editor instead of
    // leaving it mounted on the degraded status the host already renders.
    const refused = this.refuseAttach(port);
    if (refused) return refused;
    this.port = port;
    this.publishSharedToPort();
    const stopJournal = port.observePrimitiveJournal((journal) => {
      if (this.destroyed || this.applyingRemote) return;
      // A realign already took shared state back over this store, so every journal still queued
      // behind the refused one describes edits the store no longer holds. Applying them would
      // push content to the room that this author cannot see locally. The refusal status reports
      // the loss; re-publishing it silently would be the worse outcome.
      if (this.realignedInBatch) return;
      this.applyJournal(journal);
    });
    this.detachPort = () => {
      // Detach runs from an unmount, which is a task boundary: a remote update can have landed
      // since the last commit. While publication was deferred, that made this the second place
      // a journal could reach shared state against a tree it was not diffed against. Commits
      // now publish before `transact` returns, so there is nothing here to go stale. The drain
      // stays for the one case that can still leave an item queued — a journal listener that
      // transacts on the store it is publishing.
      this.flushPendingJournals();
      stopJournal();
      if (this.port === port) this.port = null;
      this.detachPort = null;
    };
    return () => this.detachPort?.();
  }

  /** Return a no-op detach when this replica cannot accept a port. Never throw. */
  private refuseAttach(port: CollaborationDocumentPort): (() => void) | null {
    if (this.destroyed) return () => {};
    if (this.port) {
      // Re-attaching the SAME port is the benign case a remount produces, and the live
      // attachment already observes it. A DIFFERENT port is not benign: this session observes
      // one journal, so that port would never publish a keystroke while the status still read
      // `ready`. Report it, because a silently unreplicated surface is the worse outcome.
      if (this.port !== port) this.setStatus('error', 'port-already-attached');
      return () => {};
    }
    if (port.documentId !== this.documentId) {
      this.setStatus('error', 'document-id-mismatch');
      return () => {};
    }
    return null;
  }

  /** Every authorable mutation replicates, so only session readiness gates a write. */
  gateOperations(_ops: readonly TreeDocOp[], _scope: StoryScope): CollaborationFailureCode | null {
    if (this.destroyed) return 'collaboration-session-destroyed';
    if (this.statusState.status() !== 'ready') return 'collaboration-session-not-ready';
    if (!this.port) return 'collaboration-session-not-attached';
    return null;
  }

  canUndo(): boolean {
    return (
      !this.destroyed &&
      ((this.port?.hasPendingJournals() ?? false) || this.undoManager.undoStack.length > 0)
    );
  }

  canRedo(): boolean {
    return !this.destroyed && this.undoManager.redoStack.length > 0;
  }

  undo(): boolean {
    if (this.destroyed) return false;
    this.flushPendingJournals();
    if (this.undoManager.undoStack.length === 0) return false;
    this.undoManager.undo();
    return true;
  }

  redo(): boolean {
    if (this.destroyed) return false;
    this.flushPendingJournals();
    if (this.undoManager.redoStack.length === 0) return false;
    this.undoManager.redo();
    return true;
  }

  /**
   * Drain anything still queued.
   *
   * A commit publishes before `transact` returns, so this is a no-op on the ordinary path. It
   * stays public because headless hosts call it after every batch, and because a journal
   * listener that transacts on the store it is publishing is the one case that can leave an
   * item queued for a moment.
   */
  flushPendingJournals(): void {
    this.port?.flushPendingJournals();
  }

  setLocalSelection(selection: CollaborationLocalSelection | null): void {
    if (this.destroyed) return;
    if (!selection) {
      this.publishAwareness();
      return;
    }
    this.publishAwareness({
      anchor: {
        paragraphId: selection.anchor.paragraphId.toUpperCase(),
        offset: Math.max(0, selection.anchor.offset),
      },
      head: {
        paragraphId: selection.head.paragraphId.toUpperCase(),
        offset: Math.max(0, selection.head.offset),
      },
      ...(selection.kind === 'cells' ? { kind: 'cells' as const } : {}),
    });
  }

  participants(): readonly CollaborationParticipant[] {
    const participants: CollaborationParticipant[] = [];
    const states = [...this.awareness.getStates().entries()].slice(0, MAX_AWARENESS_STATES);
    for (const [clientId, state] of states) {
      const payload = awarenessPayload((state as Record<string, unknown>)[AWARENESS_FIELD]);
      if (!payload) continue;
      participants.push({
        actorId: payload.actorId,
        name: payload.name,
        ...(payload.color ? { color: payload.color } : {}),
        role: payload.role,
        isLocal: clientId === this.awareness.clientID,
      });
    }
    return Object.freeze(participants);
  }

  subscribeParticipants(
    listener: (participants: readonly CollaborationParticipant[]) => void
  ): () => void {
    this.participantListeners.add(listener);
    return () => this.participantListeners.delete(listener);
  }

  remoteSelections(): readonly CollaborationRemoteSelection[] {
    const port = this.port;
    if (!port) return [];
    const resolve = (
      address: EncodedSelectionAddress
    ): CollaborationRemoteSelection['anchor'] | null => {
      const paragraph = port.paragraphByStableId(address.paragraphId);
      if (!paragraph) return null;
      return Object.freeze({
        paragraphId: paragraph.paragraphId,
        nodeId: paragraph.nodeId,
        offset: Math.min(address.offset, paragraph.text.length),
      });
    };
    const states = [...this.awareness.getStates().entries()].slice(0, MAX_AWARENESS_STATES);
    const selections: CollaborationRemoteSelection[] = [];
    for (const [clientId, state] of states) {
      if (clientId === this.awareness.clientID) continue;
      const payload = awarenessPayload((state as Record<string, unknown>)[AWARENESS_FIELD]);
      if (!payload?.selection) continue;
      const anchor = resolve(payload.selection.anchor);
      const head = resolve(payload.selection.head);
      if (!anchor || !head) continue;
      selections.push(
        Object.freeze({
          actorId: payload.actorId,
          name: payload.name,
          ...(payload.color ? { color: payload.color } : {}),
          ...(payload.selection.kind === 'cells' ? { kind: 'cells' as const } : {}),
          anchor,
          head,
        })
      );
    }
    return Object.freeze(selections);
  }

  subscribeRemoteSelections(
    listener: (selections: readonly CollaborationRemoteSelection[]) => void
  ): () => void {
    this.selectionListeners.add(listener);
    return () => this.selectionListeners.delete(listener);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.flushPendingJournals();
    this.detachPort?.();
    this.destroyed = true;
    this.stopBlobWatch();
    this.ydoc.off('afterTransaction', this.onYjsTransaction);
    this.awareness.off('change', this.onAwarenessChange);
    this.awareness.setLocalState(null);
    this.undoManager.destroy();
    this.materializer.destroy();
    this.setStatus('destroyed');
    this.statusListeners.clear();
    this.selectionListeners.clear();
    this.participantListeners.clear();
  }

  private applyJournal(journal: CanonicalPrimitiveJournal): void {
    const shared = this.identityMap.translate(journal);
    const blobs = this.collectJournalBlobs(journal);
    if (blobs !== null && blobs.ok === false) {
      this.refuseLocalJournal(blobs.failure);
      return;
    }
    const refusal = this.ydoc.transact((): CollaborationFailure | null => {
      if (blobs !== null) {
        const published = this.putJournalBlobs(blobs.payloads);
        if (published !== null) return published;
      }
      const result = applyPrimitiveJournal(this.registry, shared);
      if (!result.ok) {
        return {
          code: result.code as CollaborationFailureCode,
          ...(result.detail ? { detail: result.detail } : {}),
        };
      }
      return null;
    }, this.localOrigin);
    if (refusal === null) {
      this.refusedInARow = 0;
      return;
    }
    this.refuseLocalJournal(refusal);
  }

  /**
   * Resolve local binary bytes named by this journal before the Yjs transaction opens.
   *
   * `putBinary` carries a digest, not the bytes. A peer that applies the descriptor
   * without the payload fails materialize with `missing-blob` and keeps the old
   * document — the image paste never arrives, even when the story text did.
   * Bytes already live in the local package; a save/re-parse would walk every XML
   * node while the transaction is open.
   */
  private collectJournalBlobs(
    journal: CanonicalPrimitiveJournal
  ):
    | { readonly ok: true; readonly payloads: readonly BinaryPayload[] }
    | { readonly ok: false; readonly failure: CollaborationFailure }
    | null {
    const port = this.port;
    if (!port) {
      const needed = journal.effects.some((effect) => effect.kind === 'putBinary');
      return needed
        ? {
            ok: false,
            failure: Object.freeze({ code: 'collaboration-session-not-attached' as const }),
          }
        : null;
    }
    const collected = collectJournalBinaryPayloads(journal.effects, binaryPartReaderOf(port));
    if (collected === null) return null;
    if (!collected.ok) {
      return { ok: false, failure: Object.freeze(collected.failure) };
    }
    return collected;
  }

  private putJournalBlobs(payloads: readonly BinaryPayload[]): CollaborationFailure | null {
    try {
      publishBinaryPayloads(this.blobs, payloads);
    } catch (error) {
      return error instanceof CollaborationSchemaError
        ? Object.freeze({
            code: error.code,
            ...(error.detail ? { detail: error.detail } : {}),
          })
        : Object.freeze({ code: 'blob-store-full' as const });
    }
    return null;
  }

  private refuseLocalJournal(refusal: CollaborationFailure): void {
    this.undoManager.stopCapturing();
    // The local store already committed this edit, so leaving it would make this replica
    // silently different from the room. Shared state is the authority: take it back.
    this.refusedInARow += 1;
    this.setStatus('error', refusal.code, refusal.detail);
    this.publishSharedToPort();
    // The flush loop took the whole batch before notifying, so the journals after this one are
    // already in flight. A microtask is the earliest point the synchronous batch is over.
    this.realignedInBatch = true;
    queueMicrotask(() => {
      this.realignedInBatch = false;
    });
    // A realigned replica agrees with the room again, so it can keep editing. Staying in
    // `error` for one refusal would leave this author silently read-only for the life of the
    // room. Repeated refusals are a different case: they mean the next edit will refuse too,
    // so the session stops pretending it is healthy.
    const current = this.statusState.snapshot().reason;
    if (
      this.refusedInARow < MAX_REFUSALS_IN_A_ROW &&
      this.statusState.status() === 'error' &&
      current !== undefined &&
      current.code === refusal.code &&
      current.detail === refusal.detail
    ) {
      this.setStatus('ready');
    }
  }

  private readonly onYjsTransaction = (transaction: Y.Transaction): void => {
    if (this.destroyed || !this.port) return;
    // The canonical store already holds a local commit. Materializing it back would rebuild
    // the package for an edit the store authored.
    if (transaction.origin === this.localOrigin) return;
    // Nothing is published from here. A journal describes the tree as it stood when its
    // transaction committed, and its `spliceText` / `spliceChildren` positions are absolute.
    // This update has already integrated, so applying a journal now would address the wrong
    // offset or the wrong sibling — inside bounds, so admitted, so agreed on by every replica.
    // Journals reach shared state in the frame that commits them instead, which is why there
    // is nothing left to publish at this point.
    this.publishSharedToPort();
  };

  private publishSharedToPort(): void {
    const port = this.port;
    if (!port || this.applyingRemote) return;
    this.applyingRemote = true;
    try {
      const exceeded = limitFailure(this.registry, this.blobs);
      if (exceeded) {
        this.setStatus('error', exceeded.code, exceeded.detail);
        return;
      }
      const materialized = this.materializer.current();
      // After materializing, because that is what reads the blobs and so what hashes them.
      const poisoned = this.blobs.poisonedDigest();
      if (poisoned) {
        this.setStatus('error', 'blob-digest-mismatch', poisoned);
        return;
      }
      if (!materialized.ok) {
        this.setStatus('error', materialized.code);
        return;
      }
      // The materializer repairs shared state it cannot express as a tree, and repair means
      // leaving something out. Dropping the issue list made that repair silent: a room could
      // converge on a document missing a peer's paragraph and still report `ready`. This does
      // not apply the package either, because rendering a document already known to be short
      // of content is the one outcome worse than refusing.
      const dropped = droppedContentDetail(materialized.issues);
      if (dropped) {
        this.setStatus('error', 'materialize-dropped-content', dropped);
        return;
      }
      this.remoteCounter += 1;
      const result = port.applyRemotePackage(materialized.package, {
        origin: ORIGIN_IDS.mutationRemote,
        actorId: 'remote',
        operationId: `${this.sessionId}:remote:${this.remoteCounter}`,
      });
      if (!result.ok) {
        this.setStatus('error', 'remote-apply-failed', result.reason);
        return;
      }
      // Every node in the canonical tree now carries a logical id, so no local mapping is
      // live. Keeping one would let a re-minted canonical id resolve to the wrong node.
      if (result.changed) this.identityMap.reset();
    } catch (error) {
      this.setStatus(
        'error',
        error instanceof CollaborationSchemaError ? error.code : 'remote-apply-failed',
        error instanceof CollaborationSchemaError ? error.detail : undefined
      );
    } finally {
      this.applyingRemote = false;
    }
  }

  private readonly onAwarenessChange = (): void => {
    if (this.destroyed) return;
    const selections = this.remoteSelections();
    for (const listener of [...this.selectionListeners]) listener(selections);
    const participants = this.participants();
    for (const listener of [...this.participantListeners]) listener(participants);
  };

  private publishAwareness(selection?: EncodedSelection): void {
    const payload: AwarenessPayload = {
      actorId: this.identity.actorId,
      name: this.identity.name,
      ...(this.identity.color ? { color: this.identity.color } : {}),
      role: this.identity.role ?? 'human',
      ...(selection ? { selection } : {}),
    };
    this.awareness.setLocalStateField(AWARENESS_FIELD, payload);
  }

  private setStatus(
    status: CollaborationStatus,
    code?: CollaborationFailureCode,
    detail?: string
  ): void {
    if (!this.statusState.set(status, code, detail)) return;
    const snapshot = this.statusState.snapshot();
    for (const listener of [...this.statusListeners]) {
      listener(snapshot.status, snapshot.reason?.code, snapshot.reason?.detail);
    }
  }
}

function sharedBinariesReady(registry: DocumentRegistry, blobs: SharedBlobStore): boolean {
  for (const descriptor of registry.binaries()) {
    if (!blobs.has(descriptor.digest)) return false;
  }
  return true;
}

function waitForSharedInitialization(
  registry: DocumentRegistry,
  blobs: SharedBlobStore,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<void> {
  const meta = registry.schema.meta;
  const ready = (): boolean =>
    meta.get('initialized') === true && sharedBinariesReady(registry, blobs);
  // A blob that does not hash to its key reads as absent here, so without this the wait ends in
  // `initialization-timeout` — a joiner told to retry a room that will never satisfy it.
  const poison = (): CollaborationSchemaError | null => {
    const digest = blobs.poisonedDigest();
    return digest ? new CollaborationSchemaError('blob-digest-mismatch', digest) : null;
  };
  if (ready()) return Promise.resolve();
  const poisonedNow = poison();
  if (poisonedNow) return Promise.reject(poisonedNow);
  if (signal?.aborted) {
    return Promise.reject(new CollaborationSchemaError('initialization-aborted'));
  }
  return new Promise((resolve, reject) => {
    const finish = (error?: Error): void => {
      clearTimeout(timer);
      meta.unobserve(onChange);
      registry.doc.off('afterTransaction', onChange);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onChange = (): void => {
      const poisoned = poison();
      if (poisoned) {
        finish(poisoned);
        return;
      }
      if (ready()) finish();
    };
    const onAbort = (): void => finish(new CollaborationSchemaError('initialization-aborted'));
    const timer = setTimeout(
      () => finish(new CollaborationSchemaError('initialization-timeout')),
      timeoutMs
    );
    meta.observe(onChange);
    registry.doc.on('afterTransaction', onChange);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Full-document collaboration session.
 *
 * The public seam matches {@link TextCollaborationSession}.
 * @public
 */
export type DocumentCollaborationSession = TextCollaborationSession;

/** Owned full-document collaboration replica. @public */
export type DocumentCollaborationHandle = CollaborationHandle<DocumentCollaborationSession>;

/**
 * Options for one full-document collaboration replica.
 *
 * The caller owns `ydoc`.
 * @public
 */
export interface CreateDocumentCollaborationOptions {
  readonly ydoc: Y.Doc;
  readonly awareness: Awareness;
  readonly documentId: string;
  /** Unique attachment identity. Omit it to generate a new identity for this session. */
  readonly sessionId?: string;
  readonly identity: CollaborationIdentity;
  readonly bootstrap: CollaborationBootstrap;
}

/**
 * Create or join one full-document collaboration replica.
 *
 * The caller owns `ydoc`.
 * @public
 */
export async function createDocumentCollaboration(
  options: CreateDocumentCollaborationOptions
): Promise<DocumentCollaborationHandle> {
  const documentId = validateDocumentId(options.documentId);
  const sessionId = sessionIdentity(options.sessionId);
  const identity = validateIdentity(options.identity);
  const registry = new DocumentRegistry(options.ydoc);
  const identityMap = new LogicalIdentityMap((logicalId) => registry.hasNode(logicalId));
  const blobs = new SharedBlobStore(options.ydoc.getMap<Uint8Array>(BLOBS_KEY));

  if (options.bootstrap.kind === 'create') {
    if (registry.schema.meta.get('initialized') === true) {
      throw new CollaborationSchemaError('already-initialized');
    }
    const seeded = await seedPackage(
      registry,
      openBaselinePackage(options.bootstrap.document),
      blobs
    );
    if (!seeded.ok) throw new CollaborationSchemaError(seeded.code);
    options.ydoc.transact(() => {
      registry.schema.meta.set('documentId', documentId);
    });
  } else {
    await waitForSharedInitialization(
      registry,
      blobs,
      options.bootstrap.timeoutMs ?? DEFAULT_INITIALIZATION_TIMEOUT_MS,
      options.bootstrap.signal
    );
    if (registry.schema.meta.get('documentId') !== documentId) {
      throw new CollaborationSchemaError('document-id-mismatch');
    }
    // Shared state can arrive before this registry exists, and the derived parent index is
    // built from child-array EVENTS. Without one rebuild here a joiner materializes a
    // document with no known parents.
    registry.rebuildDerivedIndexes();
  }

  const exceeded = limitFailure(registry, blobs);
  if (exceeded) throw new CollaborationSchemaError(exceeded.code, exceeded.detail);

  const materializer = new PackageMaterializer(registry, blobs);
  const materialized = materializer.current();
  const poisoned = blobs.poisonedDigest();
  if (poisoned) {
    materializer.destroy();
    // A blob that does not hash to its key reads downstream as a blob that is not there. Say
    // which it was, so a poisoned room is not reported as a truncated one.
    throw new CollaborationSchemaError('blob-digest-mismatch', poisoned);
  }
  if (!materialized.ok) {
    materializer.destroy();
    throw new CollaborationSchemaError(materialized.code);
  }
  const session = new DocumentSession(
    options.ydoc,
    options.awareness,
    documentId,
    sessionId,
    identity,
    registry,
    materializer,
    identityMap,
    blobs
  );
  return Object.freeze({
    document: writeOoxmlPackage(materialized.package),
    session,
    destroy: () => session.destroy(),
  });
}
