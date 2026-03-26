import type { Node as PMNode } from 'prosemirror-model';

type Range = { from: number; to: number };

export function mapDirtyRangesToTopLevelIndices(doc: PMNode, ranges: Range[]): Set<number> {
  const result = new Set<number>();

  doc.forEach((node, offset, index) => {
    const from = offset;
    const to = offset + node.nodeSize;

    for (const range of ranges) {
      if (range.to > from && range.from < to) {
        result.add(index);
        break;
      }
    }
  });

  return result;
}
