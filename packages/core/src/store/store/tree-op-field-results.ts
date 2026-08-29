// Field-result refresh TreeDocOp — rewrite a field's cached RESULT runs in place.
//
// The op carries the paragraph, the field anchor (the run holding the `begin` fldChar, or
// the `w:fldSimple` element) and the new result text; the INSTRUCTION is never modified.
// The rewrite is fail-closed per field: it re-locates the anchor at apply time and touches
// only a result made of plain runs (`w:rPr` / `w:t` / `w:tab`). A result carrying revision
// markup, nested fields, bookmarks or any other structure is left exactly as it was — a
// stale cached value is recoverable in Word; a corrupted revision is not.

import {
  fieldOnOffAttribute,
  fldSimpleInstr,
  instrTextValue,
  isFldChar,
  isFldSimple,
  isInstrText,
} from '../package/field-nodes.ts';
import {
  createNodeIdAllocator,
  findNode,
  replaceChildren,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import { WML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { isValidXmlText } from '../package/sinks.ts';
import { effectiveContentLockAt, isBoundAt, ok, parentOf } from './tree-op-nodes.ts';
import type { TreeDocOp, TreeOpRejection, TreeOpResult } from './tree-op-types.ts';

export type RefreshFieldResultsOp = Extract<TreeDocOp, { op: 'refreshFieldResults' }>;

/** Ceiling on updates per op — mirrors the layout-side cap on live-resolved fields. */
export const MAX_FIELD_RESULT_UPDATES = 512;
/** Length cap on one rewritten result — a computed value must not inflate the tree. */
export const MAX_FIELD_RESULT_TEXT_CHARS = 2048;
/** Node budget for one paragraph's locate walk (hostile fan-out fails closed to "not found"). */
const MAX_LOCATE_NODES = 4096;
const MAX_LOCATE_DEPTH = 16;

/**
 * One field whose cached result the refresh op can address, as the planner sees it.
 *
 * `rewritable` is the whole plainness contract: the field is unlocked (`w:fldLock`), its
 * boundaries sit under one parent, and the result region is plain runs only, at least one.
 * The planner never emits an update for a non-rewritable field, and the applier re-checks,
 * so a hand-crafted op degrades to a skip rather than a structural rewrite.
 */
export interface LocatedFieldResult {
  /**
   * The field's begin `w:fldChar` node, or the `w:fldSimple` element itself — the SAME key
   * the layout's calibration registry uses, so a planner can pair a located result with the
   * field's live-vs-cached verdict without a second identity vocabulary.
   */
  readonly fieldNodeId: string;
  /** Raw instruction text (concatenated `w:instrText`, or `@w:instr`). Never executed. */
  readonly instruction: string;
  /** The cached result's text (`w:t` values, `w:tab` as `\t`) — `''` when not rewritable. */
  readonly cachedText: string;
  readonly rewritable: boolean;
}

interface LocatedField extends LocatedFieldResult {
  /** Element whose child list holds the field (paragraph, hyperlink, …) or the fldSimple. */
  readonly containerId: string;
  /** Result runs in order; the first receives the new text, the rest lose theirs. */
  readonly resultRunIds: readonly string[];
}

interface LocateBudget {
  nodes: number;
}

function isElement(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

/** Text of one plain result run: `w:t` values and `w:tab` as `\t`. */
function plainRunText(run: OoxmlElement): string {
  let text = '';
  for (const child of run.children) {
    if (child.kind === 'text') {
      for (const value of child.children) {
        if (value.kind === 'textValue') text += value.value;
      }
    } else if (child.kind === 'tab') {
      text += '\t';
    }
  }
  return text;
}

/**
 * Whether a run is PLAIN — only `w:rPr`, `w:t` and `w:tab` children, and an `w:rPr` free of
 * `w:rPrChange` (a tracked formatting change is revision markup the rewrite must not touch).
 */
function isPlainResultRun(node: OoxmlNode): node is OoxmlElement {
  if (node.kind !== 'run') return false;
  for (const child of node.children) {
    if (child.kind === 'runProperties') {
      const properties: readonly OoxmlNode[] = child.children;
      for (const property of properties) {
        if (property.kind !== 'textValue' && property.localName === 'rPrChange') return false;
      }
      continue;
    }
    if (child.kind === 'text') {
      if (child.children.some((value) => value.kind !== 'textValue')) return false;
      continue;
    }
    if (child.kind === 'tab') continue;
    return false;
  }
  return true;
}

/** Whether a run holds exactly one field boundary (`w:fldChar`) beside its `w:rPr`. */
function isBoundaryOnlyRun(run: OoxmlElement, type: 'separate' | 'end'): boolean {
  let sawBoundary = false;
  for (const child of run.children) {
    if (child.kind === 'runProperties') continue;
    if (isFldChar(child, type) && !sawBoundary) {
      sawBoundary = true;
      continue;
    }
    return false;
  }
  return sawBoundary;
}

/**
 * Consume one complex field starting at `children[beginIndex]` (a run whose children include
 * the `begin` fldChar). Returns the located field, or null when the field does not close
 * inside this child list — nested fields, boundaries split across containers, and anything
 * else outside the plain shape either fail the locate or mark the field non-rewritable.
 */
function consumeComplexField(
  containerId: string,
  children: readonly OoxmlNode[],
  beginIndex: number,
  budget: LocateBudget
): { field: LocatedField | null; nextIndex: number } {
  const beginRun = children[beginIndex] as OoxmlElement;
  let anchorId: string | null = null;
  let instruction = '';
  let locked = false;
  let plain = true;
  let phase: 'instruction' | 'result' = 'instruction';
  const resultRunIds: string[] = [];
  let cachedText = '';

  // The begin run itself: instruction text may share the run with the `begin` marker.
  for (const child of beginRun.children) {
    if (isFldChar(child, 'begin')) {
      if (anchorId !== null) return { field: null, nextIndex: beginIndex + 1 };
      anchorId = child.id;
      if (fieldOnOffAttribute(child, 'fldLock') === true) locked = true;
      continue;
    }
    if (child.kind === 'runProperties') continue;
    if (isInstrText(child)) {
      instruction += instrTextValue(child);
      continue;
    }
    // A second `begin` (nested field) or any other content makes the shape unsupported.
    return { field: null, nextIndex: beginIndex + 1 };
  }

  for (let index = beginIndex + 1; index < children.length; index += 1) {
    budget.nodes -= 1;
    if (budget.nodes <= 0) return { field: null, nextIndex: children.length };
    const node = children[index]!;
    // Only sibling RUNS are understood; a hyperlink, bookmark, SDT or revision wrapper
    // inside the field means the boundaries cannot be tracked here — fail the locate.
    if (node.kind !== 'run') return { field: null, nextIndex: index + 1 };
    if (node.children.some((child) => isFldChar(child, 'begin'))) {
      // A nested field anywhere within this one is out of scope for the rewrite.
      return { field: null, nextIndex: index + 1 };
    }
    if (node.children.some((child) => isFldChar(child, 'end'))) {
      if (!isBoundaryOnlyRun(node, 'end')) plain = false;
      if (anchorId === null) return { field: null, nextIndex: index + 1 };
      const rewritable = plain && !locked && phase === 'result' && resultRunIds.length > 0;
      return {
        field: {
          fieldNodeId: anchorId,
          instruction,
          cachedText: rewritable ? cachedText : '',
          rewritable,
          containerId,
          resultRunIds,
        },
        nextIndex: index + 1,
      };
    }
    if (node.children.some((child) => isFldChar(child, 'separate'))) {
      if (phase !== 'instruction' || !isBoundaryOnlyRun(node, 'separate')) plain = false;
      phase = 'result';
      continue;
    }
    if (phase === 'instruction') {
      for (const child of node.children) {
        if (child.kind === 'runProperties') continue;
        if (isInstrText(child)) instruction += instrTextValue(child);
        // Non-instruction content before `separate` is tolerated; the parse decides.
      }
      continue;
    }
    if (!isPlainResultRun(node)) {
      plain = false;
      continue;
    }
    resultRunIds.push(node.id);
    cachedText += plainRunText(node);
  }
  // The field never closed in this child list.
  return { field: null, nextIndex: children.length };
}

/** A `w:fldSimple`: the element is both anchor and result container. */
function locateSimpleField(node: OoxmlElement): LocatedField {
  const instruction = fldSimpleInstr(node) ?? '';
  const locked = fieldOnOffAttribute(node, 'fldLock') === true;
  let plain = true;
  const resultRunIds: string[] = [];
  let cachedText = '';
  for (const child of node.children) {
    if (!isPlainResultRun(child)) {
      plain = false;
      continue;
    }
    resultRunIds.push(child.id);
    cachedText += plainRunText(child);
  }
  const rewritable = plain && !locked && resultRunIds.length > 0;
  return {
    fieldNodeId: node.id,
    instruction,
    cachedText: rewritable ? cachedText : '',
    rewritable,
    containerId: node.id,
    resultRunIds,
  };
}

function isDrawingContainer(node: OoxmlElement): boolean {
  return node.kind === 'drawing' || node.localName === 'drawing' || node.localName === 'pict';
}

/** A field under `w:ins` / `w:del` is revision content; the refresh leaves it untouched. */
function isRevisionContainer(node: OoxmlElement): boolean {
  return node.localName === 'ins' || node.localName === 'del';
}

function locateFieldsInContainer(
  container: OoxmlElement,
  depth: number,
  budget: LocateBudget,
  out: LocatedField[]
): void {
  if (depth > MAX_LOCATE_DEPTH) return;
  const children = container.children;
  let index = 0;
  while (index < children.length) {
    budget.nodes -= 1;
    if (budget.nodes <= 0) return;
    const node = children[index]!;
    if (!isElement(node)) {
      index += 1;
      continue;
    }
    if (isFldSimple(node)) {
      // The OUTER field only — content nested in a cached result is never live-refreshed.
      out.push(locateSimpleField(node));
      index += 1;
      continue;
    }
    if (node.kind === 'run') {
      if (node.children.some((child) => isFldChar(child, 'begin'))) {
        const consumed = consumeComplexField(container.id, children, index, budget);
        if (consumed.field) out.push(consumed.field);
        index = consumed.nextIndex;
        continue;
      }
      index += 1;
      continue;
    }
    if (!isDrawingContainer(node) && !isRevisionContainer(node)) {
      locateFieldsInContainer(node, depth + 1, budget, out);
    }
    index += 1;
  }
}

/**
 * The fields inside one paragraph whose cached results this op could address, in document
 * order. Bounded walk; a paragraph past the budget answers what it found so far.
 */
export function locateFieldResults(paragraph: OoxmlElement): readonly LocatedFieldResult[] {
  const out: LocatedField[] = [];
  locateFieldsInContainer(paragraph, 0, { nodes: MAX_LOCATE_NODES }, out);
  return out;
}

export function validateRefreshFieldResults(
  part: OoxmlPart,
  op: RefreshFieldResultsOp
): TreeOpRejection | null {
  if (!Array.isArray(op.updates) || op.updates.length > MAX_FIELD_RESULT_UPDATES) {
    return 'invalidArgs';
  }
  for (const update of op.updates) {
    if (
      typeof update.paragraphId !== 'string' ||
      update.paragraphId.length === 0 ||
      typeof update.fieldNodeId !== 'string' ||
      update.fieldNodeId.length === 0 ||
      typeof update.text !== 'string' ||
      update.text.length > MAX_FIELD_RESULT_TEXT_CHARS ||
      !isValidXmlText(update.text) ||
      // Tab is the one control character the rewrite can express (`w:tab`); a newline
      // would need `w:br`, which is not a shape a field result refresh writes.
      update.text.includes('\n') ||
      update.text.includes('\r')
    ) {
      return 'invalidArgs';
    }
    const paragraph = findNode(part, update.paragraphId);
    if (!paragraph || paragraph.kind !== 'paragraph') return 'unknown-paragraph';
    if (isBoundAt(part, update.paragraphId)) return 'bound';
    if (effectiveContentLockAt(part, update.paragraphId).content) return 'locked';
  }
  return null;
}

/** Fresh `w:t` / `w:tab` children for one rewritten result run, splitting on `\t`. */
function resultRunContent(text: string, mint: () => string): OoxmlNode[] {
  const content: OoxmlNode[] = [];
  const pieces = text.split('\t');
  pieces.forEach((piece, index) => {
    if (index > 0) {
      content.push({
        id: mint(),
        kind: 'tab',
        namespaceUri: WML_NAMESPACE_URI,
        localName: 'tab',
        prefix: 'w',
        namespaceBindings: [],
        attributes: [],
        children: [],
      } as unknown as OoxmlNode);
    }
    if (piece.length > 0) {
      content.push({
        id: mint(),
        kind: 'text',
        namespaceUri: WML_NAMESPACE_URI,
        localName: 't',
        prefix: 'w',
        namespaceBindings: [],
        // `xml:space` is not set here: the serializer owns lexical form and adds
        // `preserve` when boundary whitespace requires it.
        attributes: [],
        children: [{ id: mint(), kind: 'textValue', value: piece }],
      } as unknown as OoxmlNode);
    }
  });
  return content;
}

/**
 * Rewrite one located field's result inside an immutable paragraph rebuild: the first
 * result run keeps its `w:rPr` and receives the new text; surplus result runs keep their
 * `w:rPr` and lose their `w:t` / `w:tab` children. Nothing else in the paragraph moves.
 */
function rewriteFieldResult(
  paragraph: OoxmlElement,
  field: LocatedField,
  text: string,
  mint: () => string
): OoxmlElement {
  const firstRunId = field.resultRunIds[0]!;
  const surplus = new Set(field.resultRunIds.slice(1));
  const rewrite = (node: OoxmlNode): OoxmlNode => {
    if (node.kind === 'textValue') return node;
    if (node.id === firstRunId || surplus.has(node.id)) {
      const properties = node.children.filter((child) => child.kind === 'runProperties');
      const content = node.id === firstRunId ? resultRunContent(text, mint) : [];
      return { ...node, children: [...properties, ...content] } as OoxmlNode;
    }
    const children = node.children.map(rewrite);
    return children.some((child, index) => child !== node.children[index])
      ? ({ ...node, children } as OoxmlNode)
      : node;
  };
  return rewrite(paragraph) as OoxmlElement;
}

/**
 * Apply the refresh: every update re-locates its field in the CURRENT paragraph and skips —
 * without failing the op — when the field is gone, not rewritable, or already carries the
 * text. An op whose every update skips commits no change (`dirty` empty, same part).
 */
export function applyRefreshFieldResults(
  part: OoxmlPart,
  op: RefreshFieldResultsOp,
  options?: EditOptions
): TreeOpResult {
  let current = part;
  const dirty: string[] = [];
  for (const update of op.updates) {
    const paragraph = findNode(current, update.paragraphId);
    if (!paragraph || paragraph.kind !== 'paragraph') continue;
    const located: LocatedField[] = [];
    locateFieldsInContainer(paragraph, 0, { nodes: MAX_LOCATE_NODES }, located);
    const field = located.find((entry) => entry.fieldNodeId === update.fieldNodeId);
    if (!field || !field.rewritable || field.cachedText === update.text) continue;
    const mint = createNodeIdAllocator(current);
    const rewritten = rewriteFieldResult(paragraph, field, update.text, mint);
    const parent = parentOf(current, paragraph.id);
    if (!parent) return { ok: false, reason: 'unknown-paragraph' };
    const siblings = parent.children.map((child) =>
      child.id === paragraph.id ? rewritten : child
    );
    const replaced = replaceChildren(current, parent.id, siblings, options);
    if (!replaced.ok) return { ok: false, reason: 'tree-invariant' };
    current = replaced.part;
    dirty.push(update.paragraphId);
  }
  return ok(current, {
    dirty,
    created: [],
    deleted: [],
    dependencyKeys: dirty,
    impact: 'text-local',
  });
}
