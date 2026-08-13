// Bounded, owner-aware walks for comment deletion.
//
// Marker remaining-scans, thread metadata, and comments-part indexing all walk
// attacker-controlled XML. A part-count cap is not enough: one hostile part can hold
// millions of nodes. Every walk here shares a visited-node + part budget; overflow is
// truncated, never an unbounded finish.

import { resolveInternalTarget } from './opc-names.ts';
import { relationshipsOf, resolveContentTypeOf } from './package-edit.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from './ooxml-tree.ts';

/** The `w15` namespace: `commentsExtended.xml` — `w15:commentEx`. */
export const W15_NAMESPACE_URI = 'http://schemas.microsoft.com/office/word/2012/wordml';
/** The `w16cid` namespace: `@parentId` on `w:comment`, and `commentsIds.xml`. */
export const W16CID_NAMESPACE_URI = 'http://schemas.microsoft.com/office/word/2016/wordml/cid';

export const COMMENTS_PART = '/word/comments.xml';
export const COMMENTS_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml';
const COMMENTS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const COMMENTS_EXTENDED_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml';
const COMMENTS_EXTENDED_REL =
  'http://schemas.microsoft.com/office/2011/relationships/commentsExtended';
const COMMENTS_IDS_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsIds+xml';
const COMMENTS_IDS_REL = 'http://schemas.microsoft.com/office/2016/relationships/commentsIds';

/** Cap on XML parts walked in one remaining-marker / vanished-note scan. */
export const MAX_COMMENT_SCAN_PARTS = 512;
/** Cap on nodes visited in one deletion/reap scan. */
export const MAX_COMMENT_SCAN_VISITED = 50_000;
const MAX_DEPTH = 64;

/** Mutable visited-node + part budget shared across one deletion or reap. */
export interface CommentScanBudget {
  visited: number;
  readonly maxVisited: number;
  parts: number;
  readonly maxParts: number;
  truncated: boolean;
}

/** A fresh budget. Tests pass tighter caps; production uses the module defaults. */
export function createCommentScanBudget(
  maxVisited: number = MAX_COMMENT_SCAN_VISITED,
  maxParts: number = MAX_COMMENT_SCAN_PARTS
): CommentScanBudget {
  return { visited: 0, maxVisited, parts: 0, maxParts, truncated: false };
}

export function chargeVisit(budget: CommentScanBudget): boolean {
  if (budget.visited >= budget.maxVisited) {
    budget.truncated = true;
    return false;
  }
  budget.visited += 1;
  return true;
}

export function chargePart(budget: CommentScanBudget): boolean {
  if (budget.parts >= budget.maxParts) {
    budget.truncated = true;
    return false;
  }
  budget.parts += 1;
  return true;
}

/**
 * Walk `root` charging every node. `visit` returning true skips children (a found marker,
 * a comment record). `onText` sees `textValue` nodes so covering can count content without a
 * second walk. Returns false when the budget truncates.
 */
export function walkCharged(
  root: OoxmlNode,
  budget: CommentScanBudget,
  visit: (node: OoxmlElement) => boolean,
  depth = 0,
  onText?: (value: string) => void
): boolean {
  if (!chargeVisit(budget)) return false;
  if (root.kind === 'textValue') {
    onText?.(root.value);
    return true;
  }
  if (depth > MAX_DEPTH) return true;
  if (visit(root)) return true;
  for (const child of root.children) {
    if (!walkCharged(child, budget, visit, depth + 1, onText)) return false;
  }
  return true;
}

export function attribute(
  node: OoxmlElement,
  namespaceUri: string,
  localName: string
): string | undefined {
  for (const entry of node.attributes) {
    if (entry.localName === localName && entry.namespaceUri === namespaceUri) return entry.value;
  }
  return undefined;
}

/** A related part of the given type, or null. Wrong types and unsafe targets are skipped. */
export function relatedTypedPart(
  pkg: OoxmlPackage,
  fromPartName: string,
  relationshipType: string,
  contentType: string
): string | null {
  for (const record of relationshipsOf(pkg, fromPartName)) {
    if (record.type !== relationshipType) continue;
    const resolved = resolveInternalTarget(fromPartName, record.rawTarget);
    if (!resolved.ok) continue;
    if (!pkg.parts.has(resolved.partName)) continue;
    if (resolveContentTypeOf(pkg, resolved.partName) === contentType) return resolved.partName;
  }
  return null;
}

/**
 * The comments part this story names, when it exists and really is one.
 *
 * Conventional `/word/comments.xml` is used only when no usable relationship exists AND the
 * part's content type is the comments type. A present wrong-typed part is not a comments part.
 */
export function commentsPartNameForStory(pkg: OoxmlPackage, storyPartName: string): string | null {
  const related = relatedTypedPart(pkg, storyPartName, COMMENTS_REL, COMMENTS_TYPE);
  if (related !== null) return related;
  if (!pkg.parts.has(COMMENTS_PART)) return null;
  return resolveContentTypeOf(pkg, COMMENTS_PART) === COMMENTS_TYPE ? COMMENTS_PART : null;
}

/**
 * commentsExtended / commentsIds related from the story or from its comments part.
 *
 * No conventional-name fallback: a header with its own comments part must not inherit the
 * body's `commentsExtended.xml` when paraIds collide.
 */
export function metadataPartNamesFor(
  pkg: OoxmlPackage,
  storyPartName: string,
  commentsPartName: string | null
): { readonly extended: string | null; readonly ids: string | null } {
  const from = (rel: string, type: string): string | null => {
    const viaStory = relatedTypedPart(pkg, storyPartName, rel, type);
    if (viaStory !== null) return viaStory;
    if (commentsPartName === null || commentsPartName === storyPartName) return null;
    return relatedTypedPart(pkg, commentsPartName, rel, type);
  };
  return {
    extended: from(COMMENTS_EXTENDED_REL, COMMENTS_EXTENDED_TYPE),
    ids: from(COMMENTS_IDS_REL, COMMENTS_IDS_TYPE),
  };
}

export interface CommentRecord {
  readonly partName: string;
  readonly node: OoxmlElement;
}

/** `w:comment` records in one comments part. Truncation is on the budget. */
export function commentRecordsIn(
  pkg: OoxmlPackage,
  partName: string,
  budget: CommentScanBudget
): Map<string, CommentRecord> {
  const byId = new Map<string, CommentRecord>();
  const part = pkg.parts.get(partName);
  if (!part || !chargePart(budget)) return byId;
  walkCharged(part.root, budget, (node) => {
    if (node.kind !== 'comment') return false;
    const id = attribute(node, WML_NAMESPACE_URI, 'id');
    if (id !== undefined && !byId.has(id)) byId.set(id, { partName: part.name, node });
    return true;
  });
  return byId;
}

export interface KeyedMetadataEntry {
  readonly partName: string;
  readonly node: OoxmlElement;
}

/** `w15:commentEx` / `w16cid:commentId` in the named metadata parts only. */
export function keyedMetadataIn(
  pkg: OoxmlPackage,
  partNames: readonly (string | null)[],
  budget: CommentScanBudget
): KeyedMetadataEntry[] {
  const entries: KeyedMetadataEntry[] = [];
  const seen = new Set<string>();
  for (const partName of partNames) {
    if (partName === null || seen.has(partName)) continue;
    seen.add(partName);
    const part = pkg.parts.get(partName);
    if (!part || !chargePart(budget)) continue;
    walkCharged(part.root, budget, (node) => {
      const keyed =
        (node.namespaceUri === W15_NAMESPACE_URI && node.localName === 'commentEx') ||
        (node.namespaceUri === W16CID_NAMESPACE_URI && node.localName === 'commentId');
      if (!keyed) return false;
      entries.push({ partName: part.name, node });
      return true;
    });
  }
  return entries;
}

/**
 * Comment ids that still have a marker in a story that uses `commentsPartName`.
 *
 * A header with its own comments part can reuse `w:id` 1; that marker does not keep the
 * body's `w:comment`. `ignoreRoot` is the owner story about to lose its markers — those
 * hits must not keep the record. Truncation fails closed: every queried id is treated as
 * still marked.
 */
export function idsStillMarked(
  pkg: OoxmlPackage,
  commentIds: ReadonlySet<string>,
  commentsPartName: string | null,
  budget: CommentScanBudget,
  ignoreRoot?: OoxmlNode | null
): { readonly marked: ReadonlySet<string>; readonly truncated: boolean } {
  const still = new Set<string>();
  if (commentIds.size === 0) return { marked: still, truncated: budget.truncated };
  for (const part of pkg.parts.values()) {
    if (!part.name.endsWith('.xml')) continue;
    if (!chargePart(budget)) {
      return { marked: commentIds, truncated: true };
    }
    if (ignoreRoot != null && ignoreRoot === part.root) continue;
    const finished = walkCharged(part.root, budget, (node) => {
      if (ignoreRoot != null && node === ignoreRoot) return true;
      if (
        node.kind !== 'commentRangeStart' &&
        node.kind !== 'commentRangeEnd' &&
        node.kind !== 'commentReference'
      ) {
        return false;
      }
      const id = attribute(node, WML_NAMESPACE_URI, 'id');
      if (id === undefined || !commentIds.has(id)) return true;
      if (commentsPartNameForStory(pkg, part.name) === commentsPartName) still.add(id);
      return true;
    });
    if (!finished) return { marked: commentIds, truncated: true };
    if (still.size === commentIds.size) return { marked: still, truncated: false };
  }
  return { marked: still, truncated: budget.truncated };
}

export interface MarkerHits {
  readonly doomed: string[];
  readonly emptiedRuns: string[];
  readonly truncated: boolean;
}

/** Markers (and emptied reference-only runs) naming `commentIds` under `root`. */
export function collectOwnerMarkers(
  root: OoxmlNode,
  commentIds: ReadonlySet<string>,
  budget: CommentScanBudget
): MarkerHits {
  const doomed: string[] = [];
  const emptiedRuns: string[] = [];
  const finished = walkCharged(root, budget, (node) => {
    if (
      node.kind === 'commentRangeStart' ||
      node.kind === 'commentRangeEnd' ||
      node.kind === 'commentReference'
    ) {
      const id = attribute(node, WML_NAMESPACE_URI, 'id');
      if (id !== undefined && commentIds.has(id)) doomed.push(node.id);
      return true;
    }
    if (node.kind === 'run') {
      const survivors = node.children.filter(
        (child) =>
          !(
            child.kind === 'commentReference' &&
            commentIds.has(attribute(child, WML_NAMESPACE_URI, 'id') ?? '')
          ) && child.kind !== 'runProperties'
      );
      if (
        survivors.length === 0 &&
        node.children.some((child) => child.kind === 'commentReference')
      ) {
        emptiedRuns.push(node.id);
        return true;
      }
    }
    return false;
  });
  return { doomed, emptiedRuns, truncated: !finished || budget.truncated };
}

/** What one owner root still says about each comment's markers. */
export interface OwnerAnchorState {
  readonly covering: boolean;
  readonly paired: boolean;
  readonly anyMarker: boolean;
}

/**
 * Pair start/end in document order under `root` and count content units between them.
 *
 * One charged walk: no per-note re-filter of a full-part anchor list. Truncation is on the
 * budget; callers must not treat a partial map as complete.
 */
export function collectOwnerAnchorStates(
  root: OoxmlNode,
  budget: CommentScanBudget
): { readonly states: Map<string, OwnerAnchorState>; readonly truncated: boolean } {
  const states = new Map<string, OwnerAnchorState>();
  const openUnits = new Map<string, number>();
  let units = 0;
  const note = (id: string, covering: boolean, paired: boolean): void => {
    const previous = states.get(id);
    states.set(id, {
      covering: covering || (previous?.covering ?? false),
      paired: paired || (previous?.paired ?? false),
      anyMarker: true,
    });
  };
  const finished = walkCharged(
    root,
    budget,
    (node) => {
      if (node.kind === 'commentRangeStart') {
        const id = attribute(node, WML_NAMESPACE_URI, 'id');
        if (id !== undefined) {
          openUnits.set(id, units);
          note(id, false, false);
        }
        return true;
      }
      if (node.kind === 'commentRangeEnd') {
        const id = attribute(node, WML_NAMESPACE_URI, 'id');
        if (id !== undefined) {
          const opened = openUnits.get(id);
          openUnits.delete(id);
          note(id, opened !== undefined && units > opened, opened !== undefined);
        }
        return true;
      }
      if (node.kind === 'commentReference') {
        const id = attribute(node, WML_NAMESPACE_URI, 'id');
        if (id !== undefined) note(id, false, false);
        return true;
      }
      if (
        node.kind === 'tab' ||
        node.kind === 'hardBreak' ||
        node.kind === 'noteReference' ||
        node.kind === 'drawing'
      ) {
        units += 1;
        return true;
      }
      return false;
    },
    0,
    (value) => {
      units += value.length;
    }
  );
  return { states, truncated: !finished || budget.truncated };
}
