import { isContentControl } from '../package/content-control-walk.ts';
import type { OoxmlNode } from '../package/ooxml-tree.ts';

/** Paragraph marks whose removal can merge into the next sibling block. */
export function paragraphMergeSources(children: readonly OoxmlNode[]): ReadonlySet<string> {
  const sources = new Set<string>();
  let nextIsParagraph = false;
  for (let index = children.length - 1; index >= 0; index--) {
    const child = children[index]!;
    if (child.kind === 'paragraph') {
      if (nextIsParagraph) sources.add(child.id);
      nextIsParagraph = true;
    } else if (child.kind === 'table' || (child.kind !== 'textValue' && isContentControl(child))) {
      nextIsParagraph = false;
    }
  }
  return sources;
}
