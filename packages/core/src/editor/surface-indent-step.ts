// Indent steps: Increase/Decrease Indent and Tab over a selection (paginated-surface seam).
//
// Outside a list, Tab normally types a tab character, and a typed character replaces the
// selection. A selection over paragraphs, or from a paragraph start, is different: Tab
// indents and keeps the text. Without that rule, selecting a paragraph and pressing Tab
// deleted it.

import { readTwipsMeasure } from '@docx-editor.dev/core/store';
import type { SemanticPosition } from '@docx-editor.dev/core/layout';
import { MAX_PARAGRAPH_INDENT_TWIPS } from '../layout/paragraph-indent.ts';

/** Word's Increase/Decrease Indent step: one default tab stop. */
export const INDENT_STEP_TWIPS = 720;

/** One indent step from `current`, never past the margin or the layout's indent bound. */
export function nextLeftIndent(current: number, step: number): number {
  return Math.min(MAX_PARAGRAPH_INDENT_TWIPS, Math.max(0, current + step * INDENT_STEP_TWIPS));
}

/**
 * `w:ind/@left` in twips, zero when nothing states it.
 *
 * Resolved across the whole list rather than picked out of it: this reads a CASCADE, whose
 * entries run lowest precedence first, so taking the first `w:ind` answered the style's
 * indent for a paragraph that had already been indented past it — and Increase Indent then
 * rewrote the same one step forever.
 *
 * Resolved PER LEVEL, not per attribute, which is where `cascadedParagraphAttributes` is
 * the wrong tool: `w:left` and `w:start` are two SPELLINGS OF ONE SETTING (transitional and
 * ISO Strict), so flattening both into one bag and preferring `left` answers whichever
 * level happened to use that word. A paragraph spelling it `w:start` over a style spelling
 * it `w:left` then stepped BACKWARDS on Increase Indent. This is the rule `paragraphIndent`
 * already applies, and the two must agree or the ruler and the button disagree.
 */
export function leftIndentTwipsOf(
  properties: readonly { localName: string; attributes?: Readonly<Record<string, string>> }[]
): number {
  let raw: string | undefined;
  for (const property of properties) {
    if (property.localName !== 'ind') continue;
    const stated = property.attributes?.left ?? property.attributes?.start;
    if (stated !== undefined) raw = stated;
  }
  const twips = readTwipsMeasure(raw);
  return twips === null || Math.abs(twips) > 9_999_999 ? 0 : twips;
}

/**
 * What Tab does to the selected paragraphs, or `null` when it types a tab character.
 *
 * - A selection over two or more paragraphs steps the left indent of all of them.
 * - A selection in one paragraph that starts at the paragraph start sets a first-line
 *   indent, also when it covers only part of the text. When the first line already has an
 *   indent of one step or more, or a hanging indent, it steps the left indent instead.
 * - A caret, or a selection in one paragraph that starts inside the text, types a tab.
 *
 * `firstLineTwips` answers the resolved signed first-line offset, negative when hanging.
 * `touched` is every paragraph from the range start to the range end, in order. A range
 * that ends at offset 0 of the next paragraph selects only the paragraph mark, so that
 * last paragraph does not count.
 */
export function tabIndentFor(
  range: { readonly from: SemanticPosition; readonly to: SemanticPosition },
  touched: readonly string[],
  firstLineTwips: (paragraphId: string) => number,
  step: number
): { readonly kind: 'firstLine' | 'left'; readonly paragraphs: readonly string[] } | null {
  const { from, to } = range;
  if (from.paragraphId === to.paragraphId && from.offset === to.offset) return null;
  const paragraphs = touched.length > 1 && to.offset === 0 ? touched.slice(0, -1) : touched;
  if (paragraphs.length > 1) return { kind: 'left', paragraphs };
  if (from.offset !== 0) return null;
  const firstLine = firstLineTwips(from.paragraphId);
  const kind = firstLine >= 0 && firstLine < step ? 'firstLine' : 'left';
  return { kind, paragraphs };
}
