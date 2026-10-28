// Inter-character justification uses real span geometry. Paint and exporters already
// consume the gaps between spans; no browser-only text-justify rule may move the caret.
import { endsWithSpaceSlot } from './trailing-spaces.ts';
import { segmentGraphemes } from './grapheme.ts';
import { cjkParagraphBreaks, hasCjkText, isCjk } from './cjk-paragraph-breaks.ts';
import { DEFAULT_CJK_TYPOGRAPHY } from './cjk-typography.ts';
import { cjkCutAllowedBetween, lastCodePointOf } from './cjk-line-break.ts';
import { isSplittableSpan, splitSpanParts, type SpanPart } from './span-parts.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';

export function justifyCjkSpans(
  spans: readonly StyleSpanRecord[],
  measurer: TextMeasurer,
  slack: number
): readonly StyleSpanRecord[] | null {
  if (!spans.some((span) => hasCjkText(span.text))) return null;
  // Tabs and float passages reserve exact positions, which justification must not cross.
  if (spans.some((span) => span.text.includes('\t') || span.wrapAdvanceBefore)) return spans;
  const split: StyleSpanRecord[] = [];
  for (const span of spans) {
    if (!isSplittableSpan(span) || !hasCjkText(span.text)) {
      split.push(span);
      continue;
    }
    const clusters = segmentGraphemes(span.text);
    const parts: SpanPart[] = [];
    let from = 0;
    for (let index = 1; index < clusters.length; index++) {
      if (
        isCjk(lastCodePointOf(clusters[index - 1]!.text)!) ||
        isCjk(clusters[index]!.text.codePointAt(0)!)
      ) {
        parts.push({ from, to: clusters[index]!.utf16From });
        from = clusters[index]!.utf16From;
      }
    }
    parts.push({ from, to: span.text.length });
    if (parts.length === 1) split.push(span);
    else split.push(...splitSpanParts(span, parts, measurer));
  }
  const gaps = new Set<number>();
  const pieces = split.map((span) => ({
    text: span.text,
    props: span.props,
    style: span.style,
    start: span.range.start,
    end: span.range.end,
    projected: !!(span.projected || span.equation),
  }));
  const breaks = cjkParagraphBreaks(pieces, DEFAULT_CJK_TYPOGRAPHY);
  for (let index = 1; index < split.length; index++) {
    const previous = split[index - 1]!;
    const current = split[index]!;
    const before = lastCodePointOf(previous.text);
    const after = current.text.codePointAt(0);
    if (
      before === undefined ||
      after === undefined ||
      current.lineEndWhitespace ||
      current.text === '\n'
    )
      continue;
    if (
      endsWithSpaceSlot(previous.text) ||
      ((isCjk(before) || isCjk(after)) &&
        breaks?.decision(pieces[index]!, 0, previous.text, current.text) === 'opens' &&
        cjkCutAllowedBetween(before, after) &&
        !/[\u00a0\u202f\u2060\ufeff]/u.test(previous.text.slice(-1) + current.text[0]))
    )
      gaps.add(index);
  }
  if (gaps.size === 0) return spans;
  const step = slack / gaps.size;
  let shift = 0;
  return split.map((span, index) => {
    if (gaps.has(index)) shift += step;
    return shift === 0 ? span : { ...span, box: { ...span.box, x: span.box.x + shift } };
  });
}
