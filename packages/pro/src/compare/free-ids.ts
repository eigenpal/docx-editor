/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { OoxmlPackage } from '@docx-editor.dev/core/store';
import { attributeOf, elementChildren, type ElementNode } from './xml-fragments.ts';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/**
 * The `attribute` value of every WordprocessingML element named one of `names`, in any part of
 * `pkg`. A document may reference an id it does not define; such a reference means nothing, and
 * a new definition must not take its id and give it a meaning.
 */
export function referencedIds(
  pkg: OoxmlPackage,
  names: ReadonlySet<string>,
  attribute = 'val'
): Set<string> {
  const ids = new Set<string>();
  for (const part of pkg.parts.values()) {
    const stack: ElementNode[] = [part.root as ElementNode];
    for (let node = stack.pop(); node; node = stack.pop()) {
      if (names.has(node.localName) && node.namespaceUri === W_NS) {
        const value = attributeOf(node, attribute);
        if (value !== undefined) ids.add(value);
      }
      for (const child of elementChildren(node)) stack.push(child);
    }
  }
  return ids;
}

/**
 * Returns a source of the smallest unused decimal ids from `start` up. Ids a document holds are
 * file data and may be huge or padded ("01"), so each counts as taken both as written and as the
 * number a reader parses from it. No arithmetic on file-supplied values, so precision is never lost.
 */
export function freeIds(used: Iterable<string>, start = 1): () => string {
  const taken = new Set<string>();
  for (const id of used) {
    taken.add(id);
    const trimmed = id.trim();
    if (/^[+-]?\d+$/.test(trimmed)) taken.add(String(BigInt(trimmed)));
  }
  let next = start;
  return () => {
    while (taken.has(String(next))) next++;
    taken.add(String(next));
    return String(next);
  };
}
