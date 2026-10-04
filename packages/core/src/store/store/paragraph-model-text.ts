// Raw paragraph text in the canonical model offset vocabulary.

import { inlineCharacterTextOf, isSymbolElement, SYMBOL_TEXT } from '../package/hyphen-text.ts';
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
    else if (inlineCharacterTextOf(segment.node) !== null)
      text += inlineCharacterTextOf(segment.node);
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

/**
 * Paragraph model text with its symbols left out. A symbol reads as "(" in model text; text
 * that is written back as plain characters, such as a heading's table of contents row, must
 * not turn it into a parenthesis. @internal
 */
export function withoutSymbols(paragraph: OoxmlParagraphNode, text: string): string {
  if (!text.includes(SYMBOL_TEXT)) return text;
  let kept = '';
  let at = 0;
  for (const segment of segmentsOf(paragraph)) {
    if (!isSymbolElement(segment.node) || segment.start < at) continue;
    kept += text.slice(at, segment.start);
    at = segment.end;
  }
  return kept + text.slice(at);
}
