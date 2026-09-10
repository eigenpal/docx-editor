// Mixed-style `{...}` stream packing for automatic hyphenation (DOM-free).
//
// Uniform tokens stay on the TeX path in `paragraph-hyphenation.ts`. This module packs a
// mixed-effective-style brace token as one continuous stream: no `.[]{}='` wrap, longest
// grapheme prefix per empty line, source language + script TeX when that word overflows.

import type { DocumentHyphenationSettings } from '@docx-editor.dev/core/store';
import { graphemeOffsetToUtf16, segmentGraphemes } from './grapheme.ts';
import {
  admittedHyphenationLanguage,
  DISCRETIONARY_HYPHEN_GLYPH,
  hyphenationBreakOffsets,
  MAX_HYPHENATION_CACHE_ENTRIES,
  type DiscretionaryHyphenBreak,
} from './hyphenation.ts';
import { OVERFLOW_TOLERANCE_PT } from './paragraph-justify.ts';
import {
  appendSpansToLine,
  hyphenationSlackPt,
  interiorLetterRuns,
  placeMixedTokenHyphenPlan,
  planMixedTokenPrefix,
  tryPlaceUniformMixedTokenHyphen,
  type InteriorLetterRun,
  type MixedPlaceablePiece,
  type MixedPrefixSlice,
  type MixedTokenHyphenPlan,
  type OverflowingCandidateHyphenInput,
} from './paragraph-hyphenation.ts';
import { lastWinsRunLanguage } from './run-language.ts';
import { displayText } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import type { TextMeasurer } from './semantic-records.ts';

export interface MixedTemplateOverflowResume {
  readonly nextPieceIndex: number;
  readonly nextConsumed: number;
  readonly fitsFully: boolean;
}

/** Resume the wrap loop without skipping the tail of the current punctuation candidate. */
export function mixedTemplateWrapResume(
  pieceIndex: number,
  boundary: number,
  resume: MixedTemplateOverflowResume
): { readonly consumed: number; readonly retryAt?: number } {
  if (resume.nextPieceIndex !== pieceIndex) {
    return { consumed: resume.nextConsumed, retryAt: resume.nextPieceIndex };
  }
  if (resume.nextConsumed < boundary) {
    return { consumed: resume.nextConsumed, retryAt: pieceIndex };
  }
  return { consumed: resume.nextConsumed };
}

type MixedStreamCursor = { pieceIndex: number; consumed: number };

type LineBox = Parameters<typeof tryPlaceUniformMixedTokenHyphen>[0]['line'];

function streamPieceBlocked(piece: MixedPlaceablePiece | undefined): boolean {
  return !piece || piece.measureText !== undefined || /[\t\n]/.test(piece.text);
}

function stepBackCursor(
  pieces: readonly MixedPlaceablePiece[],
  cursor: MixedStreamCursor
): MixedStreamCursor | null {
  if (cursor.consumed > 0) return { pieceIndex: cursor.pieceIndex, consumed: cursor.consumed - 1 };
  if (cursor.pieceIndex <= 0) return null;
  const previous = pieces[cursor.pieceIndex - 1]!;
  if (previous.text.length === 0) {
    return stepBackCursor(pieces, { pieceIndex: cursor.pieceIndex - 1, consumed: 0 });
  }
  return { pieceIndex: cursor.pieceIndex - 1, consumed: previous.text.length - 1 };
}

function charAtCursor(
  pieces: readonly MixedPlaceablePiece[],
  cursor: MixedStreamCursor
): string | undefined {
  return pieces[cursor.pieceIndex]?.text[cursor.consumed];
}

function mixedStyleKey(piece: MixedPlaceablePiece): string {
  return [
    lastWinsRunLanguage(piece.props) ?? '',
    piece.fontSlot ?? '',
    piece.style.fontFamily ?? '',
    piece.style.fontFamilyEastAsia ?? '',
    String(piece.style.fontSizePt),
    piece.style.bold ? 'b' : '',
    piece.style.italic ? 'i' : '',
    piece.style.caps ? 'c' : '',
    piece.style.smallCaps ? 's' : '',
  ].join('\t');
}

/**
 * `{...}` covering the current cursor, including spaces, or `null` when unmatched/too long.
 */
export function mixedBraceTokenCovering(
  pieces: readonly MixedPlaceablePiece[],
  pieceIndex: number,
  consumed: number
): { readonly origin: MixedStreamCursor; readonly end: MixedStreamCursor } | null {
  const here = { pieceIndex, consumed };
  const openHere = charAtCursor(pieces, here) === '{';
  let origin = openHere ? here : null;
  let work = 0;
  if (!origin) {
    let cursor = here;
    let depth = 0;
    while (work < MAX_HYPHENATION_CACHE_ENTRIES) {
      const previous = stepBackCursor(pieces, cursor);
      if (!previous) break;
      if (streamPieceBlocked(pieces[previous.pieceIndex])) return null;
      const ch = charAtCursor(pieces, previous);
      work += 1;
      cursor = previous;
      if (ch === '}') depth += 1;
      else if (ch === '{') {
        if (depth === 0) {
          origin = previous;
          break;
        }
        depth -= 1;
      }
    }
  }
  if (!origin || charAtCursor(pieces, origin) !== '{') return null;
  let depth = 0;
  let index = origin.pieceIndex;
  let offset = origin.consumed;
  let length = 0;
  while (index < pieces.length && length < MAX_HYPHENATION_CACHE_ENTRIES) {
    const piece = pieces[index]!;
    if (streamPieceBlocked(piece)) return null;
    if (offset >= piece.text.length) {
      index += 1;
      offset = 0;
      continue;
    }
    const ch = piece.text[offset]!;
    length += 1;
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const endConsumed = offset + 1;
        if (endConsumed < piece.text.length)
          return { origin, end: { pieceIndex: index, consumed: endConsumed } };
        return { origin, end: { pieceIndex: index + 1, consumed: 0 } };
      }
    }
    offset += 1;
  }
  return null;
}

function glueMixedRange(
  pieces: readonly MixedPlaceablePiece[],
  start: MixedStreamCursor,
  end: MixedStreamCursor
): string | null {
  let glued = '';
  let index = start.pieceIndex;
  let offset = start.consumed;
  let work = 0;
  while (work < MAX_HYPHENATION_CACHE_ENTRIES) {
    if (index > end.pieceIndex || (index === end.pieceIndex && offset >= end.consumed)) {
      return glued;
    }
    const piece = pieces[index];
    if (streamPieceBlocked(piece)) return null;
    if (offset >= piece!.text.length) {
      index += 1;
      offset = 0;
      continue;
    }
    const takeEnd = index === end.pieceIndex ? end.consumed : piece!.text.length;
    glued += piece!.text.slice(offset, takeEnd);
    work += takeEnd - offset;
    offset = takeEnd;
  }
  return null;
}

function measureMixedPrefix(
  pieces: readonly MixedPlaceablePiece[],
  from: MixedStreamCursor,
  utf16Length: number,
  measurePiece: (piece: MixedPlaceablePiece, text: string) => number
): number {
  const planned = planMixedTokenPrefix(pieces, from.pieceIndex, from.consumed, utf16Length);
  if (!planned) return Number.POSITIVE_INFINITY;
  let width = 0;
  for (const slice of planned.slices) {
    const piece = pieces[slice.pieceIndex];
    if (!piece) return Number.POSITIVE_INFINITY;
    width += measurePiece(piece, slice.text);
  }
  return width;
}

function pieceAtRemainingOffset(
  pieces: readonly MixedPlaceablePiece[],
  from: MixedStreamCursor,
  remainingOffset: number
): MixedPlaceablePiece | null {
  const planned = planMixedTokenPrefix(pieces, from.pieceIndex, from.consumed, remainingOffset + 1);
  const last = planned?.slices[planned.slices.length - 1];
  return last ? (pieces[last.pieceIndex] ?? null) : null;
}

function overflowingLetterRun(glued: string, cut: number): InteriorLetterRun | null {
  let lastBefore: InteriorLetterRun | null = null;
  for (const run of interiorLetterRuns(glued)) {
    if (run.start >= cut) break;
    lastBefore = run;
    if (run.start < cut && run.start + run.length > cut) return run;
  }
  return lastBefore;
}

type StreamHyphenInput = {
  readonly glued: string;
  readonly cut: number;
  readonly availablePt: number;
  readonly from: MixedStreamCursor;
  readonly pieces: readonly MixedPlaceablePiece[];
  readonly measurePiece: (piece: MixedPlaceablePiece, text: string) => number;
  readonly settings: DocumentHyphenationSettings | undefined;
  readonly consecutiveHyphenatedLines: number;
};

function lastFittingHyphenInRun(
  run: InteriorLetterRun,
  input: StreamHyphenInput
): DiscretionaryHyphenBreak | null {
  const settings = input.settings;
  if (!settings?.autoHyphenation) return null;
  const limit = settings.consecutiveHyphenLimit;
  if (limit !== null && input.consecutiveHyphenatedLines >= limit) return null;
  const piece = pieceAtRemainingOffset(input.pieces, input.from, run.start);
  if (!piece) return null;
  if (settings.doNotHyphenateCaps && piece.style.caps) return null;
  const language = lastWinsRunLanguage(piece.props);
  if (admittedHyphenationLanguage(language) === null) return null;
  const letters = input.glued.slice(run.start, run.start + run.length);
  const offsets = hyphenationBreakOffsets(letters, language, {
    doNotHyphenateCaps: settings.doNotHyphenateCaps,
  });
  const hyphenWidthPt = input.measurePiece(piece, DISCRETIONARY_HYPHEN_GLYPH);
  if (!Number.isFinite(hyphenWidthPt) || hyphenWidthPt < 0) return null;
  let best: DiscretionaryHyphenBreak | null = null;
  for (const offset of offsets) {
    if (offset <= 0 || offset >= letters.length) continue;
    const utf16Offset = run.start + offset;
    if (utf16Offset > input.cut) continue;
    const widthPt =
      measureMixedPrefix(input.pieces, input.from, utf16Offset, input.measurePiece) + hyphenWidthPt;
    if (!Number.isFinite(widthPt) || widthPt <= 0 || widthPt > input.availablePt) continue;
    if (best === null || utf16Offset > best.utf16Offset) {
      best = { utf16Offset, widthPt, hyphenWidthPt };
    }
  }
  return best;
}

/**
 * After a discretionary hyphen, a Cyrillic ru-RU tail keeps hyphenating before later
 * English overflow words. A Latin en-US tail yields to the overflowing word at the cut.
 */
function continuedRussianTailHyphen(input: StreamHyphenInput): DiscretionaryHyphenBreak | null {
  if (input.consecutiveHyphenatedLines <= 0) return null;
  const first = interiorLetterRuns(input.glued)[0];
  if (!first) return null;
  if (first.start > 0 && !/^\s+$/u.test(input.glued.slice(0, first.start))) return null;
  const piece = pieceAtRemainingOffset(input.pieces, input.from, first.start);
  if (!piece) return null;
  const language = lastWinsRunLanguage(piece.props);
  if (admittedHyphenationLanguage(language) !== 'ru') return null;
  return lastFittingHyphenInRun(first, {
    ...input,
    cut: Math.min(input.cut, first.start + first.length),
  });
}

function lastFittingStreamHyphen(input: StreamHyphenInput): DiscretionaryHyphenBreak | null {
  const continued = continuedRussianTailHyphen(input);
  if (continued) return continued;
  const overflowing = overflowingLetterRun(input.glued, input.cut);
  if (overflowing) {
    const direct = lastFittingHyphenInRun(overflowing, input);
    if (direct) return direct;
  }
  const runs = interiorLetterRuns(input.glued).filter((run) => run.start < input.cut);
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index]!;
    if (overflowing && run.start === overflowing.start) continue;
    const found = lastFittingHyphenInRun(run, {
      ...input,
      cut: Math.min(input.cut, run.start + run.length),
    });
    if (found) return found;
  }
  return null;
}

function longestGraphemePrefixUtf16(
  glued: string,
  availablePt: number,
  measurePrefix: (utf16Length: number) => number
): number {
  const segments = segmentGraphemes(glued);
  if (segments.length <= 1) return 0;
  let low = 1;
  let high = segments.length - 1;
  let best = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const utf16 = graphemeOffsetToUtf16(glued, mid);
    const width = measurePrefix(utf16);
    if (width <= availablePt) {
      best = utf16;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

function mixedBraceTokenIsNonuniform(
  pieces: readonly MixedPlaceablePiece[],
  origin: MixedStreamCursor,
  end: MixedStreamCursor
): boolean {
  let key: string | undefined;
  let index = origin.pieceIndex;
  let offset = origin.consumed;
  while (index < pieces.length) {
    if (index > end.pieceIndex || (index === end.pieceIndex && offset >= end.consumed)) break;
    const piece = pieces[index]!;
    if (streamPieceBlocked(piece)) return false;
    if (offset >= piece.text.length) {
      index += 1;
      offset = 0;
      continue;
    }
    const next = mixedStyleKey(piece);
    if (key === undefined) key = next;
    else if (next !== key) return true;
    offset = index === end.pieceIndex ? end.consumed : piece.text.length;
  }
  return false;
}

function maxSliceMetrics(
  measurer: TextMeasurer,
  pieces: readonly MixedPlaceablePiece[],
  slices: readonly MixedPrefixSlice[]
): { readonly height: number; readonly baseline: number } {
  let height = 0;
  let baseline = 0;
  for (const slice of slices) {
    const piece = pieces[slice.pieceIndex];
    if (!piece) continue;
    const metrics = measurer.lineMetrics(styleForFontSlot(piece.style, piece.fontSlot));
    height = Math.max(height, metrics.height);
    baseline = Math.max(baseline, metrics.baseline);
  }
  return { height, baseline };
}

/**
 * Longest empty-line pack of a mixed-style `{...}` token, or a full remainder that fits.
 *
 * Punctuation and spaces inside the token are not wrap points. Latin emergency cuts add no
 * hyphen. A ru-RU Cyrillic (or other admitted language/script) letter word may take TeX.
 */
export function tryPlaceMixedStyleTemplateStream(
  input: Omit<OverflowingCandidateHyphenInput, 'maxUtf16Offset' | 'pieces'> & {
    readonly pieces: readonly MixedPlaceablePiece[];
    readonly line: LineBox;
    readonly paragraphId: string;
    readonly x: number;
    readonly height: number;
    readonly measurer: TextMeasurer;
    readonly emptyLine: boolean;
  }
): MixedTemplateOverflowResume | null {
  if (input.layoutOwned || input.measureText !== undefined) return null;
  const settings = input.settings;
  if (!settings?.autoHyphenation) return null;
  if (input.suppressAutoHyphens) return null;
  const covering = mixedBraceTokenCovering(input.pieces, input.pieceIndex, input.consumed);
  if (!covering) return null;
  if (!mixedBraceTokenIsNonuniform(input.pieces, covering.origin, covering.end)) return null;
  const from = { pieceIndex: input.pieceIndex, consumed: input.consumed };
  const glued = glueMixedRange(input.pieces, from, covering.end);
  if (glued === null || glued.length === 0) return null;
  const measurePiece = (piece: MixedPlaceablePiece, text: string) => {
    const face = styleForFontSlot(piece.style, piece.fontSlot);
    return input.measurer.measure(displayText(text, face), face);
  };
  const remainingWidth = measureMixedPrefix(input.pieces, from, glued.length, measurePiece);
  const slackPt = hyphenationSlackPt(input.slackPt, input.shrinkBudgetPt);
  const fitsFully = remainingWidth <= slackPt + OVERFLOW_TOLERANCE_PT;
  if (!fitsFully && !input.emptyLine) return null;
  let hyphen: DiscretionaryHyphenBreak | null = null;
  let take = glued.length;
  if (!fitsFully) {
    const cut = longestGraphemePrefixUtf16(glued, slackPt, (utf16) =>
      measureMixedPrefix(input.pieces, from, utf16, measurePiece)
    );
    if (cut <= 0) return null;
    take = cut;
    hyphen = lastFittingStreamHyphen({
      glued,
      cut,
      availablePt: slackPt,
      from,
      pieces: input.pieces,
      measurePiece,
      settings,
      consecutiveHyphenatedLines: input.consecutiveHyphenatedLines,
    });
    if (hyphen) take = hyphen.utf16Offset;
  }
  const prefix = planMixedTokenPrefix(input.pieces, from.pieceIndex, from.consumed, take);
  if (!prefix) return null;
  const plan: MixedTokenHyphenPlan = { hyphen, ...prefix };
  const metrics = maxSliceMetrics(input.measurer, input.pieces, plan.slices);
  const placed = placeMixedTokenHyphenPlan({
    plan,
    pieces: input.pieces,
    paragraphId: input.paragraphId,
    x: input.x,
    height: metrics.height || input.height,
    measure: input.measure,
    measurePiece,
  });
  appendSpansToLine(input.line, placed.spans, metrics);
  return {
    nextPieceIndex: plan.nextPieceIndex,
    nextConsumed: plan.nextConsumed,
    fitsFully,
  };
}

/** Uniform TeX mixed-token hyphen, else mixed-style `{...}` stream packing. */
export function tryPlaceMixedTemplateOverflow(
  input: Omit<
    OverflowingCandidateHyphenInput,
    'maxUtf16Offset' | 'pieces' | 'ignoreHyphenationZone'
  > & {
    readonly pieces: readonly MixedPlaceablePiece[];
    readonly line: LineBox;
    readonly paragraphId: string;
    readonly x: number;
    readonly height: number;
    readonly metrics: { readonly height: number; readonly baseline: number };
    readonly measurer: TextMeasurer;
    readonly emptyLine: boolean;
  }
): MixedTemplateOverflowResume | null {
  const uniform = tryPlaceUniformMixedTokenHyphen({
    ...input,
    ignoreHyphenationZone: input.emptyLine,
  });
  if (uniform) {
    return { ...uniform, fitsFully: false };
  }
  return tryPlaceMixedStyleTemplateStream(input);
}
