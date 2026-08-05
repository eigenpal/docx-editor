// Removing a comment, and reaping the ones an edit emptied.
//
// A comment is spread over three places: the `w:comment` body in `comments.xml`, the
// `w15:commentEx` thread record in `commentsExtended.xml`, and the
// `w:commentRangeStart`/`w:commentRangeEnd`/`w:commentReference` markers in whichever story it
// annotates. Removing one of the three leaves the file describing a remark that is half there —
// a body no marker points at, or markers naming a comment the package cannot resolve — so all
// of it goes together, as ONE package edit and therefore one undo step.
//
// A THREAD, not one remark, for the same reason `setCommentResolved` resolves a thread: a reply
// whose parent is gone has nothing left to answer, and Word deletes the conversation.
//
// The REAPING half exists because deleting text is how a comment usually dies. Word deletes a
// comment when the words it covered are deleted, and this engine used to keep the record: the
// rail went on drawing a card with an author, a date and nothing under it, and saving produced a
// file whose comment pointed at characters that no longer existed. The test is deliberately
// narrow — a comment that COVERED characters before the edit and covers none after it — so a
// comment the file itself shipped orphaned is left exactly as it was found, and an edit that
// merely shortens a range does not take the remark with it.

import { findNode, removeNode } from './ooxml-edit.ts';
import { withPart, type OoxmlPackage } from './ooxml-package.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from './ooxml-tree.ts';
import { commentAnchorsOfStory, W15_NAMESPACE_URI } from '../store/comment-reads.ts';

/** The `w14` namespace, where `paraId` lives — the key thread state is recorded under. */
const W14_NAMESPACE_URI = 'http://schemas.microsoft.com/office/word/2010/wordml';

/** The `w16cid` namespace: `@parentId` on `w:comment`, and the `commentsIds.xml` vocabulary. */
const W16CID_NAMESPACE_URI = 'http://schemas.microsoft.com/office/word/2016/wordml/cid';

/**
 * Parts scanned for anchors in one reap.
 *
 * A cap rather than a walk of everything: the package is attacker-controlled, and the reap runs
 * inside a transaction the user is waiting on. Overflow fails CLOSED — the cascade reports
 * failure rather than deleting comments it only half looked for.
 */
const MAX_SCANNED_PARTS = 512;

function attribute(
  node: OoxmlElement,
  namespaceUri: string,
  localName: string
): string | undefined {
  for (const entry of node.attributes) {
    if (entry.localName === localName && entry.namespaceUri === namespaceUri) return entry.value;
  }
  return undefined;
}

/** Every `.xml` part, bounded. Null when the package holds more than the reap will look at. */
function scannableParts(pkg: OoxmlPackage): readonly OoxmlPart[] | null {
  const parts: OoxmlPart[] = [];
  for (const part of pkg.parts.values()) {
    if (!part.name.endsWith('.xml')) continue;
    if (parts.length >= MAX_SCANNED_PARTS) return null;
    parts.push(part);
  }
  return parts;
}

/**
 * Comment ids whose range COVERS characters, across every story in the package.
 *
 * Zero-width counts as covering nothing. That is the whole test: `addComment` refuses a
 * collapsed caret, so a range this engine wrote always had characters in it, and one that has
 * none now is one an edit emptied.
 */
function coveredCommentIds(pkg: OoxmlPackage): Set<string> | null {
  const parts = scannableParts(pkg);
  if (parts === null) return null;
  const covered = new Set<string>();
  for (const part of parts) {
    for (const anchor of commentAnchorsOfStory(part)) {
      if (anchor.orphaned) continue;
      if (
        anchor.start.paragraphId === anchor.end.paragraphId &&
        anchor.start.offset === anchor.end.offset
      ) {
        continue;
      }
      covered.add(anchor.commentId);
    }
  }
  return covered;
}

/** Every `w:comment` in the package, by `@w:id`, with the part it lives in. */
function commentRecords(
  pkg: OoxmlPackage
): Map<string, { readonly partName: string; readonly node: OoxmlElement }> {
  const byId = new Map<string, { partName: string; node: OoxmlElement }>();
  for (const part of pkg.parts.values()) {
    if (!part.name.endsWith('.xml')) continue;
    const visit = (node: OoxmlNode, depth: number): void => {
      if (node.kind === 'textValue' || depth > 64) return;
      if (node.kind === 'comment') {
        const id = attribute(node, WML_NAMESPACE_URI, 'id');
        if (id !== undefined && !byId.has(id)) byId.set(id, { partName: part.name, node });
        return;
      }
      for (const child of node.children) visit(child, depth + 1);
    };
    visit(part.root, 0);
  }
  return byId;
}

/** The `w14:paraId` of a comment's first paragraph, upper-cased, when it has one. */
function paraIdOf(comment: OoxmlElement): string | null {
  for (const child of comment.children) {
    if (child.kind !== 'paragraph') continue;
    const value = attribute(child, W14_NAMESPACE_URI, 'paraId');
    return value === undefined ? null : value.toUpperCase();
  }
  return null;
}

/**
 * A comment and every comment that answers it, transitively.
 *
 * Both thread sources are followed, because a file may carry either: `@w15:paraIdParent` in
 * `commentsExtended.xml`, keyed by `w14:paraId`, and `@w16cid:parentId` naming the parent's
 * `w:id` outright. Walking one alone left a reply behind whenever the producer used the other.
 * Coincident anchors are deliberately NOT followed: an independent remark on the same words is
 * shown as a reply, but it is not one, and deleting the first must not delete the second.
 */
function threadOf(pkg: OoxmlPackage, rootId: string): Set<string> {
  const records = commentRecords(pkg);
  const idByParaId = new Map<string, string>();
  for (const [id, record] of records) {
    const paraId = paraIdOf(record.node);
    if (paraId !== null) idByParaId.set(paraId, id);
  }

  const childrenOf = new Map<string, string[]>();
  const link = (parentId: string, childId: string): void => {
    if (parentId === childId) return;
    const bucket = childrenOf.get(parentId);
    if (bucket) bucket.push(childId);
    else childrenOf.set(parentId, [childId]);
  };
  for (const [id, record] of records) {
    const named = attribute(record.node, W16CID_NAMESPACE_URI, 'parentId');
    if (named !== undefined && records.has(named)) link(named, id);
  }
  for (const entry of extendedEntries(pkg)) {
    const paraId = attribute(entry.node, W15_NAMESPACE_URI, 'paraId');
    const parentParaId = attribute(entry.node, W15_NAMESPACE_URI, 'paraIdParent');
    if (paraId === undefined || parentParaId === undefined) continue;
    const child = idByParaId.get(paraId.toUpperCase());
    const parent = idByParaId.get(parentParaId.toUpperCase());
    if (child !== undefined && parent !== undefined) link(parent, child);
  }

  // Breadth-first with a seen set, so a file describing a cycle cannot spin here.
  const thread = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const child of childrenOf.get(current) ?? []) {
      if (thread.has(child)) continue;
      thread.add(child);
      queue.push(child);
    }
  }
  return thread;
}

/** Every `w15:commentEx` in the package, with the part it lives in. */
function extendedEntries(
  pkg: OoxmlPackage
): readonly { readonly partName: string; readonly node: OoxmlElement }[] {
  const entries: { partName: string; node: OoxmlElement }[] = [];
  for (const part of pkg.parts.values()) {
    if (!part.name.endsWith('.xml')) continue;
    const visit = (node: OoxmlNode, depth: number): void => {
      if (node.kind === 'textValue' || depth > 64) return;
      if (node.namespaceUri === W15_NAMESPACE_URI && node.localName === 'commentEx') {
        entries.push({ partName: part.name, node });
        return;
      }
      for (const child of node.children) visit(child, depth + 1);
    };
    visit(part.root, 0);
  }
  return entries;
}

/** Remove named nodes from one part in a single rebuild, parents first. */
function removeFromPart(
  pkg: OoxmlPackage,
  partName: string,
  nodeIds: readonly string[]
): OoxmlPackage | null {
  const part = pkg.parts.get(partName);
  if (!part) return pkg;
  let current = part;
  for (const nodeId of nodeIds) {
    if (!findNode(current, nodeId)) continue;
    const removed = removeNode(current, nodeId, { deferValidation: true });
    if (!removed.ok) return null;
    current = removed.part;
  }
  return current === part ? pkg : withPart(pkg, current);
}

/**
 * Strip every `w:commentRangeStart` / `w:commentRangeEnd` / `w:commentReference` naming one of
 * `commentIds`, from every story in the package.
 *
 * A `w:commentReference` is a RUN CHILD, and a run left holding only its `w:rPr` renders
 * nothing — so an emptied run goes with it, exactly as the text-delete sweep drops one.
 * Otherwise deleting a comment left a stub run at the anchor that the next keystroke joined.
 */
function stripMarkers(pkg: OoxmlPackage, commentIds: ReadonlySet<string>): OoxmlPackage | null {
  let next = pkg;
  for (const part of [...pkg.parts.values()]) {
    if (!part.name.endsWith('.xml')) continue;
    const doomed: string[] = [];
    const emptiedRuns: string[] = [];
    const visit = (node: OoxmlNode, depth: number): void => {
      if (node.kind === 'textValue' || depth > 64) return;
      if (
        node.kind === 'commentRangeStart' ||
        node.kind === 'commentRangeEnd' ||
        node.kind === 'commentReference'
      ) {
        const id = attribute(node, WML_NAMESPACE_URI, 'id');
        if (id !== undefined && commentIds.has(id)) doomed.push(node.id);
        return;
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
          return;
        }
      }
      for (const child of node.children) visit(child, depth + 1);
    };
    visit(part.root, 0);
    if (doomed.length === 0 && emptiedRuns.length === 0) continue;
    // Emptied runs first: removing the run takes its reference with it, and asking for the
    // reference afterwards would be a lookup for a node that is already gone.
    const removed = removeFromPart(next, part.name, [...emptiedRuns, ...doomed]);
    if (removed === null) return null;
    next = removed;
  }
  return next;
}

/**
 * Delete a comment thread outright: body, thread state and story markers.
 *
 * Returns the package unchanged when the id names no comment, and null when a removal was
 * refused — a caller inside a transaction rolls back rather than committing a package whose
 * comment is half gone.
 */
export function deleteCommentThread(pkg: OoxmlPackage, commentId: string): OoxmlPackage | null {
  const records = commentRecords(pkg);
  if (!records.has(commentId)) return pkg;
  const thread = threadOf(pkg, commentId);

  const paraIds = new Set<string>();
  const byPart = new Map<string, string[]>();
  for (const id of thread) {
    const record = records.get(id);
    if (!record) continue;
    const paraId = paraIdOf(record.node);
    if (paraId !== null) paraIds.add(paraId);
    const bucket = byPart.get(record.partName);
    if (bucket) bucket.push(record.node.id);
    else byPart.set(record.partName, [record.node.id]);
  }

  let next = stripMarkers(pkg, thread);
  if (next === null) return null;

  for (const [partName, nodeIds] of byPart) {
    const removed = removeFromPart(next, partName, nodeIds);
    if (removed === null) return null;
    next = removed;
  }

  // Thread state and `commentsIds.xml` are both keyed by `w14:paraId`, so one pass clears
  // both: an entry naming a paragraph the package no longer holds is a dangling record Word
  // has no comment to attach it to.
  const doomedByPart = new Map<string, string[]>();
  for (const part of next.parts.values()) {
    if (!part.name.endsWith('.xml')) continue;
    const doomed: string[] = [];
    const visit = (node: OoxmlNode, depth: number): void => {
      if (node.kind === 'textValue' || depth > 64) return;
      const keyed =
        (node.namespaceUri === W15_NAMESPACE_URI && node.localName === 'commentEx') ||
        (node.namespaceUri === W16CID_NAMESPACE_URI && node.localName === 'commentId');
      if (keyed) {
        const paraId =
          attribute(node, W15_NAMESPACE_URI, 'paraId') ??
          attribute(node, W16CID_NAMESPACE_URI, 'paraId');
        if (paraId !== undefined && paraIds.has(paraId.toUpperCase())) doomed.push(node.id);
        return;
      }
      for (const child of node.children) visit(child, depth + 1);
    };
    visit(part.root, 0);
    if (doomed.length > 0) doomedByPart.set(part.name, doomed);
  }
  for (const [partName, nodeIds] of doomedByPart) {
    const removed = removeFromPart(next, partName, nodeIds);
    if (removed === null) return null;
    next = removed;
  }

  return next;
}

/**
 * Delete every comment the edit between `before` and `after` emptied.
 *
 * The shape `cascadeDeletedNoteReferences` established: a before/after diff rather than a rule
 * inside each op, because the ops that can empty a range are several (`deleteText`,
 * `deleteBlock`, accepting a deletion) and a rule written into each one drifts. Null on failure,
 * so the caller rolls the whole transaction back.
 */
export function cascadeEmptiedComments(
  before: OoxmlPackage,
  after: OoxmlPackage
): OoxmlPackage | null {
  const coveredBefore = coveredCommentIds(before);
  const coveredAfter = coveredCommentIds(after);
  if (coveredBefore === null || coveredAfter === null) return null;

  let next = after;
  for (const commentId of coveredBefore) {
    if (coveredAfter.has(commentId)) continue;
    const reaped = deleteCommentThread(next, commentId);
    if (reaped === null) return null;
    next = reaped;
  }
  return next;
}

/** Whether the package holds any comment record at all — the cheap gate before a reap. */
export function hasAnyComment(pkg: OoxmlPackage): boolean {
  for (const part of pkg.parts.values()) {
    if (!part.name.endsWith('.xml')) continue;
    let found = false;
    const visit = (node: OoxmlNode, depth: number): void => {
      if (found || node.kind === 'textValue' || depth > 64) return;
      if (node.kind === 'comment') {
        found = true;
        return;
      }
      for (const child of node.children) visit(child, depth + 1);
    };
    visit(part.root, 0);
    if (found) return true;
  }
  return false;
}
