// Content inserted at the edge of a complex field that spans paragraphs goes outside the field.
//
// A field whose `w:fldChar` characters sit in different paragraphs, such as a table of
// contents, is not one offset unit: each of its characters measures zero, so the offset at
// its edge names both sides of a character. The rule this module states, and every lane that
// places content at an offset follows:
//
//   - at the offset of `w:fldChar w:fldCharType="end"`, content goes AFTER the end character;
//   - at the offset of `w:fldChar w:fldCharType="begin"`, content goes BEFORE the begin
//     character, so also before the field's `w:instrText` and `w:fldChar
//     w:fldCharType="separate"`.
//
// Between the begin and end characters lies the field result, which a field update replaces.
// Content placed there would be lost on the next update, and a wrapper placed across a field
// character (a `w:hyperlink` holding the end character) would break the field's nesting.
// When the end of one field and the begin of the next share an offset, content goes between
// them. Fields closed inside one paragraph are atoms of the offset model and need no rule.
//
// The lanes that place content at an offset and ask this module: insertion sites (typed text,
// run nodes, drawings, fields, through `insertionSite`), range markers (bookmarks and
// comments, `markerSiteAt`), wrappers (`w:hyperlink` and inline `w:sdt`), and note
// references (`note-lifecycle.ts`). A new lane that places content at an offset asks it too.

import { isFldChar, parsedFieldSpansOf } from '../package/field-nodes.ts';
import type { OoxmlElement, OoxmlNode, OoxmlParagraphNode } from '../package/ooxml-tree.ts';
import { directParentOf } from './tree-op-field-end-site.ts';
import { inlineContainersOf } from './tree-op-nodes.ts';
import { MAX_INLINE_CONTAINER_DEPTH, nextInlineContainerDepth } from '../package/ooxml-shared.ts';
import { orphanFieldEndAt, paragraphOffsetIndex, type InsertionSite } from './tree-op-segments.ts';
import { FieldResultsModeMemo } from '../package/field-result-mode.ts';

/** Preorder position of each node in a paragraph, with the last position its subtree holds. */
const orders = new WeakMap<OoxmlParagraphNode, ReadonlyMap<string, readonly [number, number]>>();
function orderOf(paragraph: OoxmlParagraphNode): ReadonlyMap<string, readonly [number, number]> {
  const known = orders.get(paragraph);
  if (known) return known;
  const order = new Map<string, readonly [number, number]>();
  let next = 0;
  const walk = (node: OoxmlNode): number => {
    const first = next++;
    let last = first;
    if (node.kind !== 'textValue') for (const child of node.children) last = walk(child);
    order.set(node.id, [first, last]);
    return last;
  };
  walk(paragraph);
  orders.set(paragraph, order);
  return order;
}

const orphanBegins = new FieldResultsModeMemo<OoxmlParagraphNode, ReadonlyMap<number, string>>();

/** The first `w:fldChar w:fldCharType="begin"` at `offset` whose field ends in a later paragraph. */
function orphanFieldBeginAt(paragraph: OoxmlParagraphNode, offset: number): string | undefined {
  let begins = orphanBegins.get(paragraph);
  if (!begins) {
    const found = new Map<number, string>();
    const offsets = paragraphOffsetIndex(paragraph);
    const closed = new Set(parsedFieldSpansOf(paragraph).flatMap((field) => field.removeNodeIds));
    const walk = (node: OoxmlNode, depth: number): void => {
      if (node.kind === 'textValue' || depth >= MAX_INLINE_CONTAINER_DEPTH) return;
      if (isFldChar(node, 'begin') && !closed.has(node.id)) {
        const span = offsets.spanOf(node);
        if (span && span.start === span.end && !found.has(span.start))
          found.set(span.start, node.id);
      }
      for (const child of node.children) walk(child, nextInlineContainerDepth(node, depth));
    };
    walk(paragraph, 0);
    begins = found;
    orphanBegins.set(paragraph, begins);
  }
  return begins.get(offset);
}

/** The field characters at a field edge: the end to stay after, the begin to stay before. */
export interface FieldEdge {
  readonly endId?: string;
  readonly beginId?: string;
}

/** The edge of a field that spans paragraphs at `offset`, or null when no field edge is there. */
export function fieldEdgeAt(paragraph: OoxmlParagraphNode, offset: number): FieldEdge | null {
  const endId = orphanFieldEndAt(paragraph, offset);
  const beginId = orphanFieldBeginAt(paragraph, offset);
  if (!endId && !beginId) return null;
  return { ...(endId ? { endId } : {}), ...(beginId ? { beginId } : {}) };
}

/**
 * The side of content inserted at `offset` that a node measuring zero there belongs on:
 * `before` when it holds or precedes the field's end character, `after` when it holds or
 * follows the field's begin character, and null when the field rule does not place it (no
 * field edge at the offset, or a node holding both characters).
 */
export function fieldEdgeSide(
  paragraph: OoxmlParagraphNode,
  offset: number,
  node: OoxmlNode
): 'before' | 'after' | null {
  const edge = fieldEdgeAt(paragraph, offset);
  if (!edge) return null;
  const order = orderOf(paragraph);
  const [first, last] = order.get(node.id) ?? [-1, -1];
  if (first < 0) return null;
  const end = edge.endId ? order.get(edge.endId)?.[0] : undefined;
  const begin = edge.beginId ? order.get(edge.beginId)?.[0] : undefined;
  const before = end !== undefined && first <= end;
  const after = begin !== undefined && last >= begin;
  if (before === after) return null;
  return before ? 'before' : 'after';
}

/**
 * The index among the paragraph's children where whole nodes inserted at `offset` go when the
 * offset is a field edge: right after the child holding the end character, or right before the
 * child holding the begin character. Null when no field edge is there, or when that child
 * also holds text on the far side of the character (a split decides that place).
 */
export function fieldEdgeChildIndex(paragraph: OoxmlParagraphNode, offset: number): number | null {
  const edge = fieldEdgeAt(paragraph, offset);
  if (!edge) return null;
  const offsets = paragraphOffsetIndex(paragraph);
  const order = orderOf(paragraph);
  const topIndexOf = (id: string): number => {
    const target = order.get(id)?.[0];
    if (target === undefined) return -1;
    return paragraph.children.findIndex((child) => {
      const [first, last] = order.get(child.id)!;
      return first <= target && target <= last;
    });
  };
  if (edge.endId) {
    const index = topIndexOf(edge.endId);
    const span = index >= 0 ? offsets.spanOf(paragraph.children[index]!) : undefined;
    return span && span.end === offset ? index + 1 : null;
  }
  const index = topIndexOf(edge.beginId!);
  const span = index >= 0 ? offsets.spanOf(paragraph.children[index]!) : undefined;
  return span && span.start === offset ? index : null;
}

/**
 * The insertion site, moved before the begin character when it would land at or after it.
 * Text typed at the edge still joins the run before the field, which keeps its formatting.
 */
export function siteBeforeFieldBegin(
  paragraph: OoxmlParagraphNode,
  offset: number,
  owner: OoxmlNode | null,
  site: InsertionSite
): InsertionSite {
  const beginId = fieldEdgeAt(paragraph, offset)?.beginId;
  if (!beginId) return site;
  const order = orderOf(paragraph);
  const begin = order.get(beginId)![0];
  const run = directParentOf(paragraph, beginId);
  const span = owner === null ? undefined : order.get(owner.id);
  const held = owner === null || (span !== undefined && span[0] <= begin && begin <= span[1]);
  if (!run || !held) return site;
  if (!landsAfter(site, begin, order)) return site;
  const index = run.children.findIndex((child) => child.id === beginId);
  const content = run.children.slice(0, index).some((child) => child.kind !== 'runProperties');
  if (run.kind === 'run' && content) return { kind: 'atRunIndex', run, index };
  const offsets = paragraphOffsetIndex(paragraph);
  const exited =
    inlineContainersOf(paragraph, run.id)
      .filter((node) => offsets.spanOf(node)?.start === offset)
      .at(-1) ?? run;
  const holder = directParentOf(paragraph, exited.id) ?? paragraph;
  const at = holder.children.findIndex((child) => child.id === exited.id);
  const previous = holder.children[at - 1];
  if (previous?.kind === 'run' && offsets.spanOf(previous)?.end === offset) {
    return { kind: 'appendToRun', run: previous as OoxmlElement };
  }
  return { kind: 'newRun', holder, index: at };
}

/** Whether a site puts content at or after the node at preorder position `begin`. */
function landsAfter(
  site: InsertionSite,
  begin: number,
  order: ReadonlyMap<string, readonly [number, number]>
): boolean {
  const startOf = (node: OoxmlNode | undefined) => (node ? order.get(node.id)![0] : Infinity);
  const endsAfter = (node: OoxmlNode) => order.get(node.id)![1] >= begin;
  switch (site.kind) {
    case 'withinValue':
    case 'atBoundary':
      return startOf(site.segment.node) > begin;
    case 'appendToRun':
      return endsAfter(site.run);
    case 'atRunIndex':
      return site.index < site.run.children.length
        ? startOf(site.run.children[site.index]) > begin
        : endsAfter(site.run);
    case 'newRun':
      return site.index !== undefined && site.index < site.holder.children.length
        ? startOf(site.holder.children[site.index]) > begin
        : endsAfter(site.holder);
  }
}
