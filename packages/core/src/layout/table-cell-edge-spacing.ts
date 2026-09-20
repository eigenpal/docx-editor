// Auto paragraph spacing at a table cell's own edges, split out of `semantic-table-layout.ts`
// so that module stays inside its line budget; the rule and its budget are unchanged.

import type { OoxmlProperty } from '../store/store/tree-op-types.ts';
import { paragraphAutoSpacingSides, type ParagraphSpacing } from './paragraph-style.ts';

/**
 * Drop the auto gap where a paragraph meets its cell's own boundary.
 *
 * `w:beforeAutospacing` / `w:afterAutospacing` resolve to Word's automatic value, and that
 * value applies BETWEEN paragraphs — including between two inside one cell. It contributes
 * nothing across a cell boundary: a captured control at 10pt with an 11.52pt line pitch puts
 * 26.16pt between two auto-spaced paragraphs in a cell, the same as in the body, while the
 * gap across a row boundary carries no addition at all. See `.cache/pdf/claude-autospacing/`.
 *
 * An AUTHORED measurement is untouched — only the substituted value is suppressed, because
 * only it is the consumer's to decide.
 */
export function cellEdgeAutoSpacing(
  spacing: ParagraphSpacing,
  props: readonly OoxmlProperty[],
  firstInCell: boolean,
  lastInCell: boolean
): ParagraphSpacing {
  if (!firstInCell && !lastInCell) return spacing;
  const auto = paragraphAutoSpacingSides(props);
  const dropBefore = firstInCell && auto.before;
  const dropAfter = lastInCell && auto.after;
  if (!dropBefore && !dropAfter) return spacing;
  return {
    before: dropBefore ? 0 : spacing.before,
    after: dropAfter ? 0 : spacing.after,
  };
}
