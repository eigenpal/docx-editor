// Small readers of a document tree and of shared state, shared by the scenario fuzzer.

import * as Y from 'yjs';
import type { OoxmlNode } from '@docx-editor.dev/core/store';
import { PACKAGE_NODES_KEY } from '../../packages/pro/src/collaboration/document/index.ts';
import { INLINE_FIELD } from '../../packages/pro/src/collaboration/document/paragraph-text.ts';

/**
 * The text a node shows, from its text values. With `hardBreak`, a line break shows as that
 * mark, so a printout keeps the lines apart.
 */
export function textOf(node: OoxmlNode, hardBreak?: string): string {
  if (node.kind === 'textValue') return node.value;
  if (hardBreak !== undefined && node.kind === 'hardBreak') return hardBreak;
  return node.children.map((child) => textOf(child, hardBreak)).join('');
}

/** Every element named `localName` under `root`, `root` included, in document order. */
export function elements(root: OoxmlNode, localName: string): OoxmlNode[] {
  const found: OoxmlNode[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.localName === localName) found.push(node);
    for (const child of node.children) walk(child);
  };
  walk(root);
  return found;
}

/** Every paragraph under `root`, nested ones included, in document order. */
export function paragraphs(root: OoxmlNode): OoxmlNode[] {
  const found: OoxmlNode[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'paragraph') found.push(node);
    if (node.kind !== 'textValue') for (const child of node.children) visit(child);
  };
  visit(root);
  return found;
}

/** The node with `id` under `root`, or null. */
export function findNode(root: OoxmlNode, id: string): OoxmlNode | null {
  let found: OoxmlNode | null = null;
  const visit = (node: OoxmlNode): void => {
    if (found) return;
    if (node.id === id) {
      found = node;
      return;
    }
    if (node.kind !== 'textValue') for (const child of node.children) visit(child);
  };
  visit(root);
  return found;
}

/** The node that lists a child with `id`, or null. */
export function parentOf(root: OoxmlNode, id: string): OoxmlNode | null {
  let found: OoxmlNode | null = null;
  const walk = (node: OoxmlNode): void => {
    if (found || node.kind === 'textValue') return;
    if (node.children.some((child) => child.id === id)) found = node;
    else for (const child of node.children) walk(child);
  };
  walk(root);
  return found;
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
