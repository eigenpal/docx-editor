/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import {
  relsPartNameFor,
  CUSTOM_XML_PROPS_TYPE,
  type ContentTypeIndex,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPackage,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { withChildren } from './node-shapes.ts';
import { idOf, type LogicalId } from './identity.ts';
import { awaitingUpdates } from './yjs-items.ts';
import { rejectDangerousKey, rejectPartName } from './limits.ts';
import {
  isElementRecord,
  isTextRecord,
  nodeRecordRemoved,
  nodeRecordUndone,
  type ElementRecord,
  type EncodedRelationship,
  type RepairIssue,
  type RepairIssueCode,
} from './schema.ts';
import type { DocumentRegistry } from './registry.ts';
import type { BlobBytesStore } from './seed.ts';
import {
  childrenMatchRecords,
  emptyRelsPart,
  isRelsPartName,
  relationshipChildrenOf,
  relsOwnerOf,
  relsShellMatches,
} from './materialize-rels.ts';
import {
  customXmlDirectoryChanged,
  customXmlPropsOverrides,
  customXmlRepairNeeded,
  customXmlRepairRelationships,
  isCustomXmlItemPartName,
  isCustomXmlPropsPartName,
  planCustomXmlStores,
} from './materialize-custom-xml.ts';
import { partMemberSpecFor, shownMemberChildren } from './materialize-part-members.ts';
import { adoptLooseMembers } from './materialize-orphans.ts';
import { rescuedPartEntries, typeUntypedParts } from './materialize-rescued-parts.ts';
import { PackageProjectionCache } from './materialize-package-cache.ts';
import { MaterializeSplitProjection } from './materialize-split-projection.ts';
import { hasSingletonRules, partitionWithMerges, sharedChildShell } from './singleton-children.ts';
import { spineChildren } from './materialize-spine.ts';
import { NodeCache } from './materialize-node-cache.ts';
import { dedupeIssues, ListingContests } from './materialize-contests.ts';
import { splitWinnerOrder } from './split-dedup.ts';
import { AdoptionTracker } from './materialize-adoption.ts';
import { inlineChildren, reuseEqualNodes } from './paragraph-text-view.ts';
import { reportOrphans } from './materialize-orphans.ts';
import {
  attributesMatch,
  countPass,
  countRecordRead,
  expandAncestors,
  freezeElement,
  freezeText,
  markPlaced,
  payloadIdOfNode,
  replaceChildRange,
  withRelsChildren,
} from './materialize-freeze.ts';

export {
  markPlaced,
  materializedBlobBytesRead,
  materializedNodeBuilds,
  materializedNodeReads,
  materializedPassCounts,
  materializedPlacementClaims,
  replaceChildRange,
} from './materialize-freeze.ts';

export type MaterializeFailureCode = 'missing-blob' | 'missing-root' | 'invalid-relationships';

export type MaterializeResult =
  | { readonly ok: true; readonly package: OoxmlPackage; readonly issues: readonly RepairIssue[] }
  | {
      readonly ok: false;
      readonly code: MaterializeFailureCode;
      readonly issues: readonly RepairIssue[];
    };

/**
 * Incremental package materializer. Repair is pure: it does not write Yjs.
 * Child-ID arrays remain membership authority. The derived parent index is not replicated.
 */
export class PackageMaterializer {
  private readonly cache = new NodeCache();
  private readonly partCache = new Map<string, OoxmlPart>();
  /** Package projections that only a package write can change. */
  private readonly packageCache: PackageProjectionCache;
  /** Last `.rels` projection. The node tree is not the relationship authority. */
  private readonly relsProjection = new Map<string, OoxmlPart>();
  private readonly pendingDirty = new Set<LogicalId>();
  private pendingMembership = false;
  private pendingPackage = false;
  private lastDirty: ReadonlySet<LogicalId> = new Set();
  /** The ids whose shared state changed in this pass, before the ancestors were added. */
  private rawDirty: ReadonlySet<LogicalId> = new Set();
  /** The parent each node had in the last tree this materializer built. */
  private readonly shownUnder = new Map<LogicalId, LogicalId>();
  private partRoots: ReadonlySet<LogicalId> = new Set();
  private forceFull = false;
  /** Adoptee signature per survivor at the end of the last pass. */
  private readonly adoption = new AdoptionTracker();
  /** Hidden property-container copies each shown winner also shows the children of. */
  private readonly mergeSources = new Map<LogicalId, readonly LogicalId[]>();
  /** The copies each winner showed in its cached build, to know when that build is stale. */
  private readonly builtMerges = new Map<LogicalId, string>();
  private readonly contests: ListingContests;
  private readonly splitProjection = new MaterializeSplitProjection();
  /**
   * Whether this pass claims every node of a reused subtree, or only its root.
   *
   * The claim set answers two questions: which node is already in the tree under some other
   * parent, and which node is in no part at all. Both need the WHOLE placement — but only
   * when the placement can have moved. A second parent for a node appears exactly when some
   * child array gains an entry, when a node is added or removed, or when a tombstone shifts
   * adoption, and every one of those sets `membershipChanged`, which is one of the conditions
   * that turns orphan collection on. So a pass with orphan collection off inherits the
   * placement the previous pass already resolved, and the cached subtrees it hands back are
   * the ones that pass built. Claiming their roots is enough there, and it is the difference
   * between a received keystroke costing the edit and costing the document.
   */
  private claimsWholeSubtrees = true;
  /**
   * Duplicate parents found by the last pass that walked the whole placement.
   *
   * A pass that claims roots only cannot rediscover them, and they are unchanged by
   * construction. Re-reporting them keeps the issue list a property of the tree rather than
   * of which pass happened to produce it.
   */
  private lastDuplicateParents: readonly LogicalId[] = [];
  /** Ids that left a parent's child array during this pass. Reset per pass. */
  private readonly droppedChildren = new Set<LogicalId>();
  /**
   * Ids a previous pass could not reach from any part, or found stranded content beneath.
   *
   * Nothing in shared state says a node is unreachable — every pass derives it — so a pass
   * that looks only at the children it just watched leave a parent can NOTICE a break but
   * cannot keep noticing it. The next keystroke drops the report, and, worse, drops the
   * adoption that repaired it: a member rescued once vanishes again on the following pass.
   * Carrying these forward is what makes the repair idempotent, and the set holds what is
   * actually broken rather than growing with the document.
   */
  private looseCandidates = new Set<LogicalId>();
  private pkg: OoxmlPackage | null = null;
  private customXmlRels: readonly EncodedRelationship[] = [];
  private customXmlOverrides = new Map<string, string>();
  private readonly stop: () => void;
  readonly issues: RepairIssue[] = [];

  constructor(
    readonly registry: DocumentRegistry,
    readonly blobs: BlobBytesStore
  ) {
    this.packageCache = new PackageProjectionCache(registry);
    this.contests = new ListingContests(registry);
    this.stop = registry.observeDirty((paths) => {
      for (const id of paths.logicalIds) this.pendingDirty.add(id);
      if (paths.membershipChanged) this.pendingMembership = true;
      if (paths.packageChanged) this.pendingPackage = true;
    });
  }

  destroy(): void {
    this.stop();
  }

  dirtyLogicalIds(): ReadonlySet<LogicalId> {
    return this.lastDirty;
  }

  current(): MaterializeResult {
    if (
      this.pkg &&
      this.pendingDirty.size === 0 &&
      !this.pendingPackage &&
      !this.pendingMembership
    ) {
      return { ok: true, package: this.pkg, issues: [...this.issues] };
    }
    return this.rebuild();
  }

  /**
   * Materialize from shared state alone, without reusing any cached subtree.
   *
   * An incremental pass keeps the subtrees it did not rebuild. If the package it builds is
   * refused downstream — a node shown twice after a concurrent move the dirty set missed —
   * the full pass is the answer: every replica that runs it on the same shared state reaches
   * the same tree, because the view is a function of shared state alone.
   */
  rebuildFull(): MaterializeResult {
    this.forceFull = true;
    try {
      return this.rebuild();
    } finally {
      this.forceFull = false;
    }
  }

  rebuild(): MaterializeResult {
    const rawDirty = new Set(this.pendingDirty);
    const packageChanged = this.pendingPackage;
    this.pendingDirty.clear();
    this.pendingMembership = false;
    this.pendingPackage = false;
    // A write whose Yjs events are still queued is invisible to every derived index and to
    // the dirty set: shared state already holds the edit, while `parentOf` and the adoption
    // index still describe the tree without it. That happens on the one path that matters
    // most — a queued local keystroke flushed the moment a remote update arrives. Reusing a
    // cached subtree there would publish the document as it was BEFORE the author's own
    // character, so the pass rebuilds the indexes and reads everything from shared state.
    const unobserved = this.registry.hasUnobservedWrites();
    if (unobserved) this.registry.rebuildDerivedIndexes();
    // An unobserved write can be a package write whose `packageChanged` flag has not been
    // delivered yet, so it disqualifies the package projections exactly as the flag does.
    if (packageChanged || unobserved) this.packageCache.invalidate();
    for (const survivor of this.adoption.changes(this.registry)) rawDirty.add(survivor);
    // A paragraph shows other IDs, or hides other moved text, when another paragraph's text
    // changes what they share.
    for (const paragraph of this.registry.inline.takeAffected()) rawDirty.add(paragraph);
    // A contested child whose winning lister changed moves between two cached builds.
    for (const parent of this.registry.takeReparented()) rawDirty.add(parent);
    // A deleted parent hands each child it won a contest for to the child's other listers,
    // which kept a build without it; rebuild them so one of them takes the child.
    for (const id of [...rawDirty]) {
      if (!this.registry.isTombstoned(id)) continue;
      const record = this.registry.record(id);
      if (!record || !isElementRecord(record)) continue;
      for (const child of record.childIds) {
        for (const lister of this.registry.listingParents(child)) rawDirty.add(lister);
      }
    }
    for (const id of this.splitProjection.update(this.registry)) rawDirty.add(id);
    const dirty = expandAncestors(this.registry, rawDirty);
    // Every ancestor of a changed node has to rebuild. The registry's parent index says
    // where a node lives NOW; a node a peer moved or detached is still shown
    // under its old ancestors, and they must rebuild too, or the view keeps the stale subtree.
    for (const id of rawDirty) {
      let at = this.shownUnder.get(id);
      for (let depth = 0; at !== undefined && depth < this.registry.limits.maxTreeDepth; depth++) {
        dirty.add(at);
        at = this.shownUnder.get(at);
      }
    }
    // A relationship-only change dirties no nodes. Reuse the node cache, then project `.rels`.
    //
    // Membership does NOT disqualify the cache. Every child array that moved names its own
    // parent, `expandAncestors` names that parent's ancestors, and both the adoption index
    // and the recorded subtree heights are checked, so a rebuilt spine over cached children
    // reaches the same tree a full pass does — proven by the equivalence oracle in
    // `remote-receive-equivalence.test.ts`.
    // Concurrent first-create of a part is the one case that still earns a full pass, which is
    // also what it used to get. `parts.set(name, …)` and `nodes.set(rootId, …)` are both
    // last-write-wins, so the loser's root — or its child array — leaves shared state before
    // any pass could have seen it. Its members are then reachable from nothing, and neither a
    // comparison against the previous pass nor a derived index is guaranteed to say so.
    //
    // Two shapes signal it: a part root was written, or a written node has no parent at all.
    // Note both read `rawDirty`, the ids shared state actually reported. The condition this
    // replaces asked the ancestor-EXPANDED set whether anything lacked a parent — and every
    // edit expands up to a part root, which by definition has none, so it answered yes to
    // every keystroke ever typed and no pass has been incremental since.
    const partRoots = (this.partRoots = new Set(
      this.registry.partEntries().map((entry) => entry.rootLogicalId)
    ));
    const structureArrived = [...rawDirty].some(
      (id) =>
        partRoots.has(id) ||
        (this.registry.parentOf(id) === null && !this.registry.isTombstoned(id))
    );
    const incremental =
      !this.forceFull &&
      this.pkg !== null &&
      !unobserved &&
      !structureArrived &&
      (dirty.size > 0 || packageChanged);
    this.rawDirty = rawDirty;
    const first = this.materializePass(dirty, packageChanged, incremental);
    if (!this.contests.contested) return first;
    // Two child arrays list one id and the cache disagrees with the rebuilt parent about
    // which one owns it. A full pass decides it the one deterministic way: first preorder
    // placement wins, the rest report `duplicate-parent`. Unless the decision is already
    // made: the losers' cached subtrees were built without the child (`ListingContests`).
    if (first.ok && this.contests.decided()) {
      // A rebuilt loser re-reports a duplicate the pass also carried forward; one is enough.
      return { ok: true, package: first.package, issues: dedupeIssues(first.issues) };
    }
    const second = this.materializePass(dirty, packageChanged, false);
    this.contests.record(this.lastDuplicateParents);
    return second;
  }

  private materializePass(
    dirty: ReadonlySet<LogicalId>,
    packageChanged: boolean,
    incremental: boolean
  ): MaterializeResult {
    this.issues.length = 0;
    this.lastDirty = dirty;
    this.contests.reset();
    // A full pass builds the tree from shared state alone, so it is the only one that can
    // claim placement by walking, and the only one that has to.
    this.claimsWholeSubtrees = !incremental;
    this.droppedChildren.clear();
    countPass(!incremental);
    // An incremental pass never revisits the parents a full pass found contested, so it has
    // to carry that report forward or the issue disappears after one keystroke.
    if (incremental) {
      for (const id of this.lastDuplicateParents) this.push('duplicate-parent', id);
    }
    this.customXmlRels = [];
    this.customXmlOverrides.clear();
    // The split projection was updated in `rebuild()`, which also dirtied changed products.
    const placed = new Set<LogicalId>();
    const parts = new Map<string, OoxmlPart>();
    const entries = this.registry.partEntries();
    const relationships = [...this.packageCache.groupedByOwner(this.customXmlRels).values()].flat();
    for (const entry of [
      ...entries,
      ...rescuedPartEntries(this.registry, entries, relationships),
    ]) {
      const path = new Set<LogicalId>();
      const root = this.materialize(entry.rootLogicalId, placed, path, incremental);
      if (!root || root.kind === 'textValue') {
        return { ok: false, code: 'missing-root', issues: [...this.issues] };
      }
      const previous = this.partCache.get(entry.name);
      if (previous && previous.root === root && previous.contentType === entry.contentType) {
        parts.set(entry.name, previous);
        continue;
      }
      const part = Object.freeze({
        id: entry.id || entry.name,
        name: entry.name,
        contentType: entry.contentType,
        root,
      });
      parts.set(entry.name, part);
      this.partCache.set(entry.name, part);
    }
    // Reachability candidates. A full pass has to consider every node, because it knows
    // nothing about what came before. An incremental pass saw every child that left a parent
    // — no other id can have lost its last parent while it was running — plus whatever an
    // earlier pass already found loose, since that verdict has to be reached again to hold.
    // An undo mark that comes or goes changes whether its record may be given an edge back.
    const marked = this.registry.history.takeMarkChanges();
    const candidates = incremental
      ? new Set([...this.droppedChildren, ...this.looseCandidates, ...marked])
      : this.registry.allLogicalIds();
    const loose = new Set<LogicalId>();
    this.projectRelsParts(parts);
    this.adoptOrphanPartMembers(parts, placed, incremental, candidates, loose);
    this.applyCustomXmlStores(parts, placed, incremental);
    for (const name of [...this.partCache.keys()]) {
      if (!parts.has(name)) this.partCache.delete(name);
    }
    for (const name of [...this.relsProjection.keys()]) {
      if (!parts.has(name)) this.relsProjection.delete(name);
    }
    this.evictDeadSubtrees(placed);
    // A dirty node no part reached keeps its old build. If a later edit lists it again — a
    // concurrent split moving a run an undo had just emptied — reusing that build shows
    // content shared state no longer has, so the entry goes now.
    for (const id of dirty) {
      if (placed.has(id)) continue;
      this.cache.forget(id);
    }
    reportOrphans(this.registry, this.pushIssue, candidates, placed, incremental, loose);
    this.looseCandidates = loose;
    if (!incremental) {
      this.lastDuplicateParents = this.issues.flatMap((issue) =>
        issue.code === 'duplicate-parent' && issue.logicalId !== undefined ? [issue.logicalId] : []
      );
    }
    const assembled = this.assemblePackage(parts);
    if (!assembled.ok) return assembled;
    if (
      this.pkg &&
      !packageChanged &&
      this.pkg.parts.size === parts.size &&
      [...parts].every(([name, part]) => this.pkg?.parts.get(name) === part)
    ) {
      return { ok: true, package: this.pkg, issues: [...this.issues] };
    }
    this.pkg = assembled.package;
    return { ok: true, package: this.pkg, issues: [...this.issues] };
  }

  private push(code: RepairIssueCode, logicalId?: LogicalId): void {
    this.issues.push(logicalId ? { code, logicalId } : { code });
  }

  private readonly pushIssue = (code: RepairIssueCode, logicalId?: LogicalId): void =>
    this.push(code, logicalId);

  private materialize(
    logicalId: LogicalId,
    placed: Set<LogicalId>,
    path: Set<LogicalId>,
    incremental: boolean
  ): OoxmlNode | null {
    if (path.has(logicalId) || path.size >= this.registry.limits.maxTreeDepth) {
      this.push('cycle', logicalId);
      return null;
    }
    if (placed.has(logicalId)) {
      this.push('duplicate-parent', logicalId);
      return null;
    }
    const mergeKey = this.mergeSources.get(logicalId)?.join('\u0001') ?? '';
    if (
      incremental &&
      !this.lastDirty.has(logicalId) &&
      mergeKey === (this.builtMerges.get(logicalId) ?? '')
    ) {
      const cached = this.cache.get(logicalId);
      // A cached subtree carries the depth it was built at. Grafting it under a deeper
      // parent is how a peer would push the tree past `maxTreeDepth` without any walk ever
      // reaching the bottom, and every downstream oracle — validate, fingerprint, save —
      // recurses. So the recorded height is checked before the reuse, not after.
      if (cached && path.size + this.cache.heightOf(cached) <= this.registry.limits.maxTreeDepth) {
        // Claiming the subtree node by node is what made receiving one character cost the
        // whole document: the body root rebuilds, every other block is reused, and the walk
        // visits all of them to fill a set. It is only needed when this pass has to decide
        // reachability for itself — see `claimsWholeSubtrees`.
        if (this.claimsWholeSubtrees) {
          if (!markPlaced(cached, placed)) this.contests.contested = true;
        } else {
          placed.add(idOf(cached));
        }
        return cached;
      }
    }
    if (this.registry.isTombstoned(logicalId)) return null;
    const spine = incremental ? this.rebuildSpine(logicalId, placed, path) : null;
    if (spine) return spine;
    placed.add(logicalId);
    countRecordRead();
    const record = this.registry.record(logicalId);
    if (!record) {
      this.push('missing-node', logicalId);
      return null;
    }
    if (isTextRecord(record)) {
      // Its source has not arrived: pending, as a Yjs update is, so it shows nothing yet.
      if (this.splitProjection.awaiting.has(logicalId)) return null;
      const value = this.splitProjection.textValue(logicalId, record.value);
      const previous = this.cache.get(logicalId);
      if (previous?.kind === 'textValue' && previous.value === value) return previous;
      const next = freezeText(logicalId, value);
      this.cache.remember(logicalId, next);
      return next;
    }
    path.add(logicalId);
    const issuesAtStart = this.issues.length;
    const seenChildren = new Set<LogicalId>();
    let childIds = [...record.childIds];
    // A set for membership: a peer can give a merged copy as many children as a record holds.
    const listed = new Set(childIds);
    const addChild = (extra: LogicalId): void => {
      if (listed.has(extra)) return;
      listed.add(extra);
      childIds.push(extra);
    };
    for (const extra of this.registry.adoptedChildren(logicalId)) addChild(extra);
    // A winning property container shows the properties its hidden copies hold that it lacks.
    for (const copy of this.mergeSources.get(logicalId) ?? []) {
      const copyRecord = this.registry.record(copy);
      if (!copyRecord || !isElementRecord(copyRecord)) continue;
      for (const extra of copyRecord.childIds) addChild(extra);
    }
    if (mergeKey) this.builtMerges.set(logicalId, mergeKey);
    else this.builtMerges.delete(logicalId);
    const losers = this.splitProjection.losers;
    const winnerOrder =
      losers.size === 0
        ? null
        : splitWinnerOrder(
            childIds,
            (id) => losers.has(id),
            (id) => this.registry.splitLineageOf(id)
          );
    if (winnerOrder) childIds = winnerOrder.map((index) => childIds[index]!);
    const children: OoxmlNode[] = [];
    // Concurrent peers can each write a child OOXML allows once; show one, in one order.
    const order = partitionWithMerges(record.kind, childIds, (id) =>
      this.splitProjection.losers.has(id) ? null : sharedChildShell(this.registry, id)
    );
    for (const id of order.hidden) placed.add(id);
    for (const id of childIds) this.mergeSources.delete(id);
    for (const [winner, copies] of order.merges ?? []) {
      this.mergeSources.set(winner, copies);
      // A copy's own changes reach the winner that shows its children.
      for (const copy of copies) this.shownUnder.set(copy, winner);
    }
    for (const childId of order.shown) {
      if (childId === logicalId) {
        this.push('self-child', childId);
        continue;
      }
      if (seenChildren.has(childId)) {
        this.push('duplicate-child', childId);
        continue;
      }
      seenChildren.add(childId);
      if (this.registry.isTombstoned(childId)) {
        this.push('deleted-referenced', childId);
        continue;
      }
      // A run a concurrent split superseded: drop it, and mark it placed so reachability does
      // not report it as stranded content — its loss is deliberate, the winning split's runs
      // carry the text. Every replica picks the same loser, so this converges.
      if (this.splitProjection.losers.has(childId)) {
        placed.add(childId);
        continue;
      }
      // Existence only. Decoding the child's whole record here — attributes, bindings and
      // its own child array — for every entry of every rebuilt child list is the same cost
      // as materializing it, and a cached child never needs it decoded at all.
      if (rejectDangerousKey(childId) || !this.registry.hasNode(childId)) {
        // A record that has not arrived is pending, as a Yjs update with missing dependencies
        // is: it shows when it arrives, which dirties every parent that lists it. Only a
        // record shared state removed is lost content.
        if (rejectDangerousKey(childId) || nodeRecordRemoved(this.registry.schema.nodes, childId)) {
          this.push('child-id-not-in-registry', childId);
        }
        continue;
      }
      if (!this.claimsWholeSubtrees) this.contests.note(childId, logicalId, placed, this.partRoots);
      const child = this.materialize(childId, placed, path, incremental);
      if (child) {
        children.push(child);
        this.shownUnder.set(idOf(child), logicalId);
      }
    }
    // A spine rebuild reuses this child list, so it may only when the list is the whole
    // story: every listed child shows. A child skipped without an issue is pending, and its
    // arrival dirties only itself, which the reused list would never show.
    const complete =
      order.hidden.length === 0 &&
      children.length === order.shown.length &&
      this.issues.length === issuesAtStart;
    // A paragraph's inline content is its shared text; embedded nodes are records under it.
    const inlineText = this.registry.inline.textOf(logicalId);
    if (inlineText) {
      const embedOf = (id: LogicalId): OoxmlNode | null => {
        // A peer's text can arrive before the record it embeds, which Yjs holds back until
        // what it depends on arrives: pending, so it shows nothing yet.
        if (!this.registry.hasNode(id) && awaitingUpdates(this.registry.doc)) return null;
        const node = this.materialize(id, placed, path, incremental);
        if (node) this.shownUnder.set(id, logicalId);
        return node;
      };
      const view = this.registry.inline.viewOf(logicalId);
      const built = inlineChildren(logicalId, inlineText, embedOf, this.registry.limits, view);
      const cached = this.cache.get(logicalId);
      children.push(
        ...reuseEqualNodes(cached?.kind === 'textValue' ? [] : (cached?.children ?? []), built)
      );
    }
    path.delete(logicalId);
    const previous = this.cache.get(logicalId);
    if (
      previous &&
      previous.kind !== 'textValue' &&
      previous.children.length === children.length &&
      previous.children.every((child, index) => child === children[index]) &&
      attributesMatch(previous, record)
    ) {
      this.cache.markComplete(logicalId, complete);
      return previous;
    }
    const previousChildren = previous && previous.kind !== 'textValue' ? previous.children : [];
    this.recordDroppedChildren(previousChildren, children);
    const next = freezeElement(record, replaceChildRange(previousChildren, children), previous);
    this.cache.remember(logicalId, next);
    this.cache.markComplete(logicalId, complete);
    return next;
  }

  /**
   * Rebuild a node whose own record did not change by its dirty children only. Null when the
   * full rebuild has to decide: see `spineChildren`. A node with singleton rules, merged
   * copies, adopted children or an issue in its last build always takes the full rebuild.
   */
  private rebuildSpine(
    logicalId: LogicalId,
    placed: Set<LogicalId>,
    path: Set<LogicalId>
  ): OoxmlNode | null {
    const previous = this.cache.get(logicalId);
    if (
      !previous ||
      previous.kind === 'textValue' ||
      this.rawDirty.has(logicalId) ||
      !this.cache.isComplete(logicalId) ||
      hasSingletonRules(previous.kind) ||
      this.builtMerges.has(logicalId) ||
      this.mergeSources.has(logicalId) ||
      this.splitProjection.losers.size > 0 ||
      this.registry.adoptedChildren(logicalId).length > 0
    ) {
      return null;
    }
    const height = this.cache.heightOf(previous);
    if (path.size + height > this.registry.limits.maxTreeDepth) return null;
    const issuesAtStart = this.issues.length;
    path.add(logicalId);
    const result = spineChildren(previous, {
      dirty: this.lastDirty,
      placed,
      isCached: (child) => this.cache.holds(child),
      canRebuild: (childId) => {
        if (
          rejectDangerousKey(childId) ||
          this.registry.isTombstoned(childId) ||
          !this.registry.hasNode(childId)
        ) {
          return false;
        }
        this.contests.note(childId, logicalId, placed, this.partRoots);
        return true;
      },
      rebuild: (childId) => {
        const child = this.materialize(childId, placed, path, true);
        if (child) this.shownUnder.set(idOf(child), logicalId);
        return child;
      },
    });
    path.delete(logicalId);
    if (!result) return null;
    placed.add(logicalId);
    const complete = result.dropped.length === 0 && this.issues.length === issuesAtStart;
    if (result.children === previous.children) {
      this.cache.markComplete(logicalId, complete);
      return previous;
    }
    for (const id of result.dropped) this.droppedChildren.add(id);
    const next = Object.freeze(withChildren(previous, result.children));
    this.cache.remember(logicalId, next);
    this.cache.markComplete(logicalId, complete);
    // The node is as deep as before or as one of its rebuilt children makes it.
    let rebuiltHeight = height;
    for (const child of result.children) {
      if (this.lastDirty.has(idOf(child))) {
        rebuiltHeight = Math.max(rebuiltHeight, this.cache.heightOf(child) + 1);
      }
    }
    this.cache.setHeight(logicalId, rebuiltHeight);
    return next;
  }

  /**
   * Note every child that this rebuild removed from its parent.
   *
   * These are the only ids that can have lost their last parent during the pass, which is
   * what lets orphan reporting and member adoption stop scanning the whole node table. The
   * comments-part race lands here: the losing replica's child array is overwritten, so its
   * members show up as dropped and get adopted back.
   */
  private recordDroppedChildren(previous: readonly OoxmlNode[], next: readonly OoxmlNode[]): void {
    if (previous.length === 0) return;
    const kept = new Set(next.map((child) => child.id));
    for (const child of previous) {
      if (!kept.has(child.id)) this.droppedChildren.add(idOf(child));
    }
  }

  /**
   * Forget the cached subtrees of nodes this pass saw deleted for good.
   *
   * The cache otherwise only grows: a deleted paragraph's frozen subtree stays retained for
   * the rest of the session. Only ids that left a parent during this pass can have died, and
   * a dead root is one that is tombstoned (or gone from shared state) and placed nowhere.
   * The descent stops at any placed id — a child that MOVED, or was adopted by a survivor,
   * is in the tree and keeps its entry.
   */
  private evictDeadSubtrees(placed: ReadonlySet<LogicalId>): void {
    for (const id of this.droppedChildren) {
      if (placed.has(id)) continue;
      if (this.registry.isTombstoned(id) || !this.registry.hasNode(id)) {
        this.cache.evictSubtree(id, placed, (evicted) => this.shownUnder.delete(evicted));
      }
    }
  }

  /** @internal Test-only view of which subtrees the node cache still retains. */
  retainedNodeIds(): readonly LogicalId[] {
    return this.cache.ids();
  }

  /**
   * Project each `.rels` part from the relationship map.
   *
   * The map is the replicated source of truth. The node tree is not, because
   * `putRelationship` does not splice a Relationship child.
   */
  private projectRelsParts(parts: Map<string, OoxmlPart>): void {
    const byOwner = this.packageCache.groupedByOwner(this.customXmlRels);
    const projected = new Set<string>();
    for (const [owner, records] of byOwner) {
      const relsName = relsPartNameFor(owner);
      if (relsName !== '/_rels/.rels' && rejectPartName(relsName)) continue;
      projected.add(relsName);
      const next = this.projectOneRelsPart(relsName, parts.get(relsName), records);
      if (!next) continue;
      parts.set(relsName, next);
      this.partCache.set(relsName, next);
    }
    for (const [name, part] of parts) {
      if (projected.has(name) || !isRelsPartName(name)) continue;
      const owner = relsOwnerOf(name);
      if (owner === null) continue;
      const next = this.projectOneRelsPart(name, part, byOwner.get(owner) ?? []);
      if (!next || next === part) continue;
      parts.set(name, next);
      this.partCache.set(name, next);
    }
  }

  private projectOneRelsPart(
    relsName: string,
    existing: OoxmlPart | undefined,
    records: readonly EncodedRelationship[]
  ): OoxmlPart | null {
    if (!existing && records.length === 0) {
      this.relsProjection.delete(relsName);
      return null;
    }
    const cached = this.relsProjection.get(relsName);
    const shellOk = !!cached && (!existing || relsShellMatches(cached.root, existing.root));
    const base = shellOk && cached ? cached : (existing ?? emptyRelsPart(relsName));
    if (childrenMatchRecords(base.root, records)) {
      this.relsProjection.set(relsName, base);
      return base;
    }
    const previous = base.root.children;
    const next = withRelsChildren(base, relationshipChildrenOf(previous, records, relsName));
    this.relsProjection.set(relsName, next);
    return next;
  }

  /** The node the last pass built for `id`, or null. Reads the cache only; builds nothing. */
  builtNode(id: LogicalId): OoxmlNode | null {
    return this.cache.get(id) ?? null;
  }

  /** The children a member part's root shows, in order, or null (`shownMemberChildren`). */
  shownPartChildren(rootId: LogicalId): readonly LogicalId[] | null {
    return shownMemberChildren(this.partCache.values(), rootId);
  }

  /**
   * Re-parent directory members the part-map LWW dropped.
   *
   * Both replicas mint `/word/comments.xml#0` when the file has no comments part yet, and
   * the same holds for the footnotes, endnotes and numbering parts. `parts.set(name, …)` is
   * last-write-wins, so the loser's root leaves shared state and its children are reachable
   * from no part. The children themselves are separate keys and still exist, so the repair
   * is to give them an edge back. `materialize-part-members.ts` says which elements qualify
   * for which part, and why headers cannot be among them.
   */
  private adoptOrphanPartMembers(
    parts: Map<string, OoxmlPart>,
    placed: Set<LogicalId>,
    incremental: boolean,
    candidates: Iterable<LogicalId>,
    loose: Set<LogicalId>
  ): void {
    for (const [name, part] of parts) {
      const spec = partMemberSpecFor(part.root);
      if (!spec) continue;
      const isMember = (record: ElementRecord): boolean =>
        record.logicalId !== part.root.id && spec.isMember(record);
      const members: OoxmlElement[] = [];
      const seen = new Set<LogicalId>();
      // A part reused from an earlier pass can still show a member that pass adopted and that
      // adoption would not take now: deleted, taken out by an undo, or listed elsewhere. It
      // goes, as a full pass would never have adopted it.
      const gone = new Set<LogicalId>();
      const rootRecord = this.registry.record(idOf(part.root));
      const listed = new Set(rootRecord && isElementRecord(rootRecord) ? rootRecord.childIds : []);
      for (const child of part.root.children) {
        if (child.kind === 'textValue') continue;
        const id = idOf(child);
        if (
          this.registry.isTombstoned(id) ||
          (!listed.has(id) &&
            (nodeRecordUndone(this.registry.schema.nodes.get(id)) ||
              this.registry.listingParents(id).length > 0))
        ) {
          gone.add(id);
          continue;
        }
        const record = this.registry.record(idOf(child));
        if (!record || !isElementRecord(record) || !isMember(record)) continue;
        members.push(child);
        seen.add(idOf(child));
      }
      const adopted = adoptLooseMembers(
        this.registry,
        (id) => this.materialize(id, placed, new Set(), incremental),
        members,
        seen,
        isMember,
        placed,
        incremental,
        candidates,
        loose
      );
      if (adopted === 0 && gone.size === 0) continue;
      const bySortKey = (left: OoxmlElement, right: OoxmlElement): number =>
        spec.sortKey(left).localeCompare(spec.sortKey(right));
      if (spec.adoptedAfterListed) {
        // Listed members keep their order and adopted ones follow, sorted, so a pass that
        // adopts nothing and reuses this order agrees with a full pass.
        const listed = members.length - adopted;
        members.splice(listed, adopted, ...members.slice(listed).sort(bySortKey));
      } else {
        members.sort(bySortKey);
      }
      const kept: OoxmlNode[] = [];
      for (const child of part.root.children) {
        if (seen.has(idOf(child)) || gone.has(idOf(child))) continue;
        kept.push(child);
      }
      const nextChildren = replaceChildRange(part.root.children, [...kept, ...members]);
      if (nextChildren === part.root.children) continue;
      const record = this.registry.record(idOf(part.root));
      if (!record || !isElementRecord(record)) continue;
      const nextRoot = freezeElement(record, nextChildren, part.root);
      this.cache.remember(idOf(part.root), nextRoot);
      const nextPart = Object.freeze({ ...part, root: nextRoot });
      parts.set(name, nextPart);
      this.partCache.set(name, nextPart);
    }
  }

  /**
   * The node for `id` in this pass, built only if the pass has not already produced it.
   *
   * The customXml repair reaches roots the part loop built minutes earlier in the same pass —
   * `itemProps1.xml` is both a part and a store's props root. Asking `materialize` for it a
   * second time trips the placement guard, which reports `duplicate-parent` and returns
   * nothing. That code means two child arrays are contesting one node, a session-escalating
   * signal, and it must not be spent on a repair revisiting its own output.
   */
  private materializeOnce(
    id: LogicalId,
    placed: Set<LogicalId>,
    incremental: boolean
  ): OoxmlNode | null {
    if (placed.has(id)) return this.cache.get(id) ?? null;
    return this.materialize(id, placed, new Set(), incremental);
  }

  private adoptNodesIntoRoot(
    rootId: LogicalId,
    nodeIds: readonly LogicalId[],
    placed: Set<LogicalId>,
    incremental: boolean
  ): OoxmlElement | null {
    const existing = this.cache.get(rootId);
    const root =
      existing && existing.kind !== 'textValue'
        ? existing
        : this.materializeOnce(rootId, placed, incremental);
    if (!root || root.kind === 'textValue') return null;
    const members: OoxmlNode[] = [...root.children];
    const seen = new Set(members.map((child) => child.id));
    let adopted = 0;
    for (const id of nodeIds) {
      if (seen.has(id)) continue;
      const node = this.materializeOnce(id, placed, incremental);
      if (!node || node.kind === 'textValue') continue;
      members.push(node);
      seen.add(id);
      adopted += 1;
    }
    members.sort((left, right) => payloadIdOfNode(left).localeCompare(payloadIdOfNode(right)));
    if (adopted === 0 && members.every((child, index) => child === root.children[index])) {
      return root;
    }
    const record = this.registry.record(rootId);
    if (!record || !isElementRecord(record)) return root;
    const nextChildren = replaceChildRange(root.children, members);
    const nextRoot = freezeElement(record, nextChildren, root);
    this.cache.remember(rootId, nextRoot);
    return nextRoot;
  }

  private applyCustomXmlStores(
    parts: Map<string, OoxmlPart>,
    placed: Set<LogicalId>,
    incremental: boolean
  ): void {
    const stores = planCustomXmlStores(this.registry, parts);
    if (stores.length === 0 || !customXmlRepairNeeded(parts, stores)) return;
    const remap = customXmlDirectoryChanged(parts, stores);
    const planned = new Set<string>();
    for (const store of stores) {
      planned.add(store.itemName);
      planned.add(store.propsName);
      const dataRoot = this.adoptNodesIntoRoot(
        store.dataRootId,
        store.nodeIds,
        placed,
        incremental
      );
      const propsRoot = this.materializeOnce(store.propsRootId, placed, incremental);
      if (!dataRoot || !propsRoot || propsRoot.kind === 'textValue') continue;
      const dataPart = Object.freeze({
        id: store.itemName,
        name: store.itemName,
        contentType: 'application/xml',
        root: dataRoot,
      });
      const propsPart = Object.freeze({
        id: store.propsName,
        name: store.propsName,
        contentType: CUSTOM_XML_PROPS_TYPE,
        root: propsRoot,
      });
      parts.set(store.itemName, dataPart);
      parts.set(store.propsName, propsPart);
      this.partCache.set(store.itemName, dataPart);
      this.partCache.set(store.propsName, propsPart);
    }
    if (!remap) return;
    for (const name of [...parts.keys()]) {
      if (!isCustomXmlItemPartName(name) && !isCustomXmlPropsPartName(name)) continue;
      if (planned.has(name)) continue;
      parts.delete(name);
      this.partCache.delete(name);
    }
    this.customXmlRels = customXmlRepairRelationships(this.registry, stores);
    this.customXmlOverrides = customXmlPropsOverrides(stores);
    this.projectRelsParts(parts);
  }

  private assemblePackage(parts: Map<string, OoxmlPart>): MaterializeResult {
    const assembly = this.packageCache.relationshipAssembly(this.customXmlRels);
    if (!assembly) return { ok: false, code: 'invalid-relationships', issues: [...this.issues] };
    const partBytes = this.packageCache.resolvePartBytes(this.blobs);
    if (!partBytes) return { ok: false, code: 'missing-blob', issues: [...this.issues] };
    const overrides = new Map(this.packageCache.contentTypeOverrides());
    for (const [name, mediaType] of this.customXmlOverrides) overrides.set(name, mediaType);
    const contentTypes: ContentTypeIndex = {
      defaults: this.packageCache.contentTypeDefaults(),
      overrides,
    };
    typeUntypedParts(parts, contentTypes, overrides);
    const mainDocumentPart =
      this.registry.mainDocumentPart() ||
      [...parts.keys()].find((name) => name.endsWith('document.xml')) ||
      '';
    return {
      ok: true,
      package: Object.freeze({
        parts,
        partBytes,
        relationships: assembly.byOwner,
        externalTargets: assembly.externalTargets,
        contentTypes,
        mainDocumentPart,
      }),
      issues: [...this.issues],
    };
  }
}
