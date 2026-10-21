// Minimum cuts can differ from the contextual segments used for unwrapped text.
import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import { wordBoundaries } from './cjk-line-break.ts';
import { cjkParagraphBreaks, hasCjkText } from './cjk-paragraph-breaks.ts';
import {
  eastAsianLanguage,
  resolveCjkTypography,
  type CjkTypographySettings,
} from './cjk-typography.ts';
import { compressCjkPieces } from './cjk-spacing.ts';
import type { FieldAwarePiece } from './field-pieces.ts';
import type { ResolvedTabStops } from './paragraph-tabs.ts';
import { measureDisplayText } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import type { TextMeasurer } from './semantic-records.ts';
import { withoutLineEndWhitespace } from './trailing-spaces.ts';

/** CJK minimums use paragraph analysis; other scripts retain ordinary word cuts. */
export function cjkAutofitBreaks(
  pieces: readonly FieldAwarePiece[],
  { props }: { readonly props: readonly OoxmlProperty[] },
  measurer: TextMeasurer,
  styleCascade?: { readonly typography?: CjkTypographySettings }
) {
  const policy = resolveCjkTypography(props, styleCascade?.typography);
  const visible = pieces.filter((piece) => !piece.style.hidden);
  if (
    !policy.characterWrap &&
    !visible.some((piece) => hasCjkText(piece.text) || eastAsianLanguage(piece.props))
  )
    return null;
  // This qualification selects the East Asian analysis, whose decisions ignore text context.
  // Ordinary cross-run dash cuts remain the caller's paragraphWordCuts, for both min and max.
  const breaks = cjkParagraphBreaks(visible, policy)!;
  const seams = punctuationSeams(
    visible,
    compressCjkPieces(visible, policy, measurer, undefined, Infinity),
    measurer
  );
  // A seam whose mark ends the candidate waits for the next candidate in the same segment.
  let pending = 0;
  return {
    /**
     * The width a candidate gives back to compressed punctuation seams whose two marks both
     * fall in the open segment, as they share a line there. `continues` says that the
     * candidate extends a segment that already holds text.
     */
    shared(piece: FieldAwarePiece, from: number, to: number, continues: boolean): number {
      let saved = continues ? pending : 0;
      pending = 0;
      if (seams.size === 0) return saved;
      for (let at = from; at < to; at++) {
        const seam = seams.get(piece.start + at);
        if (!seam) continue;
        if (!seam.right) {
          if (at > from || continues) saved += seam.amount;
        } else if (at + seam.length < to) saved += seam.amount;
        else pending = seam.amount;
      }
      return saved;
    },
    opens: (piece: FieldAwarePiece) => breaks.decision(piece, 0, '', piece.text) === 'opens',
    boundaries: (piece: FieldAwarePiece) =>
      breaks
        .boundaries(piece)
        .filter(
          (to) =>
            to === piece.text.length ||
            breaks.decision(piece, to, piece.text.slice(0, to), piece.text.slice(to)) === 'opens'
        ),
  };
}

interface PunctuationSeam {
  /** The width the mark gives up when its neighbour shares its line. */
  readonly amount: number;
  /** The mark gives up its right side to the next mark, not its left side to the previous one. */
  readonly right: boolean;
  readonly length: number;
}

/**
 * Adjacent full-width punctuation shares one half-em in line layout. Each compressed slice of
 * `compressed` maps, by source offset, to the width its mark gives up there.
 */
function punctuationSeams(
  visible: readonly FieldAwarePiece[],
  compressed: readonly FieldAwarePiece[],
  measurer: TextMeasurer
): ReadonlyMap<number, PunctuationSeam> {
  const seams = new Map<number, PunctuationSeam>();
  if (compressed === visible) return seams;
  // Compression keeps piece order: an unchanged piece passes through, a changed one is sliced.
  let index = 0;
  for (const slice of compressed) {
    const original = visible[index]!;
    if (slice === original || slice.end >= original.end) index++;
    if (slice.style === original.style) continue;
    const amount =
      measureDisplayText(
        slice.text,
        styleForFontSlot(original.style, original.fontSlot),
        measurer
      ) - measureDisplayText(slice.text, styleForFontSlot(slice.style, slice.fontSlot), measurer);
    if (amount > 0)
      seams.set(slice.start, {
        amount,
        right: slice.glyphOffsetPt === 0,
        length: slice.text.length,
      });
  }
  return seams;
}

/** The next unwrapped stop, excluding stops reserved for the numbering marker. */
export function nextAutofitTabStop(tabs: ResolvedTabStops, at: number): number {
  for (const stop of tabs.stops)
    if (!stop.numberingOnly && stop.positionPt > at + 1e-6) return stop.positionPt;
  const interval = tabs.defaultIntervalPt;
  return (Math.floor(at / interval + 1e-6) + 1) * interval;
}

/** Preserve upstream contextual word cuts, including paragraph-wide dash boundaries. */
export function measureUnwrappedAutofitText(
  text: string,
  boundaries: readonly number[] | undefined,
  measure: (text: string) => number,
  start: number,
  nextTabStop: (at: number) => number
): { width: number; trailing: number } {
  let width = 0;
  let trailing = 0;
  let from = 0;
  for (const to of boundaries ?? wordBoundaries(text, false)) {
    const candidate = text.slice(from, to);
    from = to;
    if (candidate.length === 0) continue;
    let advance: number;
    let spaces = 0;
    if (candidate === '\t') {
      advance = Math.max(0, nextTabStop(start + width) - (start + width));
    } else {
      const ink = withoutLineEndWhitespace(candidate);
      advance = measure(candidate);
      if (ink.length < candidate.length) spaces = advance - (ink ? measure(ink) : 0);
    }
    width += advance;
    trailing = spaces < advance ? spaces : trailing + spaces;
  }
  return { width, trailing };
}
