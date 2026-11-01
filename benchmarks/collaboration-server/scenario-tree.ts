// Small readers of a document tree and of shared state, shared by the scenario fuzzer.

import * as Y from 'yjs';
import type { OoxmlNode } from '@docx-editor.dev/core/store';
import { PACKAGE_NODES_KEY } from '../../packages/pro/src/collaboration/document/index.ts';
import { INLINE_FIELD } from '../../packages/pro/src/collaboration/document/paragraph-text.ts';

// A document tree is immutable, and an edit shares every subtree it did not change, so these
// readers keep what they read of a node by its identity. The fuzzer reads the whole document
// after every action; with the caches, an action costs what it changed, not the document.

const texts = new WeakMap<OoxmlNode, string>();

/**
 * The text a node shows, from its text values. With `hardBreak`, a line break shows as that
 * mark, so a printout keeps the lines apart.
 */
export function textOf(node: OoxmlNode, hardBreak?: string): string {
  if (node.kind === 'textValue') return node.value;
  if (hardBreak !== undefined) {
    if (node.kind === 'hardBreak') return hardBreak;
    return node.children.map((child) => textOf(child, hardBreak)).join('');
  }
  let text = texts.get(node);
  if (text === undefined) {
    text = '';
    for (const child of node.children) text += textOf(child);
    texts.set(node, text);
  }
  return text;
}

/** One walk of a root: its nodes by ID, the parent of each, and elements by local name. */
interface TreeIndex {
  readonly byId: Map<string, OoxmlNode>;
  readonly parentById: Map<string, OoxmlNode>;
  readonly byName: Map<string, OoxmlNode[]>;
  readonly paragraphs: OoxmlNode[];
}

const indexes = new WeakMap<OoxmlNode, TreeIndex>();

/** The index of `root`, in document order: the first node with an ID and its first lister. */
function indexOf(root: OoxmlNode): TreeIndex {
  let index = indexes.get(root);
  if (index) return index;
  const built: TreeIndex = {
    byId: new Map(),
    parentById: new Map(),
    byName: new Map(),
    paragraphs: [],
  };
  const visit = (node: OoxmlNode): void => {
    if (!built.byId.has(node.id)) built.byId.set(node.id, node);
    if (node.kind === 'textValue') return;
    if (node.kind === 'paragraph') built.paragraphs.push(node);
    let named = built.byName.get(node.localName);
    if (!named) built.byName.set(node.localName, (named = []));
    named.push(node);
    for (const child of node.children) {
      if (!built.parentById.has(child.id)) built.parentById.set(child.id, node);
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  indexes.set(root, (index = built));
  return index;
}

/** Every element named `localName` under `root`, `root` included, in document order. */
export function elements(root: OoxmlNode, localName: string): OoxmlNode[] {
  return [...(indexOf(root).byName.get(localName) ?? [])];
}

/** Every paragraph under `root`, nested ones included, in document order. */
export function paragraphs(root: OoxmlNode): OoxmlNode[] {
  return [...indexOf(root).paragraphs];
}

/** The node with `id` under `root`, or null. */
export function findNode(root: OoxmlNode, id: string): OoxmlNode | null {
  return indexOf(root).byId.get(id) ?? null;
}

/** The node that lists a child with `id`, or null. */
export function parentOf(root: OoxmlNode, id: string): OoxmlNode | null {
  return indexOf(root).parentById.get(id) ?? null;
}

/** The shared record map of every package node, by node ID. */
export function sharedNodes(ydoc: Y.Doc): Y.Map<unknown> {
  return ydoc.getMap(PACKAGE_NODES_KEY);
}

/** Every record's shared paragraph text, by node ID, in the record map's order. */
export function sharedTexts(ydoc: Y.Doc): [string, Y.Text][] {
  const texts: [string, Y.Text][] = [];
  for (const [key, record] of sharedNodes(ydoc).entries()) {
    const text = record instanceof Y.Map ? record.get(INLINE_FIELD) : null;
    if (text instanceof Y.Text) texts.push([key, text]);
  }
  return texts;
}
