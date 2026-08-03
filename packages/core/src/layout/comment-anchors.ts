// Comment anchors, comment bodies, and the sibling parts that hold thread state.
//
// An anchor is a RANGE over stable node identities plus UTF-16 offsets, in the same offset
// space layout and tree ops use. `w:commentRangeStart` / `w:commentRangeEnd` are empty elements
// that sit between runs, so they contribute no characters and mark a position rather than
// occupying one.
//
// Threading and resolved state are NOT in `comments.xml`. It has no parent pointer and no
// resolved flag. Both live in `commentsExtended.xml`, keyed by the `w14:paraId` of a comment's
// first paragraph. A file without that part has no threads, and the surface says so rather than
// inferring them — a comment whose text opens with "Reply:" is prose, not structure.

import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core-contract/store';
import { isContentRevisionKind } from '@docx-editor.dev/core-contract/store';
import { storyBlocks } from './story-roots.ts';

/** The `w15` namespace: `commentsExtended.xml` — thread parent and resolved state. */
export const W15_NAMESPACE_URI = 'http://schemas.microsoft.com/office/word/2012/wordml';
/** The `w14` namespace, where `paraId` lives. */
const W14_NAMESPACE_URI = 'http://schemas.microsoft.com/office/word/2010/wordml';

/** A position in one story: a paragraph node id plus a UTF-16 offset inside it. */
export interface CommentPosition {
  readonly paragraphId: string;
  readonly offset: number;
}

/**
 * Where a comment is anchored, as a range.
 *
 * `orphaned` records that the file did not give this comment a usable range — a reference with
 * no range markers, or a start with no end. The comment is still listed, marked orphaned,
 * rather than dropped: a reviewer's remark disappearing silently is worse than one that says
 * it lost its text.
 */
export interface CommentAnchor {
  readonly commentId: string;
  /** Canonical name of the part the range lives in, so a header comment is attributable. */
  readonly partName: string;
  readonly start: CommentPosition;
  readonly end: CommentPosition;
  readonly orphaned: boolean;
}

/** One comment as authored in `word/comments.xml`. */
export interface CommentRecord {
  readonly id: string;
  readonly author: string;
  readonly initials?: string;
  readonly date?: string;
  /** Body paragraphs, as tree nodes, so the surface renders measured text rather than a string. */
  readonly blocks: readonly OoxmlElement[];
  /** `w14:paraId` of the first body paragraph — the key thread state is stored under. */
  readonly paraId?: string;
}

/** Thread state for one comment, read from `commentsExtended.xml`. */
export interface CommentThreadState {
  /** `@w15:paraIdParent` — the comment this one replies to, absent for a top-level comment. */
  readonly parentParaId?: string;
  readonly done: boolean;
}

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

/** Characters one run child contributes to the model offset space. */
function textLengthOfRunChild(node: OoxmlNode): number {
  if (node.kind === 'text' || node.kind === 'deletedText') {
    let length = 0;
    for (const value of node.children) if (value.kind === 'textValue') length += value.value.length;
    return length;
  }
  if (node.kind === 'tab' || node.kind === 'hardBreak') return 1;
  return 0;
}

interface MarkerPoint {
  readonly commentId: string;
  readonly kind: 'start' | 'end';
  readonly offset: number;
}

/**
 * Comment range markers inside one paragraph, with the model offset each sits at.
 *
 * Mirrors the offset rule used by `segmentsOf` and the layout piece walk: runs contribute their
 * text, revision wrappers are descended into, everything else is skipped. A marker between two
 * runs takes the offset of the boundary it sits on, because it occupies no characters itself.
 */
function markersInParagraph(paragraph: OoxmlElement): MarkerPoint[] {
  const points: MarkerPoint[] = [];
  let offset = 0;
  const walk = (children: readonly OoxmlNode[], depth: number): void => {
    for (const child of children) {
      if (child.kind === 'textValue') continue;
      if (child.kind === 'run') {
        for (const grand of child.children) offset += textLengthOfRunChild(grand);
        continue;
      }
      if (child.kind === 'commentRangeStart' || child.kind === 'commentRangeEnd') {
        const id = wml(child, 'id');
        if (id !== undefined) {
          points.push({
            commentId: id,
            kind: child.kind === 'commentRangeStart' ? 'start' : 'end',
            offset,
          });
        }
        continue;
      }
      // Depth is bounded for the same reason the layout walk bounds it: nesting is the
      // cheapest unbounded axis in an attacker-controlled file.
      if (isContentRevisionKind(child.kind) && depth < 32) walk(child.children, depth + 1);
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
function paragraphsWithin(node: OoxmlElement): OoxmlElement[] {
  const found: OoxmlElement[] = [];
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
        comments.push({
          id,
          author: wml(node, 'author') ?? '',
          ...(initials === undefined ? {} : { initials }),
          ...(date === undefined ? {} : { date }),
          blocks,
          ...(paraId === undefined ? {} : { paraId }),
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
