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
  CollaborationIdentity,
  CollaborationLocalSelection,
  CollaborationParticipant,
  CollaborationRemoteSelection,
  CollaborationStatus,
} from '@docx-editor.dev/core/collaboration';
import {
  DocumentRegistry,
  PackageMaterializer,
  applyPrimitiveJournal,
  seedPackage,
  type BlobBytesStore,
} from './document/index.ts';
import { LogicalIdentityMap } from './document-identity.ts';
import { CollaborationSchemaError } from './schema.ts';
import type {
  YjsCollaborationBootstrap,
  YjsCollaborationRoom,
  YjsCollaborationSession,
} from './session.ts';

const AWARENESS_FIELD = 'docxEditor';
const BLOBS_KEY = 'docx-package-blobs-v1';
const MAX_IDENTITY_LENGTH = 256;
const MAX_AWARENESS_STATES = 256;
const MAX_BASELINE_BYTES = 20 * 1024 * 1024;
const MAX_SHARED_BLOB_BYTES = 64 * 1024 * 1024;
const DEFAULT_INITIALIZATION_TIMEOUT_MS = 30_000;
/** One refused journal recovers; a run of them means the next edit refuses too. */
const MAX_REFUSALS_IN_A_ROW = 3;
/** Local journals inside this window share one actor undo item. */
const UNDO_CAPTURE_TIMEOUT_MS = 5_000;

function bindPageLifecycleFlush(flush: () => void): () => void {
  const doc = typeof document === 'undefined' ? undefined : document;
  const view = typeof window === 'undefined' ? undefined : window;
  if (!doc || !view) return () => {};
  const onVisibilityChange = (): void => {
    if (doc.visibilityState === 'hidden') flush();
  };
  const onPageHide = (): void => {
    flush();
  };
  doc.addEventListener('visibilitychange', onVisibilityChange);
  view.addEventListener('pagehide', onPageHide);
  return () => {
    doc.removeEventListener('visibilitychange', onVisibilityChange);
    view.removeEventListener('pagehide', onPageHide);
  };
}

interface EncodedSelectionAddress {
  readonly paragraphId: string;
  readonly offset: number;
}

interface EncodedSelection {
  readonly anchor: EncodedSelectionAddress;
  readonly head: EncodedSelectionAddress;
}

interface AwarenessPayload {
  readonly actorId: string;
  readonly name: string;
  readonly color?: string;
  readonly role: 'human' | 'agent';
  readonly selection?: EncodedSelection;
}

/**
 * Content-addressed bytes carried beside shared state.
 *
 * Digests are immutable, so two replicas writing the same key write the same bytes and no
 * conflict is possible. Bytes stay out of the node registry, which keeps a one-character edit
 * from re-encoding an image.
 */
class SharedBlobStore implements BlobBytesStore {
  constructor(private readonly shared: Y.Map<Uint8Array>) {}

  get(digest: string): Uint8Array | null {
    const bytes = this.shared.get(digest);
    return bytes instanceof Uint8Array ? new Uint8Array(bytes) : null;
  }

  put(digest: string, bytes: Uint8Array): void {
    if (this.shared.has(digest)) return;
    let total = bytes.byteLength;
    this.shared.forEach((value) => {
      total += value instanceof Uint8Array ? value.byteLength : 0;
    });
    if (total > MAX_SHARED_BLOB_BYTES) throw new CollaborationSchemaError('blob-store-full');
    this.shared.set(digest, new Uint8Array(bytes));
  }
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
  if (anchor && head) return { anchor, head };
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

class DocumentSession implements YjsCollaborationSession {
  readonly documentId: string;
  readonly sessionId: string;
  readonly identity: CollaborationIdentity;
  private currentStatus: CollaborationStatus = 'initializing';
  private statusReason: string | undefined;
  private readonly statusListeners = new Set<
    (status: CollaborationStatus, reason?: string) => void
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
  private unbindPageLifecycle: (() => void) | null = null;

  constructor(
    private readonly ydoc: Y.Doc,
    private readonly awareness: Awareness,
    documentId: string,
    sessionId: string,
    identity: CollaborationIdentity,
    private readonly registry: DocumentRegistry,
    private readonly materializer: PackageMaterializer,
    private readonly identityMap: LogicalIdentityMap
  ) {
    this.documentId = documentId;
    this.sessionId = sessionId;
    this.identity = identity;
    this.undoManager = new Y.UndoManager([...registry.trackedTypes()], {
      trackedOrigins: new Set([this.localOrigin]),
      captureTimeout: UNDO_CAPTURE_TIMEOUT_MS,
    });
    ydoc.on('afterTransaction', this.onYjsTransaction);
    awareness.on('change', this.onAwarenessChange);
    this.unbindPageLifecycle = bindPageLifecycleFlush(() => this.flushPendingJournals());
    this.publishAwareness();
    this.setStatus('ready');
  }

  status(): CollaborationStatus {
    return this.currentStatus;
  }

  subscribeStatus(listener: (status: CollaborationStatus, reason?: string) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  setTransportStatus(status: 'ready' | 'disconnected' | 'error', reason?: string): void {
    if (this.destroyed) return;
    if (this.currentStatus === 'error' && status !== 'error') return;
    this.setStatus(status, reason);
  }

  attach(port: CollaborationDocumentPort): () => void {
    if (this.destroyed) throw new CollaborationSchemaError('session-destroyed');
    if (this.port) throw new CollaborationSchemaError('session-already-attached');
    if (port.documentId !== this.documentId) {
      throw new CollaborationSchemaError('document-id-mismatch');
    }
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
      this.flushPendingJournals();
      stopJournal();
      if (this.port === port) this.port = null;
      this.detachPort = null;
    };
    return () => this.detachPort?.();
  }

  /** Every authorable mutation replicates, so only session readiness gates a write. */
  gateOperations(_ops: readonly TreeDocOp[], _scope: StoryScope): string | null {
    if (this.destroyed) return 'collaboration-session-destroyed';
    if (this.currentStatus !== 'ready') return 'collaboration-session-not-ready';
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
    const paragraphs = new Map(
      port.paragraphs().map((paragraph) => [paragraph.paragraphId, paragraph])
    );
    const resolve = (
      address: EncodedSelectionAddress
    ): CollaborationRemoteSelection['anchor'] | null => {
      const paragraph = paragraphs.get(address.paragraphId);
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
    this.unbindPageLifecycle?.();
    this.unbindPageLifecycle = null;
    this.detachPort?.();
    this.destroyed = true;
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
    let refusal: string | null = null;
    const shared = this.identityMap.translate(journal);
    this.ydoc.transact(() => {
      const result = applyPrimitiveJournal(this.registry, shared);
      if (!result.ok) refusal = result.detail ? `${result.code}: ${result.detail}` : result.code;
    }, this.localOrigin);
    if (refusal === null) {
      this.refusedInARow = 0;
      return;
    }
    this.undoManager.stopCapturing();
    // The local store already committed this edit, so leaving it would make this replica
    // silently different from the room. Shared state is the authority: take it back.
    this.refusedInARow += 1;
    this.setStatus('error', refusal);
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
    if (
      this.refusedInARow < MAX_REFUSALS_IN_A_ROW &&
      this.currentStatus === 'error' &&
      this.statusReason === refusal
    ) {
      this.setStatus('ready');
    }
  }

  private readonly onYjsTransaction = (transaction: Y.Transaction): void => {
    if (this.destroyed || !this.port) return;
    // The canonical store already holds a local commit. Materializing it back would rebuild
    // the package for an edit the store authored.
    if (transaction.origin === this.localOrigin) return;
    // A QUEUED local journal describes the tree as it stood before this remote update. Publishing
    // shared state first replaces that tree and resets the identity map underneath the queue, so
    // the edit would refuse, or land against a node it no longer addresses. Publication is
    // deferred and reschedules itself while `isInputPending` is true, so the window is widest
    // exactly when the author holds a key down — the case that loses the most work. Yjs runs a
    // transaction opened from this handler after the current cleanup instead of nesting it, so
    // flushing here is safe.
    this.flushPendingJournals();
    this.publishSharedToPort();
  };

  private publishSharedToPort(): void {
    const port = this.port;
    if (!port || this.applyingRemote) return;
    this.applyingRemote = true;
    try {
      const materialized = this.materializer.current();
      if (!materialized.ok) {
        this.setStatus('error', materialized.code);
        return;
      }
      this.remoteCounter += 1;
      const result = port.applyRemotePackage(materialized.package, {
        origin: ORIGIN_IDS.mutationRemote,
        actorId: 'remote',
        operationId: `${this.sessionId}:remote:${this.remoteCounter}`,
      });
      if (!result.ok) {
        this.setStatus('error', result.reason);
        return;
      }
      // Every node in the canonical tree now carries a logical id, so no local mapping is
      // live. Keeping one would let a re-minted canonical id resolve to the wrong node.
      if (result.changed) this.identityMap.reset();
    } catch (error) {
      this.setStatus(
        'error',
        error instanceof CollaborationSchemaError ? error.code : 'remote-apply-failed'
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

  private setStatus(status: CollaborationStatus, reason?: string): void {
    if (this.currentStatus === status && this.statusReason === reason) return;
    this.currentStatus = status;
    this.statusReason = reason;
    for (const listener of [...this.statusListeners]) listener(status, reason);
  }
}

function waitForSharedInitialization(
  registry: DocumentRegistry,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<void> {
  const meta = registry.schema.meta;
  if (meta.get('initialized') === true) return Promise.resolve();
  if (signal?.aborted) {
    return Promise.reject(new CollaborationSchemaError('initialization-aborted'));
  }
  return new Promise((resolve, reject) => {
    const finish = (error?: Error): void => {
      clearTimeout(timer);
      meta.unobserve(onChange);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onChange = (): void => {
      if (meta.get('initialized') === true) finish();
    };
    const onAbort = (): void => finish(new CollaborationSchemaError('initialization-aborted'));
    const timer = setTimeout(
      () => finish(new CollaborationSchemaError('initialization-timeout')),
      timeoutMs
    );
    meta.observe(onChange);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Options for one full-document Yjs collaboration replica. @public */
export interface CreateDocumentCollaborationOptions {
  readonly ydoc: Y.Doc;
  readonly awareness: Awareness;
  readonly documentId: string;
  /** Unique attachment identity. Omit it to generate a new identity for this session. */
  readonly sessionId?: string;
  readonly identity: CollaborationIdentity;
  readonly bootstrap: YjsCollaborationBootstrap;
}

/** Create or join one full-document Yjs collaboration replica. @public */
export async function createDocumentCollaboration(
  options: CreateDocumentCollaborationOptions
): Promise<YjsCollaborationRoom> {
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

  const materializer = new PackageMaterializer(registry, blobs);
  const materialized = materializer.current();
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
    identityMap
  );
  return Object.freeze({
    document: writeOoxmlPackage(materialized.package),
    session,
    destroy: () => session.destroy(),
  });
}
