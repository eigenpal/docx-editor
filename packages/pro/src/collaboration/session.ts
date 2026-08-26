/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { ORIGIN_IDS, type StoryScope, type TreeDocOp } from '@docx-editor.dev/core/store';
import type {
  CollaborationDocumentPort,
  CollaborationFailureCode,
  CollaborationIdentity,
  CollaborationLocalSelection,
  CollaborationParticipant,
  CollaborationRemoteSelection,
  CollaborationStatus,
  CollaborationStatusSnapshot,
  EditorCollaborationSession,
} from '@docx-editor.dev/core/collaboration';
import {
  createCollaborationStatusTracker,
  isCollaborationFailureCode,
} from '@docx-editor.dev/core/collaboration';
import {
  CollaborationSchemaError,
  PROTOCOL_VERSION,
  SCHEMA_VERSION,
  initializeSchema,
  openBaseline,
  schemaOf,
  validateInitializedSchema,
  waitForInitialization,
  type OpenedBaseline,
} from './schema.ts';

const AWARENESS_FIELD = 'docxEditor';
const MAX_IDENTITY_LENGTH = 256;
const MAX_AWARENESS_STATES = 256;
const MAX_SHARED_PARAGRAPH_TEXT = 1_000_000;
const DEFAULT_INITIALIZATION_TIMEOUT_MS = 30_000;

/**
 * Create or join bootstrap for one collaboration replica.
 *
 * Text, document, and WebRTC factories share this union.
 * @public
 */
export type CollaborationBootstrap =
  | { readonly kind: 'create'; readonly document: Uint8Array }
  | { readonly kind: 'join'; readonly timeoutMs?: number; readonly signal?: AbortSignal };

/**
 * Host-facing collaboration session.
 *
 * A host reads identity, status, presence, and undo. The editor attaches
 * {@link EditorCollaborationSession} internally and never through this type.
 * @public
 */
export interface CollaborationSession {
  readonly documentId: string;
  /** Unique identity for this attachment lifetime. */
  readonly sessionId: string;
  readonly identity: CollaborationIdentity;
  status(): CollaborationStatus;
  /**
   * Cached status, current reason, and last failure.
   *
   * Same reference until any of those values change.
   */
  statusSnapshot(): CollaborationStatusSnapshot;
  subscribeStatus(
    listener: (
      status: CollaborationStatus,
      reason?: CollaborationFailureCode,
      detail?: string
    ) => void
  ): () => void;
  canUndo(): boolean;
  canRedo(): boolean;
  undo(): boolean;
  redo(): boolean;
  participants(): readonly CollaborationParticipant[];
  subscribeParticipants(
    listener: (participants: readonly CollaborationParticipant[]) => void
  ): () => void;
  remoteSelections(): readonly CollaborationRemoteSelection[];
  subscribeRemoteSelections(
    listener: (selections: readonly CollaborationRemoteSelection[]) => void
  ): () => void;
}

/**
 * Options for a paragraph-text collaboration replica.
 *
 * The caller owns `ydoc`.
 * @public
 */
export interface CreateTextCollaborationOptions {
  readonly ydoc: Y.Doc;
  readonly awareness: Awareness;
  readonly documentId: string;
  /** Unique attachment identity. Omit it to generate a new identity for this session. */
  readonly sessionId?: string;
  readonly identity: CollaborationIdentity;
  readonly bootstrap: CollaborationBootstrap;
}

/**
 * Engine-facing paragraph-text session, including attach and operation gating.
 *
 * Hosts consume {@link CollaborationSession}. Providers call `setTransportStatus`.
 * @public
 */
export interface TextCollaborationSession extends EditorCollaborationSession {
  /** Provider convenience seam. Low-level consumers normally leave the session ready. */
  setTransportStatus(status: 'ready' | 'disconnected' | 'error', reason?: string): void;
}

/**
 * Owned collaboration replica: document bytes, session, and teardown.
 *
 * Text and document factories share this shape. A host reads
 * {@link CollaborationSession}; the engine session remains assignable.
 * @public
 */
export interface CollaborationHandle<TSession extends CollaborationSession> {
  readonly document: Uint8Array;
  readonly session: TSession;
  destroy(): void;
}

/** Owned paragraph-text collaboration replica. @public */
export type TextCollaborationHandle = CollaborationHandle<TextCollaborationSession>;

interface EncodedPosition {
  readonly paragraphId: string;
  readonly position: string;
}

interface EncodedSelection {
  readonly anchor: EncodedPosition;
  readonly head: EncodedPosition;
}

interface AwarenessPayload {
  readonly actorId: string;
  readonly name: string;
  readonly color?: string;
  readonly role?: 'human' | 'agent';
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
  if (sessionId.length === 0 || sessionId.length > MAX_IDENTITY_LENGTH) {
    throw new CollaborationSchemaError('invalid-session-id');
  }
  return sessionId;
}

function updateYText(text: Y.Text, next: string): void {
  const current = text.toString();
  if (current === next) return;
  let prefix = 0;
  while (
    prefix < current.length &&
    prefix < next.length &&
    current.charCodeAt(prefix) === next.charCodeAt(prefix)
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < current.length - prefix &&
    suffix < next.length - prefix &&
    current.charCodeAt(current.length - suffix - 1) === next.charCodeAt(next.length - suffix - 1)
  ) {
    suffix += 1;
  }
  const removed = current.length - prefix - suffix;
  if (removed > 0) text.delete(prefix, removed);
  const inserted = next.slice(prefix, next.length - suffix);
  if (inserted.length > 0) text.insert(prefix, inserted);
}

function encodedPosition(value: unknown): EncodedPosition | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.paragraphId !== 'string' ||
    record.paragraphId.length !== 8 ||
    typeof record.position !== 'string' ||
    record.position.length === 0 ||
    record.position.length > 2048 ||
    !/^[A-Za-z0-9_-]+$/.test(record.position)
  ) {
    return null;
  }
  return { paragraphId: record.paragraphId, position: record.position };
}

function encodedSelection(value: unknown): EncodedSelection | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const selected = value as Record<string, unknown>;
  const anchor = encodedPosition(selected.anchor);
  const head = encodedPosition(selected.head);
  if (anchor && head) return { anchor, head };
  if (
    typeof selected.paragraphId === 'string' &&
    selected.paragraphId.length === 8 &&
    typeof selected.anchor === 'string' &&
    typeof selected.head === 'string' &&
    selected.anchor.length > 0 &&
    selected.head.length > 0 &&
    selected.anchor.length <= 2048 &&
    selected.head.length <= 2048 &&
    /^[A-Za-z0-9_-]+$/.test(selected.anchor) &&
    /^[A-Za-z0-9_-]+$/.test(selected.head)
  ) {
    return {
      anchor: { paragraphId: selected.paragraphId, position: selected.anchor },
      head: { paragraphId: selected.paragraphId, position: selected.head },
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
  const role = record.role === 'agent' ? 'agent' : 'human';
  const selection = encodedSelection(record.selection);
  return {
    actorId: record.actorId,
    name: record.name,
    ...(color ? { color } : {}),
    role,
    ...(selection ? { selection } : {}),
  };
}

function encodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

class Session implements TextCollaborationSession {
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
  private readonly localOrigin = Object.freeze({ kind: 'docx-collaboration-local' });
  private readonly undoManager: Y.UndoManager;
  private readonly baselineSha256: string;
  private readonly initializedBy: string;
  private port: CollaborationDocumentPort | null = null;
  private detachPort: (() => void) | null = null;
  private applyingSharedState = false;
  private remoteCounter = 0;
  private destroyed = false;

  constructor(
    private readonly ydoc: Y.Doc,
    private readonly awareness: Awareness,
    documentId: string,
    sessionId: string,
    identity: CollaborationIdentity,
    private readonly baseline: OpenedBaseline
  ) {
    this.documentId = documentId;
    this.sessionId = sessionId;
    this.identity = identity;
    const { root, paragraphs } = schemaOf(ydoc);
    this.baselineSha256 = String(root.get('baselineSha256'));
    this.initializedBy = String(root.get('initializedBy'));
    this.undoManager = new Y.UndoManager([...paragraphs.values()], {
      trackedOrigins: new Set([this.localOrigin]),
      captureTimeout: 0,
    });
    ydoc.on('afterTransaction', this.onYjsTransaction);
    awareness.on('change', this.onAwarenessChange);
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
    if (this.destroyed) return () => {};
    if (this.port) return () => {};
    if (port.documentId !== this.documentId) {
      this.setStatus('error', 'document-id-mismatch');
      return () => {};
    }
    this.validateParagraphSet(port);
    this.port = port;
    this.reconcilePortFromYjs();
    const unsubscribe = port.subscribe((change) => {
      if (this.destroyed || this.applyingSharedState) return;
      if (
        change.origin === ORIGIN_IDS.mutationRemote ||
        change.origin === ORIGIN_IDS.projection ||
        change.origin === ORIGIN_IDS.awareness
      ) {
        return;
      }
      try {
        this.reconcileYjsFromPort();
      } catch (error) {
        this.setStatus(
          'error',
          error instanceof CollaborationSchemaError ? error.code : 'local-mirror-failed',
          error instanceof CollaborationSchemaError ? error.detail : undefined
        );
      }
    });
    this.detachPort = () => {
      this.flushPendingJournals();
      unsubscribe();
      if (this.port === port) this.port = null;
      this.detachPort = null;
    };
    return () => this.detachPort?.();
  }

  gateOperations(ops: readonly TreeDocOp[], scope: StoryScope): CollaborationFailureCode | null {
    if (this.destroyed) return 'collaboration-session-destroyed';
    if (this.statusState.status() !== 'ready') return 'collaboration-session-not-ready';
    if (!this.port) return 'collaboration-session-not-attached';
    if (scope.kind !== 'body') return 'experimental-collaboration-body-text-only';
    const paragraphLengths = new Map(
      this.port.paragraphs().map((paragraph) => [paragraph.nodeId, paragraph.text.length])
    );
    for (const op of ops) {
      if (op.op !== 'insertText' && op.op !== 'deleteText') {
        return 'experimental-collaboration-text-only';
      }
      if ('revision' in op && op.revision !== undefined) {
        return 'experimental-collaboration-untracked-text-only';
      }
      if (!this.port.paragraphByNodeId(op.paragraphId)) {
        return 'experimental-collaboration-existing-paragraphs-only';
      }
      const currentLength = paragraphLengths.get(op.paragraphId);
      if (currentLength === undefined) {
        return 'experimental-collaboration-existing-paragraphs-only';
      }
      const nextLength =
        op.op === 'insertText'
          ? currentLength + op.text.length
          : currentLength - Math.max(0, op.end - op.start);
      if (nextLength > MAX_SHARED_PARAGRAPH_TEXT) return 'collaboration-text-limit';
      paragraphLengths.set(op.paragraphId, Math.max(0, nextLength));
    }
    return null;
  }

  canUndo(): boolean {
    return !this.destroyed && this.undoManager.undoStack.length > 0;
  }

  canRedo(): boolean {
    return !this.destroyed && this.undoManager.redoStack.length > 0;
  }

  undo(): boolean {
    if (!this.canUndo()) return false;
    this.undoManager.undo();
    return true;
  }

  redo(): boolean {
    if (!this.canRedo()) return false;
    this.undoManager.redo();
    return true;
  }

  setLocalSelection(selection: CollaborationLocalSelection | null): void {
    if (this.destroyed) return;
    const { paragraphs } = schemaOf(this.ydoc);
    const encodeEnd = (paragraphId: string, offset: number): EncodedPosition | undefined => {
      const text = paragraphs.get(paragraphId.toUpperCase());
      if (!text) return undefined;
      return {
        paragraphId: paragraphId.toUpperCase(),
        position: encodeBytes(
          Y.encodeRelativePosition(
            Y.createRelativePositionFromTypeIndex(text, Math.max(0, Math.min(offset, text.length)))
          )
        ),
      };
    };
    let resolved: EncodedSelection | undefined;
    if (selection) {
      const anchor = encodeEnd(selection.anchor.paragraphId, selection.anchor.offset);
      const head = encodeEnd(selection.head.paragraphId, selection.head.offset);
      if (anchor && head) resolved = { anchor, head };
    }
    this.publishAwareness(resolved);
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
        role: payload.role ?? 'human',
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
    if (!this.port) return [];
    const states = [...this.awareness.getStates().entries()].slice(0, MAX_AWARENESS_STATES);
    const { paragraphs } = schemaOf(this.ydoc);
    const selections: CollaborationRemoteSelection[] = [];
    for (const [clientId, state] of states) {
      if (clientId === this.awareness.clientID) continue;
      const payload = awarenessPayload((state as Record<string, unknown>)[AWARENESS_FIELD]);
      if (!payload?.selection) continue;
      const resolveEnd = (
        encoded: EncodedPosition
      ): { paragraphId: string; nodeId: string; offset: number } | null => {
        const text = paragraphs.get(encoded.paragraphId);
        if (!text) return null;
        let absolute: Y.AbsolutePosition | null;
        try {
          absolute = Y.createAbsolutePositionFromRelativePosition(
            Y.decodeRelativePosition(decodeBytes(encoded.position)),
            this.ydoc
          );
        } catch {
          return null;
        }
        if (!absolute || absolute.type !== text) return null;
        const paragraph = this.port
          ?.paragraphs()
          .find((candidate) => candidate.paragraphId === encoded.paragraphId);
        if (!paragraph) return null;
        return {
          paragraphId: paragraph.paragraphId,
          nodeId: paragraph.nodeId,
          offset: absolute.index,
        };
      };
      const anchor = resolveEnd(payload.selection.anchor);
      const head = resolveEnd(payload.selection.head);
      if (!anchor || !head) continue;
      selections.push(
        Object.freeze({
          actorId: payload.actorId,
          name: payload.name,
          ...(payload.color ? { color: payload.color } : {}),
          anchor: Object.freeze(anchor),
          head: Object.freeze(head),
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
    this.ydoc.off('afterTransaction', this.onYjsTransaction);
    this.awareness.off('change', this.onAwarenessChange);
    this.awareness.setLocalState(null);
    this.undoManager.destroy();
    this.setStatus('destroyed');
    this.statusListeners.clear();
    this.selectionListeners.clear();
    this.participantListeners.clear();
  }

  flushPendingJournals(): void {
    this.port?.flushPendingJournals();
  }

  private readonly onYjsTransaction = (transaction: Y.Transaction): void => {
    if (this.destroyed) return;
    // The canonical store already contains this local commit. Sending it back through the
    // remote materialization path would re-scan and transact every paragraph synchronously.
    if (transaction.origin === this.localOrigin) return;
    try {
      this.validateImmutableSchema();
    } catch (error) {
      this.setStatus(
        'error',
        error instanceof CollaborationSchemaError ? error.code : 'shared-schema-invalid',
        error instanceof CollaborationSchemaError ? error.detail : undefined
      );
      return;
    }
    if (!this.port) return;
    this.reconcilePortFromYjs();
  };

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

  private validateParagraphSet(port: CollaborationDocumentPort): void {
    const { paragraphs } = schemaOf(this.ydoc);
    const local = port.paragraphs();
    if (
      local.length !== paragraphs.size ||
      local.some(
        (paragraph) =>
          !paragraphs.has(paragraph.paragraphId) ||
          !(paragraphs.get(paragraph.paragraphId) instanceof Y.Text) ||
          paragraphs.get(paragraph.paragraphId)!.length > MAX_SHARED_PARAGRAPH_TEXT
      )
    ) {
      throw new CollaborationSchemaError('paragraph-set-mismatch');
    }
  }

  private validateImmutableSchema(): void {
    const { root, paragraphs } = schemaOf(this.ydoc);
    const allowed = new Set([
      'protocolVersion',
      'schemaVersion',
      'documentId',
      'baselineSha256',
      'baselineByteLength',
      'initializedBy',
      'baseline',
      'initialized',
    ]);
    if ([...root.keys()].some((key) => !allowed.has(key))) {
      throw new CollaborationSchemaError('unsupported-root-key');
    }
    if (
      root.get('protocolVersion') !== PROTOCOL_VERSION ||
      root.get('schemaVersion') !== SCHEMA_VERSION ||
      root.get('documentId') !== this.documentId ||
      root.get('baselineSha256') !== this.baselineSha256 ||
      root.get('baselineByteLength') !== this.baseline.bytes.byteLength ||
      root.get('initializedBy') !== this.initializedBy ||
      root.get('initialized') !== true
    ) {
      throw new CollaborationSchemaError('immutable-metadata-changed');
    }
    const bytes = root.get('baseline');
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength !== this.baseline.bytes.byteLength ||
      bytes.some((value, index) => value !== this.baseline.bytes[index])
    ) {
      throw new CollaborationSchemaError('immutable-baseline-changed');
    }
    for (const [paragraphId, text] of paragraphs) {
      if (
        !this.baseline.paragraphs.some((paragraph) => paragraph.paragraphId === paragraphId) ||
        !(text instanceof Y.Text) ||
        text.length > MAX_SHARED_PARAGRAPH_TEXT
      ) {
        throw new CollaborationSchemaError('paragraph-set-mismatch');
      }
    }
  }

  private reconcileYjsFromPort(): void {
    const port = this.port;
    if (!port) return;
    const { paragraphs } = schemaOf(this.ydoc);
    this.ydoc.transact(() => {
      for (const paragraph of port.paragraphs()) {
        const shared = paragraphs.get(paragraph.paragraphId);
        if (!shared) throw new CollaborationSchemaError('paragraph-set-mismatch');
        updateYText(shared, paragraph.text);
      }
    }, this.localOrigin);
    this.undoManager.stopCapturing();
  }

  private reconcilePortFromYjs(): void {
    const port = this.port;
    if (!port || this.applyingSharedState) return;
    const { paragraphs } = schemaOf(this.ydoc);
    this.applyingSharedState = true;
    try {
      this.validateParagraphSet(port);
      const updates: { paragraphId: string; text: string }[] = [];
      for (const paragraph of port.paragraphs()) {
        const shared = paragraphs.get(paragraph.paragraphId);
        if (!shared) throw new CollaborationSchemaError('paragraph-set-mismatch');
        const next = shared.toString();
        if (next === paragraph.text) continue;
        updates.push({ paragraphId: paragraph.paragraphId, text: next });
      }
      if (updates.length > 0) {
        this.remoteCounter += 1;
        const result = port.applyParagraphTexts(updates, {
          origin: ORIGIN_IDS.mutationRemote,
          actorId: 'remote',
          operationId: `remote:${this.remoteCounter}`,
        });
        if (!result.ok) {
          throw new CollaborationSchemaError(
            isCollaborationFailureCode(result.reason) ? result.reason : 'remote-apply-failed',
            isCollaborationFailureCode(result.reason) ? undefined : result.reason
          );
        }
      }
    } catch (error) {
      this.setStatus(
        'error',
        error instanceof CollaborationSchemaError ? error.code : 'remote-apply-failed',
        error instanceof CollaborationSchemaError ? error.detail : undefined
      );
    } finally {
      this.applyingSharedState = false;
    }
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

async function bootstrap(
  options: CreateTextCollaborationOptions,
  documentId: string,
  identity: CollaborationIdentity
): Promise<OpenedBaseline> {
  if (options.bootstrap.kind === 'create') {
    const opened = openBaseline(options.bootstrap.document, documentId);
    await initializeSchema(options.ydoc, documentId, identity.actorId, opened);
    return validateInitializedSchema(options.ydoc, documentId);
  }
  await waitForInitialization(
    options.ydoc,
    options.bootstrap.timeoutMs ?? DEFAULT_INITIALIZATION_TIMEOUT_MS,
    options.bootstrap.signal
  );
  return validateInitializedSchema(options.ydoc, documentId);
}

/**
 * Create or join one paragraph-text collaboration replica.
 *
 * The caller owns `ydoc`.
 * @public
 */
export async function createTextCollaboration(
  options: CreateTextCollaborationOptions
): Promise<TextCollaborationHandle> {
  const documentId = validateDocumentId(options.documentId);
  const sessionId = sessionIdentity(options.sessionId);
  const identity = validateIdentity(options.identity);
  const baseline = await bootstrap(options, documentId, identity);
  const session = new Session(
    options.ydoc,
    options.awareness,
    documentId,
    sessionId,
    identity,
    baseline
  );
  return Object.freeze({
    document: new Uint8Array(baseline.bytes),
    session,
    destroy: () => session.destroy(),
  });
}
