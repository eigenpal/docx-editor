// The paragraph content an inserted table row's cells start with.
//
// Inserting a row copies each source cell's first-paragraph properties, paragraph mark
// included, into the new cell's empty paragraph, so a new row matches the row it was made
// from instead of falling back to the document defaults. A source mark with no formatting of
// its own borrows the formatting of the cell's first plain text run, the face the row shows.
//
// A mark formats only the empty line; text written into the cell needs a run that carries the
// face. So the new paragraph also holds an empty run with the mark's formatting: written or
// typed text joins it, the way it joins any run already in a paragraph.
//
// Only WordprocessingML properties are copied, re-spelled under the prefix the new row uses.
// An extension namespace may be bound only on the source paragraph, where a copy cannot
// follow it. Revision markers are dropped: the copy is a fresh paragraph, not a continuation of
// someone's pending decision. A section break never belongs in a table cell.

import {
  WML_NAMESPACE_URI,
  XML_NAMESPACE_URI,
  type OoxmlAttribute,
  type OoxmlElement,
  type OoxmlNode,
} from '../package/ooxml-tree.ts';
import type { WmlFreshNamespaceContext } from '../package/wml-namespace.ts';
import { paragraphPropertiesNodeOf } from './tree-op-nodes.ts';
import { isWmlElement } from './tree-op-table-shared.ts';

const PPR_DROPPED = new Set(['pPrChange', 'sectPr', 'rPr']);
// Revision markers, plus visibility: a hidden source must not hide the values written here.
const MARK_DROPPED = new Set([
  'ins',
  'del',
  'moveFrom',
  'moveTo',
  'rPrChange',
  'vanish',
  'specVanish',
  'webHidden',
]);
/** Inline wrappers whose runs do not show the row's plain face. */
const SKIPPED_WRAPPERS = new Set(['revisionDelete', 'revisionMoveFrom', 'hyperlink']);

function wmlChildren(node: OoxmlElement, dropped: ReadonlySet<string>): OoxmlNode[] {
  return node.children.filter(
    (child) =>
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      !dropped.has(child.localName)
  );
}

function wmlVal(node: OoxmlNode): string | undefined {
  if (node.kind === 'textValue') return undefined;
  return node.attributes.find(
    (attribute) => attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'val'
  )?.value;
}

function withChildren(node: OoxmlElement, children: readonly OoxmlNode[]): OoxmlElement {
  return { ...node, children } as OoxmlElement;
}

/** The first run that shows plain text: not struck, not a link, not a reference mark. */
function firstTextRunProperties(node: OoxmlNode): OoxmlElement | undefined {
  if (node.kind === 'textValue') return undefined;
  for (const child of node.children) {
    if (child.kind === 'textValue' || SKIPPED_WRAPPERS.has(child.kind)) continue;
    if (child.kind === 'run') {
      const children: readonly OoxmlNode[] = child.children;
      if (!children.some((leaf) => isWmlElement(leaf, 't'))) continue;
      const rPr = children.find((leaf): leaf is OoxmlElement => isWmlElement(leaf, 'rPr'));
      // A content control's prompt shows placeholder styling, not the row's face.
      if (
        rPr &&
        rPr.children.some(
          (leaf) => isWmlElement(leaf, 'rStyle') && wmlVal(leaf) === 'PlaceholderText'
        )
      )
        continue;
      return rPr;
    }
    if (child.kind === 'paragraphProperties') continue;
    const nested = firstTextRunProperties(child);
    if (nested) return nested;
  }
  return undefined;
}

interface SourceContent {
  /** The kept `w:pPr` children other than the mark, or none. */
  readonly properties: readonly OoxmlNode[];
  readonly propertiesNode: OoxmlElement | undefined;
  /** The mark formatting, borrowed from the first text run when the mark has none. */
  readonly mark: OoxmlElement | undefined;
}

const sources = new WeakMap<OoxmlElement, SourceContent | null>();

function sourceContent(cell: OoxmlElement): SourceContent | null {
  const cached = sources.get(cell);
  if (cached !== undefined) return cached;
  const paragraph = cell.children.find((child) => child.kind === 'paragraph');
  let result: SourceContent | null = null;
  if (paragraph) {
    const pPr = paragraphPropertiesNodeOf(paragraph);
    const ownMark = pPr?.children.find((child) => isWmlElement(child, 'rPr')) as
      | OoxmlElement
      | undefined;
    // A mark holding only revision markers has no formatting of its own to copy.
    const ownChildren = ownMark ? wmlChildren(ownMark, MARK_DROPPED) : [];
    const markSource: OoxmlElement | undefined =
      ownChildren.length > 0 ? ownMark : firstTextRunProperties(paragraph);
    const markChildren = markSource ? wmlChildren(markSource, MARK_DROPPED) : [];
    const properties = pPr ? wmlChildren(pPr, PPR_DROPPED) : [];
    const mark = markChildren.length > 0 ? withChildren(markSource!, markChildren) : undefined;
    if (properties.length > 0 || mark) result = { properties, propertiesNode: pPr, mark };
  }
  sources.set(cell, result);
  return result;
}

/** A WML-only copy under the row's prefixes, with fresh identities and no local bindings. */
function respelled(
  node: OoxmlNode,
  wml: WmlFreshNamespaceContext,
  nextId: () => string
): OoxmlNode | null {
  if (node.kind === 'textValue') return { id: nextId(), kind: 'textValue', value: node.value };
  if (node.namespaceUri !== WML_NAMESPACE_URI) return null;
  const attributes: OoxmlAttribute[] = [];
  for (const attribute of node.attributes) {
    if (attribute.namespaceUri === WML_NAMESPACE_URI)
      attributes.push({ ...attribute, prefix: wml.attributePrefix } as OoxmlAttribute);
    else if (attribute.namespaceUri === XML_NAMESPACE_URI || !attribute.namespaceUri)
      attributes.push(attribute);
  }
  const children: OoxmlNode[] = [];
  for (const child of node.children) {
    const copy = respelled(child, wml, nextId);
    if (copy) children.push(copy);
  }
  const { prefix: _prefix, ...rest } = node;
  return {
    ...rest,
    ...(wml.elementPrefix === undefined ? {} : { prefix: wml.elementPrefix }),
    id: nextId(),
    namespaceBindings: [],
    attributes,
    children,
  } as OoxmlNode;
}

function element(
  template: OoxmlElement,
  kind: OoxmlElement['kind'],
  localName: string,
  children: readonly OoxmlNode[]
): OoxmlElement {
  return { ...template, kind, localName, attributes: [], children } as OoxmlElement;
}

/** The new cell paragraph's children: `w:pPr` (with the mark), then the seed run. */
function sourceNodes(source: SourceContent): OoxmlNode[] {
  const template = source.propertiesNode ?? source.mark!;
  const pPrChildren = source.mark ? [...source.properties, source.mark] : source.properties;
  const pPr = element(template, 'paragraphProperties', 'pPr', pPrChildren);
  if (!source.mark) return [pPr];
  return [pPr, element(source.mark, 'run', 'r', [source.mark])];
}

/** Fresh paragraph content for a cell copied from `sourceCell`. */
export function insertedCellParagraphContent(
  sourceCell: OoxmlElement,
  nextId: () => string,
  wml: WmlFreshNamespaceContext
): OoxmlNode[] {
  const source = sourceContent(sourceCell);
  if (!source) return [];
  return sourceNodes(source).flatMap((node) => respelled(node, wml, nextId) ?? []);
}

function nodeCount(node: OoxmlNode): number {
  if (node.kind === 'textValue') return 1;
  let count = 1;
  for (const child of node.children) count += nodeCount(child);
  return count;
}

/** An upper bound on the nodes {@link insertedCellParagraphContent} creates, for budgeting. */
export function insertedCellParagraphNodeCount(sourceCell: OoxmlElement): number {
  const source = sourceContent(sourceCell);
  return source ? sourceNodes(source).reduce((total, node) => total + nodeCount(node), 0) : 0;
}
