import { findNode } from '../store/package/ooxml-edit.ts';
import { fieldAtomText } from '../store/package/field-nodes.ts';
import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import { isParagraph, segmentsOf } from '../store/store/tree-op-segments.ts';
import { HeadlessRepackRefusal } from './headless-errors.ts';

/** Map a legacy plain-text offset to a tree UTF-16 offset (drawings occupy one atom each). */
export function legacyOffsetToTreeOffset(
  part: OoxmlPart,
  paragraphId: string,
  legacyOffset: number
): number {
  const paragraph = findNode(part, paragraphId);
  if (!isParagraph(paragraph)) throw new HeadlessRepackRefusal('unknown-paragraph', paragraphId);
  let legacy = 0;
  let tree = 0;
  for (const segment of segmentsOf(paragraph)) {
    if (segment.removeNodeIds && segment.removeNodeIds.length > 0) {
      if (legacy === legacyOffset) return tree;
      if (segment.node.kind === 'drawing') {
        tree += fieldAtomText().length;
        continue;
      }
      tree += fieldAtomText().length;
      continue;
    }
    const len = segment.end - segment.start;
    if (legacy + len >= legacyOffset) return tree + (legacyOffset - legacy);
    legacy += len;
    tree += len;
  }
  if (legacy === legacyOffset) return tree;
  throw new HeadlessRepackRefusal('offset-out-of-range', `legacy offset ${legacyOffset}`);
}
