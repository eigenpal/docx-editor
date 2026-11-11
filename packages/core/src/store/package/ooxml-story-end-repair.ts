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

/** Whether `node` is the WML element `localName`. */
export const isWml = (node: OoxmlNode, localName: string): node is OoxmlElement =>
  node.kind !== 'textValue' &&
  node.namespaceUri === WML_NAMESPACE_URI &&
  node.localName === localName;

/** Stories that end with a paragraph: a body, a footnote or endnote, and a text box. */
const STORY_NAMES: ReadonlySet<string> = new Set(['body', 'footnote', 'endnote', 'txbxContent']);

/** Elements a story block can sit in without leaving the story's own block sequence. */
const WRAPPER_NAMES: ReadonlySet<string> = new Set(['sdt', 'sdtContent', 'customXml']);

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

/** The index of the last block of `children` other than `without`, or -1. */
function lastBlockIndex(children: readonly OoxmlNode[], without?: string): number {
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index]!;
    if (isBlock(child) && child.id !== without) return index;
  }
  return -1;
}

/** Whether the last block of `children`, through block wrappers, is a table. */
function endsWithTable(children: readonly OoxmlNode[], depth: number, without?: string): boolean {
  const last = children[lastBlockIndex(children, without)];
  if (!last || last.kind === 'textValue') return false;
  if (isWml(last, 'tbl')) return true;
  if (depth >= MAX_WRAPPER_DEPTH || isWml(last, 'p') || isWml(last, 'altChunk')) return false;
  const blocks = wrappedBlocks(last);
  return blocks !== undefined && endsWithTable(blocks, depth + 1, without);
}

/**
 * Whether the story blocks `children` end with a table, through block wrappers. With
 * `without`, the answer is for the same blocks once the node with that id is gone.
 */
export function storyEndsWithTable(children: readonly OoxmlNode[], without?: string): boolean {
  return endsWithTable(children, 0, without);
}

/** Whether the element `name` is a story that must end with a paragraph. */
export function storyEndsWithParagraph(name: {
  readonly namespaceUri: string;
  readonly localName: string;
}): boolean {
  return name.namespaceUri === WML_NAMESPACE_URI && STORY_NAMES.has(name.localName);
}

/**
 * Whether removing the node `nodeId` leaves a story that ends with a paragraph ending with a
 * table instead. The node may sit in block wrappers at the end of the story. A story that
 * already ends with a table, for example after a merge from another participant, is not
 * refused, so editing it can go on.
 */
export function removalEndsStoryWithTable(
  nodeId: string,
  parentOf: (id: string) => OoxmlElement | null
): boolean {
  let parent = parentOf(nodeId);
  for (let step = 0; parent && step <= 2 * MAX_WRAPPER_DEPTH; step += 1) {
    if (storyEndsWithParagraph(parent)) {
      return !storyEndsWithTable(parent.children) && storyEndsWithTable(parent.children, nodeId);
    }
    if (parent.namespaceUri !== WML_NAMESPACE_URI || !WRAPPER_NAMES.has(parent.localName)) {
      return false;
    }
    parent = parentOf(parent.id);
  }
  return false;
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
    ...(last.prefix === undefined ? {} : { prefix: last.prefix }),
    namespaceBindings: [],
    attributes: [],
    children: [],
  } as OoxmlNode;
  return [...children.slice(0, index + 1), paragraph, ...children.slice(index + 1)];
}
