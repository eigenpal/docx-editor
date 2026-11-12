import type { HighlightRange } from '../contracts/editor-highlights.ts';
import type { ParagraphText } from '../contracts/editor-paragraph-text.ts';

/**
 * Highlight ranges for the `keptText` range from `from` to `to` (UTF-16 offsets, `to`
 * exclusive), with `expectedText` set so a range stops painting if its text changes.
 *
 * Kept text leaves out tracked deletions and hidden text, so one checked word can cover
 * several stretches of the paragraph. You get one range for each stretch, and an empty
 * array when the range is empty or outside `keptText`.
 *
 * @example
 * ```ts
 * const ranges = editor.getParagraphs().flatMap((paragraph) =>
 *   [...paragraph.keptText.matchAll(/\bteh\b/g)].flatMap((match) =>
 *     keptTextRanges(paragraph, match.index, match.index + match[0].length)
 *   )
 * );
 * editor.setHighlights('spelling', ranges);
 * ```
 * @public
 */
export function keptTextRanges(
  paragraph: ParagraphText,
  from: number,
  to: number
): HighlightRange[] {
  const ranges: HighlightRange[] = [];
  for (const span of paragraph.keptSpans) {
    const keptStart = Math.max(from, span.keptStart);
    const keptEnd = Math.min(to, span.keptStart + span.length);
    if (keptStart >= keptEnd) continue;
    const start = span.start + keptStart - span.keptStart;
    const length = keptEnd - keptStart;
    const expectedText = paragraph.text.slice(start, start + length);
    ranges.push({ blockId: paragraph.blockId, start, length, expectedText });
  }
  return ranges;
}
