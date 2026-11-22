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
// run nodes, drawings, fields, through `insertionSite`), tracked insertions
// (`tree-op-tracked.ts`), range markers (bookmarks and comments, `markerSiteAt`), wrappers
// (`w:hyperlink` and inline `w:sdt`), and note references (`note-lifecycle.ts`). A new lane
// that places content at an offset asks it too. A wrapper never holds a field character at
// its own edge, so it never holds one whose partner lies outside it.
//
// A run or inline wrapper that holds a field character and content past it is divided at the
// edge first (`isolateFieldEdge`). Untracked lanes that place runs, controls, or notes then join
// a divided insertion again around them (`rejoinDividedInsertions`), so it stays one change.
// Range markers stay between the halves, which still form one change, since nothing that
// holds content separates them. The tracked lane keeps the author's own insertion of this
// moment whole instead.

import { isFldChar, parsedFieldSpansOf } from '../package/field-nodes.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import {
  createNodeIdAllocator,
  findNode,
  replaceChildren,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import { cloneWithNewIds, isRunPropertiesNode, parentOf } from './tree-op-nodes.ts';
import { contains } from './tree-op-split-runs.ts';
import { isInlineContainerProperty } from '../package/inline-container-properties.ts';
import { directParentOf } from './tree-op-field-end-site.ts';
import { inlineContainersOf } from './tree-op-nodes.ts';
import {
  isContentRevisionKind,
  MAX_INLINE_CONTAINER_DEPTH,
  nextInlineContainerDepth,
} from '../package/ooxml-shared.ts';
import { orphanFieldEndAt, paragraphOffsetIndex, type InsertionSite } from './tree-op-segments.ts';
import type { TreeOpResult } from './tree-op-types.ts';
import { FieldResultsModeMemo } from '../package/field-result-mode.ts';
import { sameEditingMoment } from './tree-op-tracked-adjacency.ts';

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

/** The first begin `w:fldChar` at `offset` whose field ends in a later paragraph. */
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
 * offset is a field edge: right after the child holding the end character, or before the child
 * holding the begin character and any markers right before it at that offset. Null when no field edge is there, or when that child
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
  let index = topIndexOf(edge.beginId!);
  const span = index >= 0 ? offsets.spanOf(paragraph.children[index]!) : undefined;
  if (!span || span.start !== offset) return null;
  // Before the markers already at the edge too, so a bookmark's start, placed after its end
  // at the same offset, still lands in front of it.
  const atEdge = (child: OoxmlNode) => {
    const own = child.kind === 'paragraphProperties' ? null : offsets.spanOf(child);
    return !!own && own.start === offset && own.end === offset;
  };
  while (index > 0 && atEdge(paragraph.children[index - 1]!)) index -= 1;
  return index;
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

/**
 * Split the runs and inline wrappers at a field edge so each field character there sits in a
 * paragraph child of its own on that side: an end character with content after it, or a begin
 * character with content before it, moves the far content into sibling copies of each run and
 * wrapper that holds both. A copy keeps the original's attributes and property children, so a
 * `w:ins` or `w:del` stays the same revision (`w:id`, `w:author`, `w:date`, see
 * `same-revision.ts`) and a `w:hyperlink` keeps its target. A content control is one control
 * and is never divided: a field character inside one keeps its place. No character changes, so
 * every offset stays where it was. Lanes that place whole nodes among a paragraph's children
 * call this first, so {@link fieldEdgeChildIndex} and {@link fieldEdgeSide} find the field
 * character in a child of its own.
 */
export function isolateFieldEdge(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  offset: number,
  options?: EditOptions,
  /** Wrappers to keep whole, such as the author's own insertion that tracked typing extends. */
  keep?: (node: OoxmlNode) => boolean
): IsolatedFieldEdge | null {
  const edge = fieldEdgeAt(paragraph, offset);
  let current = { part, paragraph };
  const divided: (readonly [string, string])[] = [];
  for (const [id, after] of [
    [edge?.endId, true],
    [edge?.beginId, false],
  ] as const) {
    if (!id) continue;
    const allocate = createNodeIdAllocator(current.part);
    let minted = 0; // a division mints its tail's id; none minted means nothing was divided
    const mint = () => (minted++, allocate());
    const children = current.paragraph.children.flatMap((child) => {
      const pieces = divideAt(child, id, after, mint, 0, divided, keep);
      if (!pieces) return [child];
      return [pieces.head, pieces.tail].filter((node): node is OoxmlNode => !!node);
    });
    if (minted === 0) continue;
    const replaced = replaceChildren(current.part, current.paragraph.id, children, options);
    if (!replaced.ok) return null;
    const reloaded = findNode(replaced.part, paragraph.id);
    if (reloaded?.kind !== 'paragraph') return null;
    current = { part: replaced.part, paragraph: reloaded as OoxmlParagraphNode };
  }
  return { ...current, divided };
}

/** A paragraph after {@link isolateFieldEdge}, with each insertion it divided (head, tail). */
export interface IsolatedFieldEdge {
  readonly part: OoxmlPart;
  readonly paragraph: OoxmlParagraphNode;
  readonly divided: readonly (readonly [string, string])[];
}

/** Whether `node` is this author's own insertion of this editing moment, which typing extends. */
export function ownInsertionNow(revision: {
  readonly author: string;
  readonly date?: string;
}): (node: OoxmlNode) => boolean {
  const read = (node: OoxmlNode, name: string) =>
    node.kind === 'textValue'
      ? undefined
      : node.attributes.find((a) => a.namespaceUri === WML_NAMESPACE_URI && a.localName === name)
          ?.value;
  return (node) =>
    node.kind === 'revisionInsert' &&
    read(node, 'author') === revision.author &&
    sameEditingMoment(read(node, 'date'), revision.date);
}

/** Whether a field edge may divide `node` into two copies: runs and lossless inline wrappers. */
function divisible(node: OoxmlNode): boolean {
  if (node.kind === 'run' || node.kind === 'hyperlink' || isContentRevisionKind(node.kind)) {
    return true;
  }
  return (
    node.kind === 'generic' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    DIVISIBLE_GENERIC.has(node.localName)
  );
}
const DIVISIBLE_GENERIC = new Set(['smartTag', 'customXml', 'dir', 'bdo']);

/**
 * Divide `node` beside the descendant `id`: after it when `after`, else before it. Returns the
 * near and far pieces (either null when that side holds no content), or null when `id` is not
 * inside `node`. The head keeps the node's identity; a new tail gets fresh ids.
 */
function divideAt(
  node: OoxmlNode,
  id: string,
  after: boolean,
  mint: () => string,
  depth: number,
  divided: (readonly [string, string])[],
  keep?: (node: OoxmlNode) => boolean
): { readonly head: OoxmlNode | null; readonly tail: OoxmlNode | null } | null {
  if (node.id === id) return after ? { head: node, tail: null } : { head: null, tail: node };
  if (node.kind === 'textValue' || depth >= MAX_INLINE_CONTAINER_DEPTH) return null;
  const index = node.children.findIndex((child) => contains(child, id));
  if (index < 0) return null;
  const child = node.children[index]!;
  const inner = divideAt(
    child,
    id,
    after,
    mint,
    nextInlineContainerDepth(node, depth),
    divided,
    keep
  );
  if (!inner) return null;
  const pieces = [inner.head, inner.tail].filter((piece): piece is OoxmlNode => !!piece);
  const whole = (children: readonly OoxmlNode[]) => ({ ...node, children }) as OoxmlNode;
  const spliced = whole(node.children.flatMap((item) => (item === child ? pieces : [item])));
  if (!divisible(node) || keep?.(node))
    return after ? { head: spliced, tail: null } : { head: null, tail: spliced };
  const property = (item: OoxmlNode) =>
    isRunPropertiesNode(item) || isInlineContainerProperty(node, item);
  const content = (items: readonly OoxmlNode[]) => items.filter((item) => !property(item));
  const head = [...content(node.children.slice(0, index)), ...(inner.head ? [inner.head] : [])];
  const tail = [...(inner.tail ? [inner.tail] : []), ...content(node.children.slice(index + 1))];
  if (head.length === 0) return { head: null, tail: spliced };
  if (tail.length === 0) return { head: spliced, tail: null };
  const properties = node.children.filter(property);
  const tailId = mint();
  if (node.kind === 'revisionInsert' || node.kind === 'revisionMoveTo') {
    divided.push([node.id, tailId]);
  }
  return {
    head: whole([...properties, ...head]),
    tail: {
      ...node,
      id: tailId,
      children: [...properties.map((item) => cloneWithNewIds(item, mint)), ...tail],
    } as OoxmlNode,
  };
}

/**
 * Join the halves of each insertion {@link isolateFieldEdge} divided around untracked content,
 * so one insertion stays one change, as untracked typing inside an insertion extends it. The
 * halves stay divided when anything between them cannot sit in an insertion (another revision,
 * a link), as a tracked insertion of another change does.
 */
export function rejoinDividedInsertions(
  part: OoxmlPart,
  divided: readonly (readonly [string, string])[],
  options?: EditOptions
): OoxmlPart {
  let current = part;
  // Last division first: a tail divided again is the head of a later pair.
  for (const [headId, tailId] of [...divided].reverse()) {
    const holder = parentOf(current, headId);
    if (!holder) continue;
    const from = holder.children.findIndex((child) => child.id === headId);
    const to = holder.children.findIndex((child) => child.id === tailId);
    if (from < 0 || to <= from) continue;
    const between = holder.children.slice(from + 1, to);
    if (!between.every(insertable)) continue;
    const head = holder.children[from]!;
    const tail = holder.children[to]!;
    if (head.kind === 'textValue' || tail.kind === 'textValue') continue;
    const joined = { ...head, children: [...head.children, ...between, ...tail.children] };
    const children = [
      ...holder.children.slice(0, from),
      joined as OoxmlNode,
      ...holder.children.slice(to + 1),
    ];
    const replaced = replaceChildren(current, holder.id, children, options);
    if (replaced.ok) current = replaced.part;
  }
  return current;
}

/** Content that may sit inside a `w:ins` (`EG_ContentRunContent` and range markers). */
function insertable(node: OoxmlNode): boolean {
  switch (node.kind) {
    case 'run':
    case 'bookmarkStart':
    case 'bookmarkEnd':
    case 'commentRangeStart':
    case 'commentRangeEnd':
    case 'contentControl':
      return true;
    case 'generic':
      return node.namespaceUri === WML_NAMESPACE_URI && INSERTABLE_GENERIC.has(node.localName);
    default:
      return false;
  }
}
const INSERTABLE_GENERIC = new Set([
  'sdt',
  'smartTag',
  'customXml',
  'proofErr',
  'permStart',
  'permEnd',
]);

/** Place whole nodes with `place` after isolating the field edge at `offset`, then rejoin. */
export function placeAtFieldEdge(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  offset: number,
  place: (part: OoxmlPart, paragraph: OoxmlParagraphNode) => OoxmlPart | null,
  options?: EditOptions
): OoxmlPart | null {
  const isolated = isolateFieldEdge(part, paragraph, offset, options);
  if (!isolated) return place(part, paragraph);
  const placed = place(isolated.part, isolated.paragraph);
  return placed && rejoinDividedInsertions(placed, isolated.divided, options);
}

/** Apply a write after isolating the field edges at `offsets` ({@link isolateFieldEdge}). */
export function withFieldEdgesIsolated(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  offsets: readonly number[],
  options: EditOptions | undefined,
  write: (part: OoxmlPart, paragraph: OoxmlParagraphNode) => TreeOpResult
): TreeOpResult {
  let current: IsolatedFieldEdge | null = { part, paragraph, divided: [] };
  const divided: (readonly [string, string])[] = [];
  for (const offset of offsets) {
    current = current && isolateFieldEdge(current.part, current.paragraph, offset, options);
    if (current) divided.push(...current.divided);
  }
  if (!current) return { ok: false, reason: 'tree-invariant' };
  const written = write(current.part, current.paragraph);
  return written.ok && divided.length > 0
    ? { ...written, part: rejoinDividedInsertions(written.part, divided, options) }
    : written;
}
