// Inter-character justification uses real span geometry. Paint and exporters already
// consume the gaps between spans; no browser-only text-justify rule may move the caret.
import { segmentGraphemes } from './grapheme.ts';
import { cjkParagraphBreaks, hasCjkText, isCjk } from './cjk-paragraph-breaks.ts';
import { DEFAULT_CJK_TYPOGRAPHY } from './cjk-typography.ts';
import { cjkCutAllowedBetween, lastCodePointOf } from './cjk-line-break.ts';
import { measureDisplayText } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
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
    if (
      span.projected ||
      span.equation ||
      span.range.end - span.range.start !== span.text.length ||
      !hasCjkText(span.text)
    ) {
      split.push(span);
      continue;
    }
    const clusters = segmentGraphemes(span.text);
    const parts: { from: number; to: number }[] = [];
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
    if (parts.length === 1) {
      split.push(span);
      continue;
    }
    const style = styleForFontSlot(span.style, span.fontSlot);
    const widths = parts.map((part) =>
      measureDisplayText(span.text.slice(part.from, part.to), style, measurer)
    );
    const total = widths.reduce((sum, value) => sum + value, 0);
    let x = span.box.x;
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index]!;
      const width = total > 0 ? (widths[index]! * span.box.width) / total : 0;
      const { caretEdges: _edges, ...rest } = span;
      split.push({
        ...rest,
        text: span.text.slice(part.from, part.to),
        range: {
          ...span.range,
          start: span.range.start + part.from,
          end: span.range.start + part.to,
        },
        box: { ...span.box, x, width },
      });
      x += width;
    }
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
      previous.text.endsWith(' ') ||
      ((isCjk(before) || isCjk(after)) &&
        breaks?.decision(pieces[index]!, 0) === 'opens' &&
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
