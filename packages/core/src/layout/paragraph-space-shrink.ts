// Space compression adapted from PR #707's paragraph-justify.ts (2ce89f6e7).
// Publish spacing in Core so PDF, browser paint, and caret measurement agree.
// Modern Word uses a 75% space floor and prefers expansion near natural spacing.
// Verified against Word 16.113 and LibreOffice's interoperability implementation:
// https://github.com/LibreOffice/core/commit/529755f0919217a84a12daad0fddfddd1124f0e9
import { measureDisplayText } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import type { ResolvedRunStyle } from './run-style.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';

function capacity(span: StyleSpanRecord, measurer: TextMeasurer): number {
  if (
    (!span.style.shaping && !/^[\p{Script=Latin}\p{N}\p{P} ]*$/u.test(span.text)) ||
    span.lineEndWhitespace ||
    !/^[^\s]* $/u.test(span.text) ||
    span.equation
  )
    return 0;
  const style = styleForFontSlot(span.style, span.fontSlot);
  const space = Math.max(
    0,
    span.box.width - measureDisplayText(span.text.slice(0, -1), style, measurer)
  );
  const minimum = space * 0.75;
  return space - minimum;
}

/** Only an ordinary word followed by a space can borrow existing inter-word space. */
export function fitsWithSpaceShrink(
  spans: readonly StyleSpanRecord[],
  candidate: string,
  style: ResolvedRunStyle,
  measurer: TextMeasurer,
  lineWidth: number,
  available: number
): boolean {
  if (
    !/^[^\s]+ $/u.test(candidate) ||
    spans.some((s) => s.text.includes('\t') || s.wrapAdvanceBefore || s.equation)
  )
    return false;
  const visible = measureDisplayText(candidate.slice(0, -1), style, measurer);
  const needed = lineWidth + visible - available;
  const budget = spans.reduce((sum, span) => sum + capacity(span, measurer), 0);
  if (needed <= 0 || needed > budget + 0.001) return false;
  const spaceWidth = budget * 4;
  const terminalSpace = capacity(spans[spans.length - 1]!, measurer) * 4;
  const existingSpaces = spaceWidth - terminalSpace;
  if (existingSpaces <= 0) return false;
  const expansion = 1 + Math.max(0, available - lineWidth + terminalSpace) / existingSpaces;
  const compression = spaceWidth / (spaceWidth - needed);
  return expansion > 1.5 || 1 + (expansion - 1) / 1.7 >= compression;
}

/** Compress eligible spaces evenly, respecting every face's minimum space advance. */
export function shrinkJustifiedSpans(
  spans: readonly StyleSpanRecord[],
  needed: number,
  measurer: TextMeasurer
): readonly StyleSpanRecord[] {
  const capacities = spans.map((span, index) =>
    index < spans.length - 1 ? capacity(span, measurer) : 0
  );
  if (needed <= 0 || needed > capacities.reduce((a, b) => a + b, 0) + 0.001) return spans;
  const amounts = capacities.map(() => 0);
  let remaining = needed;
  for (let pass = 0; pass < capacities.length && remaining > 0.001; pass++) {
    const active = capacities
      .map((cap, index) => (cap - amounts[index]! > 0.001 ? index : -1))
      .filter((i) => i >= 0);
    if (!active.length) break;
    const step = remaining / active.length;
    for (const index of active) {
      const take = Math.min(step, capacities[index]! - amounts[index]!);
      amounts[index] += take;
      remaining -= take;
    }
  }
  let shift = 0;
  return spans.map((span, index) => {
    const amount = amounts[index]!;
    const result =
      shift || amount
        ? {
            ...span,
            box: { ...span.box, x: span.box.x - shift, width: span.box.width - amount },
            ...(amount
              ? {
                  style: {
                    ...span.style,
                    shaping: {
                      script: 'Latn',
                      direction: 'ltr' as const,
                      level: 0,
                      baseLevel: 0,
                      ...span.style.shaping,
                      wordSpacingPt: (span.style.shaping?.wordSpacingPt ?? 0) - amount,
                    },
                  },
                }
              : {}),
          }
        : span;
    shift += amount;
    return result;
  });
}
