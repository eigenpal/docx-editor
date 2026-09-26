// Border groups around a paragraph that opens with a page break.
//
// Paragraphs with identical borders draw one box (`w:between`, §17.3.1.24). A paragraph whose
// text follows a leading page break does not join the box above it: its text opens a box of
// its own on the next sheet, and the paragraph above closes its box with its bottom rule.

import type { OoxmlElement, OoxmlParagraphNode } from '@docx-editor.dev/core/store';
import { paragraphModelTextOf } from '../store/store/paragraph-model-text.ts';
import type { PreparedBlock } from './section-prepass-types.ts';

const opensWithBreak = new WeakMap<OoxmlElement, boolean>();

/**
 * Whether a paragraph's text opens with a page break and has text after it. Read from the
 * model, so a neighbour can ask before the paragraph is broken into lines.
 */
export function textOpensWithPageBreak(paragraph: OoxmlElement): boolean {
  const known = opensWithBreak.get(paragraph);
  if (known !== undefined) return known;
  const text = paragraphModelTextOf(paragraph as OoxmlParagraphNode);
  const opens = text.startsWith('\f') && /[^\f\n]/.test(text);
  opensWithBreak.set(paragraph, opens);
  return opens;
}

/** Whether `block` continues the border group of the block before it. */
export function joinsBorderGroup(
  before: PreparedBlock | undefined,
  block: PreparedBlock | undefined
): boolean {
  return (
    block?.kind === 'paragraph' &&
    block.borderGroupKey !== '' &&
    before?.kind === 'paragraph' &&
    before.borderGroupKey === block.borderGroupKey &&
    !textOpensWithPageBreak(block.paragraph)
  );
}

/**
 * Flow keys that also say when the next paragraph leaves the group by opening with a page
 * break. The border-group flow keys compare group identities only, and that change moves
 * this paragraph's closing rule without touching its own key.
 */
export function leadingBreakGroupFlowKeys(
  keys: string[],
  prepared: readonly PreparedBlock[]
): string[] {
  let flow = keys;
  for (let index = 0; index + 1 < prepared.length; index += 1) {
    const block = prepared[index]!;
    const next = prepared[index + 1]!;
    if (
      block.kind !== 'paragraph' ||
      next.kind !== 'paragraph' ||
      block.borderGroupKey === '' ||
      next.borderGroupKey !== block.borderGroupKey ||
      !textOpensWithPageBreak(next.paragraph)
    ) {
      continue;
    }
    if (flow === keys) flow = [...keys];
    flow[index] = `${flow[index]}~lbg`;
  }
  return flow;
}
