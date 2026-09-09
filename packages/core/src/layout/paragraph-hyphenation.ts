// Paragraph-flow hyphenation: gates, word lookahead, and a last-fit split.
//
// `paragraph-flow.ts` stays a thin call site. This module never mutates model text and
// never inserts U+00AD.

import type { DocumentHyphenationSettings, OoxmlProperty } from '@docx-editor.dev/core/store';
import {
  DISCRETIONARY_HYPHEN_GLYPH,
  hyphenationBreakOffsets,
  lastFittingDiscretionaryHyphen,
  MAX_HYPHENATION_WORD_UTF16,
  type DiscretionaryHyphenBreak,
} from './hyphenation.ts';
import type { ResolvedRunStyle } from './run-style.ts';
import type { StyleSpanRecord } from './semantic-records.ts';

const LETTER = /^\p{L}$/u;

/** Piece fields the TeX lookahead may read. */
export interface HyphenationPieceView {
  readonly text: string;
  readonly measureText?: string;
}

/** Leading Unicode letters of `text`, or empty when it does not open a letter word. */
export function leadingLetterRun(text: string): string {
  let out = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (!LETTER.test(char)) break;
    out += char;
    if (out.length >= MAX_HYPHENATION_WORD_UTF16) break;
  }
  return out;
}

/** One letters-only run inside a mixed token, capped at {@link MAX_HYPHENATION_WORD_UTF16}. */
export interface InteriorLetterRun {
  readonly start: number;
  readonly length: number;
}

/**
 * Letter runs inside `text`, including a leading run.
 *
 * Punctuation, digits, and spaces stay outside the run. A run that hits the UTF-16 cap
 * stops; remaining letters of that run are skipped so the next run is a new word.
 */
export function interiorLetterRuns(text: string): InteriorLetterRun[] {
  const runs: InteriorLetterRun[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    if (!LETTER.test(char)) {
      index += 1;
      continue;
    }
    const start = index;
    while (
      index < text.length &&
      LETTER.test(text[index]!) &&
      index - start < MAX_HYPHENATION_WORD_UTF16
    ) {
      index += 1;
    }
    runs.push({ start, length: index - start });
    while (index < text.length && LETTER.test(text[index]!)) index += 1;
  }
  return runs;
}

/**
 * Letters that continue the word after `afterUtf16` from `pieces[pieceIndex]`.
 *
 * An offset past a short earlier piece skips ahead. Stops at the first non-letter,
 * a `measureText` piece, or the UTF-16 cap.
 */
export function letterWordTail(
  pieces: readonly HyphenationPieceView[],
  pieceIndex: number,
  afterUtf16: number
): string {
  let out = '';
  let remaining = afterUtf16;
  for (let index = pieceIndex; index < pieces.length; index += 1) {
    const piece = pieces[index]!;
    if (piece.measureText !== undefined) break;
    if (remaining > piece.text.length) {
      remaining -= piece.text.length;
      continue;
    }
    if (remaining < 0) break;
    const slice = piece.text.slice(remaining);
    remaining = 0;
    for (let offset = 0; offset < slice.length; offset += 1) {
      const char = slice[offset]!;
      if (!LETTER.test(char)) return out;
      out += char;
      if (out.length >= MAX_HYPHENATION_WORD_UTF16) return out;
    }
  }
  return out;
}

export interface HyphenationOverflowInput {
  readonly settings: DocumentHyphenationSettings | undefined;
  readonly suppressAutoHyphens: boolean;
  readonly consecutiveHyphenatedLines: number;
  readonly slackPt: number;
  readonly word: string;
  readonly firstSliceUtf16: number;
  readonly language: string | null;
  readonly capsFormatted: boolean;
  readonly measure: (text: string) => number;
  /**
   * Skip the hyphenation-zone gate.
   *
   * The zone is the maximum accepted ragged whitespace. Ordinary wrap hyphenates only
   * when unused slack exceeds the zone. A small remainder wraps the whole word. An
   * unbroken word that cannot fit an empty line still takes a last-fitting pattern break.
   */
  readonly ignoreHyphenationZone?: boolean;
}

/**
 * Last TeX hyphen that fits the remaining slack, restricted to the first style span.
 *
 * Returns `null` when settings, zone, language, caps, suppression, the consecutive
 * limit, or a multi-span-only break refuse the split.
 */
export type OverflowingCandidateHyphenInput = Omit<
  HyphenationOverflowInput,
  'word' | 'firstSliceUtf16'
> & {
  readonly candidate: string;
  readonly pieces: readonly HyphenationPieceView[];
  readonly pieceIndex: number;
  readonly consumed: number;
  readonly layoutOwned: boolean;
  readonly measureText: string | undefined;
  /** Restrict the placed prefix to this UTF-16 length of `candidate`. */
  readonly maxUtf16Offset?: number;
};

/**
 * Last-fit hyphen whose prefix-plus-glyph fits `slackPt`, measured from the start of
 * `candidate` through an interior letter-run offset.
 *
 * TeX patterns see only the letter word (plus a same-span tail). The returned offset is
 * in `candidate`, so `{d.patient…}` can break as `{d.pa` without mutating model text.
 */
function lastFittingInteriorHyphen(
  input: OverflowingCandidateHyphenInput
): DiscretionaryHyphenBreak | null {
  const hyphenWidthPt = input.measure(DISCRETIONARY_HYPHEN_GLYPH);
  if (!Number.isFinite(hyphenWidthPt) || hyphenWidthPt < 0) return null;
  const doNotHyphenateCaps = input.settings?.doNotHyphenateCaps === true;
  const maxOffset = input.maxUtf16Offset ?? input.candidate.length;
  let best: DiscretionaryHyphenBreak | null = null;
  for (const run of interiorLetterRuns(input.candidate)) {
    if (run.start >= maxOffset) continue;
    const slice = input.candidate.slice(run.start, run.start + run.length);
    const word =
      slice +
      letterWordTail(input.pieces, input.pieceIndex, input.consumed + run.start + run.length);
    const offsets = hyphenationBreakOffsets(word, input.language, { doNotHyphenateCaps });
    for (const offset of offsets) {
      if (offset <= 0 || offset > run.length) continue;
      const utf16Offset = run.start + offset;
      if (utf16Offset > maxOffset) continue;
      const widthPt = input.measure(
        input.candidate.slice(0, utf16Offset) + DISCRETIONARY_HYPHEN_GLYPH
      );
      if (!Number.isFinite(widthPt) || widthPt <= 0 || widthPt > input.slackPt) continue;
      if (best === null || utf16Offset > best.utf16Offset) {
        best = { utf16Offset, widthPt, hyphenWidthPt };
      }
    }
  }
  return best;
}

type HyphenSpanExtras = Partial<
  Pick<StyleSpanRecord, 'link' | 'noteNav' | 'fontSlot' | 'revisions' | 'fieldAtom'>
>;

/** Last-fit hyphen for an overflowing candidate, including interior letter runs, or `null`. */
export function hyphenateOverflowingCandidate(
  input: OverflowingCandidateHyphenInput
): DiscretionaryHyphenBreak | null {
  if (input.layoutOwned || input.measureText !== undefined) return null;
  const settings = input.settings;
  if (!settings?.autoHyphenation) return null;
  if (input.suppressAutoHyphens) return null;
  if (!input.ignoreHyphenationZone && input.slackPt <= settings.hyphenationZonePt) return null;
  const limit = settings.consecutiveHyphenLimit;
  if (limit !== null && input.consecutiveHyphenatedLines >= limit) return null;
  if (settings.doNotHyphenateCaps && input.capsFormatted) return null;
  return lastFittingInteriorHyphen(input);
}

export function hyphenationSplitForOverflow(
  input: HyphenationOverflowInput
): DiscretionaryHyphenBreak | null {
  const settings = input.settings;
  if (!settings?.autoHyphenation) return null;
  if (input.suppressAutoHyphens) return null;
  if (!input.ignoreHyphenationZone && input.slackPt <= settings.hyphenationZonePt) return null;
  const limit = settings.consecutiveHyphenLimit;
  if (limit !== null && input.consecutiveHyphenatedLines >= limit) return null;
  if (input.firstSliceUtf16 <= 0 || input.firstSliceUtf16 > input.word.length) return null;
  if (settings.doNotHyphenateCaps && input.capsFormatted) return null;
  const found = lastFittingDiscretionaryHyphen(
    input.word,
    input.language,
    input.slackPt,
    input.measure,
    { doNotHyphenateCaps: settings.doNotHyphenateCaps }
  );
  if (!found) return null;
  if (found.utf16Offset > input.firstSliceUtf16) return null;
  return found;
}

export interface DiscretionaryHyphenPlacement {
  readonly span: StyleSpanRecord;
  readonly remaining: string;
  readonly remainingStart: number;
}

/** Prefix span plus remainder for one discretionary hyphen. Shared by wrap and empty-line cuts. */
export function placeDiscretionaryHyphenBreak(input: {
  readonly hyphen: DiscretionaryHyphenBreak;
  readonly candidate: string;
  readonly paragraphId: string;
  readonly prefixStart: number;
  readonly x: number;
  readonly height: number;
  readonly props: readonly OoxmlProperty[];
  readonly style: ResolvedRunStyle;
  readonly extras?: HyphenSpanExtras;
}): DiscretionaryHyphenPlacement {
  const end = input.prefixStart + input.hyphen.utf16Offset;
  return {
    span: {
      range: { paragraphId: input.paragraphId, start: input.prefixStart, end },
      text: input.candidate.slice(0, input.hyphen.utf16Offset),
      props: input.props,
      style: input.style,
      box: { x: input.x, y: 0, width: input.hyphen.widthPt, height: input.height },
      discretionaryHyphen: { widthPt: input.hyphen.hyphenWidthPt },
      ...input.extras,
    },
    remaining: input.candidate.slice(input.hyphen.utf16Offset),
    remainingStart: end,
  };
}

export interface OversizedEmptyLineCut extends DiscretionaryHyphenPlacement {
  readonly remainingWidth: number;
  readonly usedHyphen: boolean;
}

function emergencyPrefixLength(
  remaining: string,
  availablePt: number,
  measure: (text: string) => number
): number {
  let low = 1;
  let high = remaining.length - 1;
  let fitLength = 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const midWidth = measure(remaining.slice(0, mid));
    if (midWidth <= availablePt) {
      fitLength = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return fitLength;
}

/**
 * Next prefix for an oversized word on an empty line: a last-fit hyphen, else a raw cut.
 *
 * The zone is ignored here. The unbroken word cannot move to a later line.
 */
export function nextOversizedEmptyLineCut(input: {
  readonly remaining: string;
  readonly remainingStart: number;
  readonly availablePt: number;
  readonly measure: (text: string) => number;
  readonly hyphen: Omit<OverflowingCandidateHyphenInput, 'candidate' | 'slackPt'>;
  readonly paragraphId: string;
  readonly x: number;
  readonly height: number;
  readonly props: readonly OoxmlProperty[];
  readonly style: ResolvedRunStyle;
  readonly extras?: HyphenSpanExtras;
}): OversizedEmptyLineCut | null {
  if (input.remaining.length <= 1) return null;
  const remainingWidth = input.measure(input.remaining);
  if (remainingWidth <= input.availablePt) return null;
  const hyphen = hyphenateOverflowingCandidate({
    ...input.hyphen,
    candidate: input.remaining,
    slackPt: input.availablePt,
    ignoreHyphenationZone: true,
  });
  if (hyphen) {
    const placed = placeDiscretionaryHyphenBreak({
      hyphen,
      candidate: input.remaining,
      paragraphId: input.paragraphId,
      prefixStart: input.remainingStart,
      x: input.x,
      height: input.height,
      props: input.props,
      style: input.style,
      extras: input.extras,
    });
    return {
      ...placed,
      remainingWidth: input.measure(placed.remaining),
      usedHyphen: true,
    };
  }
  const fitLength = emergencyPrefixLength(input.remaining, input.availablePt, input.measure);
  const prefix = input.remaining.slice(0, fitLength);
  const remaining = input.remaining.slice(fitLength);
  return {
    span: {
      range: {
        paragraphId: input.paragraphId,
        start: input.remainingStart,
        end: input.remainingStart + fitLength,
      },
      text: prefix,
      props: input.props,
      style: input.style,
      box: { x: input.x, y: 0, width: input.measure(prefix), height: input.height },
      ...input.extras,
    },
    remaining,
    remainingStart: input.remainingStart + fitLength,
    remainingWidth: input.measure(remaining),
    usedHyphen: false,
  };
}
