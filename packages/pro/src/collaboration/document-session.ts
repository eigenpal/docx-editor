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

import { projectTypingOrJournal } from './document/projected-journal.ts';
import { editWaits } from './document/journal.ts';
import { markRestoredText } from './document/paragraph-text-restore.ts';
import { awaitingUpdates } from './document/yjs-items.ts';
import { viewRenamesPlan } from './document/paragraph-text-drift.ts';
import { stepHistory } from './document/history-undone.ts';
import { HistoryGroupCapture } from './document/history-group-capture.ts';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import {
  ORIGIN_IDS,
  writeOoxmlPackage,
  type OoxmlPackage,
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
  CollaborationSelectionMove,
  CollaborationStatusSnapshot,
  EditorCollaborationSession,
} from '@docx-editor.dev/core/collaboration';
import {
  historyGroupOfJournal,
  type CanonicalPrimitiveJournal,
  type CollaborationDocumentPort,
} from '@docx-editor.dev/core/collaboration/replication';
import {
  createCollaborationStatusTracker,
  safeParticipantColor,
} from '@docx-editor.dev/core/collaboration';
import { DocumentRegistry, PackageMaterializer, applyPrimitiveJournal } from './document/index.ts';
import { collectJournalBlobs, putJournalBlobs } from './document-session-blobs.ts';
import { healTargetOf, RefusalStreak, type HealTarget } from './document-session-heal.ts';
import { HistorySelection } from './document-history-selection.ts';
import { startAttachWatchdog } from './document-session-watchdog.ts';
import { RemoteSelectionResolver } from './document-remote-selections.ts';
import { droppedContentDetail, packageVersionFailure } from './document/schema.ts';
import { SHARED_BLOBS_KEY, SharedBlobStore, limitFailure } from './shared-blob-store.ts';
import { observeSeedRecords, initializeSharedState } from './document-bootstrap.ts';
import { LogicalIdentityMap } from './document-identity.ts';
import { CaretAnchors } from './document-caret-anchors.ts';
import { EditWait } from './document-edit-wait.ts';
import { resourceUsageOf, type CollaborationResourceUsage } from './resource-usage.ts';
import {
  AWARENESS_FIELD,
  MAX_AWARENESS_STATES,
  MAX_IDENTITY_LENGTH,
  awarenessPayload,
  sessionIdentity,
  encodeSelection,
  validateDocumentId,
  validateIdentity,
  type AwarenessPayload,
  type EncodedSelection,
} from './document-awareness.ts';
import { CollaborationSchemaError } from './errors.ts';
import type { CollaborationHandle, CollaborationIdentityUpdate } from './types.ts';
import type { CreateDocumentCollaborationOptions } from './document-session-options.ts';

/**
 * Local journals inside this window share one actor undo item: one typing run, not the whole
 * paragraph a user types without a long pause. This is the `Y.UndoManager` default.
 */
const UNDO_CAPTURE_TIMEOUT_MS = 500;
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
  private readonly caretAnchors: CaretAnchors;
  private readonly editWait: EditWait;
  private readonly undoManager: Y.UndoManager;
  private port: CollaborationDocumentPort | null = null;
  private detachPort: (() => void) | null = null;
  private applyingRemote = false;
  /** The last publish waited for a held-back update and left the editor behind shared state. */
  private viewWaiting = false;
  /** Where a degraded session returns on its next clean remote apply; null when terminal. */
  private healTo: HealTarget | null = null;
  private readonly historySelections: HistorySelection;
  private readonly remoteSelectionResolver = new RemoteSelectionResolver();
  private realignedInBatch = false;
  /** Journals a `change` subscriber committed while a remote install ran. Never dropped. */
  private readonly journalsHeldDuringRemote: CanonicalPrimitiveJournal[] = [];
  private drainingHeldJournals = false;
  private remoteCounter = 0;
  private destroyed = false;
  private readonly refusals = new RefusalStreak();
  private readonly historyGroups: HistoryGroupCapture;
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
    readonly offlineEditing: boolean
  ) {
    this.documentId = documentId;
    this.sessionId = sessionId;
    this.currentIdentity = identity;
    this.undoManager = new Y.UndoManager([...registry.trackedTypes()], {
      trackedOrigins: new Set([this.localOrigin]),
      captureTimeout: UNDO_CAPTURE_TIMEOUT_MS,
      deleteFilter: registry.undoDeleteFilter(),
    });
    this.historyGroups = new HistoryGroupCapture(this.undoManager, this);
    this.historySelections = new HistorySelection(
      this.undoManager,
      (id) => this.port?.paragraphByStableId(id)?.text ?? null,
      (paragraphId, character) => this.caretAnchors.findStable(paragraphId, character)
    );
    this.editWait = new EditWait({
      ydoc,
      viewWaiting: () => this.viewWaiting,
      nodeWaits: (nodeId) => editWaits(registry, this.identityMap.resolve(nodeId)),
      publish: (waiting) => this.statusState.setWaiting(waiting) && this.notifyStatus(),
    });
    this.caretAnchors = new CaretAnchors({
      registry,
      port: () => this.port,
      logicalIdOf: (nodeId) => this.identityMap.resolve(nodeId),
      embedOf: (id) => materializer.builtNode(id),
      viewIsCurrent: () => !this.viewWaiting,
    });
    ydoc.on('beforeTransaction', this.onBeforeYjsTransaction);
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
    this.attachWatchdog = startAttachWatchdog(this.documentId, attachWatchdogMs, () => {
      this.attachWatchdog = null;
      return this.destroyed || this.port !== null;
    });
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
    if (this.statusState.status() === 'error' && status !== 'error') {
      // A degraded session tracks the transport, so healing restores the connection's state.
      // A reconnect is also a chance to heal: the update that failed may have been the last
      // one a peer sent, and its sync can have filled the gap without a new transaction here.
      if (this.healTo !== null) {
        this.healTo = { status, code: reason, detail };
        this.publishSharedToPort();
      }
      return;
    }
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
      // No editor shows this session any more, so its caret leaves every peer's screen. The
      // participant entry stays: the room is still open.
      if (this.currentSelection) this.publishAwareness();
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
   * do. A host can opt out with `offlineEditing: false`. `initializing` stays refused (the
   * bootstrap has not published a first revision) and `error` refuses edits.
   */
  private hasCompatibleSharedSchema(): boolean {
    const failure = packageVersionFailure(this.registry.schema.meta);
    if (!failure) return true;
    this.setStatus('error', failure.code, failure.detail);
    return false;
  }

  private canWriteSharedState(): boolean {
    if (this.destroyed || !this.hasCompatibleSharedSchema()) return false;
    const status = this.statusState.status();
    return status === 'ready' || (this.offlineEditing && status === 'disconnected');
  }

  /** Every authorable mutation replicates, so only session readiness gates a write. */
  gateOperations(ops: readonly TreeDocOp[], _scope: StoryScope): CollaborationFailureCode | null {
    if (this.destroyed) return 'collaboration-session-destroyed';
    if (!this.canWriteSharedState()) return 'collaboration-session-not-ready';
    if (!this.port) return 'collaboration-session-not-attached';
    // An edit that a held-back update would refuse after the commit waits for it instead.
    if (this.editWait.refuses(ops)) return 'collaboration-session-not-ready';
    return this.textLimitFailure(ops);
  }

  /**
   * Refuse an insert longer than one shared text admits, before the editor commits it.
   * Shared state refuses it too, but after the commit, where the edit only disappears in the
   * realign and its caller never learns why. Reads the operations alone, so a keystroke costs
   * nothing more.
   */
  private textLimitFailure(ops: readonly TreeDocOp[]): CollaborationFailureCode | null {
    const limit = this.registry.limits.maxTextLength;
    for (const op of ops) {
      if (op.op === 'insertText' && op.text.length > limit) return 'collaboration-text-limit';
    }
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
    return this.popHistory('undo');
  }

  /** The selection the last undo or redo restored: the one its step was made from. */
  historySelection(): CollaborationLocalSelection | null {
    return this.historySelections.lastRestored();
  }

  redo(): boolean {
    return this.popHistory('redo');
  }

  private popHistory(direction: 'undo' | 'redo'): boolean {
    if (!this.canWriteSharedState()) return false;
    this.flushPendingJournals();
    // The flush can refuse the queued journal and take this session to terminal `error`,
    // so the gate re-checks: undo must not write a room the session just diverged from.
    if (!this.canWriteSharedState()) return false;
    const stack = direction === 'undo' ? this.undoManager.undoStack : this.undoManager.redoStack;
    if (stack.length === 0) return false;
    this.historyGroups.reset();
    this.historySelections.noteBefore();
    this.historySelections.startPop();
    const from = Y.getState(this.ydoc.store, this.ydoc.clientID);
    this.registry.takeUnlisted();
    stepHistory(this.registry, this.undoManager, direction, () => {
      this.registry.normalizeRestoredSplitTextAnchors();
      markRestoredText(this.ydoc, from);
    });
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
    this.caretAnchors.track(selection);
    if (!selection) {
      this.historySelections.track(null);
      this.publishAwareness();
      return;
    }
    const { encoded, texts } = encodeSelection(
      selection,
      (paragraphId) => this.port?.paragraphByStableId(paragraphId)?.text,
      (point) => this.caretAnchors.characterOf(point)
    );
    this.historySelections.track(encoded, texts);
    this.publishAwareness(encoded);
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
    return this.port
      ? this.remoteSelectionResolver.resolve(this.awareness, this.port, (paragraphId, character) =>
          this.caretAnchors.find(paragraphId, character)
        )
      : [];
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
    this.ydoc.off('beforeTransaction', this.onBeforeYjsTransaction);
    this.ydoc.off('afterTransaction', this.onYjsTransaction);
    this.awareness.off('change', this.onAwarenessChange);
    // Withdraw only this session's presence. The host owns the awareness and may keep its own
    // fields on it; a hook that owns it destroys it, which removes the whole state.
    this.awareness.setLocalStateField(AWARENESS_FIELD, null);
    this.historySelections.destroy();
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
    // Custom ports and headless stores can publish without the editor's operation gate.
    // Enforce admission here too, before minting identities or publishing document/blob data.
    if (!this.canWriteSharedState()) return;
    this.registry.inline.takeDrift();
    const projected = projectTypingOrJournal(
      this.registry,
      this.identityMap.translate(journal),
      (id) => this.materializer.shownPartChildren(id)
    );
    if (!projected.ok) {
      this.refuseLocalJournal({
        code: projected.code as CollaborationFailureCode,
        ...(projected.detail ? { detail: projected.detail } : {}),
      });
      return;
    }
    const shared = projected.journal;
    const blobs = collectJournalBlobs(this.port, journal);
    if (blobs !== null && blobs.ok === false) {
      this.refuseLocalJournal(blobs.failure);
      return;
    }
    // A custom blob reader can run host code; recheck after that callback before writing.
    if (!this.canWriteSharedState()) return;
    let transient = false;
    this.historySelections.noteBefore();
    const refusal = this.historyGroups.capture(historyGroupOfJournal(journal), () =>
      this.ydoc.transact((): CollaborationFailure | null => {
        if (blobs !== null) {
          const published = putJournalBlobs(this.blobs, blobs.payloads);
          if (published !== null) return published;
        }
        const result = applyPrimitiveJournal(
          this.registry,
          shared,
          projected.plan,
          projected.typed
        );
        if (!result.ok) {
          transient = result.transient === true;
          return {
            code: result.code as CollaborationFailureCode,
            ...(result.detail ? { detail: result.detail } : {}),
          };
        }
        return null;
      }, this.localOrigin)
    );
    if (refusal === null) {
      this.refusals.published();
      // Shared state can show this edit differently from the tree the editor computed: an ID
      // another paragraph also holds, text that follows a move. Take what shared state shows.
      // Typing only splices text, which renames nothing; any other edit can.
      const drift =
        this.registry.inline.takeDrift() ||
        (journal.effects.some((effect) => effect.kind !== 'spliceText') &&
          viewRenamesPlan(this.registry, projected.plan));
      if (drift) this.publishSharedToPort();
      return;
    }
    this.refuseLocalJournal(refusal, transient);
  }

  private refuseLocalJournal(refusal: CollaborationFailure, transient = false): void {
    this.historyGroups.reset();
    this.undoManager.stopCapturing();
    // The status this replica held before the refusal. Recovery restores it, because a
    // realign repairs the DOCUMENT, not the transport: with offline editing on, the refused
    // journal arrived while `disconnected`, and recovering to `ready` would tell the host the
    // connection came back when only the tree did.
    const before = this.statusState.snapshot();
    // The local store already committed this edit, so leaving it would make this replica
    // silently different from the room. Shared state is the authority: take it back.
    // A refusal that waits on a peer's update is not evidence the next edit will fail too.
    this.refusals.refusedOne(transient);
    // Below the cap the realign is expected to succeed; if it cannot materialize yet, the
    // session degrades and heals like any remote failure rather than ending here.
    const heal = this.refusals.recoverable() ? healTargetOf(before) : null;
    this.setStatus('error', refusal.code, refusal.detail, heal);
    // A refused edit says this view and shared state disagree, so the realign does not trust
    // the incremental view either: it rebuilds from shared state alone.
    this.publishSharedToPort(true);
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
      this.refusals.recoverable() &&
      this.statusState.status() === 'error' &&
      current !== undefined &&
      current.code === refusal.code &&
      current.detail === refusal.detail &&
      (before.status === 'ready' || before.status === 'disconnected')
    ) {
      this.setStatus(before.status, before.reason?.code, before.reason?.detail);
    }
  }

  /** Before a change from elsewhere, while shared state still holds what the editor shows. */
  private readonly onBeforeYjsTransaction = (transaction: Y.Transaction): void => {
    if (transaction.origin === this.localOrigin) this.caretAnchors.localChange();
    else this.caretAnchors.beforeChange();
  };

  remoteSelectionMove(): CollaborationSelectionMove | null {
    return this.caretAnchors.move();
  }

  private readonly onYjsTransaction = (transaction: Y.Transaction): void => {
    if (this.destroyed || !this.hasCompatibleSharedSchema() || !this.port) return;
    // The canonical store already holds a local commit. Its journal translates visible
    // positions before writing shared state, so no local materialization is necessary.
    if (transaction.origin === this.localOrigin) return;
    // Nothing is published from here. A journal describes the tree as it stood when its
    // transaction committed, and its `spliceText` / `spliceChildren` positions are absolute.
    // This update has already integrated, so applying a journal now would address the wrong
    // offset or the wrong sibling — inside bounds, so admitted, so agreed on by every replica.
    // Journals reach shared state in the frame that commits them instead, which is why there
    // is nothing left to publish at this point.
    this.publishSharedToPort();
  };

  private publishSharedToPort(full = false): void {
    const port = this.port;
    if (!port || this.applyingRemote) return;
    this.applyingRemote = true;
    try {
      if (!this.hasCompatibleSharedSchema()) return;
      const exceeded = limitFailure(this.registry, this.blobs);
      if (exceeded) {
        this.setStatus('error', exceeded.code, exceeded.detail);
        return;
      }
      // Shared state that waits for a held-back update is incomplete: a replaced attribute can
      // be gone before its new value arrives. The editor still follows it, so local edits
      // address what shared state holds, but a view that incompleteness breaks is skipped
      // rather than reported, and the update that completes it publishes again.
      const waiting = awaitingUpdates(this.ydoc);
      const materialized = full ? this.materializer.rebuildFull() : this.materializer.current();
      // After materializing, because that is what reads the blobs and so what hashes them.
      const poisoned = this.blobs.poisonedDigest();
      if (poisoned) {
        this.setStatus('error', 'blob-digest-mismatch', poisoned);
        return;
      }
      this.viewWaiting = false;
      if (!materialized.ok) {
        if (waiting) this.viewWaiting = true;
        else this.degrade(materialized.code);
        return;
      }
      // The materializer repairs shared state it cannot express as a tree, and repair means
      // leaving something out. Dropping the issue list made that repair silent: a room could
      // converge on a document missing a peer's paragraph and still report `ready`. This does
      // not apply the package either, because rendering a document already known to be short
      // of content is the one outcome worse than refusing.
      const dropped = droppedContentDetail(materialized.issues);
      if (dropped) {
        if (waiting) this.viewWaiting = true;
        else this.degrade('materialize-dropped-content', dropped);
        return;
      }
      const apply = (pkg: OoxmlPackage) => {
        this.remoteCounter += 1;
        return port.applyRemotePackage(pkg, {
          origin: ORIGIN_IDS.mutationRemote,
          actorId: 'remote',
          operationId: `${this.sessionId}:remote:${this.remoteCounter}`,
        });
      };
      let result = apply(materialized.package);
      if (!result.ok) {
        // The incremental view kept a subtree a concurrent edit invalidated. Rebuild the view
        // from shared state alone, as every replica would, before calling the room broken.
        const full = this.materializer.rebuildFull();
        if (full.ok && !droppedContentDetail(full.issues)) result = apply(full.package);
      }
      if (!result.ok) {
        if (waiting) this.viewWaiting = true;
        else this.degrade('remote-apply-failed', result.reason);
        return;
      }
      // Every node in the canonical tree now carries a logical id, so no local mapping is
      // live. Keeping one would let a re-minted canonical id resolve to the wrong node.
      if (result.changed) this.identityMap.reset();
      this.caretAnchors.afterPublish();
      const heal = this.healTo;
      if (heal !== null) this.setStatus(heal.status, heal.code, heal.detail);
    } catch (error) {
      this.degrade(
        error instanceof CollaborationSchemaError ? error.code : 'remote-apply-failed',
        error instanceof CollaborationSchemaError ? error.detail : undefined
      );
    } finally {
      this.applyingRemote = false;
      this.drainJournalsHeldDuringRemote();
      this.editWait.refresh();
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

  /**
   * A remote update this replica could not express yet. Yjs editors never stop on one: the
   * view keeps the last good document, and the next update usually completes what this one
   * started. So the session reports `error` (edits pause) but heals on the next clean apply.
   */
  private degrade(code: CollaborationFailureCode, detail?: string): void {
    this.setStatus('error', code, detail, this.healTo ?? healTargetOf(this.statusState.snapshot()));
  }

  /** `heal` arms healing for an `error`: the status the next clean update restores. */
  private setStatus(
    status: CollaborationStatus,
    code?: CollaborationFailureCode,
    detail?: string,
    heal: HealTarget | null = null
  ): void {
    // Any other route into `error` is terminal; only a degrade or a refusal arms healing.
    this.healTo = status === 'error' ? heal : null;
    if (this.statusState.set(status, code, detail, this.healTo !== null)) this.notifyStatus();
  }

  private notifyStatus(): void {
    const snapshot = this.statusState.snapshot();
    for (const listener of [...this.statusListeners]) {
      listener(snapshot.status, snapshot.reason?.code, snapshot.reason?.detail);
    }
  }
}

/**
 * Full-document collaboration session: the engine-facing seam, the transport status a
 * provider sets, and a live display-identity update.
 * @public
 */
export interface DocumentCollaborationSession extends EditorCollaborationSession {
  /**
   * Provider convenience seam. Low-level consumers normally leave the session ready.
   *
   * `reason` is a typed code so a host can branch on it: pass `'transport-disconnected'` for
   * a socket that will retry itself and `'authentication-failed'` for a credential the server
   * rejected, because those need opposite responses. The provider's own phrasing goes in
   * `detail`.
   */
  setTransportStatus(
    status: 'ready' | 'disconnected' | 'error',
    reason?: CollaborationFailureCode,
    detail?: string
  ): void;
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

export type { CreateDocumentCollaborationOptions } from './document-session-options.ts';
export { readCollaborationDocument } from './document-read.ts';

/**
 * Create or join one full-document collaboration replica.
 *
 * The caller owns `ydoc`, `awareness`, and the provider, and destroys them after
 * `handle.destroy()`.
 *
 * @throws CollaborationSchemaError when the replica cannot start:
 * `invalid-document-id`, `invalid-session-id`, `invalid-identity`, or
 * `invalid-identity-color` for a bad option; `initialization-timeout` or
 * `initialization-aborted` when no room arrived; `already-initialized` for `create` on a
 * seeded room; `document-id-mismatch` for a room of another document;
 * `protocol-version-mismatch` or `schema-version-mismatch` for a room of another format;
 * `baseline-too-large`, `invalid-baseline`, or `no-main-document-part` for seed bytes that
 * cannot open; `concurrent-seed` or `blob-digest-mismatch` for a damaged room; a resource
 * limit code such as `too-many-nodes` or `blob-store-full`; or `missing-blob`,
 * `missing-root`, or `invalid-relationships` for shared state that does not form a document.
 *
 * @example
 * ```ts
 * await new Promise((resolve) => provider.once('sync', resolve));
 * const room = await createDocumentCollaboration({
 *   ydoc,
 *   awareness,
 *   documentId: 'room-1',
 *   identity: { actorId: 'user-1', name: 'Ada' },
 *   bootstrap: { kind: 'join' },
 * });
 * // Mount the editor with room.document and collaborationModule({ session: room.session }).
 * ```
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
  // A run, text element or wrapper lives in its paragraph's shared text, not as a record.
  const identityMap = new LogicalIdentityMap(
    (logicalId) => registry.hasNode(logicalId) || registry.inline.owner(logicalId) !== null
  );
  const blobs = new SharedBlobStore(options.ydoc.getMap<Uint8Array>(SHARED_BLOBS_KEY));

  await initializeSharedState(options, registry, blobs, documentId);

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
      options.offlineEditing !== false
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
