/**
 * One `w:pPr` per paragraph.
 *
 * `CT_P` holds at most one `w:pPr`, first. A file can hold more: an export of a document that
 * concurrent property edits left with two, or a writer that appends instead of replacing.
 * Typed, the extra `w:pPr` failed the paragraph's shape, and the paragraph was read as a
 * generic node: saved again, but neither shown nor editable. The paragraph keeps its first
 * `w:pPr` typed, and every other one stays generic at its position, so nothing is lost and
 * its runs still show.
 */
import type { OoxmlNode } from './ooxml-tree.ts';

/** A paragraph's children, with each `w:pPr` but a leading one read as generic. */
export function keepLeadingParagraphProperties(
  children: readonly OoxmlNode[]
): readonly OoxmlNode[] {
  let changed = false;
  const kept = children.map((child, index) => {
    if (child.kind !== 'paragraphProperties' || index === 0) return child;
    changed = true;
    return genericSubtree(child);
  });
  return changed ? kept : children;
}

/**
 * The node and everything under it as generic. Its children are not typed either: a
 * `w:sectPr` inside an extra `w:pPr` must not count as a section break.
 */
function genericSubtree(node: OoxmlNode): OoxmlNode {
  if (node.kind === 'textValue') return node;
  return { ...node, kind: 'generic', children: node.children.map(genericSubtree) } as OoxmlNode;
}
