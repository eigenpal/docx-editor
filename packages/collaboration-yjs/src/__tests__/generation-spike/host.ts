import * as Y from 'yjs';
import {
  BODY_KEY,
  SUPPORTED_SCHEMA,
  canonicalIdentity,
  cloneBytes,
  compareAndSwapActive,
  encodeCheckpoint,
  loadCheckpointDoc,
  readSchema,
  schemaEquals,
  schemaOf,
  writeSchema,
  type AuditFact,
  type Checkpoint,
  type FailureCode,
  type GenerationRecord,
  type ResetSnapshot,
  type SchemaVersions,
  type SessionRecord,
  type UpdateFrame,
} from './schema.ts';

export interface ReplacementOk {
  readonly ok: true;
  readonly roomGenerationId: string;
  readonly previousGenerationId: string;
}

export interface ReplacementFail {
  readonly ok: false;
  readonly code: FailureCode;
}

export type ReplacementResult = ReplacementOk | ReplacementFail;

export interface JoinOk {
  readonly ok: true;
  readonly roomGenerationId: string;
  readonly snapshot: Uint8Array;
  readonly schema: SchemaVersions;
}

export interface JoinFail {
  readonly ok: false;
  readonly code: FailureCode;
}

export type JoinResult = JoinOk | JoinFail;

export interface SubmitOk {
  readonly ok: true;
}

export interface SubmitFail {
  readonly ok: false;
  readonly code: FailureCode;
}

export type SubmitResult = SubmitOk | SubmitFail;

export class GenerationHost {
  private sequence = 0;
  private checkpointSeq = 0;
  private clientSeq = 0;
  private activeId: string | null = null;
  private writersLocked = false;
  private readonly generations = new Map<string, GenerationRecord>();
  private readonly checkpoints = new Map<string, Checkpoint>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly blobs: Map<string, Uint8Array>;
  private readonly facts: AuditFact[] = [];

  constructor(blobs?: Map<string, Uint8Array>) {
    this.blobs = blobs ?? new Map();
  }

  static seed(
    text: string,
    options?: {
      readonly blobs?: Map<string, Uint8Array>;
      readonly requiredBlobs?: readonly string[];
    }
  ): GenerationHost {
    const host = new GenerationHost(options?.blobs);
    const generation = host.createGenerationFromText(
      text,
      SUPPORTED_SCHEMA,
      options?.requiredBlobs ?? []
    );
    host.generations.set(generation.roomGenerationId, generation);
    host.activeId = generation.roomGenerationId;
    return host;
  }

  activeGenerationId(): string {
    if (!this.activeId) throw new Error('no-active-generation');
    return this.activeId;
  }

  isWritersLocked(): boolean {
    return this.writersLocked;
  }

  generation(id: string): GenerationRecord | undefined {
    return this.generations.get(id);
  }

  active(): GenerationRecord {
    const generation = this.generations.get(this.activeGenerationId());
    if (!generation) throw new Error('missing-active-generation');
    return generation;
  }

  bodyOf(id = this.activeGenerationId()): string {
    const generation = this.generations.get(id);
    if (!generation) throw new Error('unknown-generation');
    return generation.doc.getText(BODY_KEY).toString();
  }

  checkpoint(id: string): Checkpoint | undefined {
    return this.checkpoints.get(id);
  }

  auditFacts(): readonly AuditFact[] {
    return this.facts;
  }

  session(id: string): SessionRecord | undefined {
    return this.sessions.get(id);
  }

  retainBlob(digest: string, bytes: Uint8Array): void {
    this.blobs.set(digest, cloneBytes(bytes));
  }

  hasBlob(digest: string): boolean {
    return this.blobs.has(digest);
  }

  dropBlob(digest: string): void {
    this.blobs.delete(digest);
  }

  beginMaintenance(): ReplacementResult {
    if (this.writersLocked) return { ok: false, code: 'writers-locked' };
    this.writersLocked = true;
    const activeId = this.activeGenerationId();
    return {
      ok: true,
      roomGenerationId: activeId,
      previousGenerationId: activeId,
    };
  }

  endMaintenance(): void {
    this.writersLocked = false;
  }

  join(sessionId: string): JoinResult {
    if (this.writersLocked) return { ok: false, code: 'writers-locked' };
    const active = this.active();
    this.clientSeq += 1;
    const record: SessionRecord = {
      sessionId,
      roomGenerationId: active.roomGenerationId,
      clientId: this.clientSeq,
      connected: true,
      disconnectReason: null,
    };
    this.sessions.set(sessionId, record);
    return {
      ok: true,
      roomGenerationId: active.roomGenerationId,
      snapshot: cloneBytes(Y.encodeStateAsUpdate(active.doc)),
      schema: active.schema,
    };
  }

  submit(frame: UpdateFrame): SubmitResult {
    const session = this.sessions.get(frame.sessionId);
    if (!session) return { ok: false, code: 'unknown-session' };
    if (!session.connected) return { ok: false, code: 'disconnected' };
    if (this.writersLocked) return { ok: false, code: 'writers-locked' };
    if (
      session.roomGenerationId !== this.activeId ||
      frame.roomGenerationId !== session.roomGenerationId
    ) {
      this.disconnectSession(session, 'stale-generation');
      this.facts.push({
        kind: 'reject-stale',
        roomGenerationId: this.activeGenerationId(),
        previousGenerationId: session.roomGenerationId,
        code: 'stale-generation',
      });
      return { ok: false, code: 'stale-generation' };
    }
    const generation = this.active();
    Y.applyUpdate(generation.doc, frame.update, 'session-update');
    generation.lastValidCanonicalIdentity = canonicalIdentity(
      generation.doc.getText(BODY_KEY).toString(),
      generation.requiredBlobs
    );
    return { ok: true };
  }

  createCheckpoint(): Checkpoint {
    this.checkpointSeq += 1;
    const checkpoint = encodeCheckpoint(this.active(), `ckpt-${this.checkpointSeq}`);
    this.checkpoints.set(checkpoint.checkpointId, checkpoint);
    this.facts.push({
      kind: 'checkpoint',
      roomGenerationId: checkpoint.roomGenerationId,
      checkpointId: checkpoint.checkpointId,
    });
    return checkpoint;
  }

  restore(checkpointId: string): ReplacementResult {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) return { ok: false, code: 'unknown-checkpoint' };
    return this.restoreFrom(checkpoint);
  }

  restoreFrom(checkpoint: Checkpoint): ReplacementResult {
    if (checkpoint.lastValidCanonicalIdentity.length === 0) {
      this.facts.push({
        kind: 'discard-candidate',
        roomGenerationId: this.activeGenerationId(),
        code: 'empty-canonical-identity',
      });
      return { ok: false, code: 'empty-canonical-identity' };
    }
    return this.replaceActive('restore', () => {
      const doc = loadCheckpointDoc(checkpoint);
      return this.wrapLoadedDoc(doc, checkpoint.schema, [...checkpoint.requiredBlobs]);
    });
  }

  reset(snapshot: ResetSnapshot): ReplacementResult {
    return this.replaceActive('destructive-reset', () =>
      this.createGenerationFromText(
        snapshot.text,
        snapshot.schema ?? SUPPORTED_SCHEMA,
        snapshot.requiredBlobs ?? []
      )
    );
  }

  migrate(nextSchema: SchemaVersions): ReplacementResult {
    return this.replaceActive('migration', () => {
      const current = this.active();
      const doc = new Y.Doc();
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(current.doc), 'migration');
      const { meta } = schemaOf(doc);
      doc.transact(() => {
        writeSchema(meta, nextSchema);
      }, 'migration');
      return this.wrapLoadedDoc(doc, nextSchema, [...current.requiredBlobs]);
    });
  }

  rollback(toGenerationId: string): ReplacementResult {
    if (this.writersLocked) return { ok: false, code: 'writers-locked' };
    const target = this.generations.get(toGenerationId);
    if (!target) return { ok: false, code: 'unknown-generation' };
    const previous = this.activeGenerationId();
    if (previous === toGenerationId) {
      return { ok: true, roomGenerationId: previous, previousGenerationId: previous };
    }
    this.writersLocked = true;
    try {
      const swapped = compareAndSwapActive(this.activeId, previous, toGenerationId);
      if (!swapped.ok) return { ok: false, code: 'cas-mismatch' };
      this.activeId = swapped.active;
      this.disconnectStaleSessions(toGenerationId);
      this.facts.push({
        kind: 'rollback',
        roomGenerationId: toGenerationId,
        previousGenerationId: previous,
      });
      return { ok: true, roomGenerationId: toGenerationId, previousGenerationId: previous };
    } finally {
      this.writersLocked = false;
    }
  }

  destroy(): void {
    for (const session of this.sessions.values()) {
      session.connected = false;
      session.disconnectReason = 'host-destroyed';
    }
    for (const generation of this.generations.values()) {
      generation.doc.destroy();
    }
    this.generations.clear();
    this.sessions.clear();
    this.checkpoints.clear();
    this.activeId = null;
  }

  private replaceActive(
    kind: 'restore' | 'destructive-reset' | 'migration',
    build: () => GenerationRecord
  ): ReplacementResult {
    if (this.writersLocked) return { ok: false, code: 'writers-locked' };
    const previous = this.activeGenerationId();
    this.writersLocked = true;
    let candidate: GenerationRecord | null = null;
    try {
      candidate = build();
      const code = this.validateCandidate(candidate);
      if (code) {
        this.facts.push({
          kind: 'discard-candidate',
          roomGenerationId: previous,
          previousGenerationId: candidate.roomGenerationId,
          code,
        });
        candidate.doc.destroy();
        return { ok: false, code };
      }
      this.generations.set(candidate.roomGenerationId, candidate);
      const swapped = compareAndSwapActive(this.activeId, previous, candidate.roomGenerationId);
      if (!swapped.ok) {
        this.generations.delete(candidate.roomGenerationId);
        candidate.doc.destroy();
        return { ok: false, code: 'cas-mismatch' };
      }
      this.activeId = swapped.active;
      this.disconnectStaleSessions(candidate.roomGenerationId);
      this.facts.push({
        kind,
        roomGenerationId: candidate.roomGenerationId,
        previousGenerationId: previous,
      });
      return {
        ok: true,
        roomGenerationId: candidate.roomGenerationId,
        previousGenerationId: previous,
      };
    } finally {
      this.writersLocked = false;
    }
  }

  private disconnectStaleSessions(activeGenerationId: string): void {
    for (const session of this.sessions.values()) {
      if (session.connected && session.roomGenerationId !== activeGenerationId) {
        this.disconnectSession(session, 'stale-generation');
      }
    }
  }

  private disconnectSession(session: SessionRecord, reason: FailureCode): void {
    session.connected = false;
    session.disconnectReason = reason;
  }

  private validateCandidate(candidate: GenerationRecord): FailureCode | null {
    if (!schemaEquals(candidate.schema, SUPPORTED_SCHEMA)) return 'unsupported-version';
    const schema = readSchema(schemaOf(candidate.doc).meta);
    if (!schema || !schemaEquals(schema, candidate.schema)) return 'invalid-schema';
    if (schemaOf(candidate.doc).meta.get('initialized') !== true) return 'invalid-snapshot';
    if (candidate.lastValidCanonicalIdentity.length === 0) {
      return 'empty-canonical-identity';
    }
    for (const digest of candidate.requiredBlobs) {
      if (!this.blobs.has(digest)) return 'missing-blob';
    }
    return null;
  }

  private createGenerationFromText(
    text: string,
    schema: SchemaVersions,
    requiredBlobs: readonly string[]
  ): GenerationRecord {
    const doc = new Y.Doc();
    const { meta, body } = schemaOf(doc);
    doc.transact(() => {
      writeSchema(meta, schema);
      meta.set('initialized', true);
      body.insert(0, text);
    }, 'bootstrap');
    return this.wrapLoadedDoc(doc, schema, requiredBlobs);
  }

  private wrapLoadedDoc(
    doc: Y.Doc,
    schema: SchemaVersions,
    requiredBlobs: readonly string[]
  ): GenerationRecord {
    this.sequence += 1;
    const roomGenerationId = `g-${this.sequence}`;
    const { meta } = schemaOf(doc);
    const identity = canonicalIdentity(doc.getText(BODY_KEY).toString(), requiredBlobs);
    doc.transact(() => {
      meta.set('roomGenerationId', roomGenerationId);
      meta.set('lastValidCanonicalIdentity', identity);
      meta.set('requiredBlobs', [...requiredBlobs]);
    }, 'generation-meta');
    return {
      roomGenerationId,
      sequence: this.sequence,
      doc,
      schema,
      lastValidCanonicalIdentity: identity,
      requiredBlobs,
    };
  }
}
