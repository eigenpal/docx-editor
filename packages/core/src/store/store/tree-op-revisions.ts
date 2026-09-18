import {
  applyCellMerge,
  rebuildRevisionTable,
  compactRevisionGrid,
} from './revision-table-rebuild.ts';
import {
  CELL_REVISION_NAMES,
  validTableRevision,
  tableRevisionTarget,
  tableRevisionContentTarget,
  tableRevisionNeighbours,
  tableRevisionRemovals,
  tableMergeDependencies,
  revisionAttribute,
} from './revision-table-plan.ts';
// Accept and reject over the canonical tree.
//
// A revision is identified by the triple `(id, author, date)` WITHIN a part, never by id alone.
// `@w:id` is `ST_DecimalNumber` on `CT_Markup` with no uniqueness constraint and no author
// scoping, so two authors' revisions may legally share an id in one part, and one logical
// revision deliberately spans many elements sharing an id. Addressing by id would merge the
// first case and could not express the second.
//
// Two rules here are load-bearing and easy to get wrong:
//
//   - CONTAINMENT governs nesting. Resolving an outer wrapper settles whether its content
//     exists; an inner revision survives exactly when the content does. Because removal takes
//     the whole subtree and unwrapping leaves it intact, the rule falls out of the rebuild
//     rather than depending on which node the walker happens to reach first.
//   - A MOVE is one decision. Accepting a `moveTo` without its `moveFrom` duplicates the
//     content, so the pair resolves together, joined by `@w:name` on the range markers.
//
// Row/cell topology and property history have separate resolution plans. Malformed
// records are refused before any mutation; historical copies never become live decisions.

import {
  createNodeIdAllocator,
  findNode,
  parentNodeOf,
  replaceChildren,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { isContentRevisionKind, isRangeMarkerKind } from '../package/ooxml-shared.ts';
import { mergeRevisionParagraphs, tableParagraphMergeTarget } from './revision-paragraph-merge.ts';
import { DEPENDENCY_KEY_IDS } from '../registry/frozen-ids.ts';
import {
  REVISION_PROPERTY_CONTAINERS,
  preservedRevisionProperty,
  validRevisionPropertyRecord,
  restoredSectionProperties,
  validNumberingRevision,
} from './revision-property-records.ts';
import { recordedProperties } from './tree-op-tracked-properties.ts';
import { scopedRevisionRoot } from './tree-op-revision-scope.ts';
import type { RevisionAddress } from './tree-op-types.ts';
import type { TreeOpEffect, TreeOpRejection } from './tree-op-validate.ts';

/** What resolving does to one wrapper. */
type Resolution = 'unwrap' | 'remove' | 'restore';

/** The shared property-history vocabulary prevents read/write classification drift. */
const PROPERTY_CHANGE_NAMES: ReadonlySet<string> = new Set(REVISION_PROPERTY_CONTAINERS.keys());

/** The two members of `EG_ParaRPrTrackChanges` that record a MOVE of the paragraph mark. */
const MARK_MOVE_NAMES: ReadonlySet<string> = new Set(['moveFrom', 'moveTo']);

/** Cheap canonical preflight for an element that may produce a review revision item. @internal */
export function isPotentialRevisionElement(node: OoxmlNode): boolean {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    (isContentRevisionKind(node.kind) ||
      MARK_MOVE_NAMES.has(node.localName) ||
      CELL_REVISION_NAMES.has(node.localName) ||
      PROPERTY_CHANGE_NAMES.has(node.localName) ||
      node.localName === 'ins' ||
      node.localName === 'del')
  );
}

/**
 * Parents that make a `w:ins`/`w:del` a STRUCTURAL revision rather than a content one.
 *
 * `w:trPr/w:del` deletes a row; `w:numPr/w:ins` inserts a numbering reference. These need
 * explicit handling rather than wrapper removal. `w:pPr/w:rPr` — the paragraph mark — is
 * absent on purpose: it is resolved, below.
 */
const STRUCTURAL_REVISION_PARENTS: ReadonlySet<string> = new Set([
  'trPr',
  'tcPr',
  'tblPr',
  'tblPrEx',
  'numPr',
  'sectPr',
]);

/** One named move range: the wrappers it covers, and the markers that delimit it. */
interface MoveRange {
  readonly wrappers: OoxmlElement[];
  readonly markers: OoxmlElement[];
}

export interface RevisionSite {
  readonly node: OoxmlElement;
  readonly parent: OoxmlElement | null;
  /** True when this site cannot be resolved and the whole op must refuse. */
  readonly refused: boolean;
  /** True for `w:pPr/w:rPr/w:ins|w:del` — the paragraph MARK, not content. */
  readonly paragraphMark: boolean;
  /** True for a supported property-history wrapper. */
  readonly propertyChange: boolean;
  /**
   * How many content-revision wrappers ENCLOSE this one, counted within its own paragraph.
   *
   * Revisions nest for real: `w:ins` wrapping `w:del` is content one reviewer added and another
   * struck, and both stay pending because each author has to be answered separately. The two
   * wrappers then cover exactly the same characters, so a range cannot tell them apart and
   * "which change is this text under" has only one honest answer — the innermost one, which is
   * the change that decides what the reader is looking at.
   *
   * Relative to the paragraph or table subtree, which is the unit the site walk memoizes. That
   * is enough and it is what keeps the memo valid: a content revision cannot enclose a
   * paragraph, and two sites can only cover one position if they are in the same paragraph.
   */
  readonly nesting: number;
}

function wmlAttribute(node: OoxmlElement, localName: string): string | undefined {
  for (const attribute of node.attributes) {
    if (attribute.localName !== localName) continue;
    if (attribute.namespaceUri !== WML_NAMESPACE_URI) continue;
    return attribute.value;
  }
  return undefined;
}

function addressOf(node: OoxmlElement): RevisionAddress | null {
  const id = wmlAttribute(node, 'id');
  const author =
    wmlAttribute(node, 'author') ?? (node.localName === 'tblGridChange' ? '' : undefined);
  if (id === undefined || author === undefined) return null;
  const date = wmlAttribute(node, 'date');
  return date === undefined ? { id, author } : { id, author, date };
}

function sameRevision(a: RevisionAddress, b: RevisionAddress): boolean {
  return a.id === b.id && a.author === b.author && (a.date ?? null) === (b.date ?? null);
}

/**
 * The key a revision is grouped under: its address PLUS the element it is written on.
 *
 * `@w:id` carries no uniqueness constraint, and Word writes one `w:date` for a whole editing
 * burst — so an insertion and a deletion can legally share all three. Grouping on the triple
 * alone showed them as one card reading `insert` with both texts concatenated, and Accept
 * then deleted the half the card said it was inserting.
 */
export function revisionGroupKey(address: RevisionAddress, localName: string): string {
  return `${localName}\u0000${address.id}\u0000${address.author}\u0000${address.date ?? ''}`;
}

/** Revision sites of one paragraph or table subtree, memoized on the immutable node. */
const subtreeSitesCache = new WeakMap<OoxmlNode, readonly RevisionSite[]>();

/**
 * Every revision-bearing element in the part, with the classification that decides whether it
 * can be resolved.
 *
 * One walk, so accept-all does not pay a traversal per revision — and paragraphs the last
 * commit did not touch are answered from {@link paragraphSitesCache} rather than re-walked.
 */
function collectRevisionSitesIn(
  part: OoxmlPart,
  scopeRootId?: string,
  retainAcrossReads = true
): RevisionSite[] {
  const sites: RevisionSite[] = [];
  const visit = (
    node: OoxmlNode,
    parent: OoxmlElement | null,
    grandparent: OoxmlElement | null,
    nesting: number
  ): void => {
    if (node.kind === 'textValue') return;
    // A PARAGRAPH's — or a TABLE's — sites depend on nothing outside it. Classification
    // reads the parent and grandparent, and every case that consults them (`w:rPr` under
    // `w:pPr`, a structural `w:trPr`/`w:tcPr` parent) is at least two levels inside the
    // memoized subtree — so the answer for that subtree is a pure function of it, and an
    // unchanged one can hand back what it said last time. Without this, a document with no
    // tracked changes at all still paid a full-tree walk per keystroke, on this path and on
    // the review queue's. Tables are memoized as a unit because their row and cell markers
    // live OUTSIDE any paragraph: a long document of tables otherwise re-walked every
    // `w:trPr`/`w:tcPr` per derivation even though only one paragraph had changed.
    if (node.kind === 'paragraph' || node.kind === 'table') {
      const cached = retainAcrossReads ? subtreeSitesCache.get(node) : undefined;
      if (cached) {
        // A plain loop, not a spread: spreading is bounded by the engine's argument-count
        // limit, and one adversarial table can legally hold more tracked markers than that
        // — the first walk would succeed and every cache hit after it would throw.
        for (const site of cached) sites.push(site);
        return;
      }
      const before = sites.length;
      // Depth restarts at the subtree the cache is keyed on, so a cached list is correct
      // wherever that node sits. Nothing is lost: a content revision cannot enclose a
      // paragraph, so a content site's depth inside its paragraph IS its depth.
      for (const child of node.children) visit(child, node, parent, 0);
      const own = sites.slice(before);
      if (retainAcrossReads) subtreeSitesCache.set(node, own);
      return;
    }
    const parentName = parent?.namespaceUri === WML_NAMESPACE_URI ? parent.localName : undefined;
    const grandparentName =
      grandparent?.namespaceUri === WML_NAMESPACE_URI ? grandparent.localName : undefined;
    if (node.namespaceUri === WML_NAMESPACE_URI) {
      const isContent = isContentRevisionKind(node.kind);
      // A mark-position `w:moveFrom`/`w:moveTo` is generic in the tree, so `isContent` misses
      // it; naming it here is what raises the card for a paragraph that was MOVED whole.
      const markMove =
        parentName === 'rPr' && grandparentName === 'pPr' && MARK_MOVE_NAMES.has(node.localName);
      // The broad preflight intentionally recognizes mark-move names anywhere so artifact scans
      // do not miss hostile markup. Resolution is narrower: only the schema-valid paragraph-mark
      // position is an actionable move decision.
      const isNamedRevision =
        isContent ||
        markMove ||
        CELL_REVISION_NAMES.has(node.localName) ||
        PROPERTY_CHANGE_NAMES.has(node.localName) ||
        node.localName === 'ins' ||
        node.localName === 'del';
      if (
        isNamedRevision &&
        (wmlAttribute(node, 'id') !== undefined || part.root.localName === 'styles')
      ) {
        // A revision on a RUN's `w:rPr` is not schema-valid — the paragraph mark is the only
        // `w:rPr` that carries one — so it is refused rather than resolved. Treating it as a
        // paragraph mark made accepting it merge two paragraphs; treating it as ordinary
        // content would make accepting it edit a run's properties. Neither is what the file
        // says, and the file says something impossible.
        const misplacedMark =
          parentName === 'rPr' &&
          grandparentName !== 'pPr' &&
          (node.localName === 'ins' || node.localName === 'del');
        const tableRevision = validTableRevision(node, parent, grandparent);
        const numberingRevision = grandparentName === 'pPr' && validNumberingRevision(node, parent);
        const structural =
          misplacedMark ||
          CELL_REVISION_NAMES.has(node.localName) ||
          (PROPERTY_CHANGE_NAMES.has(node.localName)
            ? !validRevisionPropertyRecord(node, parent)
            : parentName !== undefined && STRUCTURAL_REVISION_PARENTS.has(parentName));
        // `w:pPr/w:rPr/w:ins` marks the paragraph mark. `w:rPr` also appears inside a run,
        // where an `ins` child is not schema-valid; treating both as a paragraph mark would
        // be wrong, so the grandparent decides.
        // ...and now it does. A `w:rPr` inside a RUN carrying a `w:del` is malformed input,
        // not a paragraph mark, and treating it as one made accepting it merge two
        // paragraphs — a silent structural edit from markup no valid file contains.
        const paragraphMark =
          (!isContent || markMove) &&
          parentName === 'rPr' &&
          grandparentName === 'pPr' &&
          !structural;
        sites.push({
          node,
          parent,
          refused: addressOf(node) === null || (structural && !tableRevision && !numberingRevision),
          paragraphMark,
          propertyChange: PROPERTY_CHANGE_NAMES.has(node.localName),
          nesting,
        });
      }
      // A CHANGE RECORD'S CONTENTS ARE A COPY, NOT A DECISION. `CT_ParaRPrOriginal` admits
      // `EG_ParaRPrTrackChanges` and `CT_PPrBase` admits `w:numPr/w:ins`, so a Word-written
      // record legitimately holds revision elements — and they are the container as it WAS,
      // already answered by accepting or rejecting the record around them.
      //
      // Descending classified those copies as sites of their own. A `w:ins` inside
      // `w:pPr/w:rPr/w:rPrChange/w:rPr` has parent `rPr` and grandparent `rPrChange`, so it
      // read as a misplaced mark, and one refused site refuses the whole decision: Accept All
      // and Reject All failed for EVERY revision in a document Word had written normally,
      // with a reason no reviewer can act on.
      //
      // OUTSIDE the addressed-site branch, because a wrapper missing `@w:id` or `@w:author` is
      // still a record. `CT_TrackChange` requires the author and other generators omit it
      // anyway, so an unaddressed record is an ordinary file — and it reached the same refusal.
      if (PROPERTY_CHANGE_NAMES.has(node.localName)) return;
    }
    // Only a CONTENT wrapper deepens the count. A structural or property-change revision
    // encloses no run content, so counting it would rank an unrelated site as nested.
    const inner = isContentRevisionKind(node.kind) ? nesting + 1 : nesting;
    for (const child of node.children) visit(child, node, parent, inner);
  };
  const root = scopeRootId === undefined ? part.root : findNode(part, scopeRootId);
  if (root !== null) visit(root, null, null, 0);
  return sites;
}

/** Every revision-bearing element in the part. */
export function collectRevisionSites(part: OoxmlPart): RevisionSite[] {
  return collectRevisionSitesIn(part);
}

/** Export-only cold derivation that does not populate interactive subtree memos. @internal */
export function collectRevisionSitesTransient(part: OoxmlPart): RevisionSite[] {
  return collectRevisionSitesIn(part, undefined, false);
}

/**
 * Named move ranges: `@w:name` → the move wrappers inside that range, by half.
 *
 * The two join keys in this family are distinct and neither substitutes for the other.
 * `@w:name` pairs a `moveFrom` RANGE with its `moveTo` RANGE; `@w:id` pairs a range START with
 * its own range END. In a real document the two halves of a named pair carry different ids.
 */
export function namedMoveRanges(root: OoxmlNode): Map<string, MoveRange> {
  const byName = new Map<string, MoveRange>();
  const bucketFor = (name: string): MoveRange => {
    const existing = byName.get(name);
    if (existing) return existing;
    const created: MoveRange = { wrappers: [], markers: [] };
    byName.set(name, created);
    return created;
  };
  // Range markers and the wrappers between them are SIBLINGS, not ancestors, so this tracks
  // which named range is open as it walks each container in document order. A range end is
  // matched to its start by `@w:id`, which is the other join key in this family.
  const open: { name: string; id: string | undefined }[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    for (const child of node.children) {
      if (child.kind === 'textValue') continue;
      if (child.kind === 'moveFromRangeStart' || child.kind === 'moveToRangeStart') {
        const name = wmlAttribute(child, 'name');
        if (name !== undefined) {
          open.push({ name, id: wmlAttribute(child, 'id') });
          bucketFor(name).markers.push(child);
        }
        continue;
      }
      if (child.kind === 'moveFromRangeEnd' || child.kind === 'moveToRangeEnd') {
        const id = wmlAttribute(child, 'id');
        // Innermost matching start wins; a malformed end with no match closes the innermost
        // open range rather than being dropped, so the walk cannot leave a range open forever.
        let index = -1;
        for (let at = open.length - 1; at >= 0; at -= 1) {
          if (open[at]!.id === id) {
            index = at;
            break;
          }
        }
        const closed = index >= 0 ? open.splice(index, 1)[0] : open.pop();
        if (closed) bucketFor(closed.name).markers.push(child);
        continue;
      }
      if (child.kind === 'revisionMoveFrom' || child.kind === 'revisionMoveTo') {
        const enclosing = open[open.length - 1];
        if (enclosing !== undefined) bucketFor(enclosing.name).wrappers.push(child);
      }
      visit(child);
    }
  };
  visit(root);
  return byName;
}

/** Word preserves a named destination with no source, including its paragraph mark. */
export function orphanMoveDestinationSites(
  root: OoxmlNode,
  sites: readonly RevisionSite[]
): ReadonlySet<string> {
  const addresses = new Set<string>();
  if (!sites.some((site) => site.node.localName === 'moveTo')) return new Set();
  const ids = new Set<string>();
  for (const range of namedMoveRanges(root).values()) {
    if (range.wrappers.some((node) => node.kind === 'revisionMoveFrom')) continue;
    for (const node of range.wrappers) {
      if (node.kind !== 'revisionMoveTo') continue;
      ids.add(node.id);
      const address = addressOf(node);
      if (address) addresses.add(revisionGroupKey(address, 'moveTo'));
    }
  }
  for (const site of sites) {
    if (!site.paragraphMark || site.node.localName !== 'moveTo') continue;
    const address = addressOf(site.node);
    if (address && addresses.has(revisionGroupKey(address, 'moveTo'))) ids.add(site.node.id);
  }
  return ids;
}

/** The `w:p` a node sits inside, by id, or null when it is not inside one. */
function paragraphOwning(part: OoxmlPart, nodeId: string): string | null {
  let current = findNode(part, nodeId);
  while (current !== null) {
    if (current.kind === 'paragraph') return current.id;
    current = parentNodeOf(part, current.id);
  }
  return null;
}

function matchingRevisionSites(
  sites: readonly RevisionSite[],
  address: RevisionAddress | undefined,
  localName?: string,
  siteNodeIds?: ReadonlySet<string>
): RevisionSite[] {
  if (address === undefined && siteNodeIds === undefined) return [...sites];
  return sites.filter((site) => {
    if (siteNodeIds !== undefined && !siteNodeIds.has(site.node.id)) return false;
    if (address === undefined) return true;
    const own = addressOf(site.node);
    if (own === null || !sameRevision(own, address)) return false;
    return localName === undefined || site.node.localName === localName;
  });
}

/** Structural protection reach: node id → whether its descendant controls are removed. */
export function revisionStructuralReach(
  part: OoxmlPart,
  action: RevisionOpAction,
  address: RevisionAddress | undefined,
  options?: {
    readonly localName?: string;
    readonly scopeRootId?: string;
    readonly siteNodeIds?: readonly string[];
  }
): ReadonlyMap<string, boolean> {
  if (options?.scopeRootId !== undefined && scopedRevisionRoot(part, options.scopeRootId) === null)
    return new Map();
  const matched = matchingRevisionSites(
    collectRevisionSitesIn(part, options?.scopeRootId),
    address,
    options?.localName,
    options?.siteNodeIds === undefined ? undefined : new Set(options.siteNodeIds)
  );
  if (matched.some((site) => site.refused)) return new Map();
  const orphanDestinations = orphanMoveDestinationSites(
    options?.scopeRootId ? scopedRevisionRoot(part, options.scopeRootId)! : part.root,
    matched
  );
  const reach = new Map<string, boolean>();
  for (const id of tableRevisionNeighbours(part, matched, action).keys()) reach.set(id, false);
  const removed = new Set(tableRevisionRemovals(part, matched, action).keys());
  for (const id of removed) reach.set(id, true);
  for (const site of matched) {
    const target = tableRevisionContentTarget(part, site, action);
    if (target) reach.set(target.id, true);
  }
  for (const site of matched) {
    if (
      !site.paragraphMark ||
      orphanDestinations.has(site.node.id) ||
      !(
        (action === 'accept' && ['del', 'moveFrom'].includes(site.node.localName)) ||
        (action === 'reject' && ['ins', 'moveTo'].includes(site.node.localName))
      )
    )
      continue;
    const id = paragraphOwning(part, site.node.id);
    const container = id && parentNodeOf(part, id);
    if (!container) continue;
    const at = container.children.findIndex((n) => n.id === id);
    const next = container.children
      .slice(at + 1)
      .find(
        (n) =>
          !removed.has(n.id) &&
          (n.kind === 'paragraph' || n.kind === 'table' || n.kind === 'contentControl')
      );
    if (next) {
      const target = tableParagraphMergeTarget(next, removed);
      if (target) reach.set(target.id, false);
    }
  }
  return reach;
}

/** How one wrapper resolves, given the action. */
function resolutionOf(node: OoxmlElement, action: 'accept' | 'reject'): Resolution {
  switch (node.kind) {
    case 'revisionInsert':
    case 'revisionMoveTo':
      // Accepting keeps the content and drops the wrapper; rejecting takes both.
      return action === 'accept' ? 'unwrap' : 'remove';
    case 'revisionDelete':
    case 'revisionMoveFrom':
      // Accepting removes the content; rejecting restores it, which also turns `w:delText`
      // back into `w:t`.
      return action === 'accept' ? 'remove' : 'restore';
    default:
      return 'remove';
  }
}

function textElementFrom(node: OoxmlElement): OoxmlElement {
  return { ...node, kind: 'text', localName: 't' } as OoxmlElement;
}

/**
 * Undo the deleted forms of run content when a deletion is rejected.
 *
 * `w:delText` is the deleted form of `w:t`, and `w:delInstrText` is the deleted form of
 * `w:instrText` (`EG_RunInnerContent`, §17.3.3.7 / §17.16.23). BOTH have to be inverted.
 * Restoring the text but leaving the instruction in its deleted form outside any `w:del` means
 * Word stops reading it as an instruction: the field's code is silently lost and the field
 * never updates again.
 */
function withDeletedTextRestored(node: OoxmlNode): OoxmlNode {
  if (node.kind === 'textValue') return node;
  const children = node.children.map(withDeletedTextRestored);
  const rebuilt = children.some((child, index) => child !== node.children[index])
    ? ({ ...node, children } as OoxmlElement)
    : node;
  if (rebuilt.kind === 'deletedText') return textElementFrom(rebuilt);
  // `w:delInstrText` has no typed kind — it is layout-inert either way — so it is matched by
  // name and renamed in place.
  if (
    rebuilt.kind === 'generic' &&
    rebuilt.namespaceUri === WML_NAMESPACE_URI &&
    rebuilt.localName === 'delInstrText'
  ) {
    return { ...rebuilt, localName: 'instrText' } as OoxmlElement;
  }
  return rebuilt;
}

interface RebuildPlan {
  /** Wrapper node id → what to do with it. */
  readonly actions: ReadonlyMap<string, Resolution>;
  /** Nodes to drop outright: resolved paragraph marks and spent move-range markers. */
  readonly dropMarks: ReadonlySet<string>;
  /** Property-change wrappers, node id → restore the recorded properties into the parent. */
  readonly restoreProperties: ReadonlySet<string>;
  /**
   * Paragraphs whose mark is resolved away, so they merge with the paragraph that follows.
   *
   * Accepting `w:pPr/w:rPr/w:del` means the paragraph mark is gone, and a paragraph without
   * its mark is not a paragraph — it runs into the next one. Removing only the `w:del`
   * element would report the deletion applied while leaving two paragraphs, which is the same
   * class of error as removing a `w:trPr/w:del` and leaving the row.
   */
  readonly mergeForward: ReadonlySet<string>;
  /** Removed cells, rows, and tables, including containers emptied by this decision. */
  readonly removeStructures: ReadonlySet<string>;
  readonly mergeCells: ReadonlyMap<string, OoxmlElement>;
  readonly mint: () => string;
  readonly tables: ReadonlySet<string>;
}

/**
 * Rebuild one child list, applying every action that targets a child of THIS node.
 *
 * Separated from `rebuild` because unwrapping a wrapper has to run its children through the
 * same logic. Recursing into the child directly would skip the child's OWN action, so a
 * rejected insertion inside a rejected deletion survived: the outer unwrap consumed the inner
 * wrapper as ordinary content.
 */
/**
 * A child that marks a position rather than holding content: bookmark, comment-range and
 * move-range boundaries, permission-range boundaries, and proofing marks.
 */
function isInertMarker(node: OoxmlNode): boolean {
  if (node.kind === 'textValue') return false;
  if (node.kind === 'bookmarkStart' || node.kind === 'bookmarkEnd') return true;
  if (isRangeMarkerKind(node.kind)) return true;
  return (
    node.kind === 'generic' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    (node.localName === 'proofErr' ||
      node.localName === 'permStart' ||
      node.localName === 'permEnd')
  );
}

function rebuildChildren(children: readonly OoxmlNode[], plan: RebuildPlan): OoxmlNode[] {
  const out: OoxmlNode[] = [];
  /** Content of paragraphs whose mark was resolved away, waiting for the paragraph after. */

  for (const child of children) {
    if (child.kind !== 'textValue' && plan.removeStructures.has(child.id)) continue;
    if (child.kind !== 'textValue' && plan.dropMarks.has(child.id)) continue;
    if (child.kind !== 'textValue' && plan.restoreProperties.has(child.id)) continue;
    const action = child.kind === 'textValue' ? undefined : plan.actions.get(child.id);
    if (action === 'remove') continue;
    if (child.kind !== 'textValue' && (action === 'unwrap' || action === 'restore')) {
      // The wrapper goes; its content stays and is rebuilt under the same plan, so an inner
      // revision that survives is preserved verbatim rather than resolved on its author's
      // behalf — and one that does not survive is still resolved.
      for (const kept of rebuildChildren(child.children, plan)) {
        out.push(action === 'restore' ? withDeletedTextRestored(kept) : kept);
      }
      continue;
    }

    const rebuilt = rebuild(child, plan);
    // A run CONTAINER the resolution emptied goes with its content. A `w:fldSimple` with no
    // runs is not a field any more — striking a simple field puts the `w:del` INSIDE it, since
    // `CT_RunTrackChange` takes `EG_ContentRunContent` and that has no `fldSimple` in it, so
    // accepting leaves a hollow one still occupying the model position the reviewer agreed to
    // remove. A `w:hyperlink` with no runs is a link to nowhere holding a relationship alive.
    // Word drops both, and an untracked delete over the same range already does.
    //
    const survivor = rebuilt[0];
    const hollow =
      rebuilt.length === 1 && survivor !== undefined && survivor.kind !== 'textValue'
        ? survivor
        : null;
    if ((child.kind === 'fldSimple' || child.kind === 'hyperlink') && hollow?.children.length === 0)
      continue;
    // A revision wrapper the resolution emptied goes the same way. Accepting one author's
    // deletion of another author's insertion removes the deleted runs and leaves the `w:ins`
    // holding no characters to decide about — yet it carded as a blank entry and kept the
    // document reporting tracked changes. "Emptied" means no CONTENT left: Word writes
    // bookmark, comment-range and proofing markers directly inside a wrapper, and a wrapper
    // reduced to those is as hollow as one with nothing. The markers themselves are hoisted,
    // not dropped, because each pairs with a counterpart elsewhere. Move halves sweep too: the
    // range markers are siblings of the wrapper, so the other half still resolves by name.
    // Only a wrapper THIS resolution emptied is swept — one that arrived empty is not this
    // decision's to remove.
    if (
      hollow !== null &&
      child.kind !== 'textValue' &&
      isContentRevisionKind(child.kind) &&
      child.children.some((entry) => !isInertMarker(entry)) &&
      hollow.children.every(isInertMarker)
    ) {
      for (const marker of hollow.children) out.push(marker);
      continue;
    }
    out.push(...rebuilt);
  }

  return mergeRevisionParagraphs(out, plan.mergeForward);
}

function rebuild(node: OoxmlNode, plan: RebuildPlan): OoxmlNode[] {
  const rebuilt = rebuildNode(node, plan);
  return rebuilt.map((result) => {
    if (result.kind === 'textValue') return result;
    if (result.kind === 'table') {
      return plan.tables.has(result.id)
        ? compactRevisionGrid(
            rebuildRevisionTable(
              node as OoxmlElement,
              result,
              plan.removeStructures,
              plan.mint,
              plan.mergeCells,
              plan.restoreProperties
            ),
            plan.mint
          )
        : result;
    }
    const merge = plan.mergeCells.get(result.id);
    if (merge) result = applyCellMerge(result, revisionAttribute(merge, 'vMerge'), plan.mint);
    if (
      result.kind === 'tableCell' &&
      !result.children.some(
        (child) =>
          child.kind === 'paragraph' || child.kind === 'table' || child.kind === 'contentControl'
      )
    ) {
      return {
        ...result,
        children: [
          ...result.children,
          {
            ...result,
            id: plan.mint(),
            kind: 'paragraph',
            localName: 'p',
            attributes: [],
            children: [],
          },
        ],
      } as OoxmlElement;
    }
    return result;
  });
}

function rebuildNode(node: OoxmlNode, plan: RebuildPlan): OoxmlNode[] {
  if (node.kind === 'textValue') return [node];

  // A property-change reject replaces the CONTAINER's children with what the wrapper recorded,
  // so it is handled by the container rather than by the wrapper itself.
  const restoring = node.children.find(
    (child) => child.kind !== 'textValue' && plan.restoreProperties.has(child.id)
  );
  if (restoring !== undefined && restoring.kind !== 'textValue') {
    const recorded = recordedProperties(restoring);
    if (recorded !== null) {
      // `CT_PPrChange` records a `CT_PPrBase`, which BY CONSTRUCTION cannot contain `w:rPr` or
      // `w:sectPr` — `CT_PPr` is `CT_PPrBase`, then `w:rPr`, then `w:sectPr`, then the change
      // wrapper. Replacing the container wholesale therefore deletes both. Losing `w:sectPr`
      // deletes a SECTION BREAK: page size, margins and per-section header/footer references
      // go with it, and every following paragraph reflows into the previous section.
      //
      // `CT_RPrChange` is nearly the opposite case: `CT_RPrOriginal` genuinely is the whole
      // `w:rPr` content minus the change wrapper, so wholesale replacement is right — EXCEPT
      // on a paragraph MARK, whose `w:pPr/w:rPr` also holds `EG_ParaRPrTrackChanges`. Those
      // are somebody's pending decision about the paragraph BREAK, and it may have been taken
      // after this format change was proposed. Restoring the container from the record alone
      // deleted them, so rejecting a formatting suggestion silently answered an unrelated one.
      //
      // The LIVE ones win and the recorded copies are dropped. Both halves are load-bearing:
      // `CT_ParaRPrOriginal` admits `w:ins`, so a Word-written record legitimately carries one,
      // and keeping both emits two `w:ins` in a container whose schema allows one — a `w:pPr`
      // Word reports as unreadable. A run's own `w:rPr` holds no such children either way.
      //
      // THE PRESERVED CHILDREN GO THROUGH THE PLAN. They are live sites, not copies: THIS
      // resolution may also be removing one of them, and lifting them out verbatim made
      // Reject All report success over a paragraph-mark revision it had just been asked to
      // reject — the reviewer saw an empty pane and a tracked change still in the file.
      const preserved = rebuildChildren(
        node.children.filter((child) => preservedRevisionProperty(restoring.localName, child)),
        plan
      );
      let base = recorded.filter((child) => !preservedRevisionProperty(restoring.localName, child));
      if (restoring.localName === 'sectPrChange')
        base = restoredSectionProperties(
          node.children.filter(
            (child) =>
              child.id !== restoring.id && !preservedRevisionProperty(restoring.localName, child)
          ),
          base
        );
      const children =
        restoring.localName === 'rPrChange' || restoring.localName === 'sectPrChange'
          ? [...preserved, ...base]
          : [...base, ...preserved];
      return [{ ...node, children } as OoxmlElement];
    }
  }

  return [{ ...node, children: rebuildChildren(node.children, plan) } as OoxmlElement];
}

export type RevisionOpAction = 'accept' | 'reject';

export interface RevisionResolveResult {
  readonly ok: boolean;
  readonly reason?: TreeOpRejection;
  readonly part?: OoxmlPart;
  readonly effect?: TreeOpEffect;
}

interface RevisionResolutionOperation {
  readonly revision?: RevisionAddress;
  readonly localName?: string;
  readonly siteNodeIds?: readonly string[];
  readonly scopeRootId?: string;
}

/** Adapt one revision tree operation to the shared resolver. */
export function resolveRevisionOperation(
  part: OoxmlPart,
  action: RevisionOpAction,
  operation: RevisionResolutionOperation,
  options?: EditOptions
): RevisionResolveResult {
  return resolveRevisions(part, action, operation.revision, {
    ...options,
    ...(operation.localName === undefined ? {} : { localName: operation.localName }),
    ...(operation.siteNodeIds === undefined ? {} : { siteNodeIds: operation.siteNodeIds }),
    ...(operation.scopeRootId === undefined ? {} : { scopeRootId: operation.scopeRootId }),
  });
}

/**
 * Resolve every site carrying `address` (or every revision in the part, when `address` is
 * absent) in one transaction.
 *
 * Refuses without touching the tree when the revision is absent, or when ANY matched site is a
 * kind this pass does not resolve. A shared revision address is atomic: resolving only its
 * supported sites would falsely report that the whole decision had been applied.
 */
export function resolveRevisions(
  part: OoxmlPart,
  action: RevisionOpAction,
  address: RevisionAddress | undefined,
  options?: EditOptions & {
    readonly localName?: string;
    readonly scopeRootId?: string;
    readonly siteNodeIds?: readonly string[];
  }
): RevisionResolveResult {
  const scopeRoot =
    options?.scopeRootId === undefined ? part.root : scopedRevisionRoot(part, options.scopeRootId);
  if (scopeRoot === null || scopeRoot.kind === 'textValue') {
    return { ok: false, reason: 'invalid-property-value' };
  }
  const sites = collectRevisionSitesIn(part, options?.scopeRootId);
  const matched = matchingRevisionSites(
    sites,
    address,
    options?.localName,
    options?.siteNodeIds === undefined ? undefined : new Set(options.siteNodeIds)
  );
  if (matched.length === 0) return { ok: false, reason: 'unknown-revision' };
  const selected = new Set(matched.map((site) => site.node.id));
  const mergeIds = new Set(
    sites.filter((site) => site.node.localName === 'cellMerge').map((site) => site.node.id)
  );
  if (
    mergeIds.size &&
    tableMergeDependencies({ ...part, root: scopeRoot }).some(
      (group) =>
        group.some((id) => mergeIds.has(id)) &&
        group.some((id) => selected.has(id)) &&
        group.some((id) => !selected.has(id))
    )
  )
    return { ok: false, reason: 'unsupported-revision' };
  if (
    matched.some(
      (site) =>
        site.refused ||
        (action === 'reject' && site.propertyChange && recordedProperties(site.node) === null)
    )
  )
    return { ok: false, reason: 'unsupported-revision' };

  const orphanDestinations = orphanMoveDestinationSites(scopeRoot, sites);
  const actions = new Map<string, Resolution>();
  const dropMarks = new Set<string>();
  const restoreProperties = new Set<string>();
  const mergeForward = new Set<string>();
  const removeStructures = new Set(tableRevisionRemovals(part, matched, action).keys());
  const mergeCells = new Map<string, OoxmlElement>();
  const tables = new Set<string>();
  for (const site of matched) {
    if (
      !tableRevisionTarget(part, site) &&
      !(
        site.propertyChange &&
        !['rPrChange', 'pPrChange', 'sectPrChange'].includes(site.node.localName)
      )
    )
      continue;
    let ancestor = site.parent;
    while (ancestor) {
      if (ancestor.kind === 'table') {
        tables.add(ancestor.id);
        break;
      }
      ancestor = parentNodeOf(part, ancestor.id);
    }
  }

  const addWrapper = (node: OoxmlElement): void => {
    actions.set(node.id, orphanDestinations.has(node.id) ? 'unwrap' : resolutionOf(node, action));
  };

  for (const site of matched) {
    if (tableRevisionTarget(part, site)) {
      dropMarks.add(site.node.id);
      if (site.node.localName === 'cellMerge' && site.parent) {
        const value = revisionAttribute(site.node, action === 'accept' ? 'vMerge' : 'vMergeOrig');
        mergeCells.set(tableRevisionTarget(part, site)!.id, {
          ...site.node,
          attributes: site.node.attributes
            .filter((attribute) => attribute.localName !== 'vMerge')
            .concat(
              value === undefined
                ? []
                : [
                    {
                      kind: 'genericExtension' as const,
                      namespaceUri: WML_NAMESPACE_URI,
                      prefix: site.node.prefix,
                      localName: 'vMerge',
                      value,
                    },
                  ]
            ),
        });
      }
      continue;
    }
    if (site.propertyChange) {
      // Accepting keeps the current properties and drops the record; rejecting puts the
      // recorded properties back.
      if (action === 'accept') dropMarks.add(site.node.id);
      else restoreProperties.add(site.node.id);
      continue;
    }
    if (site.paragraphMark) {
      // `w:pPr/w:rPr/w:ins|w:del` marks the paragraph MARK itself, which is how Word records a
      // split or a merge. Accepting a deleted mark, or rejecting an inserted one, removes the
      // mark — and the paragraph then runs into the one after it. Removing only the element
      // would report the decision applied while leaving the split in place.
      // `moveFrom` and `moveTo` are the same two decisions under another name: accepting a
      // move removes the mark the paragraph left, rejecting one removes the mark it arrived
      // at. Both then run the paragraph into the one after it, exactly as `del`/`ins` do.
      const removesMark =
        (action === 'accept' &&
          (site.node.localName === 'del' || site.node.localName === 'moveFrom')) ||
        (action === 'reject' &&
          (site.node.localName === 'ins' || site.node.localName === 'moveTo'));
      dropMarks.add(site.node.id);
      if (removesMark && !orphanDestinations.has(site.node.id)) {
        const paragraph = paragraphOwning(part, site.node.id);
        if (paragraph === null) return { ok: false, reason: 'unsupported-revision' };
        mergeForward.add(paragraph);
      }
      continue;
    }
    addWrapper(site.node);
  }

  // A move resolves as a pair. Pull in every wrapper sharing a `@w:name` with a matched half,
  // so accepting the `moveTo` alone — which duplicates the content — is unreachable.
  const movesMatched = matched.filter(
    (site) => site.node.kind === 'revisionMoveFrom' || site.node.kind === 'revisionMoveTo'
  );
  if (movesMatched.length > 0) {
    for (const [, range] of namedMoveRanges(scopeRoot)) {
      if (!range.wrappers.some((wrapper) => actions.has(wrapper.id))) continue;
      for (const wrapper of range.wrappers) addWrapper(wrapper);
      // The range markers describe a move that no longer exists once it is resolved. Leaving
      // them behind would keep an empty named bookmark pair in the file, which Word removes
      // and which would pair with nothing on the next read.
      for (const marker of range.markers) dropMarks.add(marker.id);
    }
  }

  const plan: RebuildPlan = {
    actions,
    dropMarks,
    restoreProperties,
    mergeForward,
    removeStructures,
    mergeCells,
    tables,
    mint: createNodeIdAllocator(part),
  };
  const rebuilt = rebuild(part.root, plan);
  const root = rebuilt[0];
  if (rebuilt.length !== 1 || root === undefined || root.kind === 'textValue') {
    return { ok: false, reason: 'tree-invariant' };
  }
  const replaced = replaceChildren(part, part.root.id, root.children, options);
  if (!replaced.ok) {
    return { ok: false, reason: 'tree-invariant' };
  }
  return {
    ok: true,
    part: replaced.part,
    effect: {
      dirty: [],
      created: [],
      deleted: [],
      // Resolving a revision can remove a paragraph's entire content and re-flow every page
      // after it, so it is never narrower than a structural change.
      dependencyKeys: [DEPENDENCY_KEY_IDS.story],
      impact: 'flow-structural',
    },
  };
}

export type { RevisionAddress };
