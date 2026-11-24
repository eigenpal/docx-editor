// Inline content controls at a caret edge: what Backspace and Delete remove as one unit.

import type { OoxmlNode, OoxmlParagraphNode } from '../package/ooxml-tree.ts';
import { declaredLockOf, inlineContainersOf, isBoundContentControl } from './tree-op-nodes.ts';
import { segmentAncestryNodeId, segmentsOf, type Segment } from './tree-op-segments.ts';

/** One inline content control's identity and the UTF-16 span its content covers. */
export interface InlineControlSpan {
  readonly controlId: string;
  readonly start: number;
  readonly end: number;
}

function idsUnder(node: OoxmlNode, out: Set<string>): void {
  out.add(node.id);
  if (node.kind === 'textValue') return;
  for (const child of node.children) idsUnder(child, out);
}

function spanOf(container: OoxmlNode, segments: readonly Segment[]): InlineControlSpan | null {
  const ids = new Set<string>();
  idsUnder(container, ids);
  let start = Number.MAX_SAFE_INTEGER;
  let end = -1;
  for (const candidate of segments) {
    if (!ids.has(segmentAncestryNodeId(candidate))) continue;
    if (candidate.start < start) start = candidate.start;
    if (candidate.end > end) end = candidate.end;
  }
  if (end < 0) return null;
  return { controlId: container.id, start, end };
}

function spanOfControl(
  paragraph: OoxmlParagraphNode,
  segments: readonly Segment[],
  segment: Segment
): InlineControlSpan | null {
  const container = inlineContainersOf(paragraph, segmentAncestryNodeId(segment)).find(
    (ancestor) => ancestor.kind === 'contentControl'
  );
  return container ? spanOf(container, segments) : null;
}

/**
 * The outermost inline content controls (`w:sdt`, ECMA-376 Part 1, 17.5.2.31) wholly inside
 * `[start, end)` whose characters no edit may touch: `w:lock` (Part 1, 17.5.2.23) is
 * `contentLocked` or `sdtContentLocked`, or the control has a `w:dataBinding` (Part 1, 17.5.2.6). The store refuses to delete such a range as
 * text. It removes a `contentLocked` or bound control whole, and refuses a `sdtContentLocked` one.
 */
export function wholeProtectedControlsIn(
  paragraph: OoxmlParagraphNode,
  start: number,
  end: number
): InlineControlSpan[] {
  const segments = segmentsOf(paragraph);
  const found: InlineControlSpan[] = [];
  const visit = (node: OoxmlNode): void => {
    // A nested paragraph (a text box) is its own story, not this paragraph's offsets.
    if (node.kind === 'textValue' || node.kind === 'paragraph') return;
    if (
      node.kind === 'contentControl' &&
      (declaredLockOf(node).content || isBoundContentControl(node))
    ) {
      const span = spanOf(node, segments);
      if (span && span.start >= start && span.end <= end) {
        found.push(span);
        return;
      }
    }
    for (const child of node.children) visit(child);
  };
  for (const child of paragraph.children) visit(child);
  return found;
}

/**
 * The innermost inline content control whose content ends exactly at `offset` — the caret
 * at its right outer edge. What Backspace consults to delete the node as ONE unit
 * (pro-review-and-custom-nodes 4.6): deleting its last character from outside would either
 * strip one letter from a content-locked label (refused, so the key looks dead) or leave a
 * half-deleted chip whose tag still claims the full payload.
 */
export function inlineControlEndingAt(
  paragraph: OoxmlParagraphNode,
  offset: number
): InlineControlSpan | null {
  const segments = segmentsOf(paragraph);
  const before = [...segments].reverse().find((s) => s.end === offset && s.end > s.start);
  if (!before) return null;
  const span = spanOfControl(paragraph, segments, before);
  return span && span.end === offset ? span : null;
}

/** The forward-delete mirror: the control whose content STARTS exactly at `offset`. */
export function inlineControlStartingAt(
  paragraph: OoxmlParagraphNode,
  offset: number
): InlineControlSpan | null {
  const segments = segmentsOf(paragraph);
  const after = segments.find((s) => s.start === offset && s.end > s.start);
  if (!after) return null;
  const span = spanOfControl(paragraph, segments, after);
  return span && span.start === offset ? span : null;
}
