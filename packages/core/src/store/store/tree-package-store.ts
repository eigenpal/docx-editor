// Package-aware mutation coordinator for editable story parts (body + headers/footers +
// notes parts).
//
// `TreeDocumentStore` remains the only semantic mutation path for story content
// (`ctx.apply(op)`). This coordinator keeps one store per editable part so body,
// header/footer, and notes-part revisions and indexes stay independent, while
// `currentPackage()` / save always merge every open store back into the canonical OOXML
// package.
//
// Story targeting: body / headerFooter mirror `EditorScope`; notes use internal
// `{ kind: 'notesPart'; noteKind }` (one store per footnotes/endnotes part, not per note).
// Editing focus still uses `EditorScope { kind: 'note'; id: 'footnote:N' }`. Furniture and
// note lifecycle ops commit through `applyLifecycleOp` with atomic package undo/redo.

import type { OoxmlPart } from '../package/ooxml-tree.ts';
import { normalizeParagraphIdentity } from '../package/para-id.ts';
import { withPart, type OoxmlPackage } from '../package/ooxml-package.ts';
import { resolveRelationship, type RelationshipRecord } from '../package/relationships.ts';
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
import { ORIGIN_IDS } from '../registry/frozen-ids.ts';
import type { ImpactClass, TreeDocOp, TreeOpRejection } from './tree-ops.ts';
import {
  TreeDocumentStore,
  type SelectionMark,
  type TransactOptions,
  type TreeModelChange,
  type TreeStoryRef,
  type TransactionContext,
} from './tree-store.ts';

const HEADER_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
const FOOTER_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';

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

export type StoryTargetRejection =
  | 'unknown-scope'
  | 'dangling-relationship'
  | 'wrong-relationship-type'
  | 'external-relationship'
  | 'bad-relationship-target'
  | 'missing-part'
  | 'not-a-story-part'
  | 'too-many-story-stores';

export type StoryResolveResult =
  | {
      readonly ok: true;
      readonly story: TreeStoryRef;
      readonly store: TreeDocumentStore;
    }
  | { readonly ok: false; readonly reason: StoryTargetRejection; readonly detail?: string };

export type PackageTransactResult =
  | { readonly ok: true; readonly change: TreeModelChange | null }
  | {
      readonly ok: false;
      readonly reason: StoryTargetRejection | TreeOpRejection;
      readonly detail?: string;
    };

/** Cap on simultaneously opened editable story stores (body + HF parts). Fail closed. */
export const DEFAULT_MAX_EDITABLE_STORY_PARTS = 64;

export interface TreePackageStoreOptions {
  readonly historyLimit?: number;
  /** Bound on opened story stores; defaults to {@link DEFAULT_MAX_EDITABLE_STORY_PARTS}. */
  readonly maxEditableStoryParts?: number;
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
  private lastChange: TreeModelChange | null = null;
  private compositionPartName: string | null = null;
  private commitCounter = 0;

  constructor(pkg: OoxmlPackage, main: OoxmlPart, options: TreePackageStoreOptions = {}) {
    this.pkg = withPart(pkg, main);
    this.historyLimit = options.historyLimit ?? 200;
    this.maxEditableStoryParts = options.maxEditableStoryParts ?? DEFAULT_MAX_EDITABLE_STORY_PARTS;
    this.body = new TreeDocumentStore(main, { historyLimit: this.historyLimit });
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
   */
  currentPackage(): OoxmlPackage {
    let next = withPart(this.pkg, this.body.part);
    for (const store of this.stories.values()) {
      next = withPart(next, store.part);
    }
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
   * Deleting a `noteReference` via `deleteText` cascades the note body in the same
   * package undo unit.
   */
  transact(
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
    const result = store.transact(build, {
      ...options,
      story,
      ...(story.kind === 'headerFooter' || story.kind === 'notesPart'
        ? { minimumImpact: 'global' as const }
        : {}),
    });

    if (!result.ok) {
      return {
        ok: false,
        reason: result.reason,
        ...(result.detail ? { detail: result.detail } : {}),
      };
    }

    this.syncPackageFromStore(store);

    // Cascade note-body deletion when a reference atom was removed by text delete.
    let cascaded = false;
    if (result.change) {
      const afterStory = this.currentPackage();
      const cascadedPkg = cascadeDeletedNoteReferences(beforePackage, afterStory);
      if (cascadedPkg === null) {
        // Roll back the story mutation by restoring the pre-transaction package.
        this.installPackageSnapshot(beforePackage);
        return { ok: false, reason: 'invalidArgs', detail: 'note-cascade-failed' };
      }
      if (cascadedPkg !== afterStory) {
        this.installPackageSnapshot(cascadedPkg);
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

  beginComposition(scope: StoryScope, selectionBefore: SelectionMark | null = null): boolean {
    const resolved = this.resolveStory(scope);
    if (!resolved.ok) return false;
    resolved.store.beginComposition(selectionBefore);
    this.compositionPartName = resolved.story.partName;
    return true;
  }

  endComposition(): void {
    const partName = this.compositionPartName;
    this.compositionPartName = null;
    if (!partName) {
      this.body.endComposition();
      return;
    }
    const store = partName === this.body.part.name ? this.body : this.stories.get(partName);
    if (!store) return;
    const beforeDepth = store.historyDepth;
    store.endComposition();
    if (store.historyDepth > beforeDepth) {
      const story =
        partName === this.body.part.name
          ? ({ kind: 'body', partName } as const)
          : this.storyRefForPart(partName);
      if (story) this.pushUndoPointer({ kind: 'story', partName, story });
    }
    this.syncPackageFromStore(store);
  }

  cancelComposition(): void {
    const partName = this.compositionPartName;
    this.compositionPartName = null;
    if (!partName) {
      this.body.cancelComposition();
      return;
    }
    const store = partName === this.body.part.name ? this.body : this.stories.get(partName);
    store?.cancelComposition();
  }

  /**
   * Commit one furniture or note lifecycle op as a single ModelChange / undo unit that
   * restores the entire package atomically (parts, rels, content-types, settings).
   */
  applyLifecycleOp(
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
      this.installPackageSnapshot(result.package);
      this.pushUndoPointer({ kind: 'package', before, after: result.package });
      this.packageRev += 1;
      const story: TreeStoryRef = { kind: 'body', partName: this.body.part.name };
      const change = this.publishSynthetic(
        ORIGIN_IDS.mutationHuman,
        result.impact,
        story,
        result.createdPartName ? [result.createdPartName] : []
      );
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

    this.installPackageSnapshot(result.package);
    this.pushUndoPointer({ kind: 'package', before, after: result.package });
    this.packageRev += 1;

    const story: TreeStoryRef = { kind: 'body', partName: this.body.part.name };
    const change = this.publishSynthetic(
      ORIGIN_IDS.mutationHuman,
      result.impact,
      story,
      result.createdPartName ? [result.createdPartName] : []
    );
    return { ok: true, change };
  }

  undo(): TreeModelChange | null {
    const pointer = this.undoOrder.pop();
    if (!pointer) return null;
    if (pointer.kind === 'package') {
      this.installPackageSnapshot(pointer.before);
      this.redoOrder.push(pointer);
      this.packageRev += 1;
      return this.publishSynthetic(
        ORIGIN_IDS.mutationUndo,
        'global',
        { kind: 'body', partName: this.body.part.name },
        []
      );
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
    return change;
  }

  redo(): TreeModelChange | null {
    const pointer = this.redoOrder.pop();
    if (!pointer) return null;
    if (pointer.kind === 'package') {
      this.installPackageSnapshot(pointer.after);
      this.undoOrder.push(pointer);
      this.packageRev += 1;
      return this.publishSynthetic(
        ORIGIN_IDS.mutationRedo,
        'global',
        { kind: 'body', partName: this.body.part.name },
        []
      );
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

  /** How many story stores are open (body counts as one). */
  openedStoryCount(): number {
    return 1 + this.stories.size;
  }

  /**
   * Replace the package shell while preserving opened stores. Used when numbering /
   * content-types mutate the package outside story trees.
   */
  replacePackageShell(pkg: OoxmlPackage): void {
    // Keep opened store parts authoritative over the shell's copies of those names.
    let next = pkg;
    next = withPart(next, this.body.part);
    for (const store of this.stories.values()) next = withPart(next, store.part);
    this.pkg = next;
  }

  /**
   * Install a full package snapshot: body + HF stores track the snapshot's parts, orphaned
   * HF stores close, rId cache rebuilds from remaining relationships.
   */
  private installPackageSnapshot(snapshot: OoxmlPackage): void {
    const main = snapshot.parts.get(snapshot.mainDocumentPart);
    if (!main) return;
    this.body.replacePart(main);

    const nextStories = new Map<string, TreeDocumentStore>();
    for (const [name, store] of this.stories) {
      const part = snapshot.parts.get(name);
      if (!part) continue;
      store.replacePart(part);
      nextStories.set(name, store);
    }
    this.stories.clear();
    for (const [name, store] of nextStories) this.stories.set(name, store);

    this.rIdToPartName.clear();
    const relationships = snapshot.relationships.get(snapshot.mainDocumentPart) ?? [];
    for (const record of relationships) {
      if (record.type !== HEADER_REL_TYPE && record.type !== FOOTER_REL_TYPE) continue;
      const resolved = resolveRelationship(record);
      if (resolved.mode !== 'Internal' || !resolved.target.ok) continue;
      if (this.stories.has(resolved.target.partName)) {
        this.rIdToPartName.set(record.id, resolved.target.partName);
      }
    }

    this.pkg = snapshot;
    // Re-overlay open stores so currentPackage stays store-authoritative for live trees.
    this.pkg = withPart(this.pkg, this.body.part);
    for (const store of this.stories.values()) this.pkg = withPart(this.pkg, store.part);
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
      return {
        ok: false,
        reason: 'too-many-story-stores',
        detail: String(this.maxEditableStoryParts),
      };
    }
    const normalized = normalizeParagraphIdentity(part);
    const store = new TreeDocumentStore(normalized, { historyLimit: this.historyLimit });
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
      return {
        ok: false,
        reason: 'too-many-story-stores',
        detail: String(this.maxEditableStoryParts),
      };
    }

    const normalized = normalizeParagraphIdentity(located.part);
    const store = new TreeDocumentStore(normalized, { historyLimit: this.historyLimit });
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

function locateHeaderFooterPart(
  pkg: OoxmlPackage,
  rId: string
):
  | { readonly ok: true; readonly partName: string; readonly part: OoxmlPart }
  | { readonly ok: false; readonly reason: StoryTargetRejection; readonly detail?: string } {
  const relationships = pkg.relationships.get(pkg.mainDocumentPart) ?? [];
  const record = relationships.find((rel) => rel.id === rId);
  if (!record) {
    return { ok: false, reason: 'dangling-relationship', detail: rId };
  }
  if (record.type !== HEADER_REL_TYPE && record.type !== FOOTER_REL_TYPE) {
    return { ok: false, reason: 'wrong-relationship-type', detail: record.type };
  }
  return resolveInternalStoryPart(pkg, record);
}

function resolveInternalStoryPart(
  pkg: OoxmlPackage,
  record: RelationshipRecord
):
  | { readonly ok: true; readonly partName: string; readonly part: OoxmlPart }
  | { readonly ok: false; readonly reason: StoryTargetRejection; readonly detail?: string } {
  const resolved = resolveRelationship(record);
  if (resolved.mode === 'External') {
    return { ok: false, reason: 'external-relationship', detail: record.id };
  }
  if (!resolved.target.ok) {
    return {
      ok: false,
      reason: 'bad-relationship-target',
      detail: resolved.target.reason,
    };
  }
  const part = pkg.parts.get(resolved.target.partName);
  if (!part) {
    return { ok: false, reason: 'missing-part', detail: resolved.target.partName };
  }
  const rootName = part.root.localName;
  if (rootName !== 'hdr' && rootName !== 'ftr') {
    return { ok: false, reason: 'not-a-story-part', detail: rootName || part.name };
  }
  return { ok: true, partName: part.name, part };
}
