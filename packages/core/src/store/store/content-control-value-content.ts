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
    isInertInline(node)
  );
}

/** The `w:rPr` of the first live run under `node`, so the new value keeps the control's face. */
function firstLiveRunProperties(node: OoxmlNode, depth: number): OoxmlNode | undefined {
  if (node.kind === 'textValue' || depth > 32) return undefined;
  if (node.kind === 'run') return isTextRun(node) ? runPropertiesNodeOf(node) : undefined;
  if (node.kind === 'revisionDelete' || node.kind === 'revisionMoveFrom') return undefined;
  if (!isBlockContainer(node) && !isParagraph(node) && !isReplaceableInline(node)) {
    return undefined;
  }
  for (const child of node.children) {
    const found = firstLiveRunProperties(child, depth + 1);
    if (found) return found;
  }
  return undefined;
}

/**
 * Replace a paragraph's content with one run. Properties and zero-length markers stay, in
 * order; the run lands before the closing markers so a range over the paragraph covers it.
 * Refuses when the paragraph holds something a value cannot stand in for.
 */
function paragraphWithRun(
  paragraph: OoxmlElement,
  mint: DisplayRunMinter,
  nextId: () => string
): OoxmlNode | null {
  const kept: OoxmlNode[] = [];
  for (const child of paragraph.children) {
    if (isWml(child, 'pPr') || isInertInline(child)) {
      kept.push(child);
      continue;
    }
    if (!isReplaceableInline(child)) return null;
  }
  const face = firstLiveRunProperties(paragraph, 0) ?? paragraphMarkProperties(paragraph, nextId);
  let at = kept.length;
  while (at > 0 && isRangeEnd(kept[at - 1]!)) at--;
  kept.splice(at, 0, mint(withoutPlaceholderStyle(face && cloneWithFreshIds(face, nextId))));
  return { ...paragraph, children: kept } as OoxmlNode;
}

/**
 * The children a control's `w:sdtContent` holds after its display text changes.
 *
 * A value is one run. It lands in the control's first paragraph, found through the cells,
 * rows and tables the control may wrap, so a control around a cell keeps the cell, its
 * properties and its sibling cells; a control around a row keeps every cell. Other paragraphs
 * beside that one go, as a text value has no second paragraph. Inline content is replaced in
 * place, keeping its zero-length markers. Empty content grows the run, inside a paragraph
 * when the control is block-level.
 *
 * Content this walk does not understand is refused rather than flattened: replacing an
 * unknown shape with a run is how a cell disappeared from a table.
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
    if (!node.children.every(isReplaceableInline)) return null;
    const face = firstLiveRunProperties(node, 0);
    const kept: OoxmlNode[] = node.children.filter(isInertInline);
    let at = kept.length;
    while (at > 0 && isRangeEnd(kept[at - 1]!)) at--;
    kept.splice(at, 0, mint(withoutPlaceholderStyle(face && cloneWithFreshIds(face, nextId))));
    return { ...node, children: kept } as OoxmlNode;
  };

  // Depth-first for the first paragraph; the container that holds it drops its other
  // paragraphs. Bound recursion on imported XML.
  const rewrite = (node: OoxmlNode, depth: number): OoxmlNode | null => {
    if (node.kind === 'textValue' || depth > 32 || !isBlockContainer(node)) return null;
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i]!;
      if (isParagraph(child)) {
        const replaced = paragraphWithRun(child as OoxmlElement, mint, nextId);
        if (!replaced) return null;
        const children = node.children
          .map((sibling, index) => (index === i ? replaced : sibling))
          .filter((sibling, index) => index === i || !isParagraph(sibling));
        return { ...node, children } as OoxmlNode;
      }
      const updated = rewrite(child, depth + 1);
      if (updated) {
        const children = [...node.children];
        children[i] = updated;
        return { ...node, children } as OoxmlNode;
      }
    }
    return null;
  };

  const updated =
    rewrite(content, 0) ??
    (content.children.some((child) => isParagraph(child) || STRUCTURAL_KINDS.has(child.kind))
      ? null
      : replaceInline(content));
  return updated && updated.kind !== 'textValue' ? updated.children : null;
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
