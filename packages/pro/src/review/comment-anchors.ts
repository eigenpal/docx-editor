/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Comment anchors, comment bodies, and the sibling parts that hold thread state.
//
// Lifted from the engine (pro-review-and-custom-nodes): the free engine keeps the
// comment VOCABULARY (`CommentRecord`, `CommentAnchor`, thread state types — see
// core's `review-support`) and this module keeps the READERS that derive them
// from a document.
//
// An anchor is a RANGE over stable node identities plus UTF-16 offsets, in the same offset
// space layout and tree ops use. `w:commentRangeStart` / `w:commentRangeEnd` are empty elements
// that sit between runs, so they contribute no characters and mark a position rather than
// occupying one.
//
// ECMA-376 governs the anchor: `CT_Comment` (§17.13.4.2) carries `@w:id`, `@w:author`,
// `@w:initials` and `@w:date` and a body, and `CT_Markup`-derived range markers (§17.13.4.4,
// §17.13.4.3) place it. It defines NEITHER threading nor a resolved flag — a comment in Part 1
// is flat and open. Both live in namespaces outside Part 1, so this reader treats them as
// optional evidence rather than as structure the standard promises:
//
//   - `commentsExtended.xml`, `w15:commentEx` `@paraIdParent` / `@done`, keyed by `w14:paraId`.
//   - `@w16cid:parentId` on `w:comment`, naming the parent's `w:id` directly.
//
// A file using neither can still state a reply in Part 1 terms alone, by anchoring it over
// exactly the characters the parent covers — the ranges are the only part of a thread that
// survives a producer dropping the extension parts. Read all three, explicit before inferred;
// a comment whose text merely opens with "Reply:" is prose and is never treated as structure.

import {
  WML_NAMESPACE_URI,
  isContentRevisionKind,
  paragraphOffsetIndex,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
} from '@docx-editor.dev/core-contract/store';
import { storyBlocks, W15_NAMESPACE_URI } from '@docx-editor.dev/core-contract/layout';
import type {
  CommentAnchor,
  CommentPosition,
  CommentRecord,
  CommentThreadState,
} from '@docx-editor.dev/core-contract/layout';

/** The `w14` namespace, where `paraId` lives. */
const W14_NAMESPACE_URI = 'http://schemas.microsoft.com/office/word/2010/wordml';
/**
 * The `w16cid` namespace: `@parentId` on `w:comment`, a thread link by comment id.
 *
 * Outside ECMA-376 Part 1, like `w14` and `w15`. Carried in an `mc:Ignorable` namespace, which
 * is exactly the contract that lets this reader use it when present and ignore it when not.
 */
const W16CID_NAMESPACE_URI = 'http://schemas.microsoft.com/office/word/2016/wordml/cid';

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

function wml(node: OoxmlElement, localName: string): string | undefined {
  return attribute(node, WML_NAMESPACE_URI, localName);
}

interface MarkerPoint {
  readonly commentId: string;
  readonly kind: 'start' | 'end';
  readonly offset: number;
}

/**
 * Comment range markers inside one paragraph, with the model offset each sits at.
 *
 * Offsets come from `paragraphOffsetIndex` — `segmentsOf`'s own walk — rather than from a
 * private character count. A marker occupies no characters, so it takes the offset of the
 * boundary it sits on, and that boundary is only right if everything before it measured what
 * the ops and the caret say it measures. The private count got two things wrong: it never
 * descended into `w:hyperlink`, so a comment after a link anchored short by the link's length
 * and markers written INSIDE one — which is what Word writes when you comment on link text —
 * yielded no anchor at all and reported the comment orphaned; and it gave a note reference or
 * an atomic field nothing where the model gives them one unit each.
 */
function markersInParagraph(paragraph: OoxmlParagraphNode): readonly MarkerPoint[] {
  // Memoized on the immutable paragraph node: the markers in a paragraph the last commit did
  // not touch sit where they sat. The anchors are stitched across paragraphs by the caller,
  // so only this paragraph-local step is cached.
  const cached = markerCache.get(paragraph);
  if (cached) return cached;
  const points = collectMarkers(paragraph);
  markerCache.set(paragraph, points);
  return points;
}

const markerCache = new WeakMap<OoxmlParagraphNode, readonly MarkerPoint[]>();

function collectMarkers(paragraph: OoxmlParagraphNode): MarkerPoint[] {
  const offsets = paragraphOffsetIndex(paragraph);
  const points: MarkerPoint[] = [];
  const walk = (children: readonly OoxmlNode[], depth: number): void => {
    for (const child of children) {
      if (child.kind === 'textValue') continue;
      if (child.kind === 'commentRangeStart' || child.kind === 'commentRangeEnd') {
        const id = wml(child, 'id');
        const span = offsets.spanOf(child);
        // A marker the offset walk never reached — under a container it does not descend, or
        // past the nesting cap — has no position to report. It is left out, and the comment
        // is reported orphaned rather than anchored at a guessed offset.
        if (id !== undefined && span) {
          points.push({
            commentId: id,
            kind: child.kind === 'commentRangeStart' ? 'start' : 'end',
            offset: span.start,
          });
        }
        continue;
      }
      // A link is a run container like a revision wrapper, and either can hold the other.
      // Depth is bounded for the same reason the layout walk bounds it: nesting is the
      // cheapest unbounded axis in an attacker-controlled file.
      if ((child.kind === 'hyperlink' || isContentRevisionKind(child.kind)) && depth < 32) {
        walk(child.children, depth + 1);
      }
    }
  };
  walk(paragraph.children, 0);
  return points;
}

/**
 * Every comment anchor in one story, in document order.
 *
 * Overlapping and nested ranges are supported because each anchor is resolved independently —
 * Word produces both, and a model that assumed ranges nest cleanly would mis-anchor them.
 *
 * A start with no matching end anchors to the end of its own paragraph and is reported orphaned
 * rather than guessed at: extending it to the next end marker would attach a reviewer's remark
 * to text they never saw.
 */
export function commentAnchorsOfStory(part: OoxmlPart): CommentAnchor[] {
  const open = new Map<string, CommentPosition>();
  const anchors: CommentAnchor[] = [];
  let lastPosition: CommentPosition | null = null;

  for (const block of storyBlocks(part)) {
    const paragraphs = block.kind === 'paragraph' ? [block] : paragraphsWithin(block);
    for (const paragraph of paragraphs) {
      const points = markersInParagraph(paragraph);
      for (const point of points) {
        const position: CommentPosition = { paragraphId: paragraph.id, offset: point.offset };
        lastPosition = position;
        if (point.kind === 'start') {
          open.set(point.commentId, position);
          continue;
        }
        const start = open.get(point.commentId);
        if (start === undefined) {
          // An end with no start: the range is unusable, but the comment exists.
          anchors.push({
            commentId: point.commentId,
            partName: part.name,
            start: position,
            end: position,
            orphaned: true,
          });
          continue;
        }
        open.delete(point.commentId);
        anchors.push({
          commentId: point.commentId,
          partName: part.name,
          start,
          end: position,
          orphaned: false,
        });
      }
    }
  }

  for (const [commentId, start] of open) {
    anchors.push({
      commentId,
      partName: part.name,
      start,
      end: lastPosition ?? start,
      orphaned: true,
    });
  }
  return anchors;
}

/** Paragraphs inside a table, in document order, including nested tables. */
function paragraphsWithin(node: OoxmlElement): OoxmlParagraphNode[] {
  const found: OoxmlParagraphNode[] = [];
  const visit = (current: OoxmlNode, depth: number): void => {
    if (current.kind === 'textValue' || depth > 32) return;
    if (current.kind === 'paragraph') {
      found.push(current);
      return;
    }
    for (const child of current.children) visit(child, depth + 1);
  };
  for (const child of node.children) visit(child, 0);
  return found;
}

/**
 * The comments in `word/comments.xml`, in authored order.
 *
 * Every value here comes from a file an attacker fully controls, so nothing is interpreted:
 * author, initials and date are carried verbatim for a surface that will set them as TEXT.
 */
export function commentsOfPart(part: OoxmlPart): CommentRecord[] {
  const comments: CommentRecord[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'comment') {
      const id = wml(node, 'id');
      if (id !== undefined) {
        const blocks: OoxmlElement[] = [];
        for (const child of node.children) {
          if (child.kind === 'paragraph' || child.kind === 'table') blocks.push(child);
        }
        const initials = wml(node, 'initials');
        const date = wml(node, 'date');
        const first = blocks.find((block) => block.kind === 'paragraph');
        const paraId = first ? attribute(first, W14_NAMESPACE_URI, 'paraId') : undefined;
        // A comment naming ITSELF as parent is a file defect, not a cycle to propagate.
        const rawParent = attribute(node, W16CID_NAMESPACE_URI, 'parentId');
        const parentCommentId = rawParent === id ? undefined : rawParent;
        comments.push({
          id,
          author: wml(node, 'author') ?? '',
          ...(initials === undefined ? {} : { initials }),
          ...(date === undefined ? {} : { date }),
          blocks,
          ...(paraId === undefined ? {} : { paraId }),
          ...(parentCommentId === undefined ? {} : { parentCommentId }),
        });
      }
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  return comments;
}

/**
 * Thread state by `w14:paraId`, from `commentsExtended.xml`.
 *
 * The part being PRESENT is not evidence of threading. `issue-68-large-comments-suggestions.docx`
 * ships it with 212 entries carrying `@w15:done` and not one `@w15:paraIdParent`, so it records
 * resolved state for a flat list. Absent parent means top-level, and that is a fact about the
 * file rather than a default this code chose.
 */
export function threadStateOfPart(part: OoxmlPart): Map<string, CommentThreadState> {
  const states = new Map<string, CommentThreadState>();
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.namespaceUri === W15_NAMESPACE_URI && node.localName === 'commentEx') {
      const paraId = attribute(node, W15_NAMESPACE_URI, 'paraId');
      if (paraId !== undefined) {
        const parent = attribute(node, W15_NAMESPACE_URI, 'paraIdParent');
        const done = attribute(node, W15_NAMESPACE_URI, 'done');
        states.set(paraId.toUpperCase(), {
          ...(parent === undefined ? {} : { parentParaId: parent.toUpperCase() }),
          // `@w15:done` is `ST_OnOff`: absent reads as false, and only the true spellings
          // count. A file writing `done="0"` means unresolved, not resolved.
          done: done === '1' || done === 'true' || done === 'on',
        });
      }
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  return states;
}
