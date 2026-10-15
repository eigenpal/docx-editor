// Authoring bookmarks: add a named marker pair around a range, or take one away.
//
// A bookmark is a `w:bookmarkStart` carrying the name and a `w:bookmarkEnd` closing it, paired
// by `@w:id`. Both are zero-width range markup between runs, so placing them splits a run at
// most and never moves an offset: every other position in the story stays where it was.
//
// NAMES ARE CASE-INSENSITIVE AND UNIQUE. Adding a name the part already declares, in any case,
// moves that bookmark: the old pair goes and the new one takes the name as written. Uniqueness
// across the parts of a package is the caller's half (the editor deletes the name from the
// other stories in the same package transaction), because a tree op addresses one part.
//
// A bookmark is not a revision. Its markers carry no author and no date, so adding or removing
// one in suggesting mode writes the markers directly, the way a reviewer's bookmark is added.

import {
  createNodeIdAllocator,
  findNode,
  insertChildren,
  removeNode,
} from '../package/ooxml-edit.ts';
import type { EditOptions } from '../package/ooxml-edit.ts';
import { WML_NAMESPACE_URI, type OoxmlNode, type OoxmlPart } from '../package/ooxml-tree.ts';
import { bookmarkNameKey, bookmarkNameProblem } from '../package/bookmark-names.ts';
import { bookmarkPairNodes } from '../package/toc-build.ts';
import { DEPENDENCY_KEY_IDS } from '../registry/frozen-ids.ts';
import { nextBookmarkId } from './tree-op-bookmark-ids.ts';
import { markerSiteAt } from './tree-op-comments.ts';
import { effectiveContentLockAt, isBoundAt } from './tree-op-nodes.ts';
import { paragraphOffsetIndex } from './tree-op-segments.ts';
import type { TreeOpRejection, TreeOpResult } from './tree-op-types.ts';

/** A text position in the op's part. */
export interface BookmarkOpPosition {
  readonly paragraphId: string;
  readonly offset: number;
}

/**
 * Add a bookmark around `start`..`end`, or at one point when the two are equal.
 *
 * The name must pass `bookmarkNameProblem`. A bookmark the part already declares under the
 * same name, compared without case, is removed in the same op.
 */
export interface InsertBookmarkOp {
  readonly op: 'insertBookmark';
  readonly name: string;
  readonly start: BookmarkOpPosition;
  readonly end: BookmarkOpPosition;
}

/** Remove every marker pair that declares this name, compared without case. */
export interface DeleteBookmarkOp {
  readonly op: 'deleteBookmark';
  readonly name: string;
}

export type BookmarkTreeOp = InsertBookmarkOp | DeleteBookmarkOp;

function wmlValue(node: OoxmlNode, localName: string): string | undefined {
  if (node.kind === 'textValue') return undefined;
  return node.attributes.find(
    (attribute) => attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === localName
  )?.value;
}

/**
 * The marker nodes of every bookmark this name addresses: starts with the name, and the ends
 * that carry their `@w:id`. Ends are matched by id only within this part.
 */
function markerIdsNamed(part: OoxmlPart, name: string): readonly string[] {
  const key = bookmarkNameKey(name);
  const starts: string[] = [];
  const ids = new Set<string>();
  const ends: { readonly nodeId: string; readonly markerId: string }[] = [];
  const stack: OoxmlNode[] = [part.root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.kind === 'textValue') continue;
    if (node.kind === 'bookmarkStart') {
      const named = wmlValue(node, 'name');
      const id = wmlValue(node, 'id');
      if (named !== undefined && bookmarkNameKey(named) === key) {
        starts.push(node.id);
        if (id !== undefined) ids.add(id);
      }
      continue;
    }
    if (node.kind === 'bookmarkEnd') {
      const id = wmlValue(node, 'id');
      if (id !== undefined) ends.push({ nodeId: node.id, markerId: id });
      continue;
    }
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push(node.children[index]!);
    }
  }
  return [...starts, ...ends.filter((end) => ids.has(end.markerId)).map((end) => end.nodeId)];
}

/** Document order of two paragraphs in one part: negative when `a` comes first. */
function paragraphOrder(part: OoxmlPart, a: string, b: string): number {
  if (a === b) return 0;
  const stack: OoxmlNode[] = [part.root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.kind === 'textValue') continue;
    if (node.id === a) return -1;
    if (node.id === b) return 1;
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push(node.children[index]!);
    }
  }
  return 0;
}

function validPosition(part: OoxmlPart, position: BookmarkOpPosition): TreeOpRejection | null {
  if (!position || typeof position.paragraphId !== 'string') return 'unknown-paragraph';
  const paragraph = findNode(part, position.paragraphId);
  if (!paragraph) return 'unknown-paragraph';
  if (paragraph.kind !== 'paragraph') return 'not-a-paragraph';
  if (!Number.isInteger(position.offset) || position.offset < 0) return 'offset-out-of-range';
  if (position.offset > paragraphOffsetIndex(paragraph).length) return 'offset-out-of-range';
  if (isBoundAt(part, paragraph.id)) return 'bound';
  if (effectiveContentLockAt(part, paragraph.id).content) return 'locked';
  return null;
}

/** Refuse a bookmark op before any tree work, so a refusal is a true no-op. */
export function validateBookmarkOp(part: OoxmlPart, op: BookmarkTreeOp): TreeOpRejection | null {
  if (typeof op.name !== 'string' || bookmarkNameProblem(op.name) !== null) return 'invalidArgs';
  if (op.op === 'deleteBookmark') {
    return markerIdsNamed(part, op.name).length > 0 ? null : 'invalidArgs';
  }
  const start = validPosition(part, op.start);
  if (start) return start;
  const end = validPosition(part, op.end);
  if (end) return end;
  const order = paragraphOrder(part, op.start.paragraphId, op.end.paragraphId);
  if (order > 0 || (order === 0 && op.start.offset > op.end.offset)) return 'invalid-range';
  return null;
}

/** Apply a validated bookmark op. */
export function applyBookmarkOp(
  part: OoxmlPart,
  op: BookmarkTreeOp,
  options?: EditOptions
): TreeOpResult {
  const rejection = validateBookmarkOp(part, op);
  if (rejection) return { ok: false, reason: rejection };
  const dirty = new Set<string>();
  let current = part;
  for (const nodeId of markerIdsNamed(part, op.name)) {
    const paragraph = paragraphOf(current, nodeId);
    if (paragraph) dirty.add(paragraph);
    const removed = removeNode(current, nodeId, options);
    if (!removed.ok) return { ok: false, reason: 'tree-invariant', detail: 'bookmark-remove' };
    current = removed.part;
  }
  if (op.op === 'insertBookmark') {
    const mintNode = createNodeIdAllocator(current);
    const pair = bookmarkPairNodes(mintNode, op.name, nextBookmarkId(current)());
    // The END first: placing it cannot move the start's offset, and at one point the start
    // then lands in front of it, which is the order a point bookmark is written in.
    for (const [position, node] of [
      [op.end, pair.end],
      [op.start, pair.start],
    ] as const) {
      const paragraph = findNode(current, position.paragraphId);
      if (!paragraph || paragraph.kind !== 'paragraph')
        return { ok: false, reason: 'tree-invariant' };
      const site = markerSiteAt(current, paragraph, position.offset, options);
      if (!site.ok) return site;
      const inserted = insertChildren(site.part, site.containerId, site.index, [node], options);
      if (!inserted.ok) return { ok: false, reason: 'tree-invariant', detail: 'bookmark-insert' };
      current = inserted.part;
      dirty.add(position.paragraphId);
    }
  }
  return {
    ok: true,
    part: current,
    effect: {
      dirty: [...dirty],
      created: [],
      deleted: [],
      dependencyKeys: [DEPENDENCY_KEY_IDS.story],
      // Markers add no characters and no height.
      impact: 'text-local',
    },
  };
}

/** The paragraph a node sits in, or null for a marker between blocks. */
function paragraphOf(part: OoxmlPart, nodeId: string): string | null {
  const stack: { readonly node: OoxmlNode; readonly paragraph: string | null }[] = [
    { node: part.root, paragraph: null },
  ];
  while (stack.length > 0) {
    const { node, paragraph } = stack.pop()!;
    if (node.kind === 'textValue') continue;
    const inside = node.kind === 'paragraph' ? node.id : paragraph;
    if (node.id === nodeId) return inside;
    for (const child of node.children) stack.push({ node: child, paragraph: inside });
  }
  return null;
}
