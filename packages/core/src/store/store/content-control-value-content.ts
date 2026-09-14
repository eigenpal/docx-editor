import { isInlineRunContainer, WML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import type { OoxmlElement, OoxmlNode } from '../package/ooxml-tree.ts';
import {
  cloneWithFreshIds,
  isInertInline,
  isRangeEnd,
  isTextRun,
  isWhitespaceText,
  isWml,
  paragraphMarkProperties,
  paragraphOf,
  runContentOf,
  withoutPlaceholderStyle,
} from './content-control-checkbox.ts';
import { runPropertiesNodeOf } from './tree-op-nodes.ts';

/** Mints the single run that becomes a control's display, given the face it should keep. */
export type DisplayRunMinter = (properties?: OoxmlNode) => OoxmlNode;

const STRUCTURAL_KINDS: ReadonlySet<OoxmlNode['kind']> = new Set([
  'table',
  'tableRow',
  'tableCell',
]);

/** Run properties that record a revision or belong to a wrapper the value removes. */
const FACE_DROPPED_NAMES: ReadonlySet<string> = new Set([
  'ins',
  'del',
  'moveFrom',
  'moveTo',
  'rPrChange',
]);

const MAX_DEPTH = 32;

function isParagraph(node: OoxmlNode): boolean {
  return node.kind === 'paragraph' || isWml(node, 'p');
}

function isContent(node: OoxmlNode): boolean {
  return node.kind === 'contentControlContent' || isWml(node, 'sdtContent');
}

/** Containers a display paragraph may sit under: the control's content, cells, rows, tables. */
function isBlockContainer(node: OoxmlNode): boolean {
  return (
    isContent(node) ||
    node.kind === 'contentControl' ||
    STRUCTURAL_KINDS.has(node.kind) ||
    isWml(node, 'customXml')
  );
}

/** Block content beside a display paragraph that a value cannot stand in for. */
function isOtherBlock(node: OoxmlNode): boolean {
  return (
    node.kind === 'table' ||
    node.kind === 'contentControl' ||
    isWml(node, 'customXml') ||
    isWml(node, 'sdt') ||
    isWml(node, 'tbl')
  );
}

/** A run that only anchors a comment. The range markers around it stay, so it stays too. */
function isCommentAnchorRun(node: OoxmlNode): boolean {
  if (node.kind !== 'run') return false;
  const content = runContentOf(node);
  return content.length === 1 && isWml(content[0]!, 'commentReference');
}

/** Content that stays beside the value: history, zero-length marks, comment anchors. */
function isKept(node: OoxmlNode): boolean {
  return isInertInline(node) || isCommentAnchorRun(node);
}

/** Inline content a text value replaces: runs, the containers that hold them, nested controls. */
function isReplaceableInline(node: OoxmlNode): boolean {
  if (node.kind === 'textValue') return isWhitespaceText(node);
  return (
    node.kind === 'run' ||
    node.kind === 'contentControl' ||
    node.kind === 'revisionInsert' ||
    node.kind === 'revisionMoveTo' ||
    isInlineRunContainer(node) ||
    isWml(node, 'fldSimple') ||
    isWml(node, 'sdtContent') ||
    isKept(node)
  );
}

/**
 * Whether every complex field that begins among `children` also ends there. A field with one
 * boundary outside the control cannot be replaced by a value without orphaning the other.
 */
function fieldsBalanced(children: readonly OoxmlNode[]): boolean {
  let open = 0;
  const walk = (node: OoxmlNode, depth: number): void => {
    if (node.kind === 'textValue' || depth > MAX_DEPTH) return;
    if (isWml(node, 'fldChar')) {
      const type = node.attributes.find((a) => a.localName === 'fldCharType')?.value;
      if (type === 'begin') open++;
      else if (type === 'end') open--;
      return;
    }
    for (const child of node.children) walk(child, depth + 1);
  };
  for (const child of children) walk(child, 0);
  return open === 0;
}

/** Stands for "a live run with no `w:rPr`", so its absence of formatting is still an answer. */
const EMPTY_FACE: OoxmlNode = { id: '', kind: 'textValue', value: '' };

/**
 * The `w:rPr` of the first live text run under `node`, so the new value keeps the control's
 * face. Hyperlinks are not entered: their link styling belongs to the link the value removes.
 */
function firstLiveRunProperties(node: OoxmlNode, depth: number): OoxmlNode | undefined {
  if (node.kind === 'textValue' || depth > MAX_DEPTH) return undefined;
  if (node.kind === 'run') {
    if (!isTextRun(node) || isCommentAnchorRun(node)) return undefined;
    return runPropertiesNodeOf(node) ?? EMPTY_FACE;
  }
  if (node.kind === 'revisionDelete' || node.kind === 'revisionMoveFrom') return undefined;
  if (node.kind === 'hyperlink') return undefined;
  if (!isBlockContainer(node) && !isParagraph(node) && !isReplaceableInline(node)) {
    return undefined;
  }
  for (const child of node.children) {
    const found = firstLiveRunProperties(child, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function hasLiveTextRun(node: OoxmlNode): boolean {
  return firstLiveRunProperties(node, 0) !== undefined;
}

function faceOf(node: OoxmlNode, nextId: () => string): OoxmlNode | undefined {
  const found = firstLiveRunProperties(node, 0);
  if (!found || found === EMPTY_FACE || found.kind === 'textValue') return undefined;
  const formatting = found.children.filter(
    (child) => child.kind !== 'textValue' && !FACE_DROPPED_NAMES.has(child.localName)
  );
  if (formatting.length === 0) return undefined;
  return withoutPlaceholderStyle(
    cloneWithFreshIds({ ...found, children: formatting } as OoxmlNode, nextId)
  );
}

/** Insert the value run before the closing markers, so a range over the content covers it. */
function withValueRun(node: OoxmlElement, kept: readonly OoxmlNode[], run: OoxmlNode): OoxmlNode {
  const children: OoxmlNode[] = [...kept];
  let at = children.length;
  while (at > 0 && (isRangeEnd(children[at - 1]!) || isCommentAnchorRun(children[at - 1]!))) {
    at--;
  }
  children.splice(at, 0, run);
  return { ...node, children } as OoxmlNode;
}

/**
 * Replace a paragraph's content with one run. Properties, zero-length markers and comment
 * anchors stay, in order. Refuses when the paragraph holds something a value cannot stand in
 * for, or a field that reaches past the paragraph.
 */
function paragraphWithRun(
  paragraph: OoxmlElement,
  mint: DisplayRunMinter,
  nextId: () => string
): OoxmlNode | null {
  const kept: OoxmlNode[] = [];
  for (const child of paragraph.children) {
    if (isWml(child, 'pPr') || isKept(child)) {
      kept.push(child);
      continue;
    }
    if (!isReplaceableInline(child)) return null;
  }
  if (!fieldsBalanced(paragraph.children)) return null;
  const face = faceOf(paragraph, nextId) ?? paragraphMarkProperties(paragraph, nextId);
  return withValueRun(paragraph, kept, mint(face));
}

type Walk = { readonly node: OoxmlNode } | 'refused' | 'none';

/**
 * The children a control's `w:sdtContent` holds after its display text changes.
 *
 * A value is one run. It lands in the control's display paragraph: at each level, the first
 * paragraph holding live text, else the first paragraph, before any nested cell is searched.
 * So a control around a cell keeps the cell, its properties and its sibling cells, and a
 * control around a row keeps every cell and writes into the first one that has a paragraph.
 * Other paragraphs beside the display paragraph go, as a text value has no second paragraph;
 * a table or nested control beside it is refused, because the value would not be the
 * control's text while that content stayed. Inline content is replaced in place, keeping its
 * zero-length markers and comment anchors. Empty content grows the run, inside a paragraph
 * when the control is block-level.
 *
 * Content this walk does not understand is refused rather than flattened: replacing an
 * unknown shape with a run is how a cell disappeared from a table. A refusal anywhere under
 * the content refuses the write; a block-level control never receives a bare run.
 */
export function valueContent(
  content: OoxmlElement | undefined,
  mint: DisplayRunMinter,
  nextId: () => string,
  inline: boolean
): readonly OoxmlNode[] | null {
  if (!content || content.children.every(isWhitespaceText)) {
    return inline ? [mint()] : [paragraphOf(nextId, [mint()])];
  }

  const replaceInline = (node: OoxmlElement): OoxmlNode | null => {
    if (!node.children.every(isReplaceableInline) || !fieldsBalanced(node.children)) return null;
    return withValueRun(node, node.children.filter(isKept), mint(faceOf(node, nextId)));
  };

  // Level by level: this container's own paragraphs first, then its structural children in
  // order. The container that holds the display paragraph drops its other paragraphs. Bound
  // recursion on imported XML; running out of depth is a refusal, never a fallback.
  const rewrite = (node: OoxmlNode, depth: number): Walk => {
    if (node.kind === 'textValue' || !isBlockContainer(node)) return 'none';
    if (depth > MAX_DEPTH) return 'refused';
    const paragraphs = node.children.filter(isParagraph);
    const target = paragraphs.find(hasLiveTextRun) ?? paragraphs[0];
    if (target) {
      if (node.children.some(isOtherBlock)) return 'refused';
      const replaced = paragraphWithRun(target as OoxmlElement, mint, nextId);
      if (!replaced) return 'refused';
      const children = node.children
        .map((child) => (child === target ? replaced : child))
        .filter((child) => child === replaced || !isParagraph(child));
      return { node: { ...node, children } as OoxmlNode };
    }
    for (let i = 0; i < node.children.length; i++) {
      const walked = rewrite(node.children[i]!, depth + 1);
      if (walked === 'none') continue;
      if (walked === 'refused') return walked;
      const children = [...node.children];
      children[i] = walked.node;
      return { node: { ...node, children } as OoxmlNode };
    }
    return 'none';
  };

  const walked = rewrite(content, 0);
  if (walked === 'refused') return null;
  if (walked !== 'none') return walked.node.kind === 'textValue' ? null : walked.node.children;
  // No paragraph anywhere. Inline content is replaced in place; block content with no
  // paragraph to hold the value (a nested block control with nothing in it) is refused.
  if (!inline) return null;
  const replaced = replaceInline(content);
  return replaced && replaced.kind !== 'textValue' ? replaced.children : null;
}

/**
 * Whether {@link valueContent} can write this content. The validator asks so `can()` and
 * `exec()` agree; the probe's ids are discarded with its result.
 */
export function valueContentWritable(content: OoxmlElement | undefined, inline: boolean): boolean {
  const probe: DisplayRunMinter = () =>
    ({
      id: 'probe',
      kind: 'run',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'r',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [],
      children: [],
    }) as unknown as OoxmlNode;
  return valueContent(content, probe, () => 'probe', inline) !== null;
}
