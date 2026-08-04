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
// Kinds whose structural semantics are not implemented are REFUSED rather than approximated.
// Accepting a tracked row deletion by removing the `w:del` inside `w:trPr` would leave the row
// in the table while reporting the deletion applied, so the document would say the opposite of
// what was accepted. A refusal is visible and recoverable; that is not.

import { replaceChildren, type EditOptions } from '../package/ooxml-edit.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { isContentRevisionKind } from '../package/ooxml-shared.ts';
import { DEPENDENCY_KEY_IDS } from '../registry/frozen-ids.ts';
import type { RevisionAddress } from './tree-op-types.ts';
import type { TreeOpEffect, TreeOpRejection } from './tree-op-validate.ts';

/** What resolving does to one wrapper. */
type Resolution = 'unwrap' | 'remove' | 'restore';

/**
 * Element names that carry a revision but whose accept/reject semantics are structural and not
 * implemented in this pass.
 *
 * Every one of these needs to change the table or section around it, not just remove its own
 * markup. Until that exists they refuse; see the module header.
 */
const REFUSED_REVISION_NAMES: ReadonlySet<string> = new Set([
  'cellIns',
  'cellDel',
  'cellMerge',
  'trPrChange',
  'tcPrChange',
  'tblPrChange',
  'tblPrExChange',
  'tblGridChange',
  'sectPrChange',
]);

/** Property-change wrappers this pass does resolve: the run and paragraph property records. */
const PROPERTY_CHANGE_NAMES: ReadonlySet<string> = new Set(['rPrChange', 'pPrChange']);

/**
 * Parents that make a `w:ins`/`w:del` a STRUCTURAL revision rather than a content one.
 *
 * `w:trPr/w:del` deletes a row; `w:numPr/w:ins` inserts a numbering reference. Neither is
 * resolved by removing the element, so both refuse. `w:pPr/w:rPr` — the paragraph mark — is
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
  /** True for `w:rPrChange` / `w:pPrChange`. */
  readonly propertyChange: boolean;
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
  const author = wmlAttribute(node, 'author');
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

/**
 * Every revision-bearing element in the part, with the classification that decides whether it
 * can be resolved.
 *
 * One walk, so accept-all does not pay a traversal per revision.
 */
export function collectRevisionSites(part: OoxmlPart): RevisionSite[] {
  const sites: RevisionSite[] = [];
  const visit = (
    node: OoxmlNode,
    parent: OoxmlElement | null,
    grandparent: OoxmlElement | null
  ): void => {
    if (node.kind === 'textValue') return;
    const parentName = parent?.namespaceUri === WML_NAMESPACE_URI ? parent.localName : undefined;
    const grandparentName =
      grandparent?.namespaceUri === WML_NAMESPACE_URI ? grandparent.localName : undefined;
    if (node.namespaceUri === WML_NAMESPACE_URI) {
      const isContent = isContentRevisionKind(node.kind);
      const isNamedRevision =
        isContent ||
        REFUSED_REVISION_NAMES.has(node.localName) ||
        PROPERTY_CHANGE_NAMES.has(node.localName) ||
        node.localName === 'ins' ||
        node.localName === 'del';
      if (isNamedRevision && addressOf(node) !== null) {
        // A revision on a RUN's `w:rPr` is not schema-valid — the paragraph mark is the only
        // `w:rPr` that carries one — so it is refused rather than resolved. Treating it as a
        // paragraph mark made accepting it merge two paragraphs; treating it as ordinary
        // content would make accepting it edit a run's properties. Neither is what the file
        // says, and the file says something impossible.
        const misplacedMark =
          parentName === 'rPr' &&
          grandparentName !== 'pPr' &&
          (node.localName === 'ins' || node.localName === 'del');
        const structural =
          misplacedMark ||
          REFUSED_REVISION_NAMES.has(node.localName) ||
          (parentName !== undefined && STRUCTURAL_REVISION_PARENTS.has(parentName));
        // `w:pPr/w:rPr/w:ins` marks the paragraph mark. `w:rPr` also appears inside a run,
        // where an `ins` child is not schema-valid; treating both as a paragraph mark would
        // be wrong, so the grandparent decides.
        // ...and now it does. A `w:rPr` inside a RUN carrying a `w:del` is malformed input,
        // not a paragraph mark, and treating it as one made accepting it merge two
        // paragraphs — a silent structural edit from markup no valid file contains.
        const paragraphMark =
          !isContent && parentName === 'rPr' && grandparentName === 'pPr' && !structural;
        sites.push({
          node,
          parent,
          refused: structural,
          paragraphMark,
          propertyChange: PROPERTY_CHANGE_NAMES.has(node.localName),
        });
      }
    }
    for (const child of node.children) visit(child, node, parent);
  };
  visit(part.root, null, null);
  return sites;
}

/**
 * Named move ranges: `@w:name` → the move wrappers inside that range, by half.
 *
 * The two join keys in this family are distinct and neither substitutes for the other.
 * `@w:name` pairs a `moveFrom` RANGE with its `moveTo` RANGE; `@w:id` pairs a range START with
 * its own range END. In a real document the two halves of a named pair carry different ids.
 */
function namedMoveRanges(part: OoxmlPart): Map<string, MoveRange> {
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
  visit(part.root);
  return byName;
}

/** The `w:p` a node sits inside, by id, or null when it is not inside one. */
function paragraphOwning(part: OoxmlPart, nodeId: string): string | null {
  let found: string | null = null;
  const visit = (node: OoxmlNode, paragraphId: string | null): void => {
    if (found !== null || node.kind === 'textValue') return;
    const owner = node.kind === 'paragraph' ? node.id : paragraphId;
    if (node.id === nodeId) {
      found = owner;
      return;
    }
    for (const child of node.children) visit(child, owner);
  };
  visit(part.root, null);
  return found;
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

/**
 * The properties a change wrapper recorded, for a reject.
 *
 * `w:rPrChange` holds a `w:rPr`, `w:pPrChange` a `w:pPr`. Their children are the previous
 * state of the container the wrapper sits in.
 */
function recordedProperties(node: OoxmlElement): readonly OoxmlNode[] | null {
  const inner = node.localName === 'rPrChange' ? 'rPr' : 'pPr';
  for (const child of node.children) {
    if (child.kind === 'textValue') continue;
    if (child.namespaceUri === WML_NAMESPACE_URI && child.localName === inner)
      return child.children;
  }
  return null;
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
}

function isWmlNamed(node: OoxmlNode, localName: string): boolean {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    node.localName === localName
  );
}

/**
 * Rebuild one child list, applying every action that targets a child of THIS node.
 *
 * Separated from `rebuild` because unwrapping a wrapper has to run its children through the
 * same logic. Recursing into the child directly would skip the child's OWN action, so a
 * rejected insertion inside a rejected deletion survived: the outer unwrap consumed the inner
 * wrapper as ordinary content.
 */
function rebuildChildren(children: readonly OoxmlNode[], plan: RebuildPlan): OoxmlNode[] {
  const out: OoxmlNode[] = [];
  /** Content of paragraphs whose mark was resolved away, waiting for the paragraph after. */
  let carried: OoxmlNode[] = [];

  for (const [index, child] of children.entries()) {
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
    if (child.kind === 'paragraph') {
      const paragraph = rebuilt[0];
      if (paragraph !== undefined && paragraph.kind !== 'textValue') {
        if (carried.length > 0) {
          // This paragraph absorbs the content of the ones before it. Its own `w:pPr` stays:
          // the surviving mark is this paragraph's, so its properties govern the result.
          const properties = paragraph.children.filter((entry) => isWmlNamed(entry, 'pPr'));
          const content = paragraph.children.filter((entry) => !isWmlNamed(entry, 'pPr'));
          out.push({
            ...paragraph,
            children: [...properties, ...carried, ...content],
          } as OoxmlElement);
          carried = [];
          continue;
        }
        if (plan.mergeForward.has(child.id)) {
          // Only when there IS a following paragraph in this container. Otherwise the
          // paragraph keeps its content and simply loses the mark revision — spilling its
          // runs into `w:body` or `w:tc` produced a tree the invariants reject, so the whole
          // transaction was refused and Accept All failed for the entire document with an
          // opaque reason. Deleting a trailing paragraph with tracking on is exactly what
          // Word writes, so this was not an exotic file.
          const followed = children.slice(index + 1).some((entry) => entry.kind === 'paragraph');
          if (followed) {
            carried = paragraph.children.filter((entry) => !isWmlNamed(entry, 'pPr'));
            continue;
          }
        }
      }
    }
    out.push(...rebuilt);
  }

  // Unreachable now that the merge only starts when a paragraph follows; kept as a belt
  // against a plan built some other way, where losing the content would be silent.
  if (carried.length > 0) out.push(...carried);
  return out;
}

function rebuild(node: OoxmlNode, plan: RebuildPlan): OoxmlNode[] {
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
      // `CT_RPrChange` is the opposite case: `CT_RPrOriginal` genuinely is the whole `w:rPr`
      // content minus the change wrapper, so there wholesale replacement is correct.
      const preserved =
        restoring.localName === 'pPrChange'
          ? node.children.filter((child) => isWmlNamed(child, 'rPr') || isWmlNamed(child, 'sectPr'))
          : [];
      return [{ ...node, children: [...recorded, ...preserved] } as OoxmlElement];
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

/**
 * Resolve every site carrying `address` (or every revision in the part, when `address` is
 * absent) in one transaction.
 *
 * Refuses without touching the tree when the revision is absent, or when ANY matched site is a
 * kind this pass does not resolve. Refusing per site would leave a row half-tracked: a tracked
 * row insertion is `w:trPr/w:ins` on the row plus `w:cellIns` on every cell, all sharing one
 * triple, and resolving only the inline half is worse than resolving none.
 */
export function resolveRevisions(
  part: OoxmlPart,
  action: RevisionOpAction,
  address: RevisionAddress | undefined,
  options?: EditOptions
): RevisionResolveResult {
  const sites = collectRevisionSites(part);
  const matched = address
    ? sites.filter((site) => {
        const own = addressOf(site.node);
        return own !== null && sameRevision(own, address);
      })
    : sites;
  if (matched.length === 0) return { ok: false, reason: 'unknown-revision' };
  if (matched.some((site) => site.refused)) return { ok: false, reason: 'unsupported-revision' };

  const actions = new Map<string, Resolution>();
  const dropMarks = new Set<string>();
  const restoreProperties = new Set<string>();
  const mergeForward = new Set<string>();

  const addWrapper = (node: OoxmlElement): void => {
    actions.set(node.id, resolutionOf(node, action));
  };

  for (const site of matched) {
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
      const removesMark =
        (action === 'accept' && site.node.localName === 'del') ||
        (action === 'reject' && site.node.localName === 'ins');
      dropMarks.add(site.node.id);
      if (removesMark) {
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
    for (const [, range] of namedMoveRanges(part)) {
      if (!range.wrappers.some((wrapper) => actions.has(wrapper.id))) continue;
      for (const wrapper of range.wrappers) addWrapper(wrapper);
      // The range markers describe a move that no longer exists once it is resolved. Leaving
      // them behind would keep an empty named bookmark pair in the file, which Word removes
      // and which would pair with nothing on the next read.
      for (const marker of range.markers) dropMarks.add(marker.id);
    }
  }

  const plan: RebuildPlan = { actions, dropMarks, restoreProperties, mergeForward };
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
