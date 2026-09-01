// Paragraph-order indexes shared by interactive review derivation and editor positioning.

import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { createRecentRootCache } from './recent-root-cache.ts';

/**
 * Paragraph node id → document position, from the tree rather than from layout.
 *
 * Memoized on the immutable root: a derivation pass can ask repeatedly, and the shared answer
 * stays read-only so a caller cannot poison later readers.
 */
export function paragraphOrderOfPart(part: OoxmlPart): ReadonlyMap<string, number> {
  const cached = paragraphOrderCache.get(part.root);
  if (cached) return cached;
  const order = new Map<string, number>();
  const walk = (node: OoxmlNode, depth: number): void => {
    if (node.kind === 'textValue' || depth > 64) return;
    if (node.kind === 'paragraph') {
      if (!order.has(node.id)) order.set(node.id, order.size);
      return;
    }
    // An unchanged table returns its paragraph list instead of being re-descended after an edit
    // elsewhere in the document.
    if (node.kind === 'table') {
      let ids = tableParagraphIdsCache.get(node);
      if (!ids) {
        const found: string[] = [];
        const collect = (candidate: OoxmlNode, nestedDepth: number): void => {
          if (candidate.kind === 'textValue' || nestedDepth > 64) return;
          if (candidate.kind === 'paragraph') {
            found.push(candidate.id);
            return;
          }
          for (const child of candidate.children) collect(child, nestedDepth + 1);
        };
        for (const child of node.children) collect(child, 0);
        ids = found;
        tableParagraphIdsCache.set(node, ids);
      }
      for (const id of ids) {
        if (!order.has(id)) order.set(id, order.size);
      }
      return;
    }
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(part.root, 0);
  paragraphOrderCache.set(part.root, order);
  return order;
}

const paragraphOrderCache = createRecentRootCache<Map<string, number>>(8);

/**
 * Like {@link paragraphOrderOfPart}, but descends into paragraphs so textbox paragraphs rank
 * immediately after their host. Shallow order remains available for separate-story walks.
 */
export function deepParagraphOrderOfPart(part: OoxmlPart): ReadonlyMap<string, number> {
  const cached = deepParagraphOrderCache.get(part.root);
  if (cached) return cached;
  const order = new Map<string, number>();
  for (const id of subtreeDeepParagraphIds(part.root, 0)) {
    if (!order.has(id)) order.set(id, order.size);
  }
  deepParagraphOrderCache.set(part.root, order);
  return order;
}

const EMPTY_DEEP_PARAGRAPH_IDS: readonly string[] = Object.freeze([]);

/**
 * Deep paragraph ids under one immutable node, memoized per node. The depth is part of the
 * entry because republishing a shared subtree at another depth can cross the hostile-input cap.
 */
const subtreeDeepParagraphIdsCache = new WeakMap<
  OoxmlNode,
  { readonly depth: number; readonly ids: readonly string[] }
>();

function subtreeDeepParagraphIds(node: OoxmlNode, depth: number): readonly string[] {
  if (node.kind === 'textValue' || depth > 64) return EMPTY_DEEP_PARAGRAPH_IDS;
  const cached = subtreeDeepParagraphIdsCache.get(node);
  if (cached && cached.depth === depth) return cached.ids;
  let found: string[] | null = null;
  if (node.kind === 'paragraph') (found ??= []).push(node.id);
  for (const child of node.children) {
    const ids = subtreeDeepParagraphIds(child, depth + 1);
    if (ids.length === 0) continue;
    found ??= [];
    for (const id of ids) found.push(id);
  }
  const result: readonly string[] = found ?? EMPTY_DEEP_PARAGRAPH_IDS;
  subtreeDeepParagraphIdsCache.set(node, { depth, ids: result });
  return result;
}

const deepParagraphOrderCache = createRecentRootCache<Map<string, number>>(8);
const tableParagraphIdsCache = new WeakMap<OoxmlNode, readonly string[]>();
