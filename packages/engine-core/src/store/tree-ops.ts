// Paragraph semantic operations over the canonical tree (task 5.1 / 5.2).
//
// Every op addresses STABLE NODE IDENTITIES and UTF-16 offsets, never byte ranges — that is
// the whole difference from the model these replace, where an edit was a splice into the
// original XML text and a paragraph with no captured byte range could not be edited at all.
//
// Ops are declarative and JSON-safe. Application is pure: `applyTreeOp` returns a new part
// plus the structural effect, or a typed rejection, and never mutates its input. Validation
// runs BEFORE any tree work, so a rejected op leaves the tree, revision and indexes exactly
// as they were.

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
  removeNode,
  replaceChildren,
  replaceNode,
  type OoxmlEditResult,
} from '../package/ooxml-edit.ts';
import { isValidXmlText } from '../package/sinks.ts';
import { DEPENDENCY_KEY_IDS } from '../registry/frozen-ids.ts';

/**
 * The accepted RUN property boundary (design D8), as the OOXML element names that carry it.
 *
 * An explicit allowlist rather than "any `w:rPr` child": a property outside D8 has no
 * resolver, no layout behavior and no support claim, so accepting it here would let an
 * operation assert support the engine does not have. Unknown properties still ROUND-TRIP —
 * they are generic nodes in the tree — they simply cannot be authored by an op.
 */
export const ACCEPTED_RUN_PROPERTIES = [
  'rFonts', // font family
  'sz', // half-point size
  'szCs',
  'color',
  'b', // bold
  'bCs',
  'i', // italic
  'iCs',
  'u', // underline variant and color
  'strike',
  'dstrike', // double strike
  'highlight',
  'vertAlign', // superscript / subscript
  'position', // baseline offset
  'caps',
  'smallCaps',
  'spacing', // character spacing
  'w', // horizontal scaling
  'kern',
] as const;

/** The accepted PARAGRAPH property boundary (design D8). */
export const ACCEPTED_PARAGRAPH_PROPERTIES = [
  'pStyle',
  'jc', // alignment
  'spacing', // before/after + line spacing and rule
  'ind', // left/right/first-line/hanging indents
  'tabs',
  'numPr', // numbering identity and level
  'keepNext',
  'keepLines',
  'widowControl',
  'pageBreakBefore',
  'shd', // shading
] as const;

export type AcceptedRunProperty = (typeof ACCEPTED_RUN_PROPERTIES)[number];
export type AcceptedParagraphProperty = (typeof ACCEPTED_PARAGRAPH_PROPERTIES)[number];

const RUN_PROPERTY_SET: ReadonlySet<string> = new Set(ACCEPTED_RUN_PROPERTIES);
const PARAGRAPH_PROPERTY_SET: ReadonlySet<string> = new Set(ACCEPTED_PARAGRAPH_PROPERTIES);

/**
 * One authored property: an element name plus its `w:`-namespace attributes.
 *
 * Modeled as name+attributes rather than a typed record per property because that is what
 * the tree holds, so an op maps to nodes without a lossy intermediate vocabulary. Attribute
 * VALUES are validated as XML text; their meaning is the resolver's business.
 */
export interface OoxmlProperty {
  readonly localName: string;
  readonly attributes?: Readonly<Record<string, string>>;
}

export type TreeDocOp =
  | {
      readonly op: 'insertText';
      readonly paragraphId: string;
      readonly offset: number;
      readonly text: string;
    }
  | {
      readonly op: 'deleteText';
      readonly paragraphId: string;
      readonly start: number;
      readonly end: number;
    }
  | { readonly op: 'insertTab'; readonly paragraphId: string; readonly offset: number }
  | { readonly op: 'insertHardBreak'; readonly paragraphId: string; readonly offset: number }
  | { readonly op: 'splitParagraph'; readonly paragraphId: string; readonly offset: number }
  | { readonly op: 'joinParagraphs'; readonly firstId: string; readonly secondId: string }
  | {
      readonly op: 'setRunProperties';
      readonly paragraphId: string;
      readonly start: number;
      readonly end: number;
      readonly properties: readonly OoxmlProperty[];
    }
  | {
      readonly op: 'setParagraphProperties';
      readonly paragraphId: string;
      readonly properties: readonly OoxmlProperty[];
    };

export type TreeDocOpKind = TreeDocOp['op'];

export const TREE_DOC_OP_KINDS = [
  'insertText',
  'deleteText',
  'insertTab',
  'insertHardBreak',
  'splitParagraph',
  'joinParagraphs',
  'setRunProperties',
  'setParagraphProperties',
] as const satisfies readonly TreeDocOpKind[];

// Compile-time exhaustiveness, matching the legacy `DOC_OP_KINDS` guard: a new op must be
// listed here or this fails to typecheck, so it can never be silently unvalidated.
type _MissingTreeOp = Exclude<TreeDocOpKind, (typeof TREE_DOC_OP_KINDS)[number]>;
const _treeOpsExhaustive: _MissingTreeOp extends never ? true : ['missing', _MissingTreeOp] = true;
void _treeOpsExhaustive;

/**
 * How far a committed op can reach, so layout can scope its work (task 5.2).
 *
 * `text-local` touches one paragraph's characters; `paragraph-local` changes one
 * paragraph's own properties; `flow-structural` changes the block sequence and can
 * repaginate everything after it.
 */
export type ImpactClass = 'text-local' | 'paragraph-local' | 'flow-structural';

export interface TreeOpEffect {
  readonly dirty: readonly string[];
  readonly created: readonly string[];
  readonly deleted: readonly string[];
  readonly split?: { readonly from: string; readonly tail: string };
  readonly join?: { readonly kept: string; readonly removed: string };
  readonly dependencyKeys: readonly string[];
  readonly impact: ImpactClass;
}

export type TreeOpRejection =
  | 'unknown-op'
  | 'unknown-paragraph'
  | 'not-a-paragraph'
  | 'offset-out-of-range'
  | 'invalid-range'
  | 'splits-surrogate-pair'
  | 'invalid-text'
  | 'unsupported-property'
  | 'invalid-property-value'
  | 'not-adjacent-siblings'
  | 'tree-invariant';

export type TreeOpResult =
  | { readonly ok: true; readonly part: OoxmlPart; readonly effect: TreeOpEffect }
  | { readonly ok: false; readonly reason: TreeOpRejection; readonly detail?: string };

/** One addressable unit of paragraph text: a text value, a tab, or a hard break. */
interface Segment {
  readonly runId: string;
  readonly node: OoxmlNode;
  readonly start: number;
  readonly end: number;
}

function isParagraph(node: OoxmlNode | null): node is OoxmlParagraphNode {
  return node !== null && node.kind === 'paragraph';
}

/** Flatten a paragraph into UTF-16 addressable segments, in document order. */
function segmentsOf(paragraph: OoxmlParagraphNode): Segment[] {
  const segments: Segment[] = [];
  let offset = 0;
  const visit = (node: OoxmlNode, runId: string): void => {
    if (node.kind === 'textValue') {
      segments.push({ runId, node, start: offset, end: offset + node.value.length });
      offset += node.value.length;
      return;
    }
    if (node.kind === 'tab' || node.kind === 'hardBreak') {
      segments.push({ runId, node, start: offset, end: offset + 1 });
      offset += 1;
      return;
    }
    if (node.kind === 'runProperties' || node.kind === 'generic') return;
    for (const child of node.children) visit(child, runId);
  };
  for (const child of paragraph.children) {
    if (child.kind !== 'run') continue;
    for (const grand of child.children) visit(grand, child.id);
  }
  return segments;
}

function paragraphLength(paragraph: OoxmlParagraphNode): number {
  const segments = segmentsOf(paragraph);
  return segments.length === 0 ? 0 : segments[segments.length - 1]!.end;
}

/** Whether an offset falls between the halves of a surrogate pair. */
function splitsSurrogate(paragraph: OoxmlParagraphNode, offset: number): boolean {
  for (const segment of segmentsOf(paragraph)) {
    if (segment.node.kind !== 'textValue') continue;
    if (offset <= segment.start || offset >= segment.end) continue;
    const local = offset - segment.start;
    const before = segment.node.value.charCodeAt(local - 1);
    const after = segment.node.value.charCodeAt(local);
    if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) return true;
  }
  return false;
}

function validateProperties(
  properties: readonly OoxmlProperty[],
  accepted: ReadonlySet<string>
): TreeOpRejection | null {
  for (const property of properties) {
    if (!accepted.has(property.localName)) return 'unsupported-property';
    for (const [name, value] of Object.entries(property.attributes ?? {})) {
      // Attribute names and values are written straight into XML on save, so both are
      // checked here rather than at the sink — a rejected op must never reach the tree.
      if (!/^[A-Za-z_][\w.-]*$/.test(name)) return 'invalid-property-value';
      if (typeof value !== 'string' || !isValidXmlText(value)) return 'invalid-property-value';
    }
  }
  return null;
}

/** Structural validation, run before any tree work so a rejection changes nothing. */
export function validateTreeOp(part: OoxmlPart, op: TreeDocOp): TreeOpRejection | null {
  if (!TREE_DOC_OP_KINDS.includes(op.op)) return 'unknown-op';

  if (op.op === 'joinParagraphs') {
    const first = findNode(part, op.firstId);
    const second = findNode(part, op.secondId);
    if (!first || !second) return 'unknown-paragraph';
    if (!isParagraph(first) || !isParagraph(second)) return 'not-a-paragraph';
    return null;
  }

  const paragraph = findNode(part, op.paragraphId);
  if (!paragraph) return 'unknown-paragraph';
  if (!isParagraph(paragraph)) return 'not-a-paragraph';
  const length = paragraphLength(paragraph);

  switch (op.op) {
    case 'insertText': {
      if (!Number.isInteger(op.offset) || op.offset < 0 || op.offset > length) {
        return 'offset-out-of-range';
      }
      if (typeof op.text !== 'string' || !isValidXmlText(op.text)) return 'invalid-text';
      if (splitsSurrogate(paragraph, op.offset)) return 'splits-surrogate-pair';
      return null;
    }
    case 'insertTab':
    case 'insertHardBreak': {
      if (!Number.isInteger(op.offset) || op.offset < 0 || op.offset > length) {
        return 'offset-out-of-range';
      }
      if (splitsSurrogate(paragraph, op.offset)) return 'splits-surrogate-pair';
      return null;
    }
    case 'splitParagraph': {
      if (!Number.isInteger(op.offset) || op.offset < 0 || op.offset > length) {
        return 'offset-out-of-range';
      }
      if (splitsSurrogate(paragraph, op.offset)) return 'splits-surrogate-pair';
      return null;
    }
    case 'deleteText': {
      if (!Number.isInteger(op.start) || !Number.isInteger(op.end)) return 'invalid-range';
      if (op.start < 0 || op.end > length) return 'offset-out-of-range';
      if (op.start >= op.end) return 'invalid-range';
      if (splitsSurrogate(paragraph, op.start) || splitsSurrogate(paragraph, op.end)) {
        return 'splits-surrogate-pair';
      }
      return null;
    }
    case 'setRunProperties': {
      if (!Number.isInteger(op.start) || !Number.isInteger(op.end)) return 'invalid-range';
      if (op.start < 0 || op.end > length) return 'offset-out-of-range';
      if (op.start >= op.end) return 'invalid-range';
      return validateProperties(op.properties, RUN_PROPERTY_SET);
    }
    case 'setParagraphProperties':
      return validateProperties(op.properties, PARAGRAPH_PROPERTY_SET);
    default:
      return 'unknown-op';
  }
}

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

function simpleElement(nextId: () => string, localName: 'tab' | 'br'): OoxmlNode {
  return {
    id: nextId(),
    kind: localName === 'tab' ? 'tab' : 'hardBreak',
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
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
 */
export function applyTreeOp(part: OoxmlPart, op: TreeDocOp): TreeOpResult {
  const rejection = validateTreeOp(part, op);
  if (rejection) return { ok: false, reason: rejection };

  if (op.op === 'joinParagraphs') return applyJoin(part, op.firstId, op.secondId);

  const paragraph = findNode(part, op.paragraphId) as OoxmlParagraphNode;
  const nextId = createNodeIdAllocator(part);

  switch (op.op) {
    case 'insertText':
      return applyInsertContent(part, paragraph, op.offset, [(mint) => textElement(mint, op.text)]);
    case 'insertTab':
      return applyInsertContent(part, paragraph, op.offset, [(mint) => simpleElement(mint, 'tab')]);
    case 'insertHardBreak':
      return applyInsertContent(part, paragraph, op.offset, [(mint) => simpleElement(mint, 'br')]);
    case 'deleteText':
      return applyDeleteText(part, paragraph, op.start, op.end);
    case 'splitParagraph':
      return applySplit(part, paragraph, op.offset);
    case 'setRunProperties':
      return applySetRunProperties(part, paragraph, op.start, op.end, op.properties);
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
        return existing ? fromEdit(removeNode(part, existing.id), effect) : ok(part, effect);
      }
      if (existing) return fromEdit(replaceChildren(part, existing.id, children), effect);
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
      return fromEdit(insertChildren(part, paragraph.id, 0, [pPr]), effect);
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
  builders: readonly ((mint: () => string) => OoxmlNode)[]
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
    return fromEdit(replaceChildren(part, run.id, rebuilt), effect);
  }

  // At a boundary: append to the run holding the offset, or to the last run.
  const boundary = segments.find((segment) => segment.start === offset);
  if (boundary) {
    const run = findNode(part, boundary.runId);
    if (!run || run.kind !== 'run') return { ok: false, reason: 'tree-invariant' };
    const index = run.children.findIndex((child) => contains(child, boundary.node.id));
    return fromEdit(insertChildren(part, run.id, Math.max(0, index), nodes), effect);
  }

  const runs = paragraph.children.filter((child) => child.kind === 'run');
  const last = runs[runs.length - 1];
  if (last) return fromEdit(insertChildren(part, last.id, last.children.length, nodes), effect);
  // An empty paragraph: the content needs a run to live in.
  return fromEdit(
    insertChildren(part, paragraph.id, paragraph.children.length, [runElement(nextId, nodes)]),
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
  end: number
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
      const removed = removeNode(current, segment.node.id);
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
        ? removeNode(current, owner.id)
        : replaceNode(current, owner.id, textElement(nextId, value));
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
      const removed = removeNode(current, child.id);
      if (!removed.ok) return fromEdit(removed, effect);
      current = removed.part;
    }
  }
  return ok(current, effect);
}

function applySplit(part: OoxmlPart, paragraph: OoxmlParagraphNode, offset: number): TreeOpResult {
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

  const head = replaceChildren(part, paragraph.id, pPr ? [pPr, ...headChildren] : headChildren);
  if (!head.ok) return fromEdit(head, effect);
  const parent = parentOf(head.part, paragraph.id);
  if (!parent) return { ok: false, reason: 'tree-invariant', detail: 'paragraph has no parent' };
  const index = parent.children.findIndex((child) => child.id === paragraph.id);
  return fromEdit(insertChildren(head.part, parent.id, index + 1, [tailParagraph]), effect);
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
  const walk = (node: OoxmlNode): OoxmlElement | null => {
    if (node.kind === 'textValue') return null;
    if (node.children.some((child) => child.id === nodeId)) return node;
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(part.root);
}

function applyJoin(part: OoxmlPart, firstId: string, secondId: string): TreeOpResult {
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

  // Remove the source paragraph BEFORE re-parenting its children. Doing it the other way
  // round puts those nodes under two parents at once, and the invariant check inside the
  // first edit rejects the duplicate ids before the second edit can clean them up.
  const removed = removeNode(part, secondId);
  if (!removed.ok) return fromEdit(removed, effect);
  const survivor = findNode(removed.part, firstId);
  if (!survivor || survivor.kind !== 'paragraph') {
    return { ok: false, reason: 'tree-invariant', detail: 'survivor missing after removal' };
  }
  return fromEdit(replaceChildren(removed.part, firstId, [...survivor.children, ...moved]), effect);
}

function applySetRunProperties(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  start: number,
  end: number,
  properties: readonly OoxmlProperty[]
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
    const split = splitRunsAt(current, target, boundary);
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
      const cleared = replaceChildren(current, run.id, content);
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
    const updated = replaceChildren(current, run.id, [rPr, ...content]);
    if (!updated.ok) return fromEdit(updated, effect);
    current = updated.part;
  }
  return ok(current, effect);
}

/** Divide any run straddling `offset` so the offset falls on a run boundary. */
function splitRunsAt(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  offset: number
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
  const replaced = replaceChildren(part, parent.id, rebuilt);
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
    else text += '\n';
  }
  return text;
}
