import type { OoxmlNode } from '../store/package/ooxml-tree.ts';
import { isInlineRunContainer } from '../store/package/ooxml-shared.ts';
import { MAX_REVISION_DEPTH } from './revision-projection.ts';

/** Visit run content below the bounded inline-container surface of one paragraph. */
export function walkDrawingRunContent(
  paragraph: Exclude<OoxmlNode, { kind: 'textValue' }>,
  visitRunContent: (node: OoxmlNode) => void
): void {
  const visitInline = (child: OoxmlNode, depth: number): void => {
    if (child.kind === 'run') {
      for (const inner of child.children) visitRunContent(inner);
      return;
    }
    if (isInlineRunContainer(child) && depth < MAX_REVISION_DEPTH) {
      for (const inner of child.children) visitInline(inner, depth + 1);
    }
  };
  for (const child of paragraph.children) visitInline(child, 0);
}
