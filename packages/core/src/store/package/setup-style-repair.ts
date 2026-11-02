// Duplicate setup styles that concurrent participants each added.
//
// Two participants who both make the first link while apart each append the built-in style
// to the styles part. Both inserts survive the merge, so the part holds the style twice. Every
// participant removes the same copies: all but the first of each id, in document order. That
// order is the same on every replica, so the removals agree and the first copy is never
// removed by anyone.

import type { OoxmlElement } from './ooxml-tree.ts';
import { withPart, type OoxmlPackage } from './ooxml-package.ts';
import { stylesPartOf } from './ooxml-indexes.ts';
import { removeNode } from './ooxml-edit.ts';
import { markDocumentSetupEdit, styleElementsOf } from './style-definition-edit.ts';

/** Names of the styles document setup adds, the only ones this repair touches. */
const SETUP_STYLE_NAMES = new Set(['hyperlink', 'list paragraph']);

function attributeOf(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((a) => a.localName === localName)?.value;
}

function nameOf(style: OoxmlElement): string | undefined {
  for (const child of style.children) {
    if (child.kind !== 'textValue' && child.localName === 'name') return attributeOf(child, 'val');
  }
  return undefined;
}

/** Node ids of setup style copies after the first with the same id, type and name. */
export function duplicateSetupStyleIds(pkg: OoxmlPackage): string[] {
  const root = stylesPartOf(pkg)?.root;
  if (!root) return [];
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const style of styleElementsOf(root)) {
    const name = nameOf(style)?.toLowerCase();
    const styleId = attributeOf(style, 'styleId');
    if (!name || !styleId || !SETUP_STYLE_NAMES.has(name)) continue;
    const key = `${attributeOf(style, 'type') ?? ''}\u0000${styleId}\u0000${name}`;
    if (seen.has(key)) duplicates.push(style.id);
    else seen.add(key);
  }
  return duplicates;
}

/** A setup edit that removes duplicate setup styles, or null when there are none. */
export function duplicateSetupStylesEdit(
  pkg: OoxmlPackage
): ((pkg: OoxmlPackage) => OoxmlPackage) | null {
  if (duplicateSetupStyleIds(pkg).length === 0) return null;
  return markDocumentSetupEdit((current) => {
    let part = stylesPartOf(current);
    if (!part) return current;
    for (const nodeId of duplicateSetupStyleIds(current)) {
      const removed = removeNode(part, nodeId);
      if (!removed.ok) return current;
      part = removed.part;
    }
    return withPart(current, part);
  });
}
