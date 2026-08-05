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

import { validateOoxmlPartDelta, type OoxmlPart } from '../package/ooxml-tree.ts';
import { withPart, type OoxmlPackage } from '../package/ooxml-package.ts';
import { validatePackageInvariants } from '../package/package-edit.ts';
import { settingsPartOf } from '../package/note-properties.ts';
import { ORIGIN_IDS } from '../registry/frozen-ids.ts';
import { formsProtectionRefusal } from './tree-op-content-controls.ts';
import { applyTreeOp, type ImpactClass, type TreeDocOp, type TreeOpRejection } from './tree-ops.ts';

/** A selection the caller wants restored when an entry is undone or redone. */
export interface SelectionMark {
  readonly paragraphId: string;
  readonly start: number;
  readonly end: number;
}

/** Returns the mark when collapsed; otherwise undefined. */
function collapsedSelection(mark: SelectionMark | null): SelectionMark | undefined {
  if (mark === null || mark.start !== mark.end) return undefined;
  return mark;
}

/**
 * Which editable story a ModelChange came from.
 *
 * Mirrors `EditorScope` for body and header/footer — `{ kind: 'headerFooter'; rId }` —
 * so package-aware mutation and the public scope contract stay one vocabulary. Body
 * commits omit `rId`; header/footer commits carry the relationship id that addressed
 * the part. Notes parts use `{ kind: 'notesPart'; noteKind }` (one store per part).
 */
export type TreeStoryRef =
  | { readonly kind: 'body'; readonly partName: string }
  | { readonly kind: 'headerFooter'; readonly partName: string; readonly rId: string }
  | {
      readonly kind: 'notesPart';
      readonly partName: string;
      readonly noteKind: 'footnote' | 'endnote';
    };

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
  /**
   * Story that published this change. Absent on body-only store publishes that predate
   * package-aware targeting; `TreePackageStore` always sets it.
   */
  readonly story?: TreeStoryRef;
  /**
   * Committed collapsed caret for this transaction, when one exists.
   * Matches history `selectionAfter` when that mark is collapsed; absent for explicit
   * null, non-collapsed explicit selection, or when no caret was committed.
   */
  readonly caret?: SelectionMark;
}

export type TransactResult =
  | { readonly ok: true; readonly change: TreeModelChange | null }
  | { readonly ok: false; readonly reason: TreeOpRejection; readonly detail?: string };

export interface TransactionContext {
  /** Stage one op against the STORY part. Returns false once the transaction has failed. */
  apply(op: TreeDocOp): boolean;
  /**
   * Stage one op against a named part.
   *
   * A comment body lives in `comments.xml` and is edited by the same ops that edit the story,
   * so this is `apply` with the target named rather than a second vocabulary.
   */
  applyTo(partName: string, op: TreeDocOp): boolean;
  /**
   * Stage a whole-package edit: a new part, a relationship, a content-type override.
   *
   * The edit is a pure function of the working package, so a rejected transaction discards it
   * with everything else. Returning the SAME package is a no-op, not a failure — a primitive
   * that finds nothing to do says so that way.
   */
  applyPackage(edit: (pkg: OoxmlPackage) => OoxmlPackage): boolean;
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
  /**
   * Floor on the published impact. Header/footer story edits use `global` so every page
   * sharing the part invalidates rather than keeping stale furniture.
   */
  readonly minimumImpact?: ImpactClass;
  /** Story identity stamped onto the published ModelChange (package-aware targeting). */
  readonly story?: TreeStoryRef;
}

interface HistoryEntry {
  /**
   * The whole package as it was, not just the story part.
   *
   * Affordable for the same reason a part snapshot was: parts are immutable and deep-frozen, so
   * a package snapshot is a Map of references and every part the transaction did not touch is
   * object-identical to the one before it. Undo stays a pointer swap, and it now reverses every
   * part one intent wrote rather than only the story.
   */
  readonly pkg: OoxmlPackage;
  readonly revision: number;
  readonly selectionBefore: SelectionMark | null;
  readonly selectionAfter: SelectionMark | null;
}

const IMPACT_RANK: Record<ImpactClass, number> = {
  'text-local': 0,
  'paragraph-local': 1,
  'flow-structural': 2,
  global: 3,
};

export interface TreeDocumentStoreOptions {
  /** Bound on retained history entries. Oldest entries drop first. */
  readonly historyLimit?: number;
}

/** A package holding exactly one part, for callers that never open a real one. */
function singlePartPackage(part: OoxmlPart): OoxmlPackage {
  return Object.freeze({
    parts: new Map([[part.name, part]]),
    partBytes: new Map(),
    relationships: new Map(),
    externalTargets: [],
    contentTypes: {
      defaults: new Map(),
      overrides: new Map([[part.name.toLowerCase(), part.contentType]]),
    },
    mainDocumentPart: part.name,
  }) as OoxmlPackage;
}

/**
 * Opaque document+history checkpoint for package-coordinator rollback.
 * Used when a story mutation may promote to a package undo unit (note-ref cascade).
 */
export interface TreeDocumentCheckpoint {
  /**
   * The whole package, not one part. The store owns the package so a transaction spanning
   * several parts is one publication — a checkpoint of only the story part could not roll
   * back the comment or numbering part the same transaction wrote.
   */
  readonly pkg: OoxmlPackage;
  readonly revision: number;
  readonly undoStack: readonly HistoryEntry[];
  readonly redoStack: readonly HistoryEntry[];
  readonly composition: {
    readonly entry: HistoryEntry;
    readonly committed: boolean;
  } | null;
}

export class TreeDocumentStore {
  private current: OoxmlPackage;
  /** The part `apply` targets and `part` returns: the story this store is editing. */
  private readonly storyPartName: string;
  private rev = 0;
  private commitCounter = 0;
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];
  private readonly subscribers = new Set<(change: TreeModelChange) => void>();
  private readonly historyLimit: number;
  /** Package-aware story tag applied to publishes (including undo/redo). */
  private storyRef: TreeStoryRef | null = null;

  /** Open composition, if any. While set, transactions extend one entry (task 5.5). */
  private composition: {
    readonly entry: HistoryEntry;
    /** Whether any transaction inside the composition actually committed. */
    committed: boolean;
  } | null = null;

  /**
   * Open a store over a package, editing the named story part.
   *
   * A bare part is accepted and wrapped in a single-part package, so callers that never open a
   * real package — tests, headless tooling — are unaffected by the widening.
   */
  constructor(
    source: OoxmlPart | OoxmlPackage,
    storyPartNameOrOptions?: string | TreeDocumentStoreOptions,
    maybeOptions: TreeDocumentStoreOptions = {}
  ) {
    const isPart = 'root' in source;
    // The story name was added in front of the options, so the two-argument form that predates
    // it still means what it always did. Overloading on the argument's type keeps every
    // existing call site — `new TreeDocumentStore(part, { historyLimit })` — working.
    const storyPartName =
      typeof storyPartNameOrOptions === 'string' ? storyPartNameOrOptions : undefined;
    const options =
      typeof storyPartNameOrOptions === 'object' && storyPartNameOrOptions !== null
        ? storyPartNameOrOptions
        : maybeOptions;
    this.current = isPart ? singlePartPackage(source) : source;
    this.storyPartName = storyPartName ?? (isPart ? source.name : source.mainDocumentPart);
    this.historyLimit = options.historyLimit ?? 200;
  }

  /**
   * Stamp story identity onto subsequent publishes for this store (including undo/redo).
   * Used by the package coordinator so history navigation keeps the same scope tag.
   */
  setStoryRef(story: TreeStoryRef | null): void {
    this.storyRef = story;
  }

  /** The story part being edited. Unchanged for every caller that predates the widening. */
  get part(): OoxmlPart {
    const story = this.current.parts.get(this.storyPartName);
    if (!story) throw new Error(`story part missing: ${this.storyPartName}`);
    return story;
  }

  /** Every part, including the ones a multi-part transaction wrote. */
  get package(): OoxmlPackage {
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

  /**
   * Replace the package OUTSIDE the transaction and history lanes.
   *
   * For package writes that are not a user intent and publish no revision: grafting
   * `numbering.xml` into a document that never had one, which the caller performs as a
   * precondition of the list op that follows. Those edits were previously kept in a package
   * variable beside the store, which meant two owners of one value and, predictably, two
   * values — a graft written to one and a save read from the other.
   *
   * Deliberately narrow and deliberately awkward to reach for: anything a user did belongs in
   * `transact`, where it gets a revision, an undo entry and the invariant checks.
   */
  graftPackage(edit: (pkg: OoxmlPackage) => OoxmlPackage): void {
    this.current = edit(this.current);
  }

  /**
   * Replace the current part without recording history, but advance the revision so
   * revision-keyed projections cannot survive a package snapshot install.
   */
  replacePart(part: OoxmlPart): void {
    const existing = this.current.parts.get(part.name);
    if (part === existing) return;
    this.current = withPart(this.current, part);
    this.rev += 1;
  }

  /**
   * Snapshot part, revision, and undo/redo stacks so the package coordinator can roll
   * back a story transaction that fails after commit (e.g. note-reference cascade) or
   * discard a local history entry when promoting to a package undo unit.
   */
  checkpoint(): TreeDocumentCheckpoint {
    return {
      pkg: this.current,
      revision: this.rev,
      undoStack: this.undoStack.slice(),
      redoStack: this.redoStack.slice(),
      composition: this.composition
        ? { entry: { ...this.composition.entry }, committed: this.composition.committed }
        : null,
    };
  }

  /** Full restore — part, revision, history stacks, and composition. */
  restoreCheckpoint(checkpoint: TreeDocumentCheckpoint): void {
    this.current = checkpoint.pkg;
    this.rev = checkpoint.revision;
    this.undoStack.length = 0;
    this.undoStack.push(...checkpoint.undoStack);
    this.redoStack.length = 0;
    this.redoStack.push(...checkpoint.redoStack);
    this.composition = checkpoint.composition
      ? { entry: { ...checkpoint.composition.entry }, committed: checkpoint.composition.committed }
      : null;
  }

  /**
   * Restore undo/redo stacks only, keeping the current part and revision.
   * Used when a story mutation is promoted to a package history pointer so the local
   * orphan entry does not steal a later undo.
   */
  restoreHistoryStacks(checkpoint: TreeDocumentCheckpoint): void {
    this.undoStack.length = 0;
    this.undoStack.push(...checkpoint.undoStack);
    this.redoStack.length = 0;
    this.redoStack.push(...checkpoint.redoStack);
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
    /** Parts this transaction rewrote, so the commit validates those and no others. */
    const touched = new Set<string>();
    const dirty = new Set<string>();
    const created = new Set<string>();
    const deleted = new Set<string>();
    const dependencyKeys = new Set<string>();
    const splitJoin: TreeModelChange['splitJoin'][number][] = [];
    let impact: ImpactClass = options.minimumImpact ?? 'text-local';
    let selectionBefore: SelectionMark | null = null;
    let selectionAfterExplicit = false;
    let explicitSelectionAfter: SelectionMark | null = null;
    let opCaret: SelectionMark | null = null;

    const applyToPart = (partName: string, op: TreeDocOp): boolean => {
      if (failure) return false;
      const target = working.parts.get(partName);
      if (!target) {
        failure = { reason: 'unknown-part', detail: partName };
        return false;
      }
      // Forms protection lives in `settings.xml`, one part up from the op, so it is resolved
      // HERE rather than in the per-part applier: a part alone cannot see whether the document
      // it belongs to is protected.
      const protection = formsProtectionRefusal(target, settingsPartOf(working), op);
      if (protection) {
        failure = { reason: protection };
        return false;
      }
      // Validation of the whole part is DEFERRED to the commit below: per-op it made a
      // many-op transaction quadratic in document size, and nothing between here and the
      // commit can observe the intermediate parts. Op-level input validation still runs
      // inside `applyTreeOp` before any tree work.
      const result = applyTreeOp(target, op, { deferValidation: true });
      if (!result.ok) {
        failure = { reason: result.reason, ...(result.detail ? { detail: result.detail } : {}) };
        return false;
      }
      working = withPart(working, result.part);
      const identityNoOp =
        result.part === target &&
        result.effect.dirty.length === 0 &&
        result.effect.created.length === 0 &&
        result.effect.deleted.length === 0 &&
        result.effect.split === undefined &&
        (result.effect.splits === undefined || result.effect.splits.length === 0) &&
        result.effect.join === undefined &&
        result.effect.caret === undefined;
      if (identityNoOp) return true;
      touched.add(partName);
      applied += 1;
      for (const id of result.effect.dirty) dirty.add(id);
      for (const id of result.effect.created) created.add(id);
      for (const id of result.effect.deleted) deleted.add(id);
      for (const key of result.effect.dependencyKeys) dependencyKeys.add(key);
      if (result.effect.split) splitJoin.push({ split: result.effect.split });
      for (const split of result.effect.splits ?? []) splitJoin.push({ split });
      if (result.effect.join) splitJoin.push({ join: result.effect.join });
      if (IMPACT_RANK[result.effect.impact] > IMPACT_RANK[impact]) impact = result.effect.impact;
      if (result.effect.caret) {
        opCaret = { paragraphId: result.effect.caret.paragraphId, start: 0, end: 0 };
      }
      return true;
    };

    build({
      apply: (op) => applyToPart(this.storyPartName, op),
      applyTo: (partName, op) => applyToPart(partName, op),
      applyPackage: (edit) => {
        if (failure) return false;
        const next = edit(working);
        if (next === working) return true;
        for (const [name, part] of next.parts) {
          if (working.parts.get(name) !== part) touched.add(name);
        }
        working = next;
        applied += 1;
        // A new or removed part re-flows nothing by itself, but the caller pairs it with the
        // story edit that references it, and that edit reports its own impact.
        if (IMPACT_RANK['flow-structural'] > IMPACT_RANK[impact]) impact = 'flow-structural';
        return true;
      },
      selectionBefore: (selection) => {
        selectionBefore = selection;
      },
      selectionAfter: (selection) => {
        selectionAfterExplicit = true;
        explicitSelectionAfter = selection;
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

    const selectionAfter = selectionAfterExplicit ? explicitSelectionAfter : opCaret;

    const committedCaret = selectionAfterExplicit
      ? collapsedSelection(explicitSelectionAfter)
      : (opCaret ?? undefined);

    // The commit boundary is where fail-closed lives now: the SAME invariant rules the
    // primitives used to run each, applied once to the final tree. Validated as a DELTA
    // against the tree this transaction started from — that tree was validated when it was
    // published, and structural sharing means everything the ops did not touch is object-
    // identical to it, so only the changed subtrees need walking. An invalid result
    // abandons the whole transaction — no revision, no history entry, no notification —
    // exactly as a per-op rejection would have, so nothing invalid is ever published.
    for (const name of touched) {
      const previous = before.parts.get(name);
      const next = working.parts.get(name);
      if (next === undefined) continue;
      // A part this transaction CREATED has no previous tree to diff against, so it is
      // validated whole; an edited part is validated as a delta, because everything the ops
      // did not touch is object-identical to a tree that was already validated.
      const validation = previous
        ? validateOoxmlPartDelta(previous, next)
        : validateOoxmlPartDelta(next, next);
      if (!validation.ok) {
        return {
          ok: false,
          reason: 'tree-invariant',
          detail: JSON.stringify(validation.issues),
        };
      }
    }

    // Package invariants are checked HERE and nowhere else, for the same reason part
    // validation moved to the commit: a transaction may pass through a package that has a
    // relationship to a part it has not created yet, as long as nothing can observe it. What
    // must never be published is a package Word refuses to open.
    const packageValidation = validatePackageInvariants(working);
    if (!packageValidation.ok) {
      return {
        ok: false,
        reason: 'package-invariant',
        detail: JSON.stringify(packageValidation.issues),
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
          pkg: before,
          revision: beforeRevision,
          selectionBefore,
          selectionAfter,
        });
        this.redoStack.length = 0;
      }
    }

    this.current = working;
    this.rev += 1;
    if (options.story) this.storyRef = options.story;
    if (options.minimumImpact && IMPACT_RANK[options.minimumImpact] > IMPACT_RANK[impact]) {
      impact = options.minimumImpact;
    }
    return {
      ok: true,
      change: this.publish(
        origin,
        beforeRevision,
        {
          dirty,
          created,
          deleted,
          dependencyKeys,
          splitJoin,
          impact,
          caret: committedCaret,
        },
        options.story ?? this.storyRef ?? undefined
      ),
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
        pkg: this.current,
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
      pkg: this.current,
      revision: this.rev,
      selectionBefore: entry.selectionBefore,
      selectionAfter: entry.selectionAfter,
    });
    this.current = entry.pkg;
    this.rev += 1;
    return this.publish(ORIGIN_IDS.mutationUndo, beforeRevision, null, this.storyRef ?? undefined);
  }

  redo(): TreeModelChange | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    const beforeRevision = this.rev;
    this.undoStack.push({
      pkg: this.current,
      revision: this.rev,
      selectionBefore: entry.selectionBefore,
      selectionAfter: entry.selectionAfter,
    });
    this.current = entry.pkg;
    this.rev += 1;
    return this.publish(ORIGIN_IDS.mutationRedo, beforeRevision, null, this.storyRef ?? undefined);
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
      caret?: SelectionMark;
    } | null,
    story?: TreeStoryRef
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
      // one op's effect — treat them as structural and let layout re-derive. Header/footer
      // story undos stay `global` so shared furniture cannot go stale.
      impact: effects
        ? effects.impact
        : story?.kind === 'headerFooter'
          ? 'global'
          : 'flow-structural',
      ...(effects?.caret ? { caret: effects.caret } : {}),
      ...(story ? { story } : {}),
    };
    for (const listener of this.subscribers) listener(change);
    return change;
  }
}
