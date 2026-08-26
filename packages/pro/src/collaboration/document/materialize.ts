/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import {
  buildRelationshipSet,
  relsPartNameFor,
  resolveRelationship,
  CUSTOM_XML_PROPS_TYPE,
  type ContentTypeIndex,
  type OoxmlElement,
  type OoxmlExternalTarget,
  type OoxmlNode,
  type OoxmlPackage,
  type OoxmlPart,
  type RelationshipRecord,
} from '@docx-editor.dev/core/store';
import type { LogicalId } from './identity.ts';
import { rejectDangerousKey, rejectPartName } from './limits.ts';
import {
  isElementRecord,
  isTextRecord,
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
  relationshipsByOwner,
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
  mergeCustomXmlRelationships,
  planCustomXmlStores,
} from './materialize-custom-xml.ts';
import { partMemberSpecFor } from './materialize-part-members.ts';
import {
  attributesMatch,
  countBlobBytes,
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
  private readonly cache = new Map<LogicalId, OoxmlNode>();
  /** Depth of each cached subtree, so reuse cannot smuggle a node past `maxTreeDepth`. */
  private readonly heights = new Map<LogicalId, number>();
  private readonly partCache = new Map<string, OoxmlPart>();
  /** Media payload per storage key, with the digest it was read for. */
  private readonly blobBytes = new Map<string, { digest: string; bytes: Uint8Array }>();
  /** Last `.rels` projection. The node tree is not the relationship authority. */
  private readonly relsProjection = new Map<string, OoxmlPart>();
  private readonly pendingDirty = new Set<LogicalId>();
  private pendingMembership = false;
  private pendingPackage = false;
  private lastDirty: ReadonlySet<LogicalId> = new Set();
  /** Adoptee signature per survivor at the end of the last pass. */
  private lastAdoption = new Map<LogicalId, string>();
  private placementContested = false;
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
  private pkg: OoxmlPackage | null = null;
  private customXmlRels: readonly EncodedRelationship[] = [];
  private customXmlOverrides = new Map<string, string>();
  private readonly stop: () => void;
  readonly issues: RepairIssue[] = [];

  constructor(
    readonly registry: DocumentRegistry,
    readonly blobs: BlobBytesStore
  ) {
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
   * Survivors whose derived adoption set moved since the last pass.
   *
   * A join tombstones one node with a replacement and the survivor grows the orphaned
   * children. Nothing about the survivor's own record changes, so no observer names it: the
   * only witness is this index. The node cache would hand the survivor back untouched and
   * the joined content would vanish, which is why the whole document used to rebuild
   * whenever membership moved. The index holds one entry per join survivor, so comparing it
   * costs nothing next to the walk it replaces.
   */
  private adoptionChanges(): readonly LogicalId[] {
    const moved: LogicalId[] = [];
    const next = new Map<LogicalId, string>();
    for (const [survivor, adopted] of this.registry.adoptionIndex()) {
      const signature = adopted.join('\u0001');
      next.set(survivor, signature);
      if (this.lastAdoption.get(survivor) !== signature) moved.push(survivor);
    }
    for (const survivor of this.lastAdoption.keys()) {
      if (!next.has(survivor)) moved.push(survivor);
    }
    this.lastAdoption = next;
    return moved;
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
    for (const survivor of this.adoptionChanges()) rawDirty.add(survivor);
    const dirty = expandAncestors(this.registry, rawDirty);
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
    const partRoots = new Set(this.registry.partEntries().map((entry) => entry.rootLogicalId));
    const structureArrived = [...rawDirty].some(
      (id) =>
        partRoots.has(id) ||
        (this.registry.parentOf(id) === null && !this.registry.isTombstoned(id))
    );
    const incremental =
      this.pkg !== null && !unobserved && !structureArrived && (dirty.size > 0 || packageChanged);
    const first = this.materializePass(dirty, packageChanged, incremental);
    if (!this.placementContested) return first;
    // Two child arrays list one id and the cache disagrees with the rebuilt parent about
    // which one owns it. A full pass decides it the one deterministic way: first preorder
    // placement wins, the rest report `duplicate-parent`.
    return this.materializePass(dirty, packageChanged, false);
  }

  private materializePass(
    dirty: ReadonlySet<LogicalId>,
    packageChanged: boolean,
    incremental: boolean
  ): MaterializeResult {
    this.issues.length = 0;
    this.lastDirty = dirty;
    this.placementContested = false;
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
    const placed = new Set<LogicalId>();
    const parts = new Map<string, OoxmlPart>();
    for (const entry of this.registry.partEntries()) {
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
    // nothing about what came before. An incremental pass saw every child that left a parent,
    // and no other id can have lost its last parent while it was running.
    const candidates = incremental ? this.droppedChildren : this.registry.allLogicalIds();
    this.projectRelsParts(parts);
    this.adoptOrphanPartMembers(parts, placed, incremental, candidates);
    this.applyCustomXmlStores(parts, placed, incremental);
    for (const name of [...this.partCache.keys()]) {
      if (!parts.has(name)) this.partCache.delete(name);
    }
    for (const name of [...this.relsProjection.keys()]) {
      if (!parts.has(name)) this.relsProjection.delete(name);
    }
    this.reportOrphans(candidates, placed, incremental);
    if (!incremental) {
      this.lastDuplicateParents = this.issues
        .filter((issue) => issue.code === 'duplicate-parent' && issue.logicalId !== undefined)
        .map((issue) => issue.logicalId as LogicalId);
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

  /**
   * Report nodes that no part can reach.
   *
   * Reachability is read off the listings index rather than off a placement set built by
   * walking, because filling that set was the whole cost of a received keystroke: every
   * block the edit did not touch got visited to record that it is still where it was. A node
   * that any live parent lists is in the tree, and a part root is reachable by definition.
   *
   * This reports the ROOT of a detached subtree rather than every node inside it — the nodes
   * beneath it still have a parent, it just is not connected to a part. That is the more
   * useful signal anyway: one issue names the break instead of one per node below it.
   */
  /**
   * Whether some parent's CURRENT child array still names this id.
   *
   * The listings index answers "who has ever listed it", which is not the same question: a
   * parent whose whole record was replaced can leave a listing behind for a child it no
   * longer has. Reading the arrays back makes the answer authoritative, and the callers only
   * ask it about ids this pass watched leave a parent, so the read is bounded by the edit.
   *
   * A tombstoned parent counts. Its children are adopted by the survivor rather than lost, so
   * they have a place in the tree and must not be adopted into a part on top of it.
   */
  private stillListed(logicalId: LogicalId): boolean {
    for (const parent of this.registry.listingParents(logicalId)) {
      const record = this.registry.record(parent);
      if (record && isElementRecord(record) && record.childIds.includes(logicalId)) return true;
    }
    return false;
  }

  private reportOrphans(
    candidates: Iterable<LogicalId>,
    placed: ReadonlySet<LogicalId>,
    incremental: boolean
  ): void {
    const partRoots = incremental
      ? new Set(this.registry.partEntries().map((entry) => entry.rootLogicalId))
      : null;
    for (const id of candidates) {
      if (this.registry.isTombstoned(id)) continue;
      if (partRoots === null) {
        if (placed.has(id)) continue;
      } else if (partRoots.has(id) || this.stillListed(id)) {
        continue;
      }
      const record = this.registry.record(id);
      const hasContent =
        !!record &&
        (isTextRecord(record)
          ? record.value.length > 0
          : record.childIds.length > 0 || record.attributes.length > 0);
      this.push(hasContent ? 'orphan-with-content' : 'orphan', id);
    }
  }

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
    if (incremental && !this.lastDirty.has(logicalId)) {
      const cached = this.cache.get(logicalId);
      // A cached subtree carries the depth it was built at. Grafting it under a deeper
      // parent is how a peer would push the tree past `maxTreeDepth` without any walk ever
      // reaching the bottom, and every downstream oracle — validate, fingerprint, save —
      // recurses. So the recorded height is checked before the reuse, not after.
      if (cached && path.size + this.heightOf(cached) <= this.registry.limits.maxTreeDepth) {
        // Claiming the subtree node by node is what made receiving one character cost the
        // whole document: the body root rebuilds, every other block is reused, and the walk
        // visits all of them to fill a set. It is only needed when this pass has to decide
        // reachability for itself — see `claimsWholeSubtrees`.
        if (this.claimsWholeSubtrees) {
          if (!markPlaced(cached, placed)) this.placementContested = true;
        } else {
          placed.add(cached.id);
        }
        return cached;
      }
    }
    if (this.registry.isTombstoned(logicalId)) return null;
    placed.add(logicalId);
    countRecordRead();
    const record = this.registry.record(logicalId);
    if (!record) {
      this.push('missing-node', logicalId);
      return null;
    }
    if (isTextRecord(record)) {
      const previous = this.cache.get(logicalId);
      if (previous?.kind === 'textValue' && previous.value === record.value) return previous;
      const next = freezeText(logicalId, record.value);
      this.remember(logicalId, next);
      return next;
    }
    path.add(logicalId);
    const seenChildren = new Set<LogicalId>();
    const childIds = [...record.childIds];
    for (const extra of this.registry.adoptedChildren(logicalId)) {
      if (!childIds.includes(extra)) childIds.push(extra);
    }
    const children: OoxmlNode[] = [];
    for (const childId of childIds) {
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
      // Existence only. Decoding the child's whole record here — attributes, bindings and
      // its own child array — for every entry of every rebuilt child list is the same cost
      // as materializing it, and a cached child never needs it decoded at all.
      if (rejectDangerousKey(childId) || !this.registry.hasNode(childId)) {
        this.push('child-id-not-in-registry', childId);
        continue;
      }
      // A pass that claims subtree roots only cannot notice a second parent by placement, so
      // it asks the listings index instead: one lister means one parent, and more than one is
      // the contest that sends the whole rebuild back through a full pass to be resolved
      // deterministically. This rides inside the loop the rebuild already runs.
      if (!this.claimsWholeSubtrees && this.registry.listingParents(childId).length > 1) {
        this.placementContested = true;
      }
      const child = this.materialize(childId, placed, path, incremental);
      if (child) children.push(child);
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
      return previous;
    }
    const previousChildren = previous && previous.kind !== 'textValue' ? previous.children : [];
    this.recordDroppedChildren(previousChildren, children);
    const next = freezeElement(record, replaceChildRange(previousChildren, children), previous);
    this.remember(logicalId, next);
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
      if (!kept.has(child.id)) this.droppedChildren.add(child.id);
    }
  }

  private remember(logicalId: LogicalId, node: OoxmlNode): void {
    this.cache.set(logicalId, node);
    this.heights.delete(logicalId);
  }

  /**
   * Depth of one cached subtree, memoized.
   *
   * A rebuilt node forgets its height, and a node whose height moved is necessarily rebuilt
   * with a new identity, which rebuilds every ancestor. So a surviving entry is current.
   */
  private heightOf(node: OoxmlNode): number {
    const known = this.heights.get(node.id);
    if (known !== undefined) return known;
    let height = 1;
    if (node.kind !== 'textValue') {
      for (const child of node.children) height = Math.max(height, this.heightOf(child) + 1);
    }
    this.heights.set(node.id, height);
    return height;
  }

  private projectedRelationships(): EncodedRelationship[] {
    return mergeCustomXmlRelationships(this.registry.relationships(), this.customXmlRels);
  }

  /**
   * Project each `.rels` part from the relationship map.
   *
   * The map is the replicated source of truth. The node tree is not, because
   * `putRelationship` does not splice a Relationship child.
   */
  private projectRelsParts(parts: Map<string, OoxmlPart>): void {
    const byOwner = relationshipsByOwner(this.projectedRelationships());
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
    candidates: Iterable<LogicalId>
  ): void {
    for (const [name, part] of parts) {
      const spec = partMemberSpecFor(name, part.root);
      if (!spec) continue;
      const isMember = (record: ElementRecord): boolean =>
        record.logicalId !== part.root.id && spec.isMember(record);
      const members: OoxmlElement[] = [];
      const seen = new Set<LogicalId>();
      for (const child of part.root.children) {
        if (child.kind === 'textValue') continue;
        const record = this.registry.record(child.id);
        if (!record || !isElementRecord(record) || !isMember(record)) continue;
        members.push(child);
        seen.add(child.id);
      }
      const adopted = this.adoptLooseMembers(
        members,
        seen,
        isMember,
        placed,
        incremental,
        candidates
      );
      if (adopted === 0 && !spec.sortWithoutAdoption) continue;
      members.sort((left, right) => spec.sortKey(left).localeCompare(spec.sortKey(right)));
      const kept: OoxmlNode[] = [];
      for (const child of part.root.children) {
        if (seen.has(child.id)) continue;
        kept.push(child);
      }
      const nextChildren = replaceChildRange(part.root.children, [...kept, ...members]);
      if (nextChildren === part.root.children) continue;
      const record = this.registry.record(part.root.id);
      if (!record || !isElementRecord(record)) continue;
      const nextRoot = freezeElement(record, nextChildren, part.root);
      this.remember(part.root.id, nextRoot);
      const nextPart = Object.freeze({ ...part, root: nextRoot });
      parts.set(name, nextPart);
      this.partCache.set(name, nextPart);
    }
  }

  /**
   * Find members of this part that no live parent lists, and give them an edge back.
   *
   * `candidates` is the whole node table only on a full pass. On an incremental one it is the
   * ids that left a child array during this very pass, which is the only way a member can
   * lose its last parent — and it is why receiving a character in a document that happens to
   * have a comments part no longer reads every node key once per adoptable part.
   */
  private adoptLooseMembers(
    members: OoxmlElement[],
    seen: Set<LogicalId>,
    isMember: (record: ElementRecord) => boolean,
    placed: Set<LogicalId>,
    incremental: boolean,
    candidates: Iterable<LogicalId>
  ): number {
    let adopted = 0;
    for (const id of candidates) {
      if (placed.has(id) || seen.has(id) || this.registry.isTombstoned(id)) continue;
      // `placed` is complete only on a full pass. On an incremental one a surviving parent may
      // sit inside a subtree claimed by its root alone, so reachability has to be established
      // another way — otherwise a child that merely MOVED would be adopted into the part as a
      // second copy.
      if (incremental && this.stillListed(id)) continue;
      const record = this.registry.record(id);
      if (!record || !isElementRecord(record) || !isMember(record)) continue;
      const node = this.materialize(id, placed, new Set(), incremental);
      if (!node || node.kind === 'textValue') continue;
      members.push(node);
      seen.add(id);
      adopted += 1;
    }
    return adopted;
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
        : this.materialize(rootId, placed, new Set(), incremental);
    if (!root || root.kind === 'textValue') return null;
    const members: OoxmlNode[] = [...root.children];
    const seen = new Set(members.map((child) => child.id));
    let adopted = 0;
    for (const id of nodeIds) {
      if (seen.has(id)) continue;
      const cached = this.cache.get(id);
      if (cached && cached.kind !== 'textValue') {
        members.push(cached);
        seen.add(id);
        adopted += 1;
        continue;
      }
      const node = this.materialize(id, placed, new Set(), incremental);
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
    this.remember(rootId, nextRoot);
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
      const propsRoot = this.materialize(store.propsRootId, placed, new Set(), incremental);
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

  /**
   * Media bytes for every binary part, keyed the way the package wants them.
   *
   * The blob store returns a defensive copy on every read, and a descriptor names its bytes
   * by content digest — so a descriptor whose digest is unchanged names bytes this
   * materializer already holds. Re-reading them would copy every image in the document to
   * learn they are the same images, on every pass, which is to say on every received
   * character. The map is rebuilt each pass because a caller may own it; the payloads are
   * not, because they are addressed by their own hash.
   */
  private resolvePartBytes(): Map<string, Uint8Array> | null {
    const partBytes = new Map<string, Uint8Array>();
    const live = new Set<string>();
    for (const descriptor of this.registry.binaries()) {
      live.add(descriptor.storageKey);
      const held = this.blobBytes.get(descriptor.storageKey);
      if (held && held.digest === descriptor.digest) {
        partBytes.set(descriptor.storageKey, held.bytes);
        continue;
      }
      const bytes = this.blobs.get(descriptor.digest);
      if (!bytes) return null;
      countBlobBytes(bytes.length);
      this.blobBytes.set(descriptor.storageKey, { digest: descriptor.digest, bytes });
      partBytes.set(descriptor.storageKey, bytes);
    }
    for (const key of [...this.blobBytes.keys()]) {
      if (!live.has(key)) this.blobBytes.delete(key);
    }
    return partBytes;
  }

  private assemblePackage(parts: Map<string, OoxmlPart>): MaterializeResult {
    const relationships = this.projectedRelationships() as RelationshipRecord[];
    const set = buildRelationshipSet(relationships);
    if (!set.ok) return { ok: false, code: 'invalid-relationships', issues: [...this.issues] };
    const externalTargets: OoxmlExternalTarget[] = [];
    for (const record of relationships) {
      const resolved = resolveRelationship(record);
      if (resolved.mode === 'External') {
        externalTargets.push({
          ownerPart: record.ownerPart,
          id: record.id,
          type: record.type,
          rawTarget: record.rawTarget,
          sinkSafe: resolved.sinkSafe.ok,
        });
      }
    }
    const partBytes = this.resolvePartBytes();
    if (!partBytes) return { ok: false, code: 'missing-blob', issues: [...this.issues] };
    const overrides = new Map(this.registry.contentTypeOverrides());
    for (const [name, mediaType] of this.customXmlOverrides) overrides.set(name, mediaType);
    const contentTypes: ContentTypeIndex = {
      defaults: this.registry.contentTypeDefaults(),
      overrides,
    };
    const mainDocumentPart =
      this.registry.mainDocumentPart() ||
      [...parts.keys()].find((name) => name.endsWith('document.xml')) ||
      '';
    return {
      ok: true,
      package: Object.freeze({
        parts,
        partBytes,
        relationships: set.byOwner,
        externalTargets: Object.freeze(externalTargets),
        contentTypes,
        mainDocumentPart,
      }),
      issues: [...this.issues],
    };
  }
}
