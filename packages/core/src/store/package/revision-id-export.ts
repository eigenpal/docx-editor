// Unique revision ids in a saved package.
//
// The live tree may hold two revision elements with one `@w:id`, on purpose: a tracked edit
// inside another author's insertion splits that insertion, and both pieces keep its id so the
// editor reviews them as one change. Other sources produce the same shape by accident. The id
// minter looks at one part, so a header or note revision can take an id the body already
// uses, and an id read above the 32-bit signed range passes through as it was read.
//
// A reader can treat two annotations that share an id as one, and decide both when it
// decides either. So the SAVED package gives every revision annotation its own valid id
// across all parts. This pass runs on the export snapshot only: the live tree, the undo
// history and shared collaboration state keep their ids, and the editor's review grouping
// does not change. A reopened file reads each split piece as its own change.
//
// Scope is the revision id space: the elements in `REVISION_ID_BEARING`, plus the move and
// custom XML range markers. A range start and the end that closes it are one annotation and
// keep one id. Comment and bookmark ids are separate id spaces with their own minters
// (`comment-id-mint.ts`, `tree-op-bookmark-ids.ts`), and this pass does not touch them.
//
// Churn is minimal. The first occurrence of an id, in part order (main document first) and
// document order, keeps it. Only a later duplicate, or an id that is not an integer in
// `0..2147483647`, gets a new id, taken one past the highest valid id in the package.
//
// `mc:AlternateContent` branches describe one piece of content twice, and a reader reads one
// branch. An occurrence in a later branch that matches one in an earlier branch (same element
// name, same id, same position among that name and id) is the same annotation, so it takes
// the id the earlier one took.
//
// Cost: one walk per part, answered by identity for every paragraph and table row a previous
// save already summarized. A package without duplicates returns unchanged, so the serializer's
// block memos stay valid. A block that does need new ids is rebuilt once per distinct result
// and reused by identity, so its serialized markup is memoized as well.

import { REVISION_ID_BEARING } from '../store/tree-op-revision-ids.ts';
import { MAX_DECIMAL_ID } from './actor-scoped-ids.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { isMemoizedBlock, type MemoizedBlock } from './ooxml-serialize-cache.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlAttribute,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from './ooxml-tree.ts';
import { createSubtreeAggregateMemo } from './subtree-memo-policy.ts';

const MC_NAMESPACE_URI = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

/** The range-start element each range-end element closes. `@w:id` pairs the two. */
const RANGE_START_OF_END: ReadonlyMap<string, string> = new Map([
  ['moveFromRangeEnd', 'moveFromRangeStart'],
  ['moveToRangeEnd', 'moveToRangeStart'],
  ['customXmlInsRangeEnd', 'customXmlInsRangeStart'],
  ['customXmlDelRangeEnd', 'customXmlDelRangeStart'],
  ['customXmlMoveFromRangeEnd', 'customXmlMoveFromRangeStart'],
  ['customXmlMoveToRangeEnd', 'customXmlMoveToRangeStart'],
]);

const RANGE_STARTS: ReadonlySet<string> = new Set(RANGE_START_OF_END.values());

const ANNOTATION = 0;
const RANGE_START = 1;
const RANGE_END = 2;
const MIRROR = 3;

/**
 * One element that carries a revision-space `@w:id`, in document order.
 *
 * `back` is set on a mirror: the occurrence `back` places earlier that it repeats. It is
 * relative, so a block's list stays valid wherever the block sits in its part.
 */
interface Occurrence {
  readonly type: typeof ANNOTATION | typeof RANGE_START | typeof RANGE_END | typeof MIRROR;
  readonly name: string;
  readonly id: string;
  readonly back: number;
}

const NONE: readonly Occurrence[] = Object.freeze([]);

function idAttribute(node: OoxmlElement): OoxmlAttribute | undefined {
  for (const attribute of node.attributes) {
    if (attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'id') {
      return attribute;
    }
  }
  return undefined;
}

/** The occurrence `node` is, or null. The rewrite walk asks the same question. */
function occurrenceOf(node: OoxmlElement): Occurrence | null {
  if (node.namespaceUri !== WML_NAMESPACE_URI) return null;
  const name = node.localName;
  const type = REVISION_ID_BEARING.has(name)
    ? ANNOTATION
    : RANGE_STARTS.has(name)
      ? RANGE_START
      : RANGE_START_OF_END.has(name)
        ? RANGE_END
        : null;
  if (type === null) return null;
  const id = idAttribute(node);
  return id ? { type, name, id: id.value, back: 0 } : null;
}

/** Append without a varargs spread: a long list must not become a long argument list. */
function append(out: Occurrence[], from: readonly Occurrence[]): void {
  for (let at = 0; at < from.length; at += 1) out.push(from[at]!);
}

const blockSummaries = new WeakMap<MemoizedBlock, readonly Occurrence[]>();

/** The occurrences under one paragraph or table row, memoized by identity. */
function blockSummary(block: MemoizedBlock): readonly Occurrence[] {
  let summary = blockSummaries.get(block);
  if (!summary) {
    const out: Occurrence[] = [];
    for (const child of block.children) collect(child, out);
    summary = out.length === 0 ? NONE : out;
    blockSummaries.set(block, summary);
  }
  return summary;
}

function collect(node: OoxmlNode, out: Occurrence[]): void {
  if (node.kind === 'textValue') return;
  if (isMemoizedBlock(node)) {
    append(out, blockSummary(node));
    return;
  }
  if (node.namespaceUri === MC_NAMESPACE_URI && node.localName === 'AlternateContent') {
    collectAlternateContent(node, out);
    return;
  }
  const occurrence = occurrenceOf(node);
  if (occurrence) out.push(occurrence);
  for (const child of node.children) collect(child, out);
}

/** Each branch in order; an occurrence a previous branch already holds becomes a mirror. */
function collectAlternateContent(node: OoxmlElement, out: Occurrence[]): void {
  const firstIndex = new Map<string, number>();
  for (const branch of node.children) {
    const start = out.length;
    collect(branch, out);
    const seenInBranch = new Map<string, number>();
    for (let at = start; at < out.length; at += 1) {
      const occurrence = out[at]!;
      if (occurrence.type === MIRROR) continue;
      const base = `${occurrence.name}\u0000${occurrence.id}`;
      const count = seenInBranch.get(base) ?? 0;
      seenInBranch.set(base, count + 1);
      const key = `${base}\u0000${count}`;
      const earlier = firstIndex.get(key);
      if (earlier === undefined) firstIndex.set(key, at);
      else out[at] = { type: MIRROR, name: occurrence.name, id: occurrence.id, back: at - earlier };
    }
  }
}

/** Keyed by part root. An answer that grows with the part is kept for its latest root only. */
const partSummaries = createSubtreeAggregateMemo<readonly Occurrence[]>();

function* partSummarySteps(part: OoxmlPart): Generator<void, readonly Occurrence[]> {
  const cached = partSummaries.get(part.root);
  if (cached) return cached;
  const out: Occurrence[] = [];
  yield* collectSteps(part.root, out);
  const summary = out.length === 0 ? NONE : out;
  partSummaries.set(part.root, summary, summary.length);
  return summary;
}

/** {@link collect}, yielding after each block so a long part does not hold the page. */
function* collectSteps(node: OoxmlNode, out: Occurrence[]): Generator<void, void> {
  if (node.kind === 'textValue') return;
  if (isMemoizedBlock(node) || node.namespaceUri === MC_NAMESPACE_URI) {
    collect(node, out);
    if (isMemoizedBlock(node)) yield;
    return;
  }
  const occurrence = occurrenceOf(node);
  if (occurrence) out.push(occurrence);
  for (const child of node.children) yield* collectSteps(child, out);
}

/** The id as a number when it is an integer in the valid range, else -1. */
function validId(value: string): number {
  if (!/^\+?\d+$/.test(value)) return -1;
  let digits = value.charCodeAt(0) === 0x2b ? value.slice(1) : value;
  let leading = 0;
  while (leading < digits.length - 1 && digits.charCodeAt(leading) === 0x30) leading += 1;
  digits = digits.slice(leading);
  if (digits.length > 10) return -1;
  const number = Number(digits);
  return number <= MAX_DECIMAL_ID ? number : -1;
}

/**
 * New ids: one past the highest valid id in the package. Past the ceiling, the lowest id no
 * annotation holds, so a crafted id near the limit cannot force two annotations to share.
 */
function idMinter(
  summaries: readonly (readonly Occurrence[])[],
  highest: number,
  taken: Set<number>
): () => string {
  let next = highest + 1;
  let cursor = 0;
  let everyValid: Set<number> | null = null;
  return () => {
    if (next <= MAX_DECIMAL_ID) {
      taken.add(next);
      return String(next++);
    }
    if (!everyValid) {
      everyValid = new Set<number>();
      for (const summary of summaries) {
        for (const occurrence of summary) {
          const value = validId(occurrence.id);
          if (value >= 0) everyValid.add(value);
        }
      }
    }
    for (; cursor <= MAX_DECIMAL_ID; cursor += 1) {
      if (everyValid.has(cursor) || taken.has(cursor)) continue;
      taken.add(cursor);
      return String(cursor++);
    }
    throw new TypeError('no free revision id');
  };
}

/** The id each occurrence is saved with, part by part, in the same order as `summaries`. */
function assignIds(summaries: readonly (readonly Occurrence[])[]): string[][] {
  let highest = -1;
  for (const summary of summaries) {
    for (const occurrence of summary) {
      if (occurrence.type === MIRROR) continue;
      const value = validId(occurrence.id);
      if (value > highest) highest = value;
    }
  }
  const taken = new Set<number>();
  const mint = idMinter(summaries, highest, taken);
  const claim = (id: string): string => {
    const value = validId(id);
    if (value >= 0 && !taken.has(value)) {
      taken.add(value);
      return id;
    }
    return mint();
  };
  return summaries.map((summary) => {
    const ids: string[] = [];
    // Open ranges by start name and source id. Ranges pair within one part.
    const open = new Map<string, string[]>();
    for (let at = 0; at < summary.length; at += 1) {
      const occurrence = summary[at]!;
      if (occurrence.type === MIRROR) {
        ids.push(ids[at - occurrence.back]!);
        continue;
      }
      if (occurrence.type === RANGE_END) {
        const key = `${RANGE_START_OF_END.get(occurrence.name)}\u0000${occurrence.id}`;
        const opened = open.get(key)?.pop();
        ids.push(opened ?? claim(occurrence.id));
        continue;
      }
      const id = claim(occurrence.id);
      ids.push(id);
      if (occurrence.type === RANGE_START) {
        const key = `${occurrence.name}\u0000${occurrence.id}`;
        const stack = open.get(key);
        if (stack) stack.push(id);
        else open.set(key, [id]);
      }
    }
    return ids;
  });
}

const rewrittenBlocks = new WeakMap<MemoizedBlock, { readonly key: string; node: OoxmlNode }>();

/** Rebuild the nodes whose ids change, walking in the order the summary was collected. */
function rewritePart(part: OoxmlPart, ids: readonly string[]): OoxmlPart {
  let cursor = 0;
  const rewrite = (node: OoxmlNode, top: boolean): OoxmlNode => {
    if (node.kind === 'textValue') return node;
    if (!top && isMemoizedBlock(node)) {
      const summary = blockSummary(node);
      if (summary.length === 0) return node;
      let same = true;
      for (let at = 0; at < summary.length && same; at += 1) {
        same = ids[cursor + at] === summary[at]!.id;
      }
      if (same) {
        cursor += summary.length;
        return node;
      }
      const key = ids.slice(cursor, cursor + summary.length).join('\u0000');
      const reused = rewrittenBlocks.get(node);
      if (reused && reused.key === key) {
        cursor += summary.length;
        return reused.node;
      }
      const rebuilt = rewrite(node, true);
      rewrittenBlocks.set(node, { key, node: rebuilt });
      return rebuilt;
    }
    let attributes = node.attributes;
    const occurrence = occurrenceOf(node);
    if (occurrence) {
      const id = ids[cursor]!;
      cursor += 1;
      if (id !== occurrence.id) {
        attributes = node.attributes.map((attribute) =>
          attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'id'
            ? { ...attribute, value: id }
            : attribute
        ) as typeof node.attributes;
      }
    }
    let children: OoxmlNode[] | null = null;
    for (let at = 0; at < node.children.length; at += 1) {
      const child = node.children[at]!;
      const next = rewrite(child, false);
      if (next !== child) {
        children ??= node.children.slice();
        children[at] = next;
      }
    }
    if (attributes === node.attributes && !children) return node;
    return { ...node, attributes, children: children ?? node.children } as OoxmlNode;
  };
  return { ...part, root: rewrite(part.root, true) as OoxmlElement };
}

/**
 * An export snapshot in which every revision annotation has its own valid `@w:id` across all
 * parts. Returns `pkg` itself when nothing needs a new id.
 *
 * @internal
 */
export function* uniqueRevisionIdExportPackageSteps(
  pkg: OoxmlPackage
): Generator<void, OoxmlPackage> {
  const main = pkg.parts.get(pkg.mainDocumentPart);
  const ordered: OoxmlPart[] = main ? [main] : [];
  for (const part of pkg.parts.values()) if (part !== main) ordered.push(part);
  const summaries: (readonly Occurrence[])[] = [];
  for (const part of ordered) {
    summaries.push(yield* partSummarySteps(part));
    yield;
  }
  const assigned = assignIds(summaries);
  let next: OoxmlPackage | null = null;
  for (let index = 0; index < ordered.length; index += 1) {
    const summary = summaries[index]!;
    const ids = assigned[index]!;
    let changed = false;
    for (let at = 0; at < summary.length && !changed; at += 1) {
      changed = ids[at] !== summary[at]!.id;
    }
    if (!changed) continue;
    const part = ordered[index]!;
    next ??= { ...pkg, parts: new Map(pkg.parts) };
    (next.parts as Map<string, OoxmlPart>).set(part.name, rewritePart(part, ids));
    yield;
  }
  return next ?? pkg;
}

/** {@link uniqueRevisionIdExportPackageSteps}, run to completion. @internal */
export function uniqueRevisionIdExportPackage(pkg: OoxmlPackage): OoxmlPackage {
  const steps = uniqueRevisionIdExportPackageSteps(pkg);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}
