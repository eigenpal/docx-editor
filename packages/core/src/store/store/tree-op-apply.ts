// Op application over the canonical tree (tree-ops seam).
//
// This module owns turning a VALIDATED op into a new part plus its structural effect.
// Application is pure: `applyTreeOp` never mutates its input, and it validates first via
// tree-op-validate.ts so a rejected op is a true no-op. The op vocabulary and the segment
// model live in tree-op-validate.ts; both are re-exported via tree-ops.ts.

import { hardBreakAttributes, hardBreakText } from '../package/hard-break.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlAttribute,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import {
  createNodeIdAllocator,
  findNode,
  insertChildren,
  removeNode,
  replaceChildren,
  replaceNode,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import { W14_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import {
  isValidParaId,
  mintParaId,
  mintedParagraphIdentityAttributes,
  paraIdOf,
  usedParaIds,
} from '../package/para-id.ts';
import {
  TEXT_DEPS,
  cloneWithNewIds,
  fromEdit,
  isParagraphPropertiesNode,
  isRunPropertiesNode,
  namedChild,
  ok,
  paragraphPropertiesNodeOf,
  parentOf,
  runPropertiesNodeOf,
} from './tree-op-nodes.ts';
import {
  PARAGRAPH_VOCABULARY,
  RUN_VOCABULARY,
  mergedPropertyChildren,
} from './tree-op-properties.ts';
import {
  applySetListLevel,
  applySetParagraphMarkProperties,
  withoutSectionMark,
  applySetListNumbering,
  applySetSectionMark,
  applySetSectionProperties,
} from './tree-op-section.ts';
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
  if (op.op === 'setSectionProperties') return applySetSectionProperties(part, op, options);
  if (op.op === 'setSectionMark') return applySetSectionMark(part, op.paragraphId, options);

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
    case 'setListLevel':
      return applySetListLevel(part, paragraph, op.level, options, nextId);
    case 'setParagraphMarkProperties':
      return applySetParagraphMarkProperties(part, paragraph, op.properties, options, nextId);
    case 'setListNumbering':
      return applySetListNumbering(part, paragraph, op.numId, op.level ?? 0, options, nextId);
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
      const existing = paragraphPropertiesNodeOf(paragraph);
      const children = mergedPropertyChildren(
        existing?.children ?? [],
        op.properties,
        PARAGRAPH_VOCABULARY,
        nextId
      );
      const effect: TreeOpEffect = {
        dirty: [paragraph.id],
        created: [],
        deleted: [],
        dependencyKeys: TEXT_DEPS,
        impact: 'paragraph-local',
      };
      if (children.length === 0) {
        // Nothing left to hold: the container goes rather than staying as an empty `w:pPr`,
        // so a cleared paragraph digests identically to one that never had any.
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
      const hasContent = child.children.some((grand) => !isRunPropertiesNode(grand));
      if (hasContent) continue;
      const removed = removeNode(current, child.id, options);
      if (!removed.ok) return fromEdit(removed, effect);
      current = removed.part;
    }
  }
  return ok(current, effect);
}

/**
 * The range markers that CLOSE a span of content (17.13.6, 17.13.5.2, 17.13.4.x).
 *
 * A marker sitting exactly on the split has no character to sit before or after, so the
 * side it takes is a decision: an end marker stays with the head, leaving the range it
 * closes closed around the content it always covered, and everything else — a start
 * marker, a hyperlink, a picture's run — moves down with the caret.
 */
const RANGE_END_MARKERS: ReadonlySet<string> = new Set([
  'bookmarkEnd',
  'commentRangeEnd',
  'moveFromRangeEnd',
  'moveToRangeEnd',
  'permEnd',
  'customXmlInsRangeEnd',
  'customXmlDelRangeEnd',
  'customXmlMoveFromRangeEnd',
  'customXmlMoveToRangeEnd',
]);

/** The range-START element each range-END element closes; `w:id` pairs the two. */
const RANGE_START_OF_END: ReadonlyMap<string, string> = new Map([
  ['bookmarkEnd', 'bookmarkStart'],
  ['commentRangeEnd', 'commentRangeStart'],
  ['moveFromRangeEnd', 'moveFromRangeStart'],
  ['moveToRangeEnd', 'moveToRangeStart'],
  ['permEnd', 'permStart'],
  ['customXmlInsRangeEnd', 'customXmlInsRangeStart'],
  ['customXmlDelRangeEnd', 'customXmlDelRangeStart'],
  ['customXmlMoveFromRangeEnd', 'customXmlMoveFromRangeStart'],
  ['customXmlMoveToRangeEnd', 'customXmlMoveToRangeStart'],
]);

const RANGE_START_MARKERS: ReadonlySet<string> = new Set(RANGE_START_OF_END.values());

function closesARange(node: OoxmlNode): boolean {
  return node.kind !== 'textValue' && RANGE_END_MARKERS.has(node.localName);
}

/** A marker's identity as `name\0id`, so a start and the end that closes it share a key. */
function rangeKey(localName: string, node: OoxmlNode): string | null {
  if (node.kind === 'textValue') return null;
  const id = node.attributes.find((attribute) => attribute.localName === 'id');
  return id ? `${localName} ${id.value}` : null;
}

function opensARange(node: OoxmlNode): string | null {
  if (node.kind === 'textValue' || !RANGE_START_MARKERS.has(node.localName)) return null;
  return rangeKey(node.localName, node);
}

/**
 * Whether a range-end marker closes a range that was already OPEN before this position.
 *
 * An end marker stays with the head so the range it closes stays closed around the content
 * it always covered — but only when its start is behind it. A range that opens AND closes at
 * the split (an empty bookmark, a comment anchored on the caret) has its start marker in the
 * tail: keeping the end behind emitted `<w:p>…<w:bookmarkEnd id="1"/></w:p><w:p><w:bookmark
 * Start id="1"/>…` — the pair inverted across two paragraphs, an end with no start before it.
 * Such an end follows its own start into the tail instead.
 */
function closesAnOpenRange(child: OoxmlNode, openedHere: ReadonlySet<string>): boolean {
  if (!closesARange(child) || child.kind === 'textValue') return false;
  const opener = RANGE_START_OF_END.get(child.localName);
  const key = opener ? rangeKey(opener, child) : null;
  return key === null || !openedHere.has(key);
}

/**
 * Which half a paragraph child that measures ZERO characters belongs to.
 *
 * A hyperlink, a bookmark or comment marker, a run holding only a picture: none of them
 * contributes a text offset, but each sits at a definite POSITION between the runs that do.
 * Sending them all to the head — the rule this replaces — moved every hyperlink in a
 * sentence backwards past the caret, left comment ranges as empty marker pairs around the
 * wrong half, and carried an inline picture into the paragraph below when the user pressed
 * Enter at the end of the line.
 */
function zeroLengthGoesToHead(
  child: OoxmlNode,
  position: number,
  offset: number,
  openedHere: ReadonlySet<string>
): boolean {
  if (position !== offset) return position < offset;
  return closesAnOpenRange(child, openedHere);
}

/**
 * A root-declared w14 prefix that still resolves to the w14 URI AT THE PARAGRAPH.
 *
 * The root binding alone is not enough: a hostile descendant can rebind the same
 * prefix (`<w:sdt xmlns:w14="urn:evil">`), and an attribute minted under it would
 * resolve to the wrong URI at that depth — the commit-boundary delta validation
 * would then refuse the WHOLE transaction, turning Enter into a silent no-op inside
 * that subtree. Editing must never lock on hostile input, so each root alias for the
 * URI is checked against the paragraph's ancestor chain and the first unshadowed one
 * wins; none → no minting (the tail is simply id-less, as before minting existed).
 */
function w14PrefixInScopeAt(part: OoxmlPart, paragraph: OoxmlParagraphNode): string | null {
  const rootBindings = part.root.namespaceBindings.filter(
    (binding) => binding.namespaceUri === W14_NAMESPACE_URI && binding.prefix !== ''
  );
  if (rootBindings.length === 0) return null;
  // The paragraph and its ancestors up to (excluding) the root — the nodes whose own
  // declarations can shadow a root binding at the paragraph's depth.
  const chain: OoxmlNode[] = [];
  let node: OoxmlNode | null = paragraph;
  while (node && node.id !== part.root.id) {
    chain.push(node);
    node = parentOf(part, node.id);
  }
  for (const binding of rootBindings) {
    const shadowed = chain.some(
      (ancestor) =>
        ancestor.kind !== 'textValue' &&
        ancestor.namespaceBindings.some(
          (candidate) =>
            candidate.prefix === binding.prefix && candidate.namespaceUri !== W14_NAMESPACE_URI
        )
    );
    if (!shadowed) return binding.prefix;
  }
  return null;
}

/**
 * Whether a split of `paragraph` can mint `w14:paraId`s for its tails: the head must
 * carry a valid id (its uppercase form seeds the tail mints) and a w14 prefix must be
 * in scope at the paragraph (a prefixed attribute without a correct in-scope binding
 * fails the commit-boundary delta validation). In a real session both always hold —
 * the load-time normalization established them. In low-level harnesses that skip it,
 * and in hostile prefix-shadowed subtrees, tails stay attribute-less exactly as
 * before minting existed — never a refused transaction.
 */
function splitIdentityOf(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode
): { readonly headId: string; readonly prefix: string } | null {
  const headParaId = paraIdOf(paragraph);
  if (headParaId === null || !isValidParaId(headParaId)) return null;
  const prefix = w14PrefixInScopeAt(part, paragraph);
  if (prefix === null) return null;
  return { headId: headParaId.toUpperCase(), prefix };
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
  const pPr = paragraphPropertiesNodeOf(paragraph);

  // The running text offset the walk has reached, which is the position of anything that
  // measures nothing.
  let cursor = 0;
  // The range starts seen AT the current position — the ones whose end markers, if they
  // also sit here, must not be left behind in the head.
  const openedHere = new Set<string>();
  for (const child of paragraph.children) {
    if (isParagraphPropertiesNode(child)) continue;
    const runSegments =
      child.kind === 'run' ? segments.filter((segment) => segment.runId === child.id) : [];
    if (runSegments.length === 0) {
      (zeroLengthGoesToHead(child, cursor, offset, openedHere) ? headChildren : tailChildren).push(
        child
      );
      const opened = opensARange(child);
      if (opened) openedHere.add(opened);
      continue;
    }
    const runStart = runSegments[0]!.start;
    const runEnd = runSegments[runSegments.length - 1]!.end;
    if (runEnd > cursor) openedHere.clear();
    cursor = runEnd;
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
    const rPr = runPropertiesNodeOf(child);
    const headContent: OoxmlNode[] = [];
    const tailContent: OoxmlNode[] = [];
    for (const grand of child.children) {
      if (isRunPropertiesNode(grand)) continue;
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

  // A `w:sectPr` in the split paragraph's mark belongs to the TAIL: Word splits by
  // inserting a fresh mark before the existing one, so the original mark — and the
  // section boundary it carries — stays after ALL the paragraph's content. Cloning it
  // onto both halves minted a phantom section (and a spurious page break) on every
  // Enter in a section's last paragraph.
  const headPPr = pPr ? withoutSectionMark(pPr) : undefined;
  // The HEAD keeps the original paragraph's `w14:paraId` (it is spread below); the tail
  // is the new paragraph and gets a fresh deterministic mint, exactly as Word assigns a
  // new id to the paragraph an Enter creates. Seeded by (head id, offset) so one
  // `splitParagraphMany` and its equivalent sequence of single splits mint identically.
  const identity = splitIdentityOf(part, paragraph);
  const tailParagraph = {
    id: nextId(),
    kind: 'paragraph',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'p',
    prefix: 'w',
    namespaceBindings: [],
    attributes: identity
      ? mintedParagraphIdentityAttributes(
          identity.prefix,
          mintParaId(`${identity.headId}:${offset}`, usedParaIds(part.root))
        )
      : [],
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
    children: headPPr ? [headPPr, ...headChildren] : headChildren,
  }) as OoxmlNode;
  const siblings = parent.children.flatMap((child) =>
    child.id === paragraph.id ? [headParagraph, tailParagraph] : [child]
  );
  return fromEdit(replaceChildren(part, parent.id, siblings, options), effect);
}

/** The resulting paragraph a source offset belongs to: how many boundaries lie at or before it. */
function pieceIndexOf(
  offsets: readonly number[],
  position: number,
  atBoundary: 'tail' | 'head' = 'tail'
): number {
  // Binary search — a whole-document paste can carry thousands of boundaries, and every
  // segment asks. Content sitting exactly ON a boundary opens that boundary's tail, which
  // is what the equivalent sequence of single splits does; `head` is for the range-end
  // markers the single split keeps behind, so a range that closed at the caret stays closed.
  let low = 0;
  let high = offsets.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const before = atBoundary === 'tail' ? offsets[mid]! <= position : offsets[mid]! < position;
    if (before) low = mid + 1;
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
  const pPr = paragraphPropertiesNodeOf(paragraph);
  const pieceCount = offsets.length + 1;
  const pieces: OoxmlNode[][] = Array.from({ length: pieceCount }, () => []);

  // The running text offset the walk has reached — the position of anything measuring
  // nothing, exactly as the single split reads it.
  let cursor = 0;
  const openedHere = new Set<string>();
  for (const child of paragraph.children) {
    if (isParagraphPropertiesNode(child)) continue;
    const runSegments =
      child.kind === 'run' ? segments.filter((segment) => segment.runId === child.id) : [];
    if (runSegments.length === 0) {
      const piece = pieceIndexOf(
        offsets,
        cursor,
        closesAnOpenRange(child, openedHere) ? 'head' : 'tail'
      );
      pieces[piece]!.push(child);
      const opened = opensARange(child);
      if (opened) openedHere.add(opened);
      continue;
    }
    const runStart = runSegments[0]!.start;
    const runEnd = runSegments[runSegments.length - 1]!.end;
    if (runEnd > cursor) openedHere.clear();
    cursor = runEnd;
    const startPiece = pieceIndexOf(offsets, runStart);
    const endPiece = runEnd > runStart ? pieceIndexOf(offsets, runEnd - 1) : startPiece;
    if (startPiece === endPiece) {
      // Wholly inside one resulting paragraph: the run survives with its identity.
      pieces[startPiece]!.push(child);
      continue;
    }

    // The run straddles at least one boundary: divide its content children, keeping
    // `w:rPr` on every produced piece so formatting survives each break.
    const rPr = runPropertiesNodeOf(child);
    const contentByPiece: OoxmlNode[][] = Array.from({ length: pieceCount }, () => []);
    for (const grand of child.children) {
      if (isRunPropertiesNode(grand)) continue;
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

  // A `w:sectPr` in the mark belongs to the LAST piece only — the original mark ends up
  // after all the paragraph's content, exactly as the single-split rule keeps it on the
  // tail. Duplicating it minted one phantom section per pasted line.
  const strippedPPr = pPr ? withoutSectionMark(pPr) : undefined;
  // Tail `w14:paraId`s, minted in DESCENDING piece order: the equivalent sequence of
  // single splits runs last-offset-first, so its used-set grows from the last tail
  // backwards. Mirroring that order (including how a repeated offset's seed collision
  // bumps) keeps `splitParagraphMany` byte-identical to the singles it stands for.
  const identity = splitIdentityOf(part, paragraph);
  const tailIdentityAttributes: (readonly OoxmlAttribute[] | null)[] = Array.from(
    { length: pieceCount },
    () => null
  );
  if (identity) {
    const used = new Set(usedParaIds(part.root));
    for (let piece = pieceCount - 1; piece >= 1; piece -= 1) {
      const value = mintParaId(`${identity.headId}:${offsets[piece - 1]!}`, used);
      used.add(value);
      tailIdentityAttributes[piece] = mintedParagraphIdentityAttributes(identity.prefix, value);
    }
  }
  const tailParagraphs: OoxmlNode[] = [];
  for (let piece = 1; piece < pieceCount; piece += 1) {
    const last = piece === pieceCount - 1;
    const source = last ? pPr : strippedPPr;
    tailParagraphs.push({
      id: nextId(),
      kind: 'paragraph',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'p',
      prefix: 'w',
      namespaceBindings: [],
      attributes: tailIdentityAttributes[piece] ?? [],
      children: source ? [cloneWithNewIds(source, nextId), ...pieces[piece]!] : pieces[piece]!,
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
    children: strippedPPr ? [strippedPPr, ...pieces[0]!] : pieces[0]!,
  }) as OoxmlNode;
  const siblings = parent.children.flatMap((child) =>
    child.id === paragraph.id ? [headParagraph, ...tailParagraphs] : [child]
  );
  return fromEdit(replaceChildren(part, parent.id, siblings, options), effect);
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
  const moved = second.children.filter((child) => !isParagraphPropertiesNode(child));

  // A single edit against the shared parent: the surviving `w:p` receives the second
  // paragraph's content children, and the second `w:p` leaves the child sequence, in the
  // same rebuild. Expressed as remove-then-reparent the join produced two intermediate
  // trees per op; a single rebuild has no intermediate state at all, so the moved runs are
  // never under two parents at any point.
  const first = parent.children.find((child) => child.id === firstId);
  if (!first || first.kind !== 'paragraph') {
    return { ok: false, reason: 'tree-invariant', detail: 'survivor missing' };
  }
  const nextId = createNodeIdAllocator(part);
  const kept = withSectionMarkOf(first, second, nextId);
  const merged = Object.freeze({ ...kept, children: [...kept.children, ...moved] }) as OoxmlNode;
  const siblings = parent.children.flatMap((child) =>
    child.id === firstId ? [merged] : child.id === secondId ? [] : [child]
  );
  return fromEdit(replaceChildren(part, parent.id, siblings, options), effect);
}

/**
 * The join survivor, carrying the SECTION MARK of the paragraph that leaves.
 *
 * `w:sectPr` in a paragraph's mark is not formatting: it is where a section ENDS (17.6.17).
 * A join deletes the FIRST paragraph's mark, so the mark that survives the merge is the
 * second's, and the section boundary rides on it. Dropping it with the rest of the second
 * paragraph's `w:pPr` merged the section into the one that follows, taking that section's
 * page size, orientation and headers over every page of it.
 */
function withSectionMarkOf(
  first: OoxmlNode & { readonly children: readonly OoxmlNode[] },
  second: OoxmlParagraphNode,
  nextId: () => string
): OoxmlNode & { readonly children: readonly OoxmlNode[] } {
  const sectPr = namedChild(paragraphPropertiesNodeOf(second), 'sectPr');
  if (!sectPr) return first;
  const carried = cloneWithNewIds(sectPr, nextId);
  const pPr = paragraphPropertiesNodeOf(first);
  if (!pPr) {
    const minted = {
      id: nextId(),
      kind: 'paragraphProperties',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'pPr',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [],
      children: [carried],
    } as unknown as OoxmlNode;
    // `w:pPr` must be the paragraph's FIRST child per the schema.
    return { ...first, children: [minted, ...first.children] } as OoxmlNode & {
      readonly children: readonly OoxmlNode[];
    };
  }
  // The survivor's own mark, if it had one, goes with the paragraph mark being deleted.
  // `w:sectPr` sits near the END of CT_PPr's sequence, before only `w:pPrChange`.
  const others = pPr.children.filter(
    (child) => child.kind === 'textValue' || child.localName !== 'sectPr'
  );
  const change = others.findIndex(
    (child) => child.kind !== 'textValue' && child.localName === 'pPrChange'
  );
  const at = change === -1 ? others.length : change;
  const rebuilt = {
    ...pPr,
    children: [...others.slice(0, at), carried, ...others.slice(at)],
  } as OoxmlNode;
  return {
    ...first,
    children: first.children.map((child) => (child.id === pPr.id ? rebuilt : child)),
  } as OoxmlNode & { readonly children: readonly OoxmlNode[] };
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
    const existing = runPropertiesNodeOf(run);
    const content = run.children.filter((child) => !isRunPropertiesNode(child));
    const children = mergedPropertyChildren(
      existing?.children ?? [],
      properties,
      RUN_VOCABULARY,
      nextId
    );
    if (children.length === 0) {
      if (!existing) continue;
      const cleared = replaceChildren(current, run.id, content, options);
      if (!cleared.ok) return fromEdit(cleared, effect);
      current = cleared.part;
      continue;
    }
    // An EXISTING container is rewritten in place, kind and attributes intact. Minting a
    // typed replacement for one the read demoted would have dropped whatever demoted it
    // (a `w:val` on `w:rPr`), and a typed node may not carry that attribute at all.
    const rPr = existing
      ? ({ ...existing, children } as OoxmlNode)
      : ({
          id: nextId(),
          kind: 'runProperties',
          namespaceUri: WML_NAMESPACE_URI,
          localName: 'rPr',
          prefix: 'w',
          namespaceBindings: [],
          attributes: [],
          children,
        } as unknown as OoxmlNode);
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
  // The run the offset falls INSIDE, wherever inside: looking only for a straddling TEXT
  // VALUE missed every boundary between two of a run's own children. A `w:tab` and a
  // `w:br` each measure one character, so `<w:r><w:t>a</w:t><w:tab/><w:t>b</w:t></w:r>`
  // has edges at 1 and 2 that no text value straddles — the run was left whole, the range
  // then matched it through the tab's segment, and formatting the tab alone bolded all
  // three characters.
  const runIds: string[] = [];
  for (const segment of segments) {
    if (runIds[runIds.length - 1] !== segment.runId) runIds.push(segment.runId);
  }
  const straddling = runIds.find((runId) => {
    const own = segments.filter((segment) => segment.runId === runId);
    return own[0]!.start < offset && own[own.length - 1]!.end > offset;
  });
  if (straddling === undefined) return { ok: true, part };
  const run = findNode(part, straddling);
  if (!run || run.kind !== 'run') return { ok: false, reason: 'tree-invariant' };
  const nextId = createNodeIdAllocator(part);
  const rPr = runPropertiesNodeOf(run);
  const headContent: OoxmlNode[] = [];
  const tailContent: OoxmlNode[] = [];
  for (const child of run.children) {
    if (isRunPropertiesNode(child)) continue;
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
