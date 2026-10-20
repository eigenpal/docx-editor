// Where an insertion lands right after a complex field that ends its paragraph.
//
// Split out of `tree-op-segments.ts`, which is at its line cap; it resolves every other
// insertion site and calls in here.

import { isFldChar } from '../package/field-nodes.ts';
import type { OoxmlElement, OoxmlParagraphNode } from '../package/ooxml-tree.ts';
import { inlineContainersOf } from './tree-op-nodes.ts';
import { paragraphOffsetIndex, type InsertionSite, type Segment } from './tree-op-segments.ts';

/** Direct element parent of one descendant within a paragraph. */
export function directParentOf(parent: OoxmlElement, id: string): OoxmlElement | null {
  for (const child of parent.children) {
    if (child.id === id) return parent;
    if (child.kind === 'textValue') continue;
    const found = directParentOf(child, id);
    if (found) return found;
  }
  return null;
}

/**
 * A new run after the `end` marker of a complex field that closes the paragraph's content.
 *
 * The field is one atom whose segment names its `begin` run, so the generic trailing rules
 * joined the paragraph's last run, which is the one holding `end`. Text written there sits in
 * the field's own closing run, and a field or picture written next to it breaks the field
 * shape every reader expects. The new run escapes wrappers that end with the field, such as
 * the insertion that proposed it, and stays before closing bookmarks.
 */
export function afterTrailingFieldEnd(
  paragraph: OoxmlParagraphNode,
  trailing: Segment,
  offset: number
): InsertionSite | null {
  if (!trailing.removeNodeIds) return null;
  const offsets = paragraphOffsetIndex(paragraph);
  for (let index = trailing.removeNodeIds.length - 1; index >= 0; index -= 1) {
    const id = trailing.removeNodeIds[index]!;
    const run = directParentOf(paragraph, id);
    if (run?.kind !== 'run') continue;
    if (!run.children.some((child) => child.id === id && isFldChar(child, 'end'))) continue;
    const exited =
      inlineContainersOf(paragraph, run.id)
        .filter((node) => offsets.spanOf(node)?.end === offset)
        .at(-1) ?? run;
    const holder = directParentOf(paragraph, exited.id) ?? paragraph;
    let at = holder.children.findIndex((node) => node.id === exited.id) + 1;
    while (holder.children[at]?.kind === 'bookmarkEnd') at += 1;
    return { kind: 'newRun', holder, index: at };
  }
  return null;
}
