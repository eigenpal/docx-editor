// Placing comment markup in a story.
//
// `w:commentRangeStart` and `w:commentRangeEnd` are `EG_RangeMarkupElements`, which sit in
// `EG_PContent` — BETWEEN runs, not inside them. So anchoring a comment mid-run means splitting
// the run first and putting the marker on the boundary that opens up. `w:commentReference` is
// the opposite: a run child, carried by a run of its own.
//
// The markers occupy no characters, so they never move an offset. That is what lets a comment be
// anchored without shifting the text every other anchor in the document is addressed by.

import { insertChildren, findNode, type EditOptions } from '../package/ooxml-edit.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { isContentRevisionKind } from '../package/ooxml-shared.ts';
import {
  contentControlContentNodeOf,
  isContentControlNode,
} from '../package/content-control-nodes.ts';
import { paragraphOffsetIndex } from './tree-op-segments.ts';
import { DEPENDENCY_KEY_IDS } from '../registry/frozen-ids.ts';
import { splitRunsAt } from './tree-op-apply.ts';
import type { TreeOpResult } from './tree-op-validate.ts';

/** Which piece of comment markup an `insertCommentMarker` op places. */
export type CommentMarkerKind = 'start' | 'end' | 'reference';

/**
 * Where in a container's child list an offset falls, descending into the containers a
 * comment may legitimately be anchored inside.
 *
 * MEASURED BY THE PARAGRAPH OFFSET AUTHORITY, never by a second walk of its own. This
 * function used to count characters itself, and every element the authority counts and it
 * did not put the paragraph out of step by one: a drawing, a field, an inline content
 * control. The visible half was a refusal (`offset-out-of-range`) for offsets past the
 * element, and the invisible half was worse — an offset that still resolved landed the
 * marker on the wrong character, so a comment silently covered text nobody selected.
 */
function locateOffset(
  paragraph: OoxmlParagraphNode,
  container: OoxmlElement,
  offset: number,
  depth: number
): { readonly containerId: string; readonly index: number } | null {
  const index = paragraphOffsetIndex(paragraph);
  const span =
    container.id === paragraph.id ? { start: 0, end: index.length } : index.spanOf(container);
  if (!span) return null;
  let cursor = span.start;
  for (let position = 0; position < container.children.length; position += 1) {
    const child = container.children[position]!;
    // `w:pPr` and `w:rPr` must stay first among their siblings, so a marker at offset 0 goes
    // AFTER the properties rather than before them. Inserting ahead of `w:pPr` produces a
    // paragraph the tree invariants reject, which is the invariant doing its job.
    const isProperties = child.kind === 'paragraphProperties' || child.kind === 'runProperties';
    if (cursor === offset && !isProperties) return { containerId: container.id, index: position };
    if (child.kind === 'textValue') continue;
    const length = index.lengthOf(child);
    // A container the offset falls STRICTLY inside is descended into, so the marker lands
    // where the text is rather than beside the wrapper. A hyperlink, a revision wrapper and
    // an inline content control are all run containers, and any can hold another — a link
    // inside a tracked insertion is ordinary. A comment anchored inside tracked text belongs
    // inside the wrapper that tracks it, or the markup claims the comment covers text the
    // revision does not.
    if (offset > cursor && offset < cursor + length && depth < MAX_CONTAINER_DEPTH) {
      const inner = descendableContainer(child);
      if (inner) {
        const found = locateOffset(paragraph, inner, offset, depth + 1);
        if (found) return found;
      }
    }
    cursor += length;
  }
  return cursor === offset ? { containerId: container.id, index: container.children.length } : null;
}

/** Matches the offset authority's own nesting bound. */
const MAX_CONTAINER_DEPTH = 32;

/**
 * The element to descend into for an offset inside `child`, or null when the offset is
 * inside something indivisible.
 *
 * A run is deliberately absent: `insertCommentMarker` splits the run straddling the offset
 * before this runs, so an offset inside a run is already a boundary between runs by the time
 * it is located. An atom — a drawing, a field, a note mark — has no inside to reach.
 */
function descendableContainer(child: OoxmlNode): OoxmlElement | null {
  if (child.kind === 'textValue') return null;
  if (isContentRevisionKind(child.kind) || child.kind === 'hyperlink') {
    return child as OoxmlElement;
  }
  // An inline content control holds its content in `w:sdtContent`; the wrapper's other
  // children (`w:sdtPr`, `w:sdtEndPr`) are properties a marker must never land among.
  if (isContentControlNode(child)) return contentControlContentNodeOf(child) ?? null;
  return null;
}

/**
 * A marker built with its TYPED kind, not as a generic element.
 *
 * The readers match on kind — `commentAnchorsOfStory` looks for `commentRangeStart` — so a
 * marker written as generic would round-trip correctly and be invisible to everything in the
 * same session that asked where the comment is anchored.
 */
function markerElement(
  id: string,
  kind: 'commentRangeStart' | 'commentRangeEnd' | 'commentReference',
  localName: string,
  commentId: string
): OoxmlElement {
  return {
    id,
    kind,
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    prefix: 'w',
    namespaceBindings: [],
    attributes: [
      {
        kind: 'genericExtension' as const,
        namespaceUri: WML_NAMESPACE_URI,
        localName: 'id',
        prefix: 'w',
        value: commentId,
      },
    ],
    children: [],
  } as OoxmlElement;
}

/** `<w:r><w:commentReference w:id="N"/></w:r>` — the reference is a RUN child. */
function referenceRun(id: string, commentId: string): OoxmlElement {
  return {
    id,
    kind: 'run',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'r',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [markerElement(`${id}.0`, 'commentReference', 'commentReference', commentId)],
  } as OoxmlElement;
}

export interface InsertCommentMarkerOp {
  readonly op: 'insertCommentMarker';
  readonly paragraphId: string;
  readonly offset: number;
  readonly commentId: string;
  readonly marker: CommentMarkerKind;
}

/**
 * Place one piece of comment markup at a model offset.
 *
 * The run straddling the offset is split first, because a range marker is a sibling of runs and
 * cannot be placed inside one. Splitting changes no characters, so every other offset in the
 * paragraph — and every anchor addressed by one — is unmoved.
 */
export function applyInsertCommentMarker(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  op: InsertCommentMarkerOp,
  options?: EditOptions
): TreeOpResult {
  const split = splitRunsAt(part, paragraph, op.offset, options);
  if (!split.ok) return { ok: false, reason: split.reason };

  const reloaded = findNode(split.part, paragraph.id);
  if (!reloaded || reloaded.kind !== 'paragraph') return { ok: false, reason: 'tree-invariant' };

  const at = locateOffset(reloaded, reloaded, op.offset, 0);
  if (!at) return { ok: false, reason: 'offset-out-of-range' };

  const nodeId = `${part.name}#comment-${op.marker}-${op.commentId}-${op.offset}`;
  const node =
    op.marker === 'reference'
      ? referenceRun(nodeId, op.commentId)
      : markerElement(
          nodeId,
          op.marker === 'start' ? 'commentRangeStart' : 'commentRangeEnd',
          op.marker === 'start' ? 'commentRangeStart' : 'commentRangeEnd',
          op.commentId
        );

  const inserted = insertChildren(split.part, at.containerId, at.index, [node], options);
  if (!inserted.ok) {
    return { ok: false, reason: 'tree-invariant', detail: JSON.stringify(inserted.issues) };
  }
  return {
    ok: true,
    part: inserted.part,
    effect: {
      dirty: [paragraph.id],
      created: [],
      deleted: [],
      dependencyKeys: [DEPENDENCY_KEY_IDS.story],
      // The markers add no characters and no height; only the paragraph's own content changed.
      impact: 'text-local',
    },
  };
}
