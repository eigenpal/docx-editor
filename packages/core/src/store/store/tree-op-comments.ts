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
import { DEPENDENCY_KEY_IDS } from '../registry/frozen-ids.ts';
import { splitRunsAt } from './tree-op-apply.ts';
import type { TreeOpResult } from './tree-op-validate.ts';

/** Which piece of comment markup an `insertCommentMarker` op places. */
export type CommentMarkerKind = 'start' | 'end' | 'reference';

/** Characters one run child contributes, matching `segmentsOf` exactly. */
function textLengthOfRunChild(node: OoxmlNode): number {
  if (node.kind === 'text' || node.kind === 'deletedText') {
    let length = 0;
    for (const value of node.children) if (value.kind === 'textValue') length += value.value.length;
    return length;
  }
  // A tab and a hard break each occupy exactly one model offset, which is what `segmentsOf`
  // counts. The two must not disagree, or a marker lands on a different character than the
  // caret that asked for it.
  if (node.kind === 'tab' || node.kind === 'hardBreak') return 1;
  return 0;
}

function textLengthOfRun(run: OoxmlNode): number {
  if (run.kind === 'textValue') return 0;
  let length = 0;
  for (const child of run.children) length += textLengthOfRunChild(child);
  return length;
}

/**
 * Where in a container's child list an offset falls, descending into revision wrappers.
 *
 * A comment anchored inside tracked text belongs inside the wrapper that tracks it, or the
 * markup would claim the comment covers text the revision does not.
 */
function locateOffset(
  container: OoxmlElement,
  offset: number,
  base: number,
  depth: number
): { readonly containerId: string; readonly index: number } | null {
  let cursor = base;
  for (let index = 0; index < container.children.length; index += 1) {
    const child = container.children[index]!;
    // `w:pPr` and `w:rPr` must stay first among their siblings, so a marker at offset 0 goes
    // AFTER the properties rather than before them. Inserting ahead of `w:pPr` produces a
    // paragraph the tree invariants reject, which is the invariant doing its job.
    const isProperties = child.kind === 'paragraphProperties' || child.kind === 'runProperties';
    if (cursor === offset && !isProperties) return { containerId: container.id, index };
    if (child.kind === 'textValue') continue;
    if (child.kind === 'run') {
      cursor += textLengthOfRun(child);
      continue;
    }
    if (isContentRevisionKind(child.kind) && depth < 32) {
      let inner = 0;
      for (const grand of child.children) inner += textLengthOfRun(grand);
      if (offset > cursor && offset < cursor + inner) {
        return locateOffset(child, offset, cursor, depth + 1);
      }
      cursor += inner;
    }
  }
  return cursor === offset ? { containerId: container.id, index: container.children.length } : null;
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

  const at = locateOffset(reloaded, op.offset, 0, 0);
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
