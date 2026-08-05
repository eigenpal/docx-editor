import type { OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';

/** Collect paragraph node ids in document-wide index order (matches agents `getParagraphAtIndex`). */
export function collectParagraphIds(part: OoxmlPart): string[] {
  const ids: string[] = [];
  const walkBlocks = (children: readonly OoxmlNode[]): void => {
    for (const child of children) {
      if (child.kind === 'paragraph') {
        ids.push(child.id);
      } else if (child.kind === 'table') {
        for (const row of child.children) {
          if (row.kind !== 'tableRow') continue;
          for (const cell of row.children) {
            if (cell.kind !== 'tableCell') continue;
            walkBlocks(cell.children);
          }
        }
      } else if (child.kind === 'generic' && child.localName === 'sdt') {
        for (const inner of child.children) {
          if (inner.kind !== 'textValue' && inner.localName === 'sdtContent') {
            walkBlocks(inner.children);
          }
        }
      }
    }
  };
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'body' || node.localName === 'hdr' || node.localName === 'ftr') {
      walkBlocks(node.children);
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  return ids;
}
