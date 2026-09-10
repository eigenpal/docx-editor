// Paragraph-flow hyphenation: gates, word lookahead, and a last-fit split.
//
// `paragraph-flow.ts` stays a thin call site. This module never mutates model text and
// never inserts U+00AD.

import type { DocumentHyphenationSettings, OoxmlProperty } from '@docx-editor.dev/core/store';
import {
  admittedHyphenationLanguage,
  DISCRETIONARY_HYPHEN_GLYPH,
  hyphenationBreakOffsets,
  lastFittingDiscretionaryHyphen,
  MAX_HYPHENATION_WORD_UTF16,
  type DiscretionaryHyphenBreak,
} from './hyphenation.ts';
import { stripTrailingOrdinarySpaces } from './paragraph-justify.ts';
import { wordBoundaries } from './paragraph-word-boundaries.ts';
import { lastWinsRunLanguage } from './run-language.ts';
import type { ResolvedRunStyle } from './run-style.ts';
import type { FontSlot } from './script-itemization.ts';
import type { StyleSpanRecord } from './semantic-records.ts';

const LETTER = /^\p{L}$/u;

/** Piece fields the TeX lookahead may read. */
export interface HyphenationPieceView {
  readonly text: string;
  readonly measureText?: string;
}

/** Run fields mixed-token hyphenation needs to keep source style on each prefix span. */
export interface MixedPlaceablePiece extends HyphenationPieceView {
  readonly start: number;
  readonly props: readonly OoxmlProperty[];
  readonly style: ResolvedRunStyle;
  readonly fontSlot?: FontSlot;
  readonly link?: StyleSpanRecord['link'];
  readonly noteNav?: StyleSpanRecord['noteNav'];
  readonly revisions?: StyleSpanRecord['revisions'];
  readonly fieldAtom?: StyleSpanRecord['fieldAtom'];
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

const TEMPLATE_PUNCT = /[.[\]{}=']/;

/**
 * Remaining space-delimited token from `consumed` through later pieces.
 *
 * Stops at a space, tab, or dash. A `measureText` piece cuts the token so a note mark
 * cannot glue into following text.
 */
export function mixedTokenAcrossPieces(
  pieces: readonly HyphenationPieceView[],
  pieceIndex: number,
  consumed: number
): string {
  let glued = '';
  for (let index = pieceIndex; index < pieces.length; index += 1) {
    const piece = pieces[index]!;
    if (piece.measureText !== undefined) break;
    const start = index === pieceIndex ? consumed : 0;
    if (start < 0 || start > piece.text.length) continue;
    glued += piece.text.slice(start);
  }
  const end = wordBoundaries(glued, false)[0];
  return end === undefined ? glued : glued.slice(0, end);
}

/**
 * Start of the current space-delimited token, walking back across earlier runs.
 *
 * Uniformity uses this origin so a later 5.5pt remainder cannot hyphenate after a 10pt `{`.
 */
export function mixedTokenOrigin(
  pieces: readonly HyphenationPieceView[],
  pieceIndex: number,
  consumed: number
): { readonly pieceIndex: number; readonly consumed: number } {
  let index = pieceIndex;
  let offset = consumed;
  while (index >= 0) {
    const piece = pieces[index];
    if (!piece || piece.measureText !== undefined) {
      return index === pieceIndex
        ? { pieceIndex, consumed }
        : { pieceIndex: index + 1, consumed: 0 };
    }
    if (offset === 0) {
      if (index === 0) return { pieceIndex: 0, consumed: 0 };
      index -= 1;
      offset = pieces[index]!.text.length;
      continue;
    }
    const prefix = piece.text.slice(0, offset);
    let start = 0;
    for (const boundary of wordBoundaries(prefix, false)) {
      if (boundary < offset) start = boundary;
    }
    if (start === offset) return { pieceIndex: index, consumed: offset };
    if (start > 0 || index === 0) return { pieceIndex: index, consumed: start };
    index -= 1;
    offset = pieces[index]!.text.length;
  }
  return { pieceIndex: 0, consumed: 0 };
}

function effectiveHyphenStyleKey(piece: MixedPlaceablePiece): string | null {
  const language = admittedHyphenationLanguage(lastWinsRunLanguage(piece.props));
  if (language === null) return null;
  const style = piece.style;
  return [
    language,
    piece.fontSlot ?? '',
    style.fontFamily ?? '',
    style.fontFamilyEastAsia ?? '',
    String(style.fontSizePt),
    style.bold ? 'b' : '',
    style.italic ? 'i' : '',
    style.caps ? 'c' : '',
    style.smallCaps ? 's' : '',
  ].join('\t');
}

/**
 * Whether every run that forms the current space-delimited mixed token shares one
 * effective face, font slot, and admitted hyphenation language.
 */
export function mixedTokenRunsAreUniform(
  pieces: readonly MixedPlaceablePiece[],
  pieceIndex: number,
  consumed: number
): boolean {
  const origin = mixedTokenOrigin(pieces, pieceIndex, consumed);
  const glued = mixedTokenAcrossPieces(pieces, origin.pieceIndex, origin.consumed);
  if (glued.length === 0) return false;
  let remaining = glued.length;
  let key: string | null | undefined;
  for (let index = origin.pieceIndex; index < pieces.length && remaining > 0; index += 1) {
    const piece = pieces[index]!;
    if (piece.measureText !== undefined) break;
    const localStart = index === origin.pieceIndex ? origin.consumed : 0;
    const available = piece.text.length - localStart;
    if (available <= 0) continue;
    const take = Math.min(available, remaining);
    if (take <= 0) continue;
    const next = effectiveHyphenStyleKey(piece);
    if (next === null) return false;
    if (key === undefined) key = next;
    else if (next !== key) return false;
    remaining -= take;
  }
  return key !== undefined && remaining === 0;
}

export interface HyphenationOverflowInput {
  readonly settings: DocumentHyphenationSettings | undefined;
  readonly suppressAutoHyphens: boolean;
  readonly consecutiveHyphenatedLines: number;
  readonly slackPt: number;
  /**
   * Extra room from compressing expandable U+0020 on a non-final justified line.
   *
   * Added to {@link slackPt} for the zone gate and last-fit prefix. Left-aligned wrap
   * leaves this 0: shrinking spaces to force a hyphen would be a visible distortion.
   */
  readonly shrinkBudgetPt?: number;
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

/** Remaining slack plus optional justified shrink, used for zone and last-fit. */
export function hyphenationSlackPt(remainingPt: number, shrinkBudgetPt = 0): number {
  return remainingPt + Math.max(0, shrinkBudgetPt);
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

function overflowHyphenSlackPt(input: {
  readonly slackPt: number;
  readonly shrinkBudgetPt?: number;
}): number {
  return hyphenationSlackPt(input.slackPt, input.shrinkBudgetPt);
}

/** Last-fit hyphen for an overflowing candidate, including interior letter runs, or `null`. */
export function hyphenateOverflowingCandidate(
  input: OverflowingCandidateHyphenInput
): DiscretionaryHyphenBreak | null {
  if (input.layoutOwned || input.measureText !== undefined) return null;
  const settings = input.settings;
  if (!settings?.autoHyphenation) return null;
  if (input.suppressAutoHyphens) return null;
  const slackPt = overflowHyphenSlackPt(input);
  if (!input.ignoreHyphenationZone && slackPt <= settings.hyphenationZonePt) return null;
  const limit = settings.consecutiveHyphenLimit;
  if (limit !== null && input.consecutiveHyphenatedLines >= limit) return null;
  if (settings.doNotHyphenateCaps && input.capsFormatted) return null;
  return lastFittingInteriorHyphen({ ...input, slackPt });
}

export interface MixedPrefixSlice {
  readonly pieceIndex: number;
  readonly localStart: number;
  readonly localEnd: number;
  readonly text: string;
}

export interface MixedTokenHyphenPlan {
  readonly hyphen: DiscretionaryHyphenBreak | null;
  readonly slices: readonly MixedPrefixSlice[];
  readonly nextPieceIndex: number;
  readonly nextConsumed: number;
}

/**
 * Map a glued UTF-16 prefix onto the source runs that contain it.
 *
 * `nextConsumed` is the local offset after the last slice.
 */
export function planMixedTokenPrefix(
  pieces: readonly HyphenationPieceView[],
  pieceIndex: number,
  consumed: number,
  utf16Length: number
): Omit<MixedTokenHyphenPlan, 'hyphen'> | null {
  let remaining = utf16Length;
  if (remaining <= 0) return null;
  const slices: MixedPrefixSlice[] = [];
  for (let index = pieceIndex; index < pieces.length && remaining > 0; index += 1) {
    const piece = pieces[index]!;
    if (piece.measureText !== undefined) break;
    const localStart = index === pieceIndex ? consumed : 0;
    const available = piece.text.length - localStart;
    if (available <= 0) continue;
    const take = Math.min(available, remaining);
    slices.push({
      pieceIndex: index,
      localStart,
      localEnd: localStart + take,
      text: piece.text.slice(localStart, localStart + take),
    });
    remaining -= take;
  }
  const last = slices[slices.length - 1];
  if (remaining > 0 || !last) return null;
  return {
    slices,
    nextPieceIndex: last.pieceIndex,
    nextConsumed: last.localEnd,
  };
}

/**
 * Map a glued-token hyphen offset onto the source runs that contain the prefix.
 *
 * The last slice holds the break. `nextConsumed` is the local offset after that break.
 */
export function planMixedTokenHyphen(
  pieces: readonly HyphenationPieceView[],
  pieceIndex: number,
  consumed: number,
  hyphen: DiscretionaryHyphenBreak
): MixedTokenHyphenPlan | null {
  const prefix = planMixedTokenPrefix(pieces, pieceIndex, consumed, hyphen.utf16Offset);
  if (!prefix) return null;
  return { hyphen, ...prefix };
}

/**
 * Farthest-fitting hyphen in a uniform mixed token when that token overflows slack.
 *
 * Mixed effective styles, missing admitted language, or an ordinary letter word return
 * `null` so punctuation and emergency cuts keep their baseline behaviour.
 */
export function hyphenateMixedToken(
  input: Omit<OverflowingCandidateHyphenInput, 'maxUtf16Offset' | 'pieces'> & {
    readonly pieces: readonly MixedPlaceablePiece[];
  }
): MixedTokenHyphenPlan | null {
  const glued = mixedTokenAcrossPieces(input.pieces, input.pieceIndex, input.consumed);
  if (glued.length <= input.candidate.length) return null;
  if (!TEMPLATE_PUNCT.test(glued)) return null;
  if (!mixedTokenRunsAreUniform(input.pieces, input.pieceIndex, input.consumed)) return null;
  if (input.measure(glued) <= input.slackPt + 0.001) return null;
  const found = hyphenateOverflowingCandidate({
    ...input,
    candidate: glued,
  });
  if (!found) return null;
  return planMixedTokenHyphen(input.pieces, input.pieceIndex, input.consumed, found);
}

type LineBox = {
  readonly spans: StyleSpanRecord[];
  width: number;
  height: number;
  baseline: number;
  end: number;
};

function measureMixedSlice(
  input: {
    readonly measure: (text: string) => number;
    readonly measurePiece?: (piece: MixedPlaceablePiece, text: string) => number;
  },
  piece: MixedPlaceablePiece,
  text: string
): number {
  return input.measurePiece ? input.measurePiece(piece, text) : input.measure(text);
}

/** Prefix spans for a mixed-token hyphen, one span per source run, hyphen on the last. */
export function placeMixedTokenHyphenPlan(input: {
  readonly plan: MixedTokenHyphenPlan;
  readonly pieces: readonly MixedPlaceablePiece[];
  readonly paragraphId: string;
  readonly x: number;
  readonly height: number;
  readonly measure: (text: string) => number;
  readonly measurePiece?: (piece: MixedPlaceablePiece, text: string) => number;
}): { readonly spans: StyleSpanRecord[]; readonly width: number } {
  const spans: StyleSpanRecord[] = [];
  let x = input.x;
  let width = 0;
  const lastIndex = input.plan.slices.length - 1;
  const hyphen = input.plan.hyphen;
  for (let index = 0; index < input.plan.slices.length; index += 1) {
    const slice = input.plan.slices[index]!;
    const piece = input.pieces[slice.pieceIndex];
    if (!piece) continue;
    const isBreak = index === lastIndex && hyphen !== null;
    const measured = isBreak
      ? measureMixedSlice(input, piece, slice.text + DISCRETIONARY_HYPHEN_GLYPH)
      : measureMixedSlice(input, piece, slice.text);
    const spanWidth =
      isBreak && hyphen && hyphen.widthPt - width > 0 ? hyphen.widthPt - width : measured;
    spans.push({
      range: {
        paragraphId: input.paragraphId,
        start: piece.start + slice.localStart,
        end: piece.start + slice.localEnd,
      },
      text: slice.text,
      props: piece.props,
      style: piece.style,
      box: { x, y: 0, width: spanWidth, height: input.height },
      ...(isBreak && hyphen ? { discretionaryHyphen: { widthPt: hyphen.hyphenWidthPt } } : {}),
      ...(piece.link ? { link: piece.link } : {}),
      ...(piece.noteNav ? { noteNav: piece.noteNav } : {}),
      ...(piece.fontSlot ? { fontSlot: piece.fontSlot } : {}),
      ...(piece.revisions ? { revisions: piece.revisions } : {}),
      ...(piece.fieldAtom ? { fieldAtom: piece.fieldAtom } : {}),
    });
    x += spanWidth;
    width += spanWidth;
  }
  return { spans, width };
}

export function appendSpansToLine(
  line: LineBox,
  spans: readonly StyleSpanRecord[],
  metrics: { readonly height: number; readonly baseline: number }
): void {
  const target = line.spans;
  for (const span of spans) {
    target.push(span);
    line.width += span.box.width;
    line.height = Math.max(line.height, metrics.height);
    line.baseline = Math.max(line.baseline, metrics.baseline);
    line.end = span.range.end;
  }
}

/** Hyphenate a uniform mixed token, append prefix spans, and return the resume cursor. */
export function tryPlaceUniformMixedTokenHyphen(
  input: Omit<OverflowingCandidateHyphenInput, 'maxUtf16Offset' | 'pieces'> & {
    readonly pieces: readonly MixedPlaceablePiece[];
    readonly line: LineBox;
    readonly paragraphId: string;
    readonly x: number;
    readonly height: number;
    readonly metrics: { readonly height: number; readonly baseline: number };
  }
): { readonly nextPieceIndex: number; readonly nextConsumed: number } | null {
  const plan = hyphenateMixedToken(input);
  if (!plan) return null;
  const placed = placeMixedTokenHyphenPlan({
    plan,
    pieces: input.pieces,
    paragraphId: input.paragraphId,
    x: input.x,
    height: input.height,
    measure: input.measure,
  });
  appendSpansToLine(input.line, placed.spans, input.metrics);
  return { nextPieceIndex: plan.nextPieceIndex, nextConsumed: plan.nextConsumed };
}

export function hyphenationSplitForOverflow(
  input: HyphenationOverflowInput
): DiscretionaryHyphenBreak | null {
  const settings = input.settings;
  if (!settings?.autoHyphenation) return null;
  if (input.suppressAutoHyphens) return null;
  const slackPt = overflowHyphenSlackPt(input);
  if (!input.ignoreHyphenationZone && slackPt <= settings.hyphenationZonePt) return null;
  const limit = settings.consecutiveHyphenLimit;
  if (limit !== null && input.consecutiveHyphenatedLines >= limit) return null;
  if (input.firstSliceUtf16 <= 0 || input.firstSliceUtf16 > input.word.length) return null;
  if (settings.doNotHyphenateCaps && input.capsFormatted) return null;
  const found = lastFittingDiscretionaryHyphen(input.word, input.language, slackPt, input.measure, {
    doNotHyphenateCaps: settings.doNotHyphenateCaps,
  });
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
  const visible = stripTrailingOrdinarySpaces(input.remaining);
  const visibleWidth =
    visible.length === input.remaining.length ? remainingWidth : input.measure(visible);
  // Trailing U+0020 hangs at the margin. It must not force an empty-line hyphen.
  if (visibleWidth <= input.availablePt) return null;
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
