// Space compression adapted from PR #707's paragraph-justify.ts (2ce89f6e7).
// Publish spacing in Core so PDF, browser paint, and caret measurement agree.
// The format's producers use a 75% space floor and prefer expansion near natural spacing.
// An open reference implementation of the same rule:
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

/**
 * Only an ordinary word followed by a space can borrow existing inter-word space.
 *
 * A word that straddles a source-run seam — a quoted bold term, a semicolon left in
 * the next run — overflows on a later piece than the one that opened it. The kept
 * line still runs to `lineWidth`, but the line the reference would produce instead
 * ends where the word began, so `wordStart`/`wordStartWidth` describe that
 * alternative. Their defaults are the values the caller already holds when the
 * overflowing candidate opens the word, so that path measures exactly as before.
 */
export function fitsWithSpaceShrink(
  spans: readonly StyleSpanRecord[],
  candidate: string,
  style: ResolvedRunStyle,
  measurer: TextMeasurer,
  lineWidth: number,
  available: number,
  wordStart: number = spans.length,
  wordStartWidth: number = lineWidth
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
  // The alternative line stops before the overflowing word, so only the spans ahead
  // of it carry its stretch, and the space in front of it is the one that hangs.
  const before = spans.slice(0, Math.max(0, Math.min(wordStart, spans.length)));
  const terminalSpace = before.length ? capacity(before[before.length - 1]!, measurer) * 4 : 0;
  const existingSpaces =
    before.reduce((sum, span) => sum + capacity(span, measurer) * 4, 0) - terminalSpace;
  if (existingSpaces <= 0) return false;
  const expansion = 1 + Math.max(0, available - wordStartWidth + terminalSpace) / existingSpaces;
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
