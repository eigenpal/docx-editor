// Tab over a selection (paginated-surface seam).
//
// Outside a list, Tab normally types a tab character, and a typed character replaces the
// selection. A selection that covers whole paragraphs is different: Tab indents them and
// keeps the text. Without that rule, selecting a paragraph and pressing Tab deleted it.

import type { SemanticPosition } from '@docx-editor.dev/core/layout';
import { indentTwips } from '../layout/paragraph-indent.ts';

/**
 * What Tab does to the selected paragraphs, or `null` when it types a tab character.
 *
 * - A selection over two or more paragraphs steps the left indent of all of them.
 * - A selection in one paragraph that starts at the paragraph start sets a first-line
 *   indent. When the first line is already indented that far, it steps the left indent.
 * - A caret, or a selection that starts inside the text, types a tab.
 *
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
  if (from.offset !== 0 || paragraphs.length === 0) return null;
  const kind = firstLineTwips(from.paragraphId) < step ? 'firstLine' : 'left';
  return { kind, paragraphs };
}

/**
 * The resolved first-line offset of a paragraph in twips: positive for a first-line
 * indent, negative for a hanging one, zero when nothing states it.
 *
 * `w:ind` cascades attribute by attribute (17.3.1.12), and a non-zero `w:hanging` wins
 * over `w:firstLine`. The indent writers state the unused one as an explicit zero.
 */
export function firstLineTwipsOf(
  properties: readonly { localName: string; attributes?: Readonly<Record<string, string>> }[]
): number {
  let firstLine: number | null = null;
  let hanging: number | null = null;
  for (const property of properties) {
    if (property.localName !== 'ind') continue;
    firstLine = indentTwips(property.attributes?.firstLine) ?? firstLine;
    hanging = indentTwips(property.attributes?.hanging) ?? hanging;
  }
  if (hanging !== null && hanging !== 0) return -hanging;
  return firstLine ?? 0;
}
