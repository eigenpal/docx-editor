// Tree-backed document store with intent-scoped semantic history (tasks 5.2, 5.4-5.6).
//
// One transaction = one atomic publication = one history entry. `apply` stages ops against
// a working part; nothing is visible until `transact` returns, so a rejected op mid-batch
// leaves revision, tree, indexes and subscribers exactly as they were.
//
// HISTORY IS SCOPED BY INTENT, NOT BY A TIMER (design D10). A wall-clock coalescing window
// is the approach D10 rejects: it cannot reliably group an IME composition, whose
// transactions span an unbounded interval, and it just as easily merges across a projection
// reconciliation that should not be an entry at all. Here the caller states the scope — a
// transaction is one entry, a composition is one entry however many transactions it
// contains, and a projection-origin commit is none.
//
// Entries are snapshots, which is affordable because the tree is persistent and
// structurally shared: an entry retains the previous part by reference rather than cloning
// it, so undo is a pointer swap and history costs nothing per entry.

import { validateOoxmlPart, type OoxmlPart } from '../package/ooxml-tree.ts';
import { ORIGIN_IDS } from '../registry/frozen-ids.ts';
import { applyTreeOp, type ImpactClass, type TreeDocOp, type TreeOpRejection } from './tree-ops.ts';

/** A selection the caller wants restored when an entry is undone or redone. */
export interface SelectionMark {
  readonly paragraphId: string;
  readonly start: number;
  readonly end: number;
}

export interface TreeModelChange {
  readonly change: 'model-change';
  readonly fromRevision: number;
  readonly toRevision: number;
  readonly commitId: string;
  readonly origin: string;
  readonly dirty: readonly string[];
  readonly created: readonly string[];
  readonly deleted: readonly string[];
  readonly splitJoin: readonly (
    | { readonly split: { readonly from: string; readonly tail: string } }
    | { readonly join: { readonly kept: string; readonly removed: string } }
  )[];
  readonly dependencyKeys: readonly string[];
  /** The widest impact among the transaction's ops — what layout must scope to. */
  readonly impact: ImpactClass;
}

export type TransactResult =
  | { readonly ok: true; readonly change: TreeModelChange | null }
  | { readonly ok: false; readonly reason: TreeOpRejection; readonly detail?: string };

export interface TransactionContext {
  /** Stage one op. Returns false once the transaction has failed; further ops are ignored. */
  apply(op: TreeDocOp): boolean;
  /** The selection to restore when this entry is undone. */
  selectionBefore(selection: SelectionMark | null): void;
  /** The selection to restore when this entry is redone. */
  selectionAfter(selection: SelectionMark | null): void;
}

export interface TransactOptions {
  readonly origin?: string;
  /**
   * A COMMAND is one user intent that may need several ops (a toolbar click applying a
   * property across a multi-run selection). It is still exactly one history entry, which is
   * the same rule a plain transaction follows — the option exists to say so explicitly at
   * the call site rather than leaving it implied.
   */
  readonly scope?: 'transaction' | 'command';
}

interface HistoryEntry {
  readonly part: OoxmlPart;
  readonly revision: number;
  readonly selectionBefore: SelectionMark | null;
  readonly selectionAfter: SelectionMark | null;
}

const IMPACT_RANK: Record<ImpactClass, number> = {
  'text-local': 0,
  'paragraph-local': 1,
  'flow-structural': 2,
};

export interface TreeDocumentStoreOptions {
  /** Bound on retained history entries. Oldest entries drop first. */
  readonly historyLimit?: number;
}

export class TreeDocumentStore {
  private current: OoxmlPart;
  private rev = 0;
  private commitCounter = 0;
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];
  private readonly subscribers = new Set<(change: TreeModelChange) => void>();
  private readonly historyLimit: number;

  /** Open composition, if any. While set, transactions extend one entry (task 5.5). */
  private composition: {
    readonly entry: HistoryEntry;
    /** Whether any transaction inside the composition actually committed. */
    committed: boolean;
  } | null = null;

  constructor(part: OoxmlPart, options: TreeDocumentStoreOptions = {}) {
    this.current = part;
    this.historyLimit = options.historyLimit ?? 200;
  }

  get part(): OoxmlPart {
    return this.current;
  }
  get revision(): number {
    return this.rev;
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  /** Retained entries — the unit `undo()` reverses, so tests can assert grouping. */
  get historyDepth(): number {
    return this.undoStack.length;
  }
  get compositionActive(): boolean {
    return this.composition !== null;
  }

  subscribe(listener: (change: TreeModelChange) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  /**
   * Run one atomic transaction.
   *
   * Ops are staged against a working copy. On the first rejection the whole transaction is
   * abandoned: no revision, no history entry, no notification. On success exactly one
   * revision is published and exactly one history entry is recorded — unless a composition
   * is open, in which case the entry already exists and this transaction joins it.
   */
  transact(
    build: (ctx: TransactionContext) => void,
    options: TransactOptions = {}
  ): TransactResult {
    const origin = options.origin ?? ORIGIN_IDS.mutationHuman;
    const before = this.current;
    const beforeRevision = this.rev;

    let working = this.current;
    let failure: { reason: TreeOpRejection; detail?: string } | null = null;
    let applied = 0;
    const dirty = new Set<string>();
    const created = new Set<string>();
    const deleted = new Set<string>();
    const dependencyKeys = new Set<string>();
    const splitJoin: TreeModelChange['splitJoin'][number][] = [];
    let impact: ImpactClass = 'text-local';
    let selectionBefore: SelectionMark | null = null;
    let selectionAfter: SelectionMark | null = null;

    build({
      apply: (op) => {
        if (failure) return false;
        // Validation of the whole part is DEFERRED to the commit below: per-op it made a
        // many-op transaction quadratic in document size, and nothing between here and the
        // commit can observe the intermediate parts. Op-level input validation still runs
        // inside `applyTreeOp` before any tree work.
        const result = applyTreeOp(working, op, { deferValidation: true });
        if (!result.ok) {
          failure = { reason: result.reason, ...(result.detail ? { detail: result.detail } : {}) };
          return false;
        }
        working = result.part;
        applied += 1;
        for (const id of result.effect.dirty) dirty.add(id);
        for (const id of result.effect.created) created.add(id);
        for (const id of result.effect.deleted) deleted.add(id);
        for (const key of result.effect.dependencyKeys) dependencyKeys.add(key);
        if (result.effect.split) splitJoin.push({ split: result.effect.split });
        if (result.effect.join) splitJoin.push({ join: result.effect.join });
        if (IMPACT_RANK[result.effect.impact] > IMPACT_RANK[impact]) impact = result.effect.impact;
        return true;
      },
      selectionBefore: (selection) => {
        selectionBefore = selection;
      },
      selectionAfter: (selection) => {
        selectionAfter = selection;
      },
    });

    if (failure) {
      const rejection = failure as { reason: TreeOpRejection; detail?: string };
      return {
        ok: false,
        reason: rejection.reason,
        ...(rejection.detail ? { detail: rejection.detail } : {}),
      };
    }
    if (applied === 0) return { ok: true, change: null };

    // The commit boundary is where fail-closed lives now: the SAME invariant validation the
    // primitives used to run each, applied once to the final tree. An invalid result
    // abandons the whole transaction — no revision, no history entry, no notification —
    // exactly as a per-op rejection would have, so nothing invalid is ever published.
    const validation = validateOoxmlPart(working);
    if (!validation.ok) {
      return {
        ok: false,
        reason: 'tree-invariant',
        detail: JSON.stringify(validation.issues),
      };
    }

    // A PROJECTION-origin commit reconciles the view with state the store already holds.
    // It publishes a revision so consumers can re-derive, but it is not a user intent, so
    // it must not become an undo step (task 5.6).
    const recordsHistory = origin !== ORIGIN_IDS.projection;

    if (recordsHistory) {
      if (this.composition) {
        // Inside a composition every transaction folds into the entry opened at
        // compositionstart — however many transactions the IME emits (task 5.5).
        this.composition.committed = true;
        this.composition = {
          ...this.composition,
          entry: { ...this.composition.entry, selectionAfter },
        };
      } else {
        this.pushUndo({
          part: before,
          revision: beforeRevision,
          selectionBefore,
          selectionAfter,
        });
        this.redoStack.length = 0;
      }
    }

    this.current = working;
    this.rev += 1;
    return {
      ok: true,
      change: this.publish(origin, beforeRevision, {
        dirty,
        created,
        deleted,
        dependencyKeys,
        splitJoin,
        impact,
      }),
    };
  }

  /**
   * Open one history entry for an IME composition.
   *
   * Everything committed until `endComposition` collapses into this single entry, which is
   * what makes a composed word one undo step rather than one per intermediate transaction.
   */
  beginComposition(selectionBefore: SelectionMark | null = null): void {
    if (this.composition) return; // already open; nested starts are a no-op, not an error
    this.composition = {
      entry: {
        part: this.current,
        revision: this.rev,
        selectionBefore,
        selectionAfter: null,
      },
      committed: false,
    };
  }

  /** Close the composition, recording its entry only if anything actually committed. */
  endComposition(): void {
    const open = this.composition;
    this.composition = null;
    if (!open || !open.committed) return;
    this.pushUndo(open.entry);
    this.redoStack.length = 0;
  }

  /**
   * Cancel an open composition without recording an entry, leaving whatever it committed
   * in place. An IME cancel is not an undo request; the caller decides what to revert.
   */
  cancelComposition(): void {
    this.composition = null;
  }

  undo(): TreeModelChange | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    const beforeRevision = this.rev;
    this.redoStack.push({
      part: this.current,
      revision: this.rev,
      selectionBefore: entry.selectionBefore,
      selectionAfter: entry.selectionAfter,
    });
    this.current = entry.part;
    this.rev += 1;
    return this.publish(ORIGIN_IDS.mutationUndo, beforeRevision, null);
  }

  redo(): TreeModelChange | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    const beforeRevision = this.rev;
    this.undoStack.push({
      part: this.current,
      revision: this.rev,
      selectionBefore: entry.selectionBefore,
      selectionAfter: entry.selectionAfter,
    });
    this.current = entry.part;
    this.rev += 1;
    return this.publish(ORIGIN_IDS.mutationRedo, beforeRevision, null);
  }

  /** The selection to restore for the entry `undo()` would reverse next. */
  selectionForUndo(): SelectionMark | null {
    return this.undoStack[this.undoStack.length - 1]?.selectionBefore ?? null;
  }

  /** The selection to restore for the entry `redo()` would reapply next. */
  selectionForRedo(): SelectionMark | null {
    return this.redoStack[this.redoStack.length - 1]?.selectionAfter ?? null;
  }

  private pushUndo(entry: HistoryEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.historyLimit) this.undoStack.shift();
  }

  private publish(
    origin: string,
    fromRevision: number,
    effects: {
      dirty: Set<string>;
      created: Set<string>;
      deleted: Set<string>;
      dependencyKeys: Set<string>;
      splitJoin: TreeModelChange['splitJoin'][number][];
      impact: ImpactClass;
    } | null
  ): TreeModelChange {
    this.commitCounter += 1;
    const change: TreeModelChange = {
      change: 'model-change',
      fromRevision,
      toRevision: this.rev,
      commitId: `commit-${this.commitCounter}`,
      origin,
      dirty: effects ? [...effects.dirty] : [],
      created: effects ? [...effects.created] : [],
      deleted: effects ? [...effects.deleted] : [],
      splitJoin: effects ? effects.splitJoin : [],
      dependencyKeys: effects ? [...effects.dependencyKeys] : [],
      // Undo and redo restore a whole previous tree, so their reach is not knowable from
      // one op's effect — treat them as structural and let layout re-derive.
      impact: effects ? effects.impact : 'flow-structural',
    };
    for (const listener of this.subscribers) listener(change);
    return change;
  }
}
