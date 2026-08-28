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
  writeOoxmlPackage,
  type StoryScope,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import type {
  CollaborationFailure,
  CollaborationFailureCode,
  CollaborationIdentity,
  CollaborationLocalSelection,
  CollaborationParticipant,
  CollaborationRemoteSelection,
  CollaborationStatus,
  CollaborationStatusSnapshot,
} from '@docx-editor.dev/core/collaboration';
import type {
  CanonicalPrimitiveJournal,
  CollaborationDocumentPort,
} from '@docx-editor.dev/core/collaboration/replication';
import {
  createCollaborationStatusTracker,
  safeParticipantColor,
} from '@docx-editor.dev/core/collaboration';
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
import { SHARED_BLOBS_KEY, SharedBlobStore, limitFailure } from './shared-blob-store.ts';
import {
  DEFAULT_INITIALIZATION_TIMEOUT_MS,
  observeSeedRecords,
  openBaselinePackage,
  runCreateOrJoinBootstrap,
  seedRecordCount,
  waitForSharedInitialization,
} from './document-bootstrap.ts';
import { LogicalIdentityMap } from './document-identity.ts';
import { resourceUsageOf, type CollaborationResourceUsage } from './resource-usage.ts';
import {
  AWARENESS_FIELD,
  MAX_AWARENESS_STATES,
  MAX_IDENTITY_LENGTH,
  awarenessPayload,
  sessionIdentity,
  validateDocumentId,
  validateIdentity,
  type AwarenessPayload,
  type EncodedSelection,
  type EncodedSelectionAddress,
} from './document-awareness.ts';
import { CollaborationSchemaError } from './schema.ts';
import type {
  CollaborationBootstrap,
  CollaborationHandle,
  CollaborationIdentityUpdate,
  TextCollaborationSession,
} from './session.ts';

/** One refused journal recovers; a run of them means the next edit refuses too. */
const MAX_REFUSALS_IN_A_ROW = 3;
/** Local journals inside this window share one actor undo item. */
const UNDO_CAPTURE_TIMEOUT_MS = 5_000;
/** After this long with no attached document port, the session warns that nothing replicates. */
const ATTACH_WATCHDOG_MS = 2_000;

/**
 * Test-only override for the attach watchdog delay. Not re-exported from
 * `@docx-editor.dev/pro/collaboration`.
 *
 * @internal
 */
export const ATTACH_WATCHDOG_MS_FOR_TESTS: unique symbol = Symbol(
  'createDocumentCollaboration.attachWatchdogMs'
);

class DocumentSession implements DocumentCollaborationSession {
  readonly documentId: string;
  readonly sessionId: string;
  private currentIdentity: CollaborationIdentity;
  private currentSelection: EncodedSelection | undefined;
  private attachWatchdog: ReturnType<typeof setTimeout> | null = null;
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
  /** Journals a `change` subscriber committed while a remote install ran. Never dropped. */
  private readonly journalsHeldDuringRemote: CanonicalPrimitiveJournal[] = [];
  private drainingHeldJournals = false;
  private remoteCounter = 0;
  /** Declined-tangle events already reconciled into the author's store (#581). */
  private seenDeclinedTangles = 0;
  private destroyed = false;
  private refusedInARow = 0;
  private readonly stopBlobWatch: () => void;
  private readonly stopSeedWatch: () => void;

  constructor(
    private readonly ydoc: Y.Doc,
    private readonly awareness: Awareness,
    documentId: string,
    sessionId: string,
    identity: CollaborationIdentity,
    private readonly registry: DocumentRegistry,
    private readonly materializer: PackageMaterializer,
    private readonly identityMap: LogicalIdentityMap,
    private readonly blobs: SharedBlobStore,
    attachWatchdogMs: number,
    private readonly offlineEditing: boolean
  ) {
    this.documentId = documentId;
    this.sessionId = sessionId;
    this.currentIdentity = identity;
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
    // A second seed record means two seed transactions merged: every paragraph exists twice
    // and no client can pick one side. Terminal by design — every replica that observes the
    // merged array reports the same code, with no repair attempt.
    this.stopSeedWatch = observeSeedRecords(ydoc, () => {
      this.setStatus('error', 'concurrent-seed');
    });
    // A session that is never attached still reports `ready`, and in the connect-later flow a
    // missed `key` remount silently stops replication. The failure codes are a closed core
    // union with only terminal statuses, so this cannot be a typed non-fatal warning; a
    // one-shot console.warn is the honest surface. Cleared on attach and on destroy.
    this.attachWatchdog = setTimeout(() => {
      this.attachWatchdog = null;
      if (this.destroyed || this.port) return;
      console.warn(
        `[docx-editor] The collaboration session for "${this.documentId}" was created ` +
          `${attachWatchdogMs}ms ago and no editor attached its document port. The session ` +
          `reports "ready" but no edits replicate. Remount the editor when the session ` +
          `appears — for example pass key={session.sessionId} — so ` +
          `collaborationModule({ session }) attaches it.`
      );
    }, attachWatchdogMs);
    // Browsers have no unref; destroy clears the timer. Guarded unref keeps a short-lived
    // Node host from waiting on the watchdog.
    (this.attachWatchdog as { unref?: () => void }).unref?.();
  }

  get identity(): CollaborationIdentity {
    return this.currentIdentity;
  }

  private clearAttachWatchdog(): void {
    if (this.attachWatchdog === null) return;
    clearTimeout(this.attachWatchdog);
    this.attachWatchdog = null;
  }

  status(): CollaborationStatus {
    return this.statusState.status();
  }

  statusSnapshot(): CollaborationStatusSnapshot {
    return this.statusState.snapshot();
  }

  resourceUsage(): CollaborationResourceUsage {
    return resourceUsageOf(this.registry, this.blobs);
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

  setTransportStatus(
    status: 'ready' | 'disconnected' | 'error',
    reason?: CollaborationFailureCode,
    detail?: string
  ): void {
    if (this.destroyed) return;
    if (this.statusState.status() === 'error' && status !== 'error') return;
    if (reason !== undefined) {
      this.setStatus(status, reason, detail);
      return;
    }
    this.setStatus(status);
  }

  get attached(): boolean {
    return this.port !== null;
  }

  attach(port: CollaborationDocumentPort): () => void {
    // Hosts call this from a layout effect. A throw unmounts the editor instead of
    // leaving it mounted on the degraded status the host already renders.
    const refused = this.refuseAttach(port);
    if (refused) return refused;
    this.clearAttachWatchdog();
    this.port = port;
    this.publishSharedToPort();
    const stopJournal = port.observePrimitiveJournal((journal) => {
      if (this.destroyed) return;
      // A `change` subscriber that transacts while this session installs a remote package
      // commits its edit locally and publishes its journal into this window. Dropping it
      // here left that edit on this replica alone — never replicated, never refused, status
      // `ready` — which is the silent divergence a refusal exists to prevent. The journal is
      // held instead and applied the moment the install finishes; see the drain in
      // `publishSharedToPort` for why its positions stay sound.
      if (this.applyingRemote) {
        this.journalsHeldDuringRemote.push(journal);
        return;
      }
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

  /**
   * The one readiness rule for writing shared state from this replica.
   *
   * A journal applies to the local Y.Doc either way, so a `disconnected` replica can keep
   * editing and its buffered updates merge on reconnect exactly as concurrent online edits
   * do. Only the host can show an offline indicator, so it opts in. `initializing` stays
   * refused (the bootstrap has not published a first revision) and `error` stays terminal.
   */
  private canWriteSharedState(): boolean {
    if (this.destroyed) return false;
    const status = this.statusState.status();
    return status === 'ready' || (this.offlineEditing && status === 'disconnected');
  }

  /** Every authorable mutation replicates, so only session readiness gates a write. */
  gateOperations(_ops: readonly TreeDocOp[], _scope: StoryScope): CollaborationFailureCode | null {
    if (this.destroyed) return 'collaboration-session-destroyed';
    if (!this.canWriteSharedState()) return 'collaboration-session-not-ready';
    if (!this.port) return 'collaboration-session-not-attached';
    return null;
  }

  // Undo and redo write shared state exactly as a keystroke does — Y.UndoManager reverses the
  // room's history and every peer applies the result — so they obey the same readiness rule
  // the operation gate applies. Without it a replica in terminal `error`, which the gate has
  // declared diverged and read-only, kept mutating the room through Ctrl+Z.
  canUndo(): boolean {
    return (
      this.canWriteSharedState() &&
      ((this.port?.hasPendingJournals() ?? false) || this.undoManager.undoStack.length > 0)
    );
  }

  canRedo(): boolean {
    return this.canWriteSharedState() && this.undoManager.redoStack.length > 0;
  }

  undo(): boolean {
    if (!this.canWriteSharedState()) return false;
    this.flushPendingJournals();
    // The flush can refuse the queued journal and take this session to terminal `error`,
    // so the gate re-checks: undo must not write a room the session just diverged from.
    if (!this.canWriteSharedState()) return false;
    if (this.undoManager.undoStack.length === 0) return false;
    this.undoManager.undo();
    return true;
  }

  redo(): boolean {
    if (!this.canWriteSharedState()) return false;
    this.flushPendingJournals();
    if (!this.canWriteSharedState()) return false;
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

  setIdentity(update: CollaborationIdentityUpdate): void {
    if (this.destroyed) return;
    const name = update.name === undefined ? this.currentIdentity.name : update.name.trim();
    if (name.length === 0 || name.length > MAX_IDENTITY_LENGTH) {
      throw new CollaborationSchemaError('invalid-identity');
    }
    let color = this.currentIdentity.color;
    if (update.color !== undefined) {
      if (update.color.length > 64) {
        throw new CollaborationSchemaError('invalid-identity-color');
      }
      // The same gate the painter applies. An unsafe value is dropped, not thrown, so a
      // rejected color degrades to the accent fallback instead of blocking the rename.
      color = safeParticipantColor(update.color);
    }
    // `actorId` and `role` are attribution, not presentation. A partial cannot name them, and
    // any extra runtime property is ignored.
    this.currentIdentity = Object.freeze({
      actorId: this.currentIdentity.actorId,
      name,
      ...(color ? { color } : {}),
      role: this.currentIdentity.role ?? 'human',
    });
    this.publishAwareness(this.currentSelection);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clearAttachWatchdog();
    this.flushPendingJournals();
    this.detachPort?.();
    this.destroyed = true;
    this.stopBlobWatch();
    this.stopSeedWatch();
    this.ydoc.off('afterTransaction', this.onYjsTransaction);
    this.awareness.off('change', this.onAwarenessChange);
    this.awareness.setLocalState(null);
    this.undoManager.destroy();
    this.materializer.destroy();
    // The caller owns `ydoc` and can outlive this session, so the registry gives its
    // observers back — a leaked handler would keep paying on every later transaction.
    this.registry.destroy();
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
    // The status this replica held before the refusal. Recovery restores it, because a
    // realign repairs the DOCUMENT, not the transport: with offline editing on, the refused
    // journal arrived while `disconnected`, and recovering to `ready` would tell the host the
    // connection came back when only the tree did.
    const before = this.statusState.snapshot();
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
      current.detail === refusal.detail &&
      (before.status === 'ready' || before.status === 'disconnected')
    ) {
      this.setStatus(before.status, before.reason?.code, before.reason?.detail);
    }
  }

  private readonly onYjsTransaction = (transaction: Y.Transaction): void => {
    if (this.destroyed || !this.port) return;
    // The canonical store already holds a local commit. Materializing it back would rebuild
    // the package for an edit the store authored — so this normally skips a local transaction.
    // The exception is a concurrent-split tangle the dedup declines (#581): the materialized
    // tree then differs from what the store authored, and without reconciling it here the
    // author would keep a clean view while every other replica converges on the duplicated one.
    if (transaction.origin === this.localOrigin) {
      // Reconcile only on the edit that CREATES a tangle, not on every later keystroke while it
      // persists: the event count rises once per tangle, so a steady stream of edits in an
      // already-tangled document takes the early return with no materialize.
      const tangles = this.registry.declinedSplitTangleEvents();
      if (tangles !== this.seenDeclinedTangles) {
        this.seenDeclinedTangles = tangles;
        this.publishSharedToPort();
      }
      return;
    }
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
      this.drainJournalsHeldDuringRemote();
    }
  }

  /**
   * Apply the journals a `change` subscriber committed while the remote install ran.
   *
   * Their positions are sound: each was diffed against the tree AFTER
   * `installAuthoritativePackageSnapshot`, and shared state equals that tree here because the
   * whole `applyingRemote` window is synchronous — no other shared write can interleave.
   * Draining after the `finally` also means `identityMap.reset()` has already run, and
   * `applyJournal` translates at apply time, so freshly minted canonical ids map correctly.
   * Re-entry is blocked by the `applyingRemote` guard, so the buffer never outlives the
   * publish call that filled it.
   *
   * A refusal mid-drain realigns the store, which invalidates the rest of the buffer the
   * same way it abandons the rest of a flush batch — those journals describe edits the
   * realign just took back, so they are cleared, and the refusal status reports the loss.
   * The re-entrancy guard is what makes that work: the realign's own publish ends before
   * `realignedInBatch` is set, so an unguarded drain would consume the remaining buffer in
   * that gap and push the very content the realign took back.
   */
  private drainJournalsHeldDuringRemote(): void {
    if (this.drainingHeldJournals) return;
    this.drainingHeldJournals = true;
    try {
      while (this.journalsHeldDuringRemote.length > 0) {
        if (this.destroyed || this.realignedInBatch) {
          this.journalsHeldDuringRemote.length = 0;
          return;
        }
        const journal = this.journalsHeldDuringRemote.shift();
        if (journal) this.applyJournal(journal);
      }
    } finally {
      this.drainingHeldJournals = false;
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
    this.currentSelection = selection;
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

/**
 * Full-document collaboration session.
 *
 * The seam matches {@link TextCollaborationSession}, plus a live display-identity update.
 * @public
 */
export interface DocumentCollaborationSession extends TextCollaborationSession {
  /**
   * Update the display identity for the rest of this session and republish presence.
   *
   * `name` revalidates with the construction rules (trimmed, 1 to 256 characters) and an
   * invalid value throws. `color` longer than 64 characters throws; a color
   * `safeParticipantColor` refuses is dropped, so peers fall back to the accent color.
   * `actorId` and `role` are immutable — the update type cannot name them, and any extra
   * runtime property is ignored.
   */
  setIdentity(update: CollaborationIdentityUpdate): void;

  /**
   * One reading of the room's replicated size against this replica's hard limits.
   *
   * A room only grows — deletion is a tombstone — and the limits that bound hostile
   * amplification turn terminal when crossed. Watch this to archive and re-room before that
   * happens. The tombstone count walks the node map once per call, so read it on your own
   * schedule rather than per keystroke.
   */
  resourceUsage(): CollaborationResourceUsage;
}

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
  /**
   * Admit local edits while the transport is `disconnected`.
   *
   * A journal applies to the local `Y.Doc` either way, so buffered offline edits merge on
   * reconnect exactly as concurrent online edits do. Off by default: a host that shows no
   * offline indicator would let users type into a document no peer receives yet. `error`
   * stays terminal and `initializing` stays refused regardless of this option.
   */
  readonly offlineEditing?: boolean;
}

export { readCollaborationDocument } from './document-read.ts';

/**
 * Create or join one full-document collaboration replica.
 *
 * The caller owns `ydoc`.
 * @public
 */
export async function createDocumentCollaboration(
  options: CreateDocumentCollaborationOptions
): Promise<DocumentCollaborationHandle> {
  const attachWatchdogMs =
    (options as { readonly [ATTACH_WATCHDOG_MS_FOR_TESTS]?: number })[
      ATTACH_WATCHDOG_MS_FOR_TESTS
    ] ?? ATTACH_WATCHDOG_MS;
  const documentId = validateDocumentId(options.documentId);
  const sessionId = sessionIdentity(options.sessionId);
  const identity = validateIdentity(options.identity);
  const registry = new DocumentRegistry(options.ydoc);
  // A bootstrap that refuses must not leave this registry observing the caller's document:
  // the caller keeps `ydoc` (a retry, a different room), and a leaked observer taxes every
  // later transaction. On success the session owns the registry and detaches it on destroy.
  try {
    return await bootstrapDocumentReplica(options, {
      attachWatchdogMs,
      documentId,
      sessionId,
      identity,
      registry,
    });
  } catch (error) {
    registry.destroy();
    throw error;
  }
}

interface DocumentReplicaContext {
  readonly attachWatchdogMs: number;
  readonly documentId: string;
  readonly sessionId: string;
  readonly identity: CollaborationIdentity;
  readonly registry: DocumentRegistry;
}

async function bootstrapDocumentReplica(
  options: CreateDocumentCollaborationOptions,
  context: DocumentReplicaContext
): Promise<DocumentCollaborationHandle> {
  const { attachWatchdogMs, documentId, sessionId, identity, registry } = context;
  const identityMap = new LogicalIdentityMap((logicalId) => registry.hasNode(logicalId));
  const blobs = new SharedBlobStore(options.ydoc.getMap<Uint8Array>(SHARED_BLOBS_KEY));

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
  } else if (options.bootstrap.kind === 'create-or-join') {
    const outcome = await runCreateOrJoinBootstrap({
      ydoc: options.ydoc,
      awareness: options.awareness,
      registry,
      blobs,
      documentId,
      document: options.bootstrap.document,
      probeTimeoutMs: options.bootstrap.probeTimeoutMs,
      electionWindowMs: options.bootstrap.electionWindowMs,
      timeoutMs: options.bootstrap.timeoutMs,
      signal: options.bootstrap.signal,
    });
    if (outcome === 'joined') {
      if (registry.schema.meta.get('documentId') !== documentId) {
        throw new CollaborationSchemaError('document-id-mismatch');
      }
      // Same rebuild as the join path: shared state arrived before this registry existed.
      registry.rebuildDerivedIndexes();
    }
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

  // Two merged seed transactions duplicate the whole document, and no client can pick one
  // side. Refuse the room before any edit can ride on it; a legacy room with no seed
  // records (or exactly one) passes.
  if (seedRecordCount(options.ydoc) > 1) {
    throw new CollaborationSchemaError('concurrent-seed');
  }

  const exceeded = limitFailure(registry, blobs);
  if (exceeded) throw new CollaborationSchemaError(exceeded.code, exceeded.detail);

  const materializer = new PackageMaterializer(registry, blobs);
  // Any throw between here and the return leaks the materializer's observers on the
  // caller's document — `current()` can throw on hostile shared state, and the refusals
  // below throw by design — so the whole tail hands the materializer back on the way out.
  // On success, ownership passes to the session, which detaches it on destroy.
  try {
    const materialized = materializer.current();
    const poisoned = blobs.poisonedDigest();
    if (poisoned) {
      // A blob that does not hash to its key reads downstream as a blob that is not there.
      // Say which it was, so a poisoned room is not reported as a truncated one.
      throw new CollaborationSchemaError('blob-digest-mismatch', poisoned);
    }
    if (!materialized.ok) {
      throw new CollaborationSchemaError(materialized.code);
    }
    // Serialize before the session exists: a throw here must not orphan a live session
    // whose registry and materializer the catch below is about to tear down.
    const document = writeOoxmlPackage(materialized.package);
    const session = new DocumentSession(
      options.ydoc,
      options.awareness,
      documentId,
      sessionId,
      identity,
      registry,
      materializer,
      identityMap,
      blobs,
      attachWatchdogMs,
      options.offlineEditing === true
    );
    return Object.freeze({
      document,
      session,
      destroy: () => session.destroy(),
    });
  } catch (error) {
    materializer.destroy();
    throw error;
  }
}
