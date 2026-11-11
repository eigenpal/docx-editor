/**
 * The paragraph a story ends with when its file ends it with a table.
 *
 * A document body, a footnote or endnote, and a text box always end with a paragraph. A file
 * that ends one with a table reads as if an empty paragraph followed the table: it takes a
 * line below the table, can open a page of its own, holds the caret, and is saved. A table at
 * the end of a block-level content control or custom XML element ends the story too; the
 * paragraph then follows the wrapper.
 *
 * Headers and footers keep their content as written: a table may end them, and nothing below
 * it takes a line. A table cell is not repaired either, since such a file is not opened at all.
 */
import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';

/** Wrappers whose children are the story's blocks. Deeper nesting stays as written. */
const MAX_WRAPPER_DEPTH = 8;

const isWml = (node: OoxmlNode, localName: string): node is OoxmlElement =>
  node.kind !== 'textValue' &&
  node.namespaceUri === WML_NAMESPACE_URI &&
  node.localName === localName;

/** A block-level element: one that ends a story when nothing else follows it. */
const isBlock = (node: OoxmlNode): node is OoxmlElement =>
  isWml(node, 'p') ||
  isWml(node, 'tbl') ||
  isWml(node, 'sdt') ||
  isWml(node, 'customXml') ||
  isWml(node, 'altChunk');

/** The children holding a wrapper's blocks: `w:sdtContent` for a control, else its own. */
function wrappedBlocks(wrapper: OoxmlElement): readonly OoxmlNode[] | undefined {
  if (wrapper.localName === 'customXml') return wrapper.children;
  for (const child of wrapper.children) if (isWml(child, 'sdtContent')) return child.children;
  return undefined;
}

/** The index of the last block of `children`, or -1. */
function lastBlockIndex(children: readonly OoxmlNode[]): number {
  for (let index = children.length - 1; index >= 0; index -= 1)
    if (isBlock(children[index]!)) return index;
  return -1;
}

/** Whether the last block of `children`, through block wrappers, is a table. */
function endsWithTable(children: readonly OoxmlNode[], depth: number): boolean {
  const last = children[lastBlockIndex(children)];
  if (!last || last.kind === 'textValue') return false;
  if (isWml(last, 'tbl')) return true;
  if (depth >= MAX_WRAPPER_DEPTH || isWml(last, 'p') || isWml(last, 'altChunk')) return false;
  const blocks = wrappedBlocks(last);
  return blocks !== undefined && endsWithTable(blocks, depth + 1);
}

/** Whether the story blocks `children` end with a table, through block wrappers. */
export function storyEndsWithTable(children: readonly OoxmlNode[]): boolean {
  return endsWithTable(children, 0);
}

/** Whether a node of `kind` named `localName` is a story that must end with a paragraph. */
export function storyEndsWithParagraph(
  kind: string,
  name: { readonly namespaceUri: string; readonly localName: string }
): boolean {
  return (
    kind === 'body' ||
    kind === 'note' ||
    (name.namespaceUri === WML_NAMESPACE_URI && name.localName === 'txbxContent')
  );
}

/**
 * `children` of a story, with an empty paragraph right after the block that ends it when
 * that block is, or ends with, a table. The same children when nothing is missing.
 */
export function withStoryEndParagraph(children: readonly OoxmlNode[]): readonly OoxmlNode[] {
  if (!storyEndsWithTable(children)) return children;
  const index = lastBlockIndex(children);
  const last = children[index] as OoxmlElement;
  const paragraph = {
    id: `${last.id}~end`,
    kind: 'paragraph',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'p',
    prefix: last.prefix,
    namespaceBindings: [],
    attributes: [],
    children: [],
  } as unknown as OoxmlNode;
  return [...children.slice(0, index + 1), paragraph, ...children.slice(index + 1)];
}
