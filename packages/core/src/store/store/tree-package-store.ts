// Package-aware mutation coordinator for editable story parts (body + headers/footers +
// notes parts).
//
// `TreeDocumentStore` remains the only semantic mutation path for story content
// (`ctx.apply(op)`). This coordinator keeps one store per editable part so body,
// header/footer, and notes-part revisions and indexes stay independent, while
// `currentPackage()` / save always merge every open store back into the canonical OOXML
// package.
//
// Drawing media/package intents (task 12) wire through `tree-package-images.ts`.
//
// Story targeting: body / headerFooter mirror `EditorScope`; notes use internal
// `{ kind: 'notesPart'; noteKind }` (one store per footnotes/endnotes part, not per note).
// Editing focus still uses `EditorScope { kind: 'note'; id: 'footnote:N' }`. Furniture and
// note lifecycle ops commit through `applyLifecycleOp` with atomic package undo/redo.

import type { OoxmlPart } from '../package/ooxml-tree.ts';
import { normalizeParagraphIdentity } from '../package/para-id.ts';
import { openStoryPartsOf, openStoryTokenOf } from './open-story-parts.ts';
import { settingsPartOf } from '../package/note-properties.ts';
import { ensureListParagraphContextualSpacing } from '../package/list-style-part.ts';
import { withPart, type OoxmlExternalTarget, type OoxmlPackage } from '../package/ooxml-package.ts';
import { resolveRelationship } from '../package/relationships.ts';
import {
  applyHeaderFooterLifecycleOp,
  isHeaderFooterLifecycleOp,
  type HeaderFooterLifecycleOp,
} from '../package/hf-lifecycle.ts';
import {
  applyNoteLifecycleOp,
  cascadeDeletedNoteReferences,
  isNoteLifecycleOp,
  type NoteLifecycleOp,
} from '../package/note-lifecycle.ts';
import { resolveNotesPart } from '../package/note-references.ts';
import type { NoteKind } from '../package/note-nodes.ts';
import {
  mergePersistentPackageShell,
  pruneUnreachableHyperlinkShell,
  rememberShellHyperlinks,
  retainShellHyperlinks,
} from '../package/package-shell-persistence.ts';
import { ORIGIN_IDS } from '../registry/frozen-ids.ts';
import type { ImpactClass, TreeDocOp, TreeOpRejection } from './tree-ops.ts';
import type { RevisionAttributionInput } from './tree-op-types.ts';
import {
  deleteBlockMayStrandNote,
  deleteMayEmptyCommentRange,
  deleteMayStrandNote,
  FOOTER_REL_TYPE,
  HEADER_REL_TYPE,
  locateHeaderFooterPart,
} from './tree-package-gates.ts';
import { cascadeEmptiedComments } from '../package/comment-lifecycle.ts';
import {
  TreeDocumentStore,
  type SelectionMark,
  type TransactOptions,
  type TreeDocumentCheckpoint,
  type TreeModelChange,
  type TreeStoryRef,
  type TransactionContext,
} from './tree-store.ts';
import {
  applyImagePropertiesIntent,
  deleteImage as deleteImageIntent,
  deleteImageTracked as deleteImageTrackedIntent,
  embedExternalImage as embedExternalImageIntent,
  insertImage as insertImageIntent,
  replaceImage as replaceImageIntent,
  setDrawingMetadataWithHyperlink as setDrawingMetadataWithHyperlinkIntent,
  type ApplyImagePropertiesInput,
  type ExternalImageFetchPort,
  type ImageIntentResult,
  type InsertImageInput,
} from './tree-package-images.ts';
import {
  applyFragmentPaste as applyFragmentPasteIntent,
  type FragmentPasteInput,
  type FragmentPasteResult,
} from './tree-package-fragment.ts';
import type { ImageDecodePort, SupportedImageMime } from '../package/image-resources.ts';
import {
  packageTransactionPublished,
  runObservedStoreTransaction,
} from '../package/canonical-primitive-capture.ts';
import {
  publishRemoteCanonicalPackage,
  type RemotePackageAttribution,
} from './tree-package-remote.ts';

type NoteCascadeFn = (before: OoxmlPackage, after: OoxmlPackage) => OoxmlPackage | null;

/** Revision ops whose result can remove a note reference along with the content it sits in. */
const RESOLUTION_OPS: ReadonlySet<string> = new Set([
  'acceptRevision',
  'rejectRevision',
  'acceptAllRevisions',
  'rejectAllRevisions',
]);

/**
 * Ops that remove whole blocks without naming one, so no cheap subtree probe exists.
 *
 * Row and column deletion take a table id and carry away every cell paragraph under it —
 * comment range markers included. Gated by kind rather than by content: the reap they open is
 * a before/after diff and finds nothing when the table held no comment.
 */
const CONTENT_REMOVING_OPS: ReadonlySet<string> = new Set([
  'deleteTableRow',
  'deleteTableColumn',
  'removeContentControl',
  'removeRepeatingSectionItem',
]);

/**
 * Editable story target.
 *
 * Body and headerFooter mirror `EditorScope`. Notes use one lazy store per notes part
 * (`notesPart`) — not one store per note — resolved through safe document relationships.
 */
export type StoryScope =
  | { readonly kind: 'body' }
  | { readonly kind: 'headerFooter'; readonly rId: string }
  | { readonly kind: 'notesPart'; readonly noteKind: NoteKind };

/**
 * Why a story scope could not be resolved to a part.
 *
 * Several of these are FILE-hostile shapes rather than caller mistakes:
 * `external-relationship` and `bad-relationship-target` are how a crafted document tries to
 * point a story at something outside the package, and both are refused rather than followed.
 */
export type StoryTargetRejection =
  | 'unknown-scope'
  | 'dangling-relationship'
  | 'wrong-relationship-type'
  | 'external-relationship'
  | 'bad-relationship-target'
  | 'missing-part'
  | 'not-a-story-part'
  | 'too-many-story-stores';

/** A story scope resolved to a part, or the typed reason it could not be. */
export type StoryResolveResult =
  | {
      readonly ok: true;
      readonly story: TreeStoryRef;
      readonly store: TreeDocumentStore;
    }
  | { readonly ok: false; readonly reason: StoryTargetRejection; readonly detail?: string };

/** Whether a package-level transaction committed, or why it was refused. */
export type PackageTransactResult =
  | { readonly ok: true; readonly change: TreeModelChange | null }
  | {
      readonly ok: false;
      readonly reason: StoryTargetRejection | TreeOpRejection;
      readonly detail?: string;
    };

/** Cap on simultaneously opened editable story stores (body + HF parts). Fail closed. */
export const DEFAULT_MAX_EDITABLE_STORY_PARTS = 64;

/** How a package store is constructed: limits, history depth, and review contributions. */
export interface TreePackageStoreOptions {
  readonly historyLimit?: number;
  /** Bound on opened story stores; defaults to {@link DEFAULT_MAX_EDITABLE_STORY_PARTS}. */
  readonly maxEditableStoryParts?: number;
  /**
   * Test seam for note-reference cascade after `deleteText` / `deleteBlock`. Production uses
   * {@link cascadeDeletedNoteReferences}.
   */
  readonly cascadeDeletedNoteReferences?: NoteCascadeFn;
}

interface StoryHistoryPointer {
  readonly kind: 'story';
  readonly partName: string;
  readonly story: TreeStoryRef;
}

interface PackageHistoryPointer {
  readonly kind: 'package';
  readonly before: OoxmlPackage;
  readonly after: OoxmlPackage;
}

type HistoryPointer = StoryHistoryPointer | PackageHistoryPointer;

/**
 * Package-level mutation authority: routes `TreeDocOp`s to the store for a story part,
 * publishes one ModelChange / undo unit per transaction, and keeps `currentPackage()`
 * coherent for save/reopen.
 */
export class TreePackageStore {
  private pkg: OoxmlPackage;
  private packageRev = 0;
  private readonly body: TreeDocumentStore;
  /** Opened non-body story stores, keyed by canonical part name. */
  private readonly stories = new Map<string, TreeDocumentStore>();
  /** rId → part name for opened HF stores (and resolved targets). */
  private readonly rIdToPartName = new Map<string, string>();
  private readonly undoOrder: HistoryPointer[] = [];
  private readonly redoOrder: HistoryPointer[] = [];
  private readonly subscribers = new Set<(change: TreeModelChange) => void>();
  private readonly historyLimit: number;
  private readonly maxEditableStoryParts: number;
  private readonly cascadeNoteReferences: NoteCascadeFn;
  private lastChange: TreeModelChange | null = null;
  /**
   * Hyperlink externals minted via {@link replacePackageShell} (outside package history).
   * Re-applied on snapshot install so lifecycle undo cannot drop shell `r:id`s; not used for
   * lifecycle-cloned owned relationships, which history snapshots already restore.
   */
  private shellHyperlinks: readonly OoxmlExternalTarget[] = Object.freeze([]);
  /**
   * Open IME composition session. Captures the package/story checkpoint at begin so a
   * mid-composition note-ref cascade can promote the whole composition to one package
   * undo unit (or restore on cancel) instead of a story-only pointer that orphans note bodies.
   */
  private compositionSession: {
    readonly partName: string;
    readonly beforePackage: OoxmlPackage;
    readonly storyCheckpoint: TreeDocumentCheckpoint;
    packageWideEffects: boolean;
  } | null = null;
  private commitCounter = 0;
  /**
   * Memo for {@link currentPackage}, keyed on that method's COMPLETE read set by object identity:
   * the shell, the body part, and each open story's part in map order. Identity is the only sound
   * key — `packageRevision` is excluded, because shell writes (`replacePackageShell`, story-store
   * grafts, lazy opens) move `this.pkg` or a `store.part` without bumping it. Parts are frozen, so
   * a matching tuple proves the snapshot cannot differ; nothing invalidates explicitly.
   */
  private currentPackageMemo: {
    readonly pkg: OoxmlPackage;
    readonly bodyPart: OoxmlPart;
    readonly storyParts: readonly OoxmlPart[];
    readonly result: OoxmlPackage;
  } | null = null;

  constructor(pkg: OoxmlPackage, main: OoxmlPart, options: TreePackageStoreOptions = {}) {
    this.pkg = withPart(pkg, main);
    this.historyLimit = options.historyLimit ?? 200;
    this.maxEditableStoryParts = options.maxEditableStoryParts ?? DEFAULT_MAX_EDITABLE_STORY_PARTS;
    this.cascadeNoteReferences =
      options.cascadeDeletedNoteReferences ?? cascadeDeletedNoteReferences;
    // The WHOLE package, not the part alone. A transaction writing several parts as one unit —
    // a comment's story markers plus its body in `comments.xml` plus the relationship and
    // content-type override — needs the package as its working set; a store handed one part
    // rebuilds a stub package the invariant check refuses.
    this.body = new TreeDocumentStore(this.pkg, main.name, {
      historyLimit: this.historyLimit,
      // The SAME live getter the story stores get. A store keeps its own working copy, so a
      // `settings.xml` replaced through the coordinator left the body reading stale protection —
      // making the body the one story a protected document still let you edit. Protection that
      // holds in a header but not the body is worse than none: it looks enforced.
      settingsPart: () => settingsPartOf(this.pkg),
    });
    this.body.setStoryRef({ kind: 'body', partName: main.name });
    // Body is always open; HF stores are opened lazily and count against the cap.
  }

  get packageRevision(): number {
    return this.packageRev;
  }

  get canUndo(): boolean {
    return this.undoOrder.length > 0;
  }

  get canRedo(): boolean {
    return this.redoOrder.length > 0;
  }

  get lastModelChange(): TreeModelChange | null {
    return this.lastChange;
  }

  /** Body store — independent revision/index from every HF store. */
  bodyStore(): TreeDocumentStore {
    return this.body;
  }

  /**
   * The current package with every opened story store's part merged in.
   * Pure snapshot of authority; callers must not mutate.
   *
   * Memoized on input identity: repeated calls with unchanged authority return the
   * SAME frozen instance instead of minting a copy per call. Layout asks for this
   * once per paragraph when keying drawing tokens, so the un-memoized `withPart`
   * map copies dominated large-document keystroke flushes.
   *
   * Stores whose parts are absent from the package shell (deleted furniture/notes)
   * stay parked for undo/redo identity but are not re-injected into the snapshot.
   */
  currentPackage(): OoxmlPackage {
    const memo = this.currentPackageMemo;
    if (memo && memo.pkg === this.pkg && memo.bodyPart === this.body.part) {
      let index = 0;
      let hit = true;
      for (const store of this.stories.values()) {
        if (memo.storyParts[index] !== store.part) {
          hit = false;
          break;
        }
        index += 1;
      }
      if (hit && index === memo.storyParts.length) return memo.result;
    }
    let next = withPart(this.pkg, this.body.part);
    const storyParts: OoxmlPart[] = [];
    for (const store of this.stories.values()) {
      storyParts.push(store.part);
      if (!this.pkg.parts.has(store.part.name)) continue;
      next = withPart(next, store.part);
    }
    this.currentPackageMemo = {
      pkg: this.pkg,
      bodyPart: this.body.part,
      storyParts,
      result: next,
    };
    return next;
  }

  subscribe(listener: (change: TreeModelChange) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  /**
   * Resolve a story scope to its store. Fail closed for dangling / wrong-typed / missing
   * targets — layout may fail open on the same rId, but mutation must not invent a part.
   */
  resolveStory(scope: StoryScope): StoryResolveResult {
    if (scope.kind === 'body') {
      const story: TreeStoryRef = { kind: 'body', partName: this.body.part.name };
      return { ok: true, story, store: this.body };
    }
    if (scope.kind === 'notesPart') {
      if (scope.noteKind !== 'footnote' && scope.noteKind !== 'endnote') {
        return { ok: false, reason: 'unknown-scope', detail: String(scope.noteKind) };
      }
      return this.openNotesPartStore(scope.noteKind);
    }
    if (scope.kind !== 'headerFooter' || typeof scope.rId !== 'string' || scope.rId.length === 0) {
      return {
        ok: false,
        reason: 'unknown-scope',
        detail: String((scope as { kind?: string }).kind),
      };
    }
    return this.openHeaderFooterStore(scope.rId);
  }

  /** Current part for a scope, or null when the target is refused. */
  partFor(scope: StoryScope): OoxmlPart | null {
    const resolved = this.resolveStory(scope);
    return resolved.ok ? resolved.store.part : null;
  }

  /** Per-story revision, or null when the target is refused. */
  revisionFor(scope: StoryScope): number | null {
    const resolved = this.resolveStory(scope);
    return resolved.ok ? resolved.store.revision : null;
  }

  /**
   * Commit ops against one story as ONE transaction / undo unit / ModelChange.
   * Header/footer and notes-part commits publish `impact: 'global'`.
   * Deleting a `noteReference` via `deleteText` or a block subtree via `deleteBlock`
   * cascades the note body in the same package undo unit.
   */
  transact(
    scope: StoryScope,
    build: (ctx: TransactionContext) => void,
    options: Omit<TransactOptions, 'story' | 'minimumImpact'> = {}
  ): PackageTransactResult {
    return runObservedStoreTransaction(
      this,
      () => this.commitStoryTransaction(scope, build, options),
      packageTransactionPublished
    );
  }

  private commitStoryTransaction(
    scope: StoryScope,
    build: (ctx: TransactionContext) => void,
    options: Omit<TransactOptions, 'story' | 'minimumImpact'> = {}
  ): PackageTransactResult {
    const resolved = this.resolveStory(scope);
    if (!resolved.ok) {
      return {
        ok: false,
        reason: resolved.reason,
        ...(resolved.detail ? { detail: resolved.detail } : {}),
      };
    }

    const { store, story } = resolved;
    const beforePackage = this.currentPackage();
    const beforeDepth = store.historyDepth;
    const compositionWasOpen = store.compositionActive;
    const checkpoint = store.checkpoint();
    // `deleteText` / `deleteBlock` can remove noteReference atoms; skip package-wide
    // cascade for every other op. Gates stay local to the op target (paragraph range or
    // block subtree) so ordinary structural deletion never scans the whole package.
    let mayDeleteNoteAtoms = false;
    const deleteTargets = new Set<string>();
    // Same shape, different question: whether the transaction can leave a comment covering no
    // characters. Word deletes a comment whose words are deleted, and the reap that does it is
    // a before/after diff, so it needs the same "was it even possible" gate.
    let mayEmptyComments = false;
    const commentTargets = new Set<string>();
    let turnsListOn = false;
    let listStyleId: string | undefined;
    const result = store.transact(
      (ctx) => {
        build({
          // The whole context is forwarded, not a hand-picked three: `applyTo` and
          // `applyPackage` are how a transaction writes the comment or numbering part in the
          // same unit as the story, and rebuilding the object dropped them.
          ...ctx,
          apply: (op) => {
            if (op.op === 'setListNumbering' && op.numId !== null) turnsListOn = true;
            if (op.op === 'setParagraphProperties') {
              listStyleId ??= op.properties.find((property) => property.localName === 'pStyle')
                ?.attributes?.val;
            }
            if (!mayDeleteNoteAtoms) {
              if (
                op.op === 'deleteText' &&
                deleteMayStrandNote(this.pkg, store.part, op, deleteTargets)
              ) {
                mayDeleteNoteAtoms = true;
              } else if (
                op.op === 'deleteBlock' &&
                deleteBlockMayStrandNote(this.pkg, store.part, op, deleteTargets)
              ) {
                mayDeleteNoteAtoms = true;
              } else if (RESOLUTION_OPS.has(op.op)) {
                // Resolving a revision removes the content it covers, and a note reference is one
                // model unit, so a struck-through selection carries it away. Not narrowable to a
                // paragraph range: a revision's sites are wherever the file put them. The cascade
                // is a diff, so it is free.
                mayDeleteNoteAtoms = true;
              }
            }
            if (!mayEmptyComments) {
              if (op.op === 'deleteText' || op.op === 'deleteBlock') {
                mayEmptyComments = deleteMayEmptyCommentRange(
                  this.pkg,
                  store.part,
                  op,
                  commentTargets
                );
              } else if (RESOLUTION_OPS.has(op.op) || CONTENT_REMOVING_OPS.has(op.op)) {
                // Rejecting an insertion removes the words it inserted, which a comment can be
                // anchored over. A row or column deletion removes whole cell PARAGRAPHS, markers
                // and all, and names a table rather than a paragraph, so there is no cheap
                // subtree to probe. Opens the gate outright; the reap is a diff, so it is free.
                mayEmptyComments = true;
              }
            }
            return ctx.apply(op);
          },
          selectionBefore: (selection) => ctx.selectionBefore(selection),
          selectionAfter: (selection) => ctx.selectionAfter(selection),
        });
      },
      {
        ...options,
        story,
        ...(story.kind === 'headerFooter' || story.kind === 'notesPart'
          ? { minimumImpact: 'global' as const }
          : {}),
      }
    );

    if (!result.ok) {
      return {
        ok: false,
        reason: result.reason,
        ...(result.detail ? { detail: result.detail } : {}),
      };
    }

    this.syncPackageFromStore(store);
    if (turnsListOn && listStyleId) {
      const repaired = ensureListParagraphContextualSpacing(this.pkg, listStyleId);
      if (repaired) this.replacePackageShell(repaired);
    }

    // Cascade note-body deletion when a reference atom was removed by text or block delete.
    // Body mutation + cascade share one package history unit; local story history is
    // discarded on promotion so a later undo cannot replay the orphan story entry.
    let cascaded = false;
    if (result.change && mayDeleteNoteAtoms) {
      const afterStory = this.currentPackage();
      const cascadedPkg = this.cascadeNoteReferences(beforePackage, afterStory);
      if (cascadedPkg === null) {
        // Roll back story mutation AND history stacks (including redo cleared by transact).
        store.restoreCheckpoint(checkpoint);
        this.installPackageSnapshotInternal(beforePackage);
        return { ok: false, reason: 'invalidArgs', detail: 'note-cascade-failed' };
      }
      if (cascadedPkg !== afterStory) {
        this.installPackageSnapshotInternal(cascadedPkg);
        if (!compositionWasOpen) {
          store.restoreHistoryStacks(checkpoint);
        } else if (this.compositionSession) {
          // Defer package history until endComposition — mark so the whole IME
          // composition promotes to one package pointer (citation + note body).
          this.compositionSession.packageWideEffects = true;
        }
        cascaded = true;
      }
    }

    // Then reap the comments the same edit emptied. AFTER the note cascade and against its
    // output, so a comment anchored inside a note body that has just been deleted is measured
    // against the package the user will actually get. Both promote through the same pointer:
    // one undo puts the words, the note and the remark back together.
    if (result.change && mayEmptyComments) {
      const afterNotes = this.currentPackage();
      const reaped = cascadeEmptiedComments(beforePackage, afterNotes, {
        storyPartName: story.partName,
      });
      if (reaped === null) {
        store.restoreCheckpoint(checkpoint);
        this.installPackageSnapshotInternal(beforePackage);
        return { ok: false, reason: 'invalidArgs', detail: 'comment-cascade-failed' };
      }
      if (reaped !== afterNotes) {
        this.installPackageSnapshotInternal(reaped);
        if (!compositionWasOpen) {
          store.restoreHistoryStacks(checkpoint);
        } else if (this.compositionSession) {
          this.compositionSession.packageWideEffects = true;
        }
        cascaded = true;
      }
    }

    if (result.change) {
      this.packageRev += 1;
      if (!compositionWasOpen && (store.historyDepth > beforeDepth || cascaded)) {
        if (cascaded) {
          // Promote to package undo so reference+body restore together.
          this.pushUndoPointer({
            kind: 'package',
            before: beforePackage,
            after: this.currentPackage(),
          });
        } else {
          this.pushUndoPointer({ kind: 'story', partName: story.partName, story });
        }
      }
      const change = cascaded
        ? this.publishSynthetic(result.change.origin, 'global', story, result.change.created)
        : result.change;
      if (!cascaded) this.publish(change);
      return { ok: true, change };
    }
    return { ok: true, change: result.change };
  }

  /** Whether a package-wide IME composition session is open on any story. */
  compositionSessionOpen(): boolean {
    return this.compositionSession !== null;
  }

  beginComposition(scope: StoryScope, selectionBefore: SelectionMark | null = null): boolean {
    let resolved = this.resolveStory(scope);
    if (!resolved.ok) return false;
    // One package can have only one open IME unit. Switching stories commits the previous
    // unit before opening the next; otherwise the old store remains permanently composed
    // and subsequent edits never enter unified history.
    if (this.compositionSession && this.compositionSession.partName !== resolved.story.partName) {
      this.endComposition();
      resolved = this.resolveStory(scope);
      if (!resolved.ok) return false;
    }
    // Capture package + story stacks before the composition opens so a later cascade can
    // promote (or cancel-restore) against the pre-composition baseline.
    if (!this.compositionSession) {
      this.compositionSession = {
        partName: resolved.story.partName,
        beforePackage: this.currentPackage(),
        storyCheckpoint: resolved.store.checkpoint(),
        packageWideEffects: false,
      };
    }
    resolved.store.beginComposition(selectionBefore);
    return true;
  }

  endComposition(): void {
    const session = this.compositionSession;
    this.compositionSession = null;
    if (!session) {
      this.body.endComposition();
      return;
    }
    const store =
      session.partName === this.body.part.name ? this.body : this.stories.get(session.partName);
    if (!store) return;
    const beforeDepth = store.historyDepth;
    store.endComposition();
    if (session.packageWideEffects) {
      // Discard the local story undo entry endComposition just recorded — the package
      // pointer owns the unit so undo restores citation and note body together.
      store.restoreHistoryStacks(session.storyCheckpoint);
      this.syncPackageFromStore(store);
      this.pushUndoPointer({
        kind: 'package',
        before: session.beforePackage,
        after: this.currentPackage(),
      });
      return;
    }
    if (store.historyDepth > beforeDepth) {
      const story =
        session.partName === this.body.part.name
          ? ({ kind: 'body', partName: session.partName } as const)
          : this.storyRefForPart(session.partName);
      if (story) this.pushUndoPointer({ kind: 'story', partName: session.partName, story });
    }
    this.syncPackageFromStore(store);
  }

  cancelComposition(): void {
    const session = this.compositionSession;
    this.compositionSession = null;
    if (!session) {
      this.body.cancelComposition();
      return;
    }
    const store =
      session.partName === this.body.part.name ? this.body : this.stories.get(session.partName);
    if (session.packageWideEffects) {
      // Cascade already deleted note bodies with no history unit yet — restore the
      // pre-composition package so cancel cannot strand irreversible note loss.
      if (store) store.restoreCheckpoint(session.storyCheckpoint);
      this.installPackageSnapshotInternal(session.beforePackage);
      this.packageRev += 1;
      const story =
        session.partName === this.body.part.name
          ? ({ kind: 'body', partName: session.partName } as const)
          : this.storyRefForPart(session.partName);
      this.publishSynthetic(
        ORIGIN_IDS.mutationHuman,
        'global',
        story ?? { kind: 'body', partName: this.body.part.name },
        []
      );
      return;
    }
    store?.cancelComposition();
  }

  /**
   * Commit one furniture or note lifecycle op as a single ModelChange / undo unit that
   * restores the entire package atomically (parts, rels, content-types, settings).
   */
  applyLifecycleOp(
    op: HeaderFooterLifecycleOp | NoteLifecycleOp | TreeDocOp
  ): PackageTransactResult {
    return runObservedStoreTransaction(
      this,
      () => this.commitLifecycleOp(op),
      packageTransactionPublished
    );
  }

  private commitLifecycleOp(
    op: HeaderFooterLifecycleOp | NoteLifecycleOp | TreeDocOp
  ): PackageTransactResult {
    const before = this.currentPackage();

    if (isNoteLifecycleOp(op)) {
      const result = applyNoteLifecycleOp(before, op);
      if (!result.ok) {
        return {
          ok: false,
          reason: result.reason,
          ...(result.detail ? { detail: result.detail } : {}),
        };
      }
      // Identity/no-op success (e.g. empty convertAllNotes): no pointer, revision, or event.
      if (result.package === before) {
        return { ok: true, change: null };
      }
      this.installPackageSnapshotInternal(result.package);
      this.pushUndoPointer({ kind: 'package', before, after: result.package });
      this.packageRev += 1;
      const story: TreeStoryRef = { kind: 'body', partName: this.body.part.name };
      const change = this.publishSynthetic(
        ORIGIN_IDS.mutationHuman,
        result.impact,
        story,
        result.createdPartName ? [result.createdPartName] : []
      );
      this.evictUnreachableStories();
      return { ok: true, change };
    }

    if (!isHeaderFooterLifecycleOp(op)) {
      return { ok: false, reason: 'invalidArgs', detail: 'not-lifecycle-op' };
    }
    const result = applyHeaderFooterLifecycleOp(before, op);
    if (!result.ok) {
      return {
        ok: false,
        reason: result.reason,
        ...(result.detail ? { detail: result.detail } : {}),
      };
    }

    this.installPackageSnapshotInternal(result.package);
    this.pushUndoPointer({ kind: 'package', before, after: result.package });
    this.packageRev += 1;

    const story: TreeStoryRef = { kind: 'body', partName: this.body.part.name };
    const change = this.publishSynthetic(
      ORIGIN_IDS.mutationHuman,
      result.impact,
      story,
      result.createdPartName ? [result.createdPartName] : []
    );
    this.evictUnreachableStories();
    return { ok: true, change };
  }

  undo(): TreeModelChange | null {
    const pointer = this.undoOrder.pop();
    if (!pointer) return null;
    if (pointer.kind === 'package') {
      this.installPackageSnapshotInternal(pointer.before);
      this.redoOrder.push(pointer);
      this.packageRev += 1;
      const change = this.publishSynthetic(
        ORIGIN_IDS.mutationUndo,
        'global',
        { kind: 'body', partName: this.body.part.name },
        []
      );
      this.evictUnreachableStories();
      return change;
    }
    const store =
      pointer.partName === this.body.part.name ? this.body : this.stories.get(pointer.partName);
    if (!store) return null;
    const change = store.undo();
    if (!change) return null;
    this.redoOrder.push(pointer);
    this.syncPackageFromStore(store);
    this.packageRev += 1;
    this.publish(change);
    this.evictUnreachableStories();
    return change;
  }

  redo(): TreeModelChange | null {
    const pointer = this.redoOrder.pop();
    if (!pointer) return null;
    if (pointer.kind === 'package') {
      this.installPackageSnapshotInternal(pointer.after);
      this.undoOrder.push(pointer);
      this.packageRev += 1;
      const change = this.publishSynthetic(
        ORIGIN_IDS.mutationRedo,
        'global',
        { kind: 'body', partName: this.body.part.name },
        []
      );
      this.evictUnreachableStories();
      return change;
    }
    const store =
      pointer.partName === this.body.part.name ? this.body : this.stories.get(pointer.partName);
    if (!store) return null;
    const change = store.redo();
    if (!change) return null;
    this.undoOrder.push(pointer);
    this.syncPackageFromStore(store);
    this.packageRev += 1;
    this.publish(change);
    this.evictUnreachableStories();
    return change;
  }

  selectionForUndo(): SelectionMark | null {
    const pointer = this.undoOrder[this.undoOrder.length - 1];
    if (!pointer || pointer.kind === 'package') return null;
    const store =
      pointer.partName === this.body.part.name ? this.body : this.stories.get(pointer.partName);
    return store?.selectionForUndo() ?? null;
  }

  selectionForRedo(): SelectionMark | null {
    const pointer = this.redoOrder[this.redoOrder.length - 1];
    if (!pointer || pointer.kind === 'package') return null;
    const store =
      pointer.partName === this.body.part.name ? this.body : this.stories.get(pointer.partName);
    return store?.selectionForRedo() ?? null;
  }

  /** See {@link openStoryPartsOf}. */
  openStoryParts(): readonly OoxmlPart[] {
    return openStoryPartsOf(this.stories, this.pkg);
  }

  /** How many story stores are open (body counts as one). */
  openedStoryCount(): number {
    return 1 + this.stories.size;
  }

  /** See {@link openStoryTokenOf}. */
  openStoryToken(): string {
    return openStoryTokenOf(this.stories, this.pkg);
  }

  /**
   * Insert a validated raster image as one package undo unit (task 12).
   */
  insertImage(scope: StoryScope, input: InsertImageInput): Promise<ImageIntentResult> {
    return insertImageIntent(this, scope, input);
  }

  /** Land a clipboard fragment (resource merge + blocks) as one package undo unit. */
  applyFragmentPaste(scope: StoryScope, input: FragmentPasteInput): FragmentPasteResult {
    return applyFragmentPasteIntent(this, scope, input);
  }

  /** Replace a picture drawing's embedded media in one package undo unit. */
  replaceImage(
    scope: StoryScope,
    drawingNodeId: string,
    bytes: Uint8Array,
    mime: SupportedImageMime,
    decodePort: ImageDecodePort,
    options: import('./tree-package-images.ts').ReplaceImageOptions
  ): Promise<ImageIntentResult> {
    return replaceImageIntent(this, scope, drawingNodeId, bytes, mime, decodePort, options);
  }

  /** Delete a picture drawing and collect orphaned media in one package undo unit. */
  deleteImage(scope: StoryScope, drawingNodeId: string): ImageIntentResult {
    return deleteImageIntent(this, scope, drawingNodeId);
  }

  /** Propose the deletion as a tracked change: the drawing goes into a `w:del`, media stays. */
  deleteImageTracked(
    scope: StoryScope,
    drawingNodeId: string,
    revision: RevisionAttributionInput
  ): ImageIntentResult {
    return deleteImageTrackedIntent(this, scope, drawingNodeId, revision);
  }

  /** Fetch external bytes explicitly and embed them; no fetch on open/load. */
  embedExternalImage(
    scope: StoryScope,
    drawingNodeId: string,
    url: string,
    port: ExternalImageFetchPort,
    signal: AbortSignal,
    decodePort: ImageDecodePort
  ): Promise<ImageIntentResult> {
    return embedExternalImageIntent(this, scope, drawingNodeId, url, port, signal, decodePort);
  }

  /** Metadata plus hyperlink target creation in one package transaction. */
  setDrawingMetadataWithHyperlink(
    scope: StoryScope,
    drawingNodeId: string,
    title: string,
    description: string,
    hyperlink: string | null
  ): ImageIntentResult {
    return setDrawingMetadataWithHyperlinkIntent(
      this,
      scope,
      drawingNodeId,
      title,
      description,
      hyperlink
    );
  }

  /** Properties batch with hyperlink relationship create/update/remove in one package unit. */
  applyImageProperties(scope: StoryScope, input: ApplyImagePropertiesInput): ImageIntentResult {
    return applyImagePropertiesIntent(this, scope, input);
  }

  /**
   * Promote a story transaction that wrote package bytes to one package undo pointer.
   * Used by image intents and note-reference cascade.
   */
  promoteStoryTransactionToPackageUnit(
    beforePackage: OoxmlPackage,
    store: TreeDocumentStore,
    checkpoint: TreeDocumentCheckpoint,
    beforeDepth: number
  ): TreeModelChange {
    this.installPackageSnapshotInternal(store.package);
    if (store.historyDepth > beforeDepth) {
      store.restoreHistoryStacks(checkpoint);
    }
    this.pushUndoPointer({
      kind: 'package',
      before: beforePackage,
      after: this.currentPackage(),
    });
    this.packageRev += 1;
    const story =
      store.part.name === this.body.part.name
        ? ({ kind: 'body', partName: store.part.name } as const)
        : this.storyRefForPart(store.part.name);
    return this.publishSynthetic(
      ORIGIN_IDS.mutationHuman,
      story?.kind === 'headerFooter' ? 'global' : 'flow-structural',
      story ?? { kind: 'body', partName: this.body.part.name },
      []
    );
  }

  /**
   * Publish a story transaction the coordinator did not run.
   *
   * Comment writes commit straight on the story store and hand the new shell back through
   * {@link replacePackageShell}, so they never pass through `applyTreeOps` — the one place
   * every other edit bumps the revision and publishes. The subscriber channel therefore
   * stayed silent for a comment: `Editor.on('change')` never fired, and a review rail keyed
   * on it only caught up on the next unrelated caret move, so a reply someone had just
   * written was invisible until they clicked elsewhere.
   *
   * The STORY's own change is published rather than a synthetic one, because it carries the
   * dirty anchor paragraphs and the `text-local` impact the marker ops computed; a synthetic
   * `global` would make every comment cost a full relayout. History is deliberately
   * untouched — the story transaction already recorded its undo entry, exactly as
   * `applyTreeOps` leaves a non-cascading story edit.
   *
   * A `null` change is an identity no-op (nothing was written), and publishes nothing.
   */
  publishStoryWrite(change: TreeModelChange | null): TreeModelChange | null {
    if (!change) return null;
    this.packageRev += 1;
    this.publish(change);
    return change;
  }

  /**
   * Record a write that spanned SEVERAL parts as one package undo unit.
   *
   * A comment spans parts — the body in `comments.xml`, the thread record in
   * `commentsExtended.xml`, the markers in the story — and those writes reach the store through
   * the story store rather than `transact`. The story store's history cannot undo them: `undo()`
   * on a story pointer syncs the STORY PART alone, so undoing a comment restored the markers and
   * left the body, or the reverse. The caller discards the story entry and hands the package it
   * started from to this instead, the same promotion the note cascade does.
   */
  adoptPackageUnit(before: OoxmlPackage): void {
    const after = this.currentPackage();
    if (before === after) return;
    this.pushUndoPointer({ kind: 'package', before, after });
  }

  /** Install a full package snapshot (public seam for post-fetch cleanup). */
  installPackageSnapshot(snapshot: OoxmlPackage): void {
    this.installPackageSnapshotInternal(snapshot);
  }

  /**
   * Install a package this replica did not author, verbatim. No shell merge — see
   * `publishRemoteCanonicalPackage` for why merging one here diverges two replicas.
   */
  installAuthoritativePackageSnapshot(snapshot: OoxmlPackage): void {
    this.installPackageSnapshotInternal(snapshot, false);
  }

  /** Publish one remotely materialized canonical package as one revision. */
  publishRemotePackage(
    pkg: OoxmlPackage,
    attribution: RemotePackageAttribution
  ): PackageTransactResult {
    return publishRemoteCanonicalPackage(this, pkg, attribution);
  }

  /**
   * Replace the package shell while preserving opened stores. Used when numbering /
   * content-types mutate the package outside story trees.
   */
  replacePackageShell(pkg: OoxmlPackage): void {
    // Remember hyperlinks minted on this write before overlaying opened stores — delta is
    // against the pre-replace shell so lifecycle-cloned owned rels are never recorded.
    this.shellHyperlinks = rememberShellHyperlinks(this.shellHyperlinks, this.pkg, pkg);
    // Keep opened store parts authoritative over the shell's copies of those names.
    // Parked (deleted) stores are not re-injected.
    let next = pkg;
    next = withPart(next, this.body.part);
    for (const store of this.stories.values()) {
      if (!pkg.parts.has(store.part.name)) continue;
      next = withPart(next, store.part);
    }
    this.pkg = next;
  }

  /**
   * Install a full package snapshot: body + opened story stores track the snapshot's parts.
   * Stores whose parts disappeared stay parked (history identity preserved) so a later
   * package undo can reconnect them; rId cache rebuilds from remaining relationships.
   *
   * Numbering / shell-minted hyperlink resources (via {@link replacePackageShell}) are merged
   * onto the snapshot so lifecycle undo cannot orphan story `numId` / `r:id` references.
   * Furniture and notes parts remain snapshot-owned; shell hyperlink `.rels` for those owners
   * park when the part is temporarily absent and are pruned once history can no longer restore
   * the owner. Lifecycle-cloned owned relationships are not shell-minted and GC with the part.
   */
  private installPackageSnapshotInternal(snapshot: OoxmlPackage, mergeLocalShell = true): void {
    // Capture live shell before replacing — snapshot may predate numbering/hyperlink writes.
    const merged = mergeLocalShell
      ? mergePersistentPackageShell(snapshot, this.pkg, this.shellHyperlinks)
      : snapshot;
    const main = merged.parts.get(merged.mainDocumentPart);
    if (!main) return;
    this.body.replacePart(main);

    for (const [name, store] of this.stories) {
      const part = merged.parts.get(name);
      if (!part) continue;
      store.replacePart(part);
    }

    this.rIdToPartName.clear();
    const relationships = merged.relationships.get(merged.mainDocumentPart) ?? [];
    for (const record of relationships) {
      if (record.type !== HEADER_REL_TYPE && record.type !== FOOTER_REL_TYPE) continue;
      const resolved = resolveRelationship(record);
      if (resolved.mode !== 'Internal' || !resolved.target.ok) continue;
      if (
        this.stories.has(resolved.target.partName) &&
        merged.parts.has(resolved.target.partName)
      ) {
        this.rIdToPartName.set(record.id, resolved.target.partName);
      }
    }

    this.pkg = merged;
    // Re-overlay open stores present in the snapshot so currentPackage stays authoritative.
    this.pkg = withPart(this.pkg, this.body.part);
    for (const store of this.stories.values()) {
      if (!this.pkg.parts.has(store.part.name)) continue;
      this.pkg = withPart(this.pkg, store.part);
    }
  }

  private openNotesPartStore(noteKind: NoteKind): StoryResolveResult {
    const part = resolveNotesPart(this.currentPackage(), noteKind);
    if (!part) {
      return { ok: false, reason: 'missing-part', detail: noteKind };
    }
    const existing = this.stories.get(part.name);
    if (existing) {
      return {
        ok: true,
        story: { kind: 'notesPart', partName: part.name, noteKind },
        store: existing,
      };
    }
    if (this.openedStoryCount() >= this.maxEditableStoryParts) {
      this.evictUnreachableStories();
    }
    if (this.openedStoryCount() >= this.maxEditableStoryParts) {
      return {
        ok: false,
        reason: 'too-many-story-stores',
        detail: String(this.maxEditableStoryParts),
      };
    }
    const normalized = normalizeParagraphIdentity(part);
    const store = new TreeDocumentStore(normalized, {
      historyLimit: this.historyLimit,
      // A story store is built from a PART, whose synthetic package holds no `settings.xml`
      // — so without this a protected document refused a body edit and accepted a header one.
      settingsPart: () => settingsPartOf(this.pkg),
    });
    const story: TreeStoryRef = {
      kind: 'notesPart',
      partName: normalized.name,
      noteKind,
    };
    store.setStoryRef(story);
    this.stories.set(normalized.name, store);
    if (normalized !== part) {
      this.pkg = withPart(this.pkg, normalized);
    }
    return { ok: true, story, store };
  }

  private openHeaderFooterStore(rId: string): StoryResolveResult {
    const cachedName = this.rIdToPartName.get(rId);
    if (cachedName) {
      const store = this.stories.get(cachedName);
      if (store) {
        return {
          ok: true,
          story: { kind: 'headerFooter', partName: cachedName, rId },
          store,
        };
      }
    }

    const located = locateHeaderFooterPart(this.currentPackage(), rId);
    if (!located.ok) return located;

    const existing = this.stories.get(located.partName);
    if (existing) {
      this.rIdToPartName.set(rId, located.partName);
      return {
        ok: true,
        story: { kind: 'headerFooter', partName: located.partName, rId },
        store: existing,
      };
    }

    // Body + opened HF stores. Opening one more must stay within the bound.
    if (this.openedStoryCount() >= this.maxEditableStoryParts) {
      this.evictUnreachableStories();
    }
    if (this.openedStoryCount() >= this.maxEditableStoryParts) {
      return {
        ok: false,
        reason: 'too-many-story-stores',
        detail: String(this.maxEditableStoryParts),
      };
    }

    const normalized = normalizeParagraphIdentity(located.part);
    const store = new TreeDocumentStore(normalized, {
      historyLimit: this.historyLimit,
      // A story store is built from a PART, whose synthetic package holds no `settings.xml`
      // — so without this a protected document refused a body edit and accepted a header one.
      settingsPart: () => settingsPartOf(this.pkg),
    });
    const story: TreeStoryRef = {
      kind: 'headerFooter',
      partName: normalized.name,
      rId,
    };
    store.setStoryRef(story);
    this.stories.set(normalized.name, store);
    this.rIdToPartName.set(rId, normalized.name);
    if (normalized !== located.part) {
      this.pkg = withPart(this.pkg, normalized);
    }
    return { ok: true, story, store };
  }

  private storyRefForPart(partName: string): TreeStoryRef | null {
    if (partName === this.body.part.name) return { kind: 'body', partName };
    for (const [rId, name] of this.rIdToPartName) {
      if (name === partName) return { kind: 'headerFooter', partName, rId };
    }
    const part = this.currentPackage().parts.get(partName);
    if (part?.root.localName === 'footnotes') {
      return { kind: 'notesPart', partName, noteKind: 'footnote' };
    }
    if (part?.root.localName === 'endnotes') {
      return { kind: 'notesPart', partName, noteKind: 'endnote' };
    }
    return null;
  }

  private syncPackageFromStore(store: TreeDocumentStore): void {
    this.pkg = withPart(this.pkg, store.part);
  }

  private pushUndoPointer(pointer: HistoryPointer): void {
    this.undoOrder.push(pointer);
    this.redoOrder.length = 0;
    if (this.undoOrder.length > this.historyLimit) this.undoOrder.shift();
    this.evictUnreachableStories();
  }

  /**
   * Drop parked story stores that no current package part and no undo/redo pointer can
   * restore. History-reachable identities stay so edit→delete→undo reconnects the same
   * store; unreachable parked entries must not hold `maxEditableStoryParts` forever.
   *
   * Also prunes scoped hyperlink shell resources parked for owners that are no longer
   * live and not history-reachable (see `pruneUnreachableHyperlinkShell`).
   */
  private evictUnreachableStories(): void {
    const retained = this.retainedStoryPartNames();
    for (const [name] of [...this.stories]) {
      if (retained.has(name)) continue;
      this.stories.delete(name);
      for (const [rId, partName] of [...this.rIdToPartName]) {
        if (partName === name) this.rIdToPartName.delete(rId);
      }
    }
    const hyperlinkOwners = this.retainedHyperlinkOwnerParts(retained);
    const pruned = pruneUnreachableHyperlinkShell(this.pkg, hyperlinkOwners);
    if (pruned !== this.pkg) this.pkg = pruned;
    this.shellHyperlinks = retainShellHyperlinks(
      this.shellHyperlinks,
      hyperlinkOwners,
      this.pkg.mainDocumentPart
    );
  }

  private retainedStoryPartNames(): Set<string> {
    const retained = new Set<string>();
    const live = this.pkg;
    for (const name of this.stories.keys()) {
      if (live.parts.has(name)) retained.add(name);
    }
    for (const pointer of this.undoOrder) {
      this.retainPointerStoryParts(pointer, retained);
    }
    for (const pointer of this.redoOrder) {
      this.retainPointerStoryParts(pointer, retained);
    }
    return retained;
  }

  /**
   * Owners whose scoped hyperlink shell must survive while furniture/notes parts are
   * temporarily absent: opened/parked story retention plus every part name that package
   * history can still restore (even when the story store was never opened).
   */
  private retainedHyperlinkOwnerParts(storyRetained: ReadonlySet<string>): Set<string> {
    const retained = new Set<string>(storyRetained);
    retained.add(this.pkg.mainDocumentPart);
    retained.add(this.body.part.name);
    for (const pointer of this.undoOrder) {
      this.retainPointerHyperlinkOwners(pointer, retained);
    }
    for (const pointer of this.redoOrder) {
      this.retainPointerHyperlinkOwners(pointer, retained);
    }
    return retained;
  }

  private retainPointerStoryParts(pointer: HistoryPointer, retained: Set<string>): void {
    if (pointer.kind === 'story') {
      retained.add(pointer.partName);
      return;
    }
    for (const name of this.stories.keys()) {
      if (pointer.before.parts.has(name) || pointer.after.parts.has(name)) {
        retained.add(name);
      }
    }
  }

  private retainPointerHyperlinkOwners(pointer: HistoryPointer, retained: Set<string>): void {
    if (pointer.kind === 'story') {
      retained.add(pointer.partName);
      return;
    }
    for (const name of pointer.before.parts.keys()) retained.add(name);
    for (const name of pointer.after.parts.keys()) retained.add(name);
  }

  private publish(change: TreeModelChange): void {
    this.lastChange = change;
    for (const listener of this.subscribers) listener(change);
  }

  private publishSynthetic(
    origin: string,
    impact: ImpactClass,
    story: TreeStoryRef,
    created: readonly string[]
  ): TreeModelChange {
    this.commitCounter += 1;
    const fromRevision = this.packageRev - 1;
    const change: TreeModelChange = {
      change: 'model-change',
      fromRevision: fromRevision < 0 ? 0 : fromRevision,
      toRevision: this.packageRev,
      commitId: `pkg-commit-${this.commitCounter}`,
      origin,
      dirty: [],
      created: [...created],
      deleted: [],
      splitJoin: [],
      dependencyKeys: [],
      impact,
      story,
    };
    this.publish(change);
    return change;
  }
}
