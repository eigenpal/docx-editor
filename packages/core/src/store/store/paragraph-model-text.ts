// Raw paragraph text in the canonical model offset vocabulary.

import { fieldAtomText } from '../package/field-nodes.ts';
import { hardBreakText } from '../package/hard-break.ts';
import type { OoxmlParagraphNode } from '../package/ooxml-tree.ts';
import { segmentsOf } from './tree-op-segments.ts';

/** Paragraph text as the ops address it, from one canonical paragraph node. @internal */
export function paragraphModelTextOf(paragraph: OoxmlParagraphNode): string {
  let text = '';
  for (const segment of segmentsOf(paragraph)) {
    if (segment.removeNodeIds && segment.removeNodeIds.length > 0) {
      text += fieldAtomText();
      continue;
    }
    if (segment.node.kind === 'textValue') text += segment.node.value;
    else if (segment.node.kind === 'tab') text += '\t';
    else if (segment.node.kind === 'hardBreak') text += hardBreakText(segment.node);
    else if (
      segment.node.kind === 'fldChar' ||
      segment.node.kind === 'fldSimple' ||
      (segment.node.kind === 'generic' &&
        (segment.node.localName === 'fldChar' || segment.node.localName === 'fldSimple'))
    ) {
      text += fieldAtomText();
    }
  }
  return text;
}
