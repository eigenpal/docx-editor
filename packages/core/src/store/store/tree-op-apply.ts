// Op application over the canonical tree (tree-ops seam).
//
// This module owns turning a VALIDATED op into a new part plus its structural effect.
// Application is pure: `applyTreeOp` never mutates its input, and it validates first via
// tree-op-validate.ts so a rejected op is a true no-op. The op vocabulary and the segment
// model live in tree-op-validate.ts; both are re-exported via tree-ops.ts.

import { hardBreakAttributes, hardBreakText } from '../package/hard-break.ts';
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
  insertChildren,
  parentNodeOf,
  removeNode,
  replaceChildren,
  replaceNode,
  type EditOptions,
  type OoxmlEditResult,
} from '../package/ooxml-edit.ts';
import { DEPENDENCY_KEY_IDS } from '../registry/frozen-ids.ts';
import {
  isParagraph,
  segmentsOf,
  validateTreeOp,
  type OoxmlProperty,
  type TreeDocOp,
  type TreeOpEffect,
  type TreeOpRejection,
  type TreeOpResult,
} from './tree-op-validate.ts';

function propertyElement(property: OoxmlProperty, id: string): OoxmlNode {
  return {
    id,
    kind: 'generic',
    namespaceUri: WML_NAMESPACE_URI,
    localName: property.localName,
    prefix: 'w',
    namespaceBindings: [],
    attributes: Object.entries(property.attributes ?? {}).map(([localName, value]) => ({
      kind: 'genericExtension' as const,
      namespaceUri: WML_NAMESPACE_URI,
      localName,
      prefix: 'w',
      value,
    })),
    children: [],
  } as unknown as OoxmlNode;
}

function textElement(nextId: () => string, text: string): OoxmlNode {
  const valueId = nextId();
  return {
    id: nextId(),
    kind: 'text',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 't',
    prefix: 'w',
    namespaceBindings: [],
    // `xml:space="preserve"` is not added here: the serializer owns lexical form, and a
    // leading/trailing space is preserved by the tree regardless of the attribute.
    attributes: [],
    children: [{ id: valueId, kind: 'textValue', value: text }],
  } as unknown as OoxmlNode;
}

function simpleElement(
  nextId: () => string,
  localName: 'tab' | 'br',
  breakKind: 'line' | 'page' = 'line'
): OoxmlNode {
  return {
    id: nextId(),
    kind: localName === 'tab' ? 'tab' : 'hardBreak',
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    prefix: 'w',
    namespaceBindings: [],
    attributes: localName === 'br' ? [...hardBreakAttributes(breakKind)] : [],
    children: [],
  } as unknown as OoxmlNode;
}

function runElement(nextId: () => string, children: readonly OoxmlNode[]): OoxmlNode {
  return {
    id: nextId(),
    kind: 'run',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'r',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children,
  } as unknown as OoxmlNode;
}

const TEXT_DEPS = [DEPENDENCY_KEY_IDS.story];

function ok(part: OoxmlPart, effect: TreeOpEffect): TreeOpResult {
  return { ok: true, part, effect };
}

function fromEdit(result: OoxmlEditResult, effect: TreeOpEffect): TreeOpResult {
  if (!result.ok) {
    return { ok: false, reason: 'tree-invariant', detail: JSON.stringify(result.issues) };
  }
  return ok(result.part, effect);
}

/**
 * Apply one validated op to a part.
 *
 * Validation runs first and returns before any tree work, so a rejected op is a true no-op:
 * the caller keeps the part it passed in, unchanged and still frozen.
 *
 * `options.deferValidation` passes through to the edit primitives: a transaction applying
 * many ops re-validates the whole part once at its commit boundary rather than after every
 * primitive, which is the difference between a paste that is linear and one that is
 * quadratic in document size.
 */
export function applyTreeOp(part: OoxmlPart, op: TreeDocOp, options?: EditOptions): TreeOpResult {
  const rejection = validateTreeOp(part, op);
  if (rejection) return { ok: false, reason: rejection };

  if (op.op === 'joinParagraphs') return applyJoin(part, op.firstId, op.secondId, options);

  const paragraph = findNode(part, op.paragraphId) as OoxmlParagraphNode;
  const nextId = createNodeIdAllocator(part);

  switch (op.op) {
    case 'insertText':
      return applyInsertContent(
        part,
        paragraph,
        op.offset,
        [(mint) => textElement(mint, op.text)],
        options
      );
    case 'insertTab':
      return applyInsertContent(
        part,
        paragraph,
        op.offset,
        [(mint) => simpleElement(mint, 'tab')],
        options
      );
    case 'insertHardBreak':
      return applyInsertContent(
        part,
        paragraph,
        op.offset,
        [(mint) => simpleElement(mint, 'br', 'line')],
        options
      );
    case 'insertPageBreak':
      return applyInsertContent(
        part,
        paragraph,
        op.offset,
        [(mint) => simpleElement(mint, 'br', 'page')],
        options
      );
    case 'deleteText':
      return applyDeleteText(part, paragraph, op.start, op.end, options);
    case 'splitParagraph':
      return applySplit(part, paragraph, op.offset, options);
    case 'splitParagraphMany':
      return applySplitMany(part, paragraph, op.offsets, options);
    case 'setRunProperties':
      return applySetRunProperties(part, paragraph, op.start, op.end, op.properties, options);
    case 'setParagraphProperties': {
      const existing = paragraph.children.find((child) => child.kind === 'paragraphProperties');
      const children = op.properties.map((property) => propertyElement(property, nextId()));
      const effect: TreeOpEffect = {
        dirty: [paragraph.id],
        created: [],
        deleted: [],
        dependencyKeys: TEXT_DEPS,
        impact: 'paragraph-local',
      };
      if (op.properties.length === 0) {
        // Clearing properties removes the container entirely rather than leaving an empty
        // `w:pPr`, so a cleared paragraph digests identically to one that never had any.
        return existing
          ? fromEdit(removeNode(part, existing.id, options), effect)
          : ok(part, effect);
      }
      if (existing) return fromEdit(replaceChildren(part, existing.id, children, options), effect);
      const pPr = {
        id: nextId(),
        kind: 'paragraphProperties',
        namespaceUri: WML_NAMESPACE_URI,
        localName: 'pPr',
        prefix: 'w',
        namespaceBindings: [],
        attributes: [],
        children,
      } as unknown as OoxmlNode;
      // `w:pPr` must be the paragraph's FIRST child per the schema.
      return fromEdit(insertChildren(part, paragraph.id, 0, [pPr], options), effect);
    }
    default:
      return { ok: false, reason: 'unknown-op' };
  }
}

/** Insert content nodes at a UTF-16 offset, splitting a text value when the offset is inside one. */
function applyInsertContent(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  offset: number,
  builders: readonly ((mint: () => string) => OoxmlNode)[],
  options?: EditOptions
): TreeOpResult {
  const nextId = createNodeIdAllocator(part);
  const nodes = builders.map((build) => build(nextId));
  const effect: TreeOpEffect = {
    dirty: [paragraph.id],
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact: 'text-local',
  };
  const segments = segmentsOf(paragraph);

  // Inside a text value: split it and place the new content between the halves.
  for (const segment of segments) {
    if (segment.node.kind !== 'textValue') continue;
    if (offset <= segment.start || offset >= segment.end) continue;
    const local = offset - segment.start;
    const value = segment.node.value;
    const textNode = findTextParent(paragraph, segment.node.id);
    if (!textNode) return { ok: false, reason: 'tree-invariant', detail: 'orphan text value' };
    const run = findNode(part, segment.runId);
    if (!run || run.kind !== 'run') return { ok: false, reason: 'tree-invariant' };
    const head = textElement(nextId, value.slice(0, local));
    const tail = textElement(nextId, value.slice(local));
    const rebuilt = run.children.flatMap((child) =>
      child.id === textNode.id ? [head, ...nodes, tail] : [child]
    );
    return fromEdit(replaceChildren(part, run.id, rebuilt, options), effect);
  }

  // At a boundary: append to the run holding the offset, or to the last run.
  const boundary = segments.find((segment) => segment.start === offset);
  if (boundary) {
    const run = findNode(part, boundary.runId);
    if (!run || run.kind !== 'run') return { ok: false, reason: 'tree-invariant' };
    const index = run.children.findIndex((child) => contains(child, boundary.node.id));
    return fromEdit(insertChildren(part, run.id, Math.max(0, index), nodes, options), effect);
  }

  const runs = paragraph.children.filter((child) => child.kind === 'run');
  const last = runs[runs.length - 1];
  if (last) {
    return fromEdit(insertChildren(part, last.id, last.children.length, nodes, options), effect);
  }
  // An empty paragraph: the content needs a run to live in.
  return fromEdit(
    insertChildren(
      part,
      paragraph.id,
      paragraph.children.length,
      [runElement(nextId, nodes)],
      options
    ),
    effect
  );
}

function contains(node: OoxmlNode, id: string): boolean {
  if (node.id === id) return true;
  if (node.kind === 'textValue') return false;
  return node.children.some((child) => contains(child, id));
}

/** The `w:t` element that owns a text value. */
function findTextParent(paragraph: OoxmlParagraphNode, valueId: string): OoxmlNode | null {
  const walk = (node: OoxmlNode): OoxmlNode | null => {
    if (node.kind === 'textValue') return null;
    if (node.kind === 'text' && node.children.some((child) => child.id === valueId)) return node;
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(paragraph);
}

function applyDeleteText(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  start: number,
  end: number,
  options?: EditOptions
): TreeOpResult {
  const segments = segmentsOf(paragraph);
  const effect: TreeOpEffect = {
    dirty: [paragraph.id],
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact: 'text-local',
  };
  let current = part;
  const nextId = createNodeIdAllocator(part);

  // Highest offset first, so earlier segment positions stay valid as edits apply.
  for (const segment of [...segments].reverse()) {
    if (segment.end <= start || segment.start >= end) continue;
    if (segment.node.kind !== 'textValue') {
      const removed = removeNode(current, segment.node.id, options);
      if (!removed.ok) return fromEdit(removed, effect);
      current = removed.part;
      continue;
    }
    const from = Math.max(0, start - segment.start);
    const to = Math.min(segment.node.value.length, end - segment.start);
    const value = segment.node.value.slice(0, from) + segment.node.value.slice(to);
    const owner = findTextParent(paragraph, segment.node.id);
    if (!owner) return { ok: false, reason: 'tree-invariant', detail: 'orphan text value' };
    const edited =
      value.length === 0
        ? removeNode(current, owner.id, options)
        : replaceNode(current, owner.id, textElement(nextId, value), options);
    if (!edited.ok) return fromEdit(edited, effect);
    current = edited.part;
  }

  // Drop runs left with no content. A run holding only `w:rPr` renders nothing and would
  // otherwise accumulate on every deletion.
  const after = findNode(current, paragraph.id);
  if (after && after.kind === 'paragraph') {
    for (const child of after.children) {
      if (child.kind !== 'run') continue;
      // A run's children are elements only, so "content" is simply anything that is not
      // the run's own property container.
      const hasContent = child.children.some((grand) => grand.kind !== 'runProperties');
      if (hasContent) continue;
      const removed = removeNode(current, child.id, options);
      if (!removed.ok) return fromEdit(removed, effect);
      current = removed.part;
    }
  }
  return ok(current, effect);
}

function applySplit(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  offset: number,
  options?: EditOptions
): TreeOpResult {
  const nextId = createNodeIdAllocator(part);
  const segments = segmentsOf(paragraph);
  const headChildren: OoxmlNode[] = [];
  const tailChildren: OoxmlNode[] = [];
  const pPr = paragraph.children.find((child) => child.kind === 'paragraphProperties');

  for (const child of paragraph.children) {
    if (child.kind === 'paragraphProperties') continue;
    if (child.kind !== 'run') {
      // Unknown paragraph-level content stays with the HEAD: it has no offset, so moving it
      // would be an invented decision.
      headChildren.push(child);
      continue;
    }
    const runSegments = segments.filter((segment) => segment.runId === child.id);
    const runStart = runSegments[0]?.start ?? Number.POSITIVE_INFINITY;
    const runEnd = runSegments[runSegments.length - 1]?.end ?? runStart;
    if (runEnd <= offset) {
      headChildren.push(child);
      continue;
    }
    if (runStart >= offset) {
      tailChildren.push(child);
      continue;
    }
    // The run straddles the split: divide its content children, keeping `w:rPr` on BOTH
    // halves so formatting survives the split.
    const rPr = child.children.find((grand) => grand.kind === 'runProperties');
    const headContent: OoxmlNode[] = [];
    const tailContent: OoxmlNode[] = [];
    for (const grand of child.children) {
      if (grand.kind === 'runProperties') continue;
      const segment = runSegments.find((candidate) => contains(grand, candidate.node.id));
      if (!segment) {
        headContent.push(grand);
        continue;
      }
      if (segment.end <= offset) headContent.push(grand);
      else if (segment.start >= offset) tailContent.push(grand);
      else if (segment.node.kind === 'textValue') {
        const local = offset - segment.start;
        headContent.push(textElement(nextId, segment.node.value.slice(0, local)));
        tailContent.push(textElement(nextId, segment.node.value.slice(local)));
      } else headContent.push(grand);
    }
    if (headContent.length > 0) {
      headChildren.push(runElement(nextId, rPr ? [rPr, ...headContent] : headContent));
    }
    if (tailContent.length > 0) {
      const clonedRpr = rPr ? cloneWithNewIds(rPr, nextId) : null;
      tailChildren.push(runElement(nextId, clonedRpr ? [clonedRpr, ...tailContent] : tailContent));
    }
  }

  const tailParagraph = {
    id: nextId(),
    kind: 'paragraph',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'p',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: pPr ? [cloneWithNewIds(pPr, nextId), ...tailChildren] : tailChildren,
  } as unknown as OoxmlNode;

  const effect: TreeOpEffect = {
    dirty: [paragraph.id],
    created: [tailParagraph.id],
    deleted: [],
    split: { from: paragraph.id, tail: tailParagraph.id },
    dependencyKeys: TEXT_DEPS,
    impact: 'flow-structural',
  };

  // A single edit against the parent's child sequence. Expressed as "replace the head
  // `w:p`'s children, then insert the tail `w:p`", every split produced two intermediate
  // trees — and two node-index states — and a plain-text paste performs one split per
  // paragraph mark. Substituting [head, tail] for the original `w:p` yields the identical
  // tree in one rebuild.
  const parent = parentOf(part, paragraph.id);
  if (!parent) return { ok: false, reason: 'tree-invariant', detail: 'paragraph has no parent' };
  const headParagraph = Object.freeze({
    ...paragraph,
    children: pPr ? [pPr, ...headChildren] : headChildren,
  }) as OoxmlNode;
  const siblings = parent.children.flatMap((child) =>
    child.id === paragraph.id ? [headParagraph, tailParagraph] : [child]
  );
  return fromEdit(replaceChildren(part, parent.id, siblings, options), effect);
}

/** The resulting paragraph a source offset belongs to: how many boundaries lie at or before it. */
function pieceIndexOf(offsets: readonly number[], position: number): number {
  // Binary search — a whole-document paste can carry thousands of boundaries, and every
  // segment asks. Content sitting exactly ON a boundary opens that boundary's tail, which
  // is what the equivalent sequence of single splits does.
  let low = 0;
  let high = offsets.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (offsets[mid]! <= position) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * Split a `w:p` at every offset in one pass.
 *
 * Semantically the sequence of single splits from the last offset to the first, produced
 * without the intermediates: each character of the paragraph's content is visited once,
 * and the parent's child sequence is rebuilt once. Runs and text values wholly inside one
 * resulting paragraph keep their identity, exactly as an untouched run survives a single
 * split; only content straddling a boundary is rebuilt. `w:pPr` and `w:rPr` are duplicated
 * onto every tail with fresh identities, so direct formatting survives the break the way
 * Word carries it across a paragraph mark.
 */
function applySplitMany(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  offsets: readonly number[],
  options?: EditOptions
): TreeOpResult {
  const nextId = createNodeIdAllocator(part);
  const segments = segmentsOf(paragraph);
  const pPr = paragraph.children.find((child) => child.kind === 'paragraphProperties');
  const pieceCount = offsets.length + 1;
  const pieces: OoxmlNode[][] = Array.from({ length: pieceCount }, () => []);

  for (const child of paragraph.children) {
    if (child.kind === 'paragraphProperties') continue;
    if (child.kind !== 'run') {
      // Unknown paragraph-level content stays with the HEAD: it has no offset, so moving it
      // would be an invented decision. Matches the single-split rule.
      pieces[0]!.push(child);
      continue;
    }
    const runSegments = segments.filter((segment) => segment.runId === child.id);
    const runStart = runSegments[0]?.start ?? Number.POSITIVE_INFINITY;
    const runEnd = runSegments[runSegments.length - 1]?.end ?? runStart;
    const startPiece = pieceIndexOf(offsets, runStart);
    const endPiece = runEnd > runStart ? pieceIndexOf(offsets, runEnd - 1) : startPiece;
    if (startPiece === endPiece) {
      // Wholly inside one resulting paragraph: the run survives with its identity.
      pieces[startPiece]!.push(child);
      continue;
    }

    // The run straddles at least one boundary: divide its content children, keeping
    // `w:rPr` on every produced piece so formatting survives each break.
    const rPr = child.children.find((grand) => grand.kind === 'runProperties');
    const contentByPiece: OoxmlNode[][] = Array.from({ length: pieceCount }, () => []);
    for (const grand of child.children) {
      if (grand.kind === 'runProperties') continue;
      const segment = runSegments.find((candidate) => contains(grand, candidate.node.id));
      if (!segment) {
        contentByPiece[startPiece]!.push(grand);
        continue;
      }
      if (segment.node.kind !== 'textValue') {
        contentByPiece[pieceIndexOf(offsets, segment.start)]!.push(grand);
        continue;
      }
      const from = segment.start;
      const until = segment.end;
      let sliceStart = from;
      let piece = pieceIndexOf(offsets, from);
      let cut = false;
      for (const boundary of offsets) {
        if (boundary <= from) continue;
        if (boundary >= until) break;
        // A REPEATED boundary yields an empty slice: the piece between two equal offsets
        // is an empty paragraph, and an empty `w:t` inside it would serialize markup the
        // equivalent single splits never produce — so the piece advances and nothing is
        // emitted, exactly as a split at a paragraph edge emits no text.
        const slice = segment.node.value.slice(sliceStart - from, boundary - from);
        if (slice.length > 0) contentByPiece[piece]!.push(textElement(nextId, slice));
        sliceStart = boundary;
        piece += 1;
        cut = true;
      }
      if (!cut) {
        // No boundary inside this value: it moves whole, identity intact.
        contentByPiece[piece]!.push(grand);
        continue;
      }
      const lastSlice = segment.node.value.slice(sliceStart - from);
      if (lastSlice.length > 0) contentByPiece[piece]!.push(textElement(nextId, lastSlice));
    }
    let keptOriginalRpr = false;
    for (let piece = 0; piece < pieceCount; piece += 1) {
      const content = contentByPiece[piece]!;
      if (content.length === 0) continue;
      const pieceRpr = rPr ? (keptOriginalRpr ? cloneWithNewIds(rPr, nextId) : rPr) : null;
      keptOriginalRpr = true;
      pieces[piece]!.push(runElement(nextId, pieceRpr ? [pieceRpr, ...content] : content));
    }
  }

  const tailParagraphs: OoxmlNode[] = [];
  for (let piece = 1; piece < pieceCount; piece += 1) {
    tailParagraphs.push({
      id: nextId(),
      kind: 'paragraph',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'p',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [],
      children: pPr ? [cloneWithNewIds(pPr, nextId), ...pieces[piece]!] : pieces[piece]!,
    } as unknown as OoxmlNode);
  }

  const effect: TreeOpEffect = {
    dirty: [paragraph.id],
    created: tailParagraphs.map((tail) => tail.id),
    deleted: [],
    splits: tailParagraphs.map((tail) => ({ from: paragraph.id, tail: tail.id })),
    dependencyKeys: TEXT_DEPS,
    impact: 'flow-structural',
  };

  const parent = parentOf(part, paragraph.id);
  if (!parent) return { ok: false, reason: 'tree-invariant', detail: 'paragraph has no parent' };
  const headParagraph = Object.freeze({
    ...paragraph,
    children: pPr ? [pPr, ...pieces[0]!] : pieces[0]!,
  }) as OoxmlNode;
  const siblings = parent.children.flatMap((child) =>
    child.id === paragraph.id ? [headParagraph, ...tailParagraphs] : [child]
  );
  return fromEdit(replaceChildren(part, parent.id, siblings, options), effect);
}

/** A deep copy with freshly minted identities, for content duplicated by a split. */
function cloneWithNewIds(node: OoxmlNode, nextId: () => string): OoxmlNode {
  if (node.kind === 'textValue') return { id: nextId(), kind: 'textValue', value: node.value };
  return {
    ...node,
    id: nextId(),
    children: node.children.map((child) => cloneWithNewIds(child, nextId)),
  } as OoxmlNode;
}

function parentOf(part: OoxmlPart, nodeId: string): OoxmlElement | null {
  // Served from the part's node index rather than a fresh full-tree walk: split and join
  // ask for a parent on every op, and the walk made each one O(document).
  return parentNodeOf(part, nodeId);
}

function applyJoin(
  part: OoxmlPart,
  firstId: string,
  secondId: string,
  options?: EditOptions
): TreeOpResult {
  const second = findNode(part, secondId) as OoxmlParagraphNode;
  const parent = parentOf(part, firstId);
  const secondParent = parentOf(part, secondId);
  if (!parent || !secondParent || parent.id !== secondParent.id) {
    return { ok: false, reason: 'not-adjacent-siblings' };
  }
  const firstIndex = parent.children.findIndex((child) => child.id === firstId);
  const secondIndex = parent.children.findIndex((child) => child.id === secondId);
  if (secondIndex !== firstIndex + 1) return { ok: false, reason: 'not-adjacent-siblings' };

  const effect: TreeOpEffect = {
    dirty: [firstId],
    created: [],
    deleted: [secondId],
    join: { kept: firstId, removed: secondId },
    dependencyKeys: TEXT_DEPS,
    impact: 'flow-structural',
  };

  // The survivor keeps ITS paragraph properties; the removed paragraph's are dropped, which
  // matches Word: joining into a paragraph adopts that paragraph's formatting.
  const moved = second.children.filter((child) => child.kind !== 'paragraphProperties');

  // A single edit against the shared parent: the surviving `w:p` receives the second
  // paragraph's content children, and the second `w:p` leaves the child sequence, in the
  // same rebuild. Expressed as remove-then-reparent the join produced two intermediate
  // trees per op; a single rebuild has no intermediate state at all, so the moved runs are
  // never under two parents at any point.
  const first = parent.children.find((child) => child.id === firstId);
  if (!first || first.kind !== 'paragraph') {
    return { ok: false, reason: 'tree-invariant', detail: 'survivor missing' };
  }
  const merged = Object.freeze({ ...first, children: [...first.children, ...moved] }) as OoxmlNode;
  const siblings = parent.children.flatMap((child) =>
    child.id === firstId ? [merged] : child.id === secondId ? [] : [child]
  );
  return fromEdit(replaceChildren(part, parent.id, siblings, options), effect);
}

function applySetRunProperties(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  start: number,
  end: number,
  properties: readonly OoxmlProperty[],
  options?: EditOptions
): TreeOpResult {
  const effect: TreeOpEffect = {
    dirty: [paragraph.id],
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact: 'text-local',
  };
  // Split at both edges first, so the range lands on whole runs and only those runs change.
  let current = part;
  for (const boundary of [end, start]) {
    const target = findNode(current, paragraph.id) as OoxmlParagraphNode;
    const split = splitRunsAt(current, target, boundary, options);
    if (!split.ok) return split;
    current = split.part;
  }

  const target = findNode(current, paragraph.id) as OoxmlParagraphNode;
  const segments = segmentsOf(target);
  const runIds = new Set(
    segments
      .filter((segment) => segment.start >= start && segment.end <= end)
      .map((segment) => segment.runId)
  );
  const nextId = createNodeIdAllocator(current);
  for (const runId of runIds) {
    const run = findNode(current, runId);
    if (!run || run.kind !== 'run') continue;
    const existing = run.children.find((child) => child.kind === 'runProperties');
    const content = run.children.filter((child) => child.kind !== 'runProperties');
    if (properties.length === 0) {
      if (!existing) continue;
      const cleared = replaceChildren(current, run.id, content, options);
      if (!cleared.ok) return fromEdit(cleared, effect);
      current = cleared.part;
      continue;
    }
    const rPr = {
      id: existing?.id ?? nextId(),
      kind: 'runProperties',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'rPr',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [],
      children: properties.map((property) => propertyElement(property, nextId())),
    } as unknown as OoxmlNode;
    // `w:rPr` must lead the run's children.
    const updated = replaceChildren(current, run.id, [rPr, ...content], options);
    if (!updated.ok) return fromEdit(updated, effect);
    current = updated.part;
  }
  return ok(current, effect);
}

/** Divide any run straddling `offset` so the offset falls on a run boundary. */
function splitRunsAt(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  offset: number,
  options?: EditOptions
): { ok: true; part: OoxmlPart } | { ok: false; reason: TreeOpRejection; detail?: string } {
  const segments = segmentsOf(paragraph);
  const straddling = segments.find(
    (segment) => segment.node.kind === 'textValue' && segment.start < offset && segment.end > offset
  );
  if (!straddling) return { ok: true, part };
  const run = findNode(part, straddling.runId);
  if (!run || run.kind !== 'run') return { ok: false, reason: 'tree-invariant' };
  const nextId = createNodeIdAllocator(part);
  const rPr = run.children.find((child) => child.kind === 'runProperties');
  const headContent: OoxmlNode[] = [];
  const tailContent: OoxmlNode[] = [];
  for (const child of run.children) {
    if (child.kind === 'runProperties') continue;
    const segment = segments.find(
      (candidate) => candidate.runId === run.id && contains(child, candidate.node.id)
    );
    if (!segment) {
      headContent.push(child);
      continue;
    }
    if (segment.end <= offset) headContent.push(child);
    else if (segment.start >= offset) tailContent.push(child);
    else if (segment.node.kind === 'textValue') {
      const local = offset - segment.start;
      headContent.push(textElement(nextId, segment.node.value.slice(0, local)));
      tailContent.push(textElement(nextId, segment.node.value.slice(local)));
    } else headContent.push(child);
  }
  const head = runElement(nextId, rPr ? [rPr, ...headContent] : headContent);
  const tail = runElement(
    nextId,
    rPr ? [cloneWithNewIds(rPr, nextId), ...tailContent] : tailContent
  );
  const parent = parentOf(part, run.id);
  if (!parent) return { ok: false, reason: 'tree-invariant' };
  const rebuilt = parent.children.flatMap((child) =>
    child.id === run.id ? [head, tail] : [child]
  );
  const replaced = replaceChildren(part, parent.id, rebuilt, options);
  if (!replaced.ok)
    return { ok: false, reason: 'tree-invariant', detail: JSON.stringify(replaced.issues) };
  return { ok: true, part: replaced.part };
}

/** Paragraph text as the ops address it, for tests and callers computing offsets. */
export function paragraphTextOf(part: OoxmlPart, paragraphId: string): string | null {
  const paragraph = findNode(part, paragraphId);
  if (!isParagraph(paragraph)) return null;
  let text = '';
  for (const segment of segmentsOf(paragraph)) {
    if (segment.node.kind === 'textValue') text += segment.node.value;
    else if (segment.node.kind === 'tab') text += '\t';
    else if (segment.node.kind === 'hardBreak') text += hardBreakText(segment.node);
  }
  return text;
}
