// PM-free semantic DocumentStore (document-engine tasks 4.2, 4.4, 4.5). Owns the
// current authored model, a synchronous transaction path, deterministic
// normalization, history, subscriptions, and opaque anchors. It contains no
// ProseMirror, DOM, transport, or CRDT type — a server mutates it identically to
// a browser. `transact` is the only mutation entry; batches are all-or-nothing.

import { detachFormattingReferences, type PackageModel } from '../model/index.ts';
import { NON_CANONICAL_ORIGINS } from '../registry/frozen-ids.ts';
import { normalize } from './normalize.ts';
import { buildModelChange } from './model-change.ts';
import { validateDocOp, applyDocOp } from './docops.ts';
import type { DocOp, ModelChange, OpEffect } from './contracts.ts';
import type { AuditIndex, ReplayJournal } from './audit.ts';

export type StoreFailureKind = 'validation' | 'conflict' | 'authorization' | 'resource' | 'aborted';
export interface StoreFailure {
  readonly kind: StoreFailureKind;
  readonly message: string;
  readonly index?: number;
}

export type OpStatus =
  | { readonly status: 'applied' }
  | { readonly status: 'aborted'; readonly failingIndices: readonly number[] }
  | { readonly status: 'failed'; readonly failure: StoreFailure };

export type CommitResult =
  | {
      readonly ok: true;
      readonly commitId: string;
      readonly revision: number;
      readonly modelChange: ModelChange;
    }
  | { readonly ok: false; readonly failure: StoreFailure };

export type BatchResult =
  | {
      readonly ok: true;
      readonly commitId: string;
      readonly revision: number;
      readonly results: readonly OpStatus[];
      readonly modelChange: ModelChange;
      /** Maps each appendParagraph `symbolicId` to its allocated real id. */
      readonly createdSymbols: Readonly<Record<string, string>>;
    }
  | { readonly ok: false; readonly revision: number; readonly results: readonly OpStatus[] };

export interface TransactionContext {
  apply(op: DocOp): void;
}

class DocOpValidationError extends Error {
  constructor(readonly failure: StoreFailure) {
    super(failure.message);
  }
}

/** Opaque engine-owned anchor handle (task 4.2; full resolution is 4.8–4.10). */
export interface AnchorHandle {
  readonly __brand: 'AnchorHandle';
}
interface AnchorRecord extends AnchorHandle {
  readonly storyId: string;
  readonly blockId: string;
  readonly affinity: 'before' | 'after';
}

export interface TransactOptions {
  /** Optimistic-concurrency precondition; conflict if it differs from current. */
  readonly baseRevision?: number;
}

interface Commit {
  readonly before: PackageModel;
  readonly after: PackageModel;
  readonly modelChange: ModelChange;
}

/** A canonical write MUST carry a MutationOrigin. A ProjectionOrigin (binding/view work) or an
 *  AwarenessOrigin (presence) performing a canonical write is a programming error — it would leak
 *  projection/awareness into history, audit, snapshot, and replication (design D5 / task 6.9). */
function assertCanonicalOrigin(origin: string): void {
  if (NON_CANONICAL_ORIGINS.includes(origin)) {
    throw new Error(
      `non-canonical origin '${origin}' may not perform a canonical store write (projection/awareness never enter history/audit)`
    );
  }
}

export class DocumentStore {
  private model: PackageModel;
  private revision = 0;
  private commitCounter = 0;
  private inTransaction = false;
  private readonly subscribers = new Set<(mc: ModelChange) => void>();
  private readonly history: Commit[] = [];
  private readonly redo: Commit[] = [];

  private readonly audit?: AuditIndex;
  private readonly journal?: ReplayJournal;
  private readonly clock: () => number;

  constructor(
    initial: PackageModel,
    opts: {
      revision?: number;
      commitCounter?: number;
      audit?: AuditIndex;
      journal?: ReplayJournal;
      /** Injected time source (deterministic in tests); defaults to a monotonic counter. */
      clock?: () => number;
    } = {}
  ) {
    this.model = detachFormattingReferences(initial);
    this.revision = opts.revision ?? 0;
    this.commitCounter = opts.commitCounter ?? 0;
    this.audit = opts.audit;
    this.journal = opts.journal;
    let tick = 0;
    this.clock = opts.clock ?? (() => (tick += 1));
  }

  get currentModel(): PackageModel {
    return this.model;
  }
  get currentRevision(): number {
    return this.revision;
  }

  subscribe(fn: (mc: ModelChange) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  /** Synchronous transaction. Rejects async/nested/reentrant; rolls back on any failure. */
  transact(
    origin: string,
    callback: (ctx: TransactionContext) => void,
    opts: TransactOptions = {}
  ): CommitResult {
    assertCanonicalOrigin(origin);
    if (this.inTransaction) throw new Error('nested/reentrant transaction is not allowed');
    if (opts.baseRevision !== undefined && opts.baseRevision !== this.revision) {
      return {
        ok: false,
        failure: {
          kind: 'conflict',
          message: `baseRevision ${opts.baseRevision} != current ${this.revision}`,
        },
      };
    }

    this.inTransaction = true;
    const staged: DocOp[] = [];
    const ctx: TransactionContext = {
      apply: (op) => {
        const v = validateDocOp(op);
        if (!v.ok)
          throw new DocOpValidationError({
            kind: 'validation',
            message: v.reason,
            index: staged.length,
          });
        staged.push(op);
      },
    };

    try {
      const ret = callback(ctx) as unknown;
      if (ret && typeof (ret as { then?: unknown }).then === 'function') {
        throw new Error('async transaction callback is not allowed');
      }
      return this.commitStaged(origin, staged);
    } catch (e) {
      if (e instanceof DocOpValidationError) return { ok: false, failure: e.failure };
      throw e; // programmer error (nested/async) or callback throw -> rollback, nothing committed
    } finally {
      this.inTransaction = false;
    }
  }

  /**
   * All-or-nothing batch (task 4.5). Every op is schema-validated and applied;
   * any failure aborts all writes with positional `aborted` results and no state
   * change. `symbolicId` on appendParagraph is resolved to the real created id so
   * later ops in the batch can target it.
   */
  applyEdits(ops: readonly DocOp[], origin: string): BatchResult {
    assertCanonicalOrigin(origin);
    // Pre-validate every op positionally without mutating.
    const failingIndices: number[] = [];
    ops.forEach((op, i) => {
      if (!validateDocOp(op).ok) failingIndices.push(i);
    });
    if (failingIndices.length > 0) {
      const results = ops.map<OpStatus>((_, i) =>
        failingIndices.includes(i)
          ? {
              status: 'failed',
              failure: { kind: 'validation', message: `op ${i} invalid`, index: i },
            }
          : { status: 'aborted', failingIndices }
      );
      return { ok: false, revision: this.revision, results };
    }

    // Apply against a working model; resolve symbolic ids from appendParagraph.
    const symbolic = new Map<string, string>();
    let working = this.model;
    const effects: OpEffect[] = [];
    try {
      for (const op of ops) {
        const resolved = this.resolveSymbolic(op, symbolic);
        const { model, effect } = applyDocOp(working, resolved);
        working = model;
        effects.push(effect);
        if (
          (resolved.op === 'appendParagraph' || resolved.op === 'insertParagraph') &&
          (op.op === 'appendParagraph' || op.op === 'insertParagraph') &&
          op.symbolicId
        ) {
          symbolic.set(op.symbolicId, effect.created[0]);
        }
      }
    } catch (e) {
      const results = ops.map<OpStatus>(() => ({ status: 'aborted', failingIndices: [] }));
      void e;
      return { ok: false, revision: this.revision, results };
    }
    const commit = this.publish(origin, working, effects, ops);
    return {
      ok: true,
      commitId: commit.commitId,
      revision: commit.revision,
      results: ops.map(() => ({ status: 'applied' })),
      modelChange: commit.modelChange,
      createdSymbols: Object.fromEntries(symbolic),
    };
  }

  /**
   * Binding-only (task 5.3 / ADR-S10): publish an authored model DERIVED from a
   * backend merge as one monotonic revision + one ModelChange. The merge already
   * happened in the backend; this never re-runs DocOp validation. A backend MUST
   * NOT mutate canonical state or call `notify` itself — canonical state changes
   * only through store entries, and the optional `YjsBinding` is the sole caller of
   * this on the replication path.
   */
  publishDerived(
    model: PackageModel,
    origin: string
  ): { ok: true; commitId: string; revision: number; modelChange: ModelChange } {
    assertCanonicalOrigin(origin);
    const before = this.model;
    const fromRevision = this.revision;
    this.revision += 1;
    this.commitCounter += 1;
    const commitId = `commit-${this.commitCounter}`;
    const normalizedModel = normalize(model);
    const normalized = detachFormattingReferences(normalizedModel);
    const modelChange = buildModelChange(
      fromRevision,
      this.revision,
      commitId,
      origin,
      [],
      normalizedModel !== model
    );
    this.model = normalized;
    // Same suspension guard as publish(): a remote-derived commit while replicated
    // must NOT become undoable, or disconnect would re-expose an undo that removes
    // converged remote text from the store while the Y.Doc still holds it (ADR-S10).
    if (!this.isHistorySuspended) {
      this.history.push({ before, after: normalized, modelChange });
      this.redo.length = 0;
    }
    this.notify(modelChange);
    return { ok: true, commitId, revision: this.revision, modelChange };
  }

  // --- history ---

  private historySuspendCount = 0;

  /**
   * Suspend local semantic history (ADR-S10), reference-counted so multiple
   * connections and one-per-store are both safe. While a YjsBinding is connected the
   * canonical model is co-authored through the CRDT, so a local `undo` that rewinds
   * to a pre-collaboration snapshot would clobber converged remote state. Entering
   * suspension FORKS AWAY the existing history (so it can never be undone across the
   * collaboration boundary), and no undoable history accumulates while suspended.
   * Collaborative undo (via the backend's actor-scoped Y.UndoManager) is a separate,
   * deferred path.
   */
  suspendHistory(): void {
    if (this.historySuspendCount === 0) {
      this.history.length = 0;
      this.redo.length = 0;
    }
    this.historySuspendCount += 1;
  }
  resumeHistory(): void {
    if (this.historySuspendCount > 0) this.historySuspendCount -= 1;
  }
  get isHistorySuspended(): boolean {
    return this.historySuspendCount > 0;
  }

  canUndo(): boolean {
    return !this.isHistorySuspended && this.history.length > 0;
  }
  canRedo(): boolean {
    return !this.isHistorySuspended && this.redo.length > 0;
  }

  undo(): CommitResult {
    if (this.isHistorySuspended)
      return {
        ok: false,
        failure: { kind: 'aborted', message: 'history suspended while replicated' },
      };
    const commit = this.history.pop();
    if (!commit) return { ok: false, failure: { kind: 'aborted', message: 'nothing to undo' } };
    this.redo.push(commit);
    this.model = commit.before;
    this.revision += 1;
    const mc = this.invert(commit.modelChange);
    this.notify(mc);
    return { ok: true, commitId: mc.commitId, revision: this.revision, modelChange: mc };
  }

  redoLast(): CommitResult {
    if (this.isHistorySuspended)
      return {
        ok: false,
        failure: { kind: 'aborted', message: 'history suspended while replicated' },
      };
    const commit = this.redo.pop();
    if (!commit) return { ok: false, failure: { kind: 'aborted', message: 'nothing to redo' } };
    this.history.push(commit);
    this.model = commit.after;
    this.revision += 1;
    const mc = {
      ...commit.modelChange,
      fromRevision: this.revision - 1,
      toRevision: this.revision,
      origin: 'redo',
    };
    this.notify(mc);
    return { ok: true, commitId: mc.commitId, revision: this.revision, modelChange: mc };
  }

  // --- anchors (opaque; task 4.2 surface, resolution refined in 4.8–4.10) ---

  createAnchor(
    paragraphId: string,
    affinity: 'before' | 'after' = 'after'
  ): AnchorHandle | undefined {
    for (const [storyId, story] of this.model.stories) {
      if (story.blocks.some((b) => b.id === paragraphId)) {
        const rec: AnchorRecord = {
          __brand: 'AnchorHandle',
          storyId,
          blockId: paragraphId,
          affinity,
        };
        return rec;
      }
    }
    return undefined;
  }

  resolveAnchor(handle: AnchorHandle): { storyId: string; blockId: string } | { invalid: true } {
    const rec = handle as AnchorRecord;
    const story = this.model.stories.get(rec.storyId);
    if (story && story.blocks.some((b) => b.id === rec.blockId))
      return { storyId: rec.storyId, blockId: rec.blockId };
    return { invalid: true };
  }

  // --- internals ---

  private resolveSymbolic(op: DocOp, symbolic: Map<string, string>): DocOp {
    const map = (id: string) => symbolic.get(id) ?? id;
    switch (op.op) {
      case 'insertText':
      case 'splitParagraph':
      case 'deleteParagraph':
        return { ...op, paragraphId: map(op.paragraphId) };
      case 'joinParagraphs':
        return { ...op, firstId: map(op.firstId), secondId: map(op.secondId) };
      case 'replaceParagraph':
      case 'setParagraphRuns':
        return { ...op, paragraphId: map(op.paragraphId) };
      default:
        return op;
    }
  }

  private commitStaged(origin: string, staged: readonly DocOp[]): CommitResult {
    let working = this.model;
    const effects: OpEffect[] = [];
    try {
      for (const op of staged) {
        const { model, effect } = applyDocOp(working, op);
        working = model;
        effects.push(effect);
      }
    } catch (e) {
      return {
        ok: false,
        failure: { kind: 'validation', message: e instanceof Error ? e.message : String(e) },
      };
    }
    const commit = this.publish(origin, working, effects, staged);
    return {
      ok: true,
      commitId: commit.commitId,
      revision: commit.revision,
      modelChange: commit.modelChange,
    };
  }

  private publish(
    origin: string,
    working: PackageModel,
    effects: readonly OpEffect[],
    ops: readonly DocOp[]
  ): { commitId: string; revision: number; modelChange: ModelChange } {
    const normalizedModel = normalize(working);
    const normalized = detachFormattingReferences(normalizedModel);
    const before = this.model;
    const fromRevision = this.revision;
    this.revision += 1;
    this.commitCounter += 1;
    const commitId = `commit-${this.commitCounter}`;
    const modelChange = buildModelChange(
      fromRevision,
      this.revision,
      commitId,
      origin,
      effects,
      normalizedModel !== working
    );
    this.model = normalized;
    // While history is suspended (replicated), do NOT accumulate undoable commits —
    // otherwise disconnect would re-expose an undo path across the collaboration
    // boundary. Collaborative undo is the backend's Y.UndoManager, deferred (ADR-S10).
    if (!this.isHistorySuspended) {
      this.history.push({ before, after: normalized, modelChange });
      this.redo.length = 0;
    }
    this.record(commitId, modelChange, ops);
    this.notify(modelChange);
    return { commitId, revision: this.revision, modelChange };
  }

  /** Append the redacted audit entry (no raw text) and the full replay journal entry. */
  private record(commitId: string, mc: ModelChange, ops: readonly DocOp[]): void {
    const at = this.clock();
    this.audit?.append({
      commitId,
      toRevision: mc.toRevision,
      origin: mc.origin,
      dirtyIds: [...mc.dirty, ...mc.created, ...mc.deleted],
      at,
    });
    if (ops.length > 0) {
      this.journal?.append({
        commitId,
        toRevision: mc.toRevision,
        origin: mc.origin,
        ops: [...ops],
        at,
      });
    }
  }

  private invert(mc: ModelChange): ModelChange {
    return {
      ...mc,
      fromRevision: this.revision - 1,
      toRevision: this.revision,
      origin: 'undo',
      dirty: mc.dirty,
      deleted: mc.created,
      created: mc.deleted,
      splitJoin: mc.splitJoin.map((sj) =>
        'split' in sj
          ? { join: { kept: sj.split.from, removed: sj.split.tail } }
          : { split: { from: sj.join.kept, tail: sj.join.removed } }
      ),
      moves: mc.moves.map((m) => ({ id: m.id, from: m.to, to: m.from })),
    };
  }

  private notify(mc: ModelChange): void {
    for (const fn of this.subscribers) fn(mc);
  }
}
