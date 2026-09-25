import { PAGE_BREAK_CHAR, type OoxmlProperty } from '@docx-editor.dev/core/store';
import { coalesceBidiPieces } from './bidi-piece-coalescing.ts';
import { bidiAlgorithm } from './bidi.ts';
import type { FieldAwarePiece } from './field-pieces.ts';
import { itemizeScriptFontSlots } from './script-itemization.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';
import { measureDisplayText } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import { MAX_SHAPING_CONTEXT, type ShapingContext } from './shaped-run.ts';

export function paragraphIsRtl(props: readonly OoxmlProperty[]): boolean {
  let rtl = false;
  for (const prop of props) {
    if (prop.localName === 'bidi') {
      const value = prop.attributes?.val;
      rtl = value === undefined || value === '1' || value === 'true' || value === 'on';
    }
  }
  return rtl;
}

function runIsRtl(props: readonly OoxmlProperty[]): boolean {
  let rtl = false;
  for (const prop of props) {
    if (prop.localName !== 'rtl') continue;
    const value = prop.attributes?.val;
    rtl = value === undefined || value === '1' || value === 'true' || value === 'on';
  }
  return rtl;
}

const HAS_BIDI_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

/** Resolve contiguous run-direction groups without changing source text or offsets. */
function runDirectionLevels(pieces: readonly FieldAwarePiece[], text: string, rtl: boolean) {
  const embedding = bidiAlgorithm.getEmbeddingLevels(text, rtl ? 'rtl' : 'ltr');
  // Keep authored Unicode controls on the established full-paragraph UAX #9 path.
  if (HAS_BIDI_CONTROLS.test(text)) return embedding;
  let offset = 0;
  for (let start = 0; start < pieces.length; ) {
    const direction = runIsRtl(pieces[start]!.props);
    let end = start;
    let length = 0;
    while (end < pieces.length && runIsRtl(pieces[end]!.props) === direction) {
      length += pieces[end]!.text.length;
      end++;
    }
    const context = bidiAlgorithm.getEmbeddingLevels(
      text.slice(offset, offset + length),
      direction ? 'rtl' : 'ltr'
    );
    embedding.levels.set(context.levels, offset);
    offset += length;
    start = end;
  }
  return embedding;
}

/**
 * Resolve paragraph-wide levels before wrapping; source offsets remain logical.
 *
 * With `pageBreaksIgnored` (a table cell), a page break is laid out as absent, so it is
 * absent for bidi resolution, itemization and joining too; see {@link withoutIgnoredBreaks}.
 */
export function bidiPieces(
  pieces: readonly FieldAwarePiece[],
  rtl: boolean,
  sourceBoundaries?: ReadonlySet<number>,
  pageBreaksIgnored = false
): readonly FieldAwarePiece[] {
  const text = pieces.map((piece) => piece.text).join('');
  if (
    !rtl &&
    !/[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/u.test(text) &&
    !pieces.some((piece) => runIsRtl(piece.props))
  )
    return pieces;
  // Atom placement has separate advances and is not an ordinary text run. A tab is: it is a
  // segment separator (UAX #9 class S), so it takes the paragraph level below and the text
  // on each side of it resolves as usual. Bailing out on tabs left every tab-aligned RTL form
  // label unshaped and in left-to-right order.
  if (
    pieces.some(
      (p) =>
        p.projected ||
        p.inlineDrawing ||
        p.equation ||
        p.positionalTab ||
        p.measureText !== undefined ||
        p.end - p.start !== p.text.length
    )
  )
    return pieces;
  const ignored = pageBreaksIgnored && pieces.some(isPageBreak);
  const items = ignored
    ? withoutIgnoredBreaks(pieces, rtl, sourceBoundaries)
    : resolvedItems(pieces, rtl, sourceBoundaries);
  return items ? withJoiningContext(items, ignored) : pieces;
}

const isPageBreak = (piece: FieldAwarePiece | undefined) => piece?.text === PAGE_BREAK_CHAR;

/**
 * Resolve the pieces as though every page break were absent, then put the breaks back.
 *
 * Inside a table cell a page break has no geometry, so the text on its two sides must read as
 * the text without it. As a whitespace character (UAX #9 class WS) it split a number into
 * two digit groups that reordered separately, and took a level of its own that displaced a
 * tab. Here it acts as UAX #9 X9 treats a boundary neutral (BN): it is removed before
 * resolution, and then takes the level of a logical neighbour. The source pieces on its two
 * sides coalesce and itemize as one, so a shaped item the break falls inside is split at the
 * break into halves with one style. Every piece keeps its authored source offsets.
 */
function withoutIgnoredBreaks(
  pieces: readonly FieldAwarePiece[],
  rtl: boolean,
  sourceBoundaries: ReadonlySet<number> | undefined
): FieldAwarePiece[] | null {
  // Each break is one UTF-16 unit (the caller refuses pieces whose text and range differ);
  // `at` is where it sits in the offsets without breaks.
  const breaks: { piece: FieldAwarePiece; at: number }[] = [];
  const kept: FieldAwarePiece[] = [];
  for (const piece of pieces) {
    const removed = breaks.length;
    if (isPageBreak(piece)) breaks.push({ piece, at: piece.start - removed });
    else
      kept.push(
        removed ? { ...piece, start: piece.start - removed, end: piece.end - removed } : piece
      );
  }
  // The breaks are in source order, so the count before a boundary is a binary search. A
  // scan per boundary was quadratic in merged-paragraph members that each end with a break.
  const breaksBefore = (boundary: number) => {
    let low = 0;
    let high = breaks.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (breaks[mid]!.piece.start < boundary) low = mid + 1;
      else high = mid;
    }
    return low;
  };
  const boundaries = sourceBoundaries
    ? new Set([...sourceBoundaries].map((boundary) => boundary - breaksBefore(boundary)))
    : undefined;
  const items = resolvedItems(kept, rtl, boundaries);
  if (!items) return null;
  const result: FieldAwarePiece[] = [];
  let next = 0;
  const placeBreaks = (at: number) => {
    for (; next < breaks.length && breaks[next]!.at <= at; next++) result.push(breaks[next]!.piece);
  };
  for (const item of items) {
    placeBreaks(item.start);
    let from = item.start;
    // `next` counts the breaks already placed, which is the shift back to source offsets.
    const slice = (to: number) => {
      result.push({
        ...item,
        text: item.text.slice(from - item.start, to - item.start),
        start: from + next,
        end: to + next,
      });
      from = to;
    };
    while (next < breaks.length && breaks[next]!.at < item.end) {
      slice(breaks[next]!.at);
      placeBreaks(from);
    }
    slice(item.end);
  }
  placeBreaks(Infinity);
  // The level of the logical neighbour: the following text, else (trailing breaks) the last
  // text. A caret at an offset sits on the span that starts there, so a break placed at the
  // leading edge of the text after it keeps each caret where the text without it puts it.
  let neighbour: FieldAwarePiece | undefined;
  for (const piece of result) if (!isPageBreak(piece)) neighbour = piece;
  for (let index = result.length - 1; index >= 0; index--) {
    const piece = result[index]!;
    if (!isPageBreak(piece)) {
      neighbour = piece;
      continue;
    }
    const shaping = neighbour?.style.shaping;
    const level = shaping?.level ?? (rtl ? 1 : 0);
    const runDirection = neighbour
      ? shaping?.runDirection
      : runIsRtl(piece.props)
        ? ('rtl' as const)
        : ('ltr' as const);
    result[index] = {
      ...piece,
      style: {
        ...piece.style,
        shaping: {
          script: 'Zyyy',
          direction: level % 2 ? ('rtl' as const) : ('ltr' as const),
          level,
          baseLevel: rtl ? 1 : 0,
          ...(runDirection ? { runDirection } : {}),
        },
      },
    };
  }
  return result;
}

/** Levels, script items and shaping styles for pieces that bidi resolution accepts. */
function resolvedItems(
  pieces: readonly FieldAwarePiece[],
  rtl: boolean,
  sourceBoundaries: ReadonlySet<number> | undefined
): FieldAwarePiece[] | null {
  const text = pieces.map((piece) => piece.text).join('');
  // Contiguous runs with the same w:rtl state share one directional context.
  // Unmarked runs use LTR context; strong Arabic and Arabic-Indic digits retain
  // their Unicode classes inside it. Paragraph bidi still controls outer layout.
  const embedding = runDirectionLevels(pieces, text, rtl);
  const usesRunGroups = !HAS_BIDI_CONTROLS.test(text);
  const result: FieldAwarePiece[] = [];
  let offset = 0;
  for (const piece of coalesceBidiPieces(pieces, sourceBoundaries)) {
    let items;
    try {
      items = itemizeScriptFontSlots(piece.text, offset, embedding);
    } catch {
      return null;
    }
    for (const item of items) {
      // UAX #9 L1: a segment separator is reset to the paragraph embedding level.
      const separator = /^\t+$/u.test(piece.text.slice(item.from, item.to));
      const level = separator ? (rtl ? 1 : 0) : item.bidiLevel;
      const style = {
        ...piece.style,
        shaping: {
          script: item.script,
          direction: separator ? (rtl ? ('rtl' as const) : ('ltr' as const)) : item.direction,
          level,
          baseLevel: rtl ? 1 : 0,
          ...(usesRunGroups
            ? { runDirection: runIsRtl(piece.props) ? ('rtl' as const) : ('ltr' as const) }
            : {}),
        },
      };
      result.push({
        ...piece,
        text: piece.text.slice(item.from, item.to),
        start: piece.start + item.from,
        end: piece.start + item.to,
        style,
      });
    }
    offset += piece.text.length;
  }
  return result;
}

/** Scripts whose letters change form with their neighbours (Unicode joining types). */
const JOINING_SCRIPTS: ReadonlySet<string> = new Set([
  'Adlm',
  'Arab',
  'Mand',
  'Mong',
  'Nkoo',
  'Phag',
  'Rohg',
  'Syrc',
]);

/**
 * Give each joining-script piece the neighbouring text it joins with.
 *
 * A word split into two formatting runs (a colour change mid-word) is shaped as two pieces,
 * and each half drew its boundary letter in an isolated or final form. HarfBuzz joins across
 * the split when each half sees the other's letters as context. The context reaches the
 * measurer and the exporters through the style, so width and paint shape the same way.
 *
 * Bounded: only adjacent pieces at the same bidi level, only for joining scripts, only when
 * no whitespace sits at the boundary, and at most {@link MAX_SHAPING_CONTEXT} units on each
 * side. Only the edge word carries the outside context. Line breaks come later; a word does
 * not break mid-word, so a boundary inside one keeps both halves on one line. Context changes
 * glyph forms only: a kern or cursive offset between the two halves is not applied.
 *
 * With `breaksIgnored`, a page break between two pieces is absent: the pieces on its two
 * sides join as they would without it.
 */
function withJoiningContext(pieces: FieldAwarePiece[], breaksIgnored: boolean): FieldAwarePiece[] {
  if (!pieces.some((piece) => JOINING_SCRIPTS.has(piece.style.shaping?.script ?? ''))) {
    return pieces;
  }
  const levelOf = (piece: FieldAwarePiece | undefined) => piece?.style.shaping?.level;
  // The adjacent piece in `step` direction, stepping over contiguous ignored breaks.
  const neighbourOf = (index: number, step: -1 | 1) => {
    let at = index + step;
    let edge = step < 0 ? pieces[index]!.start : pieces[index]!.end;
    for (; breaksIgnored && isPageBreak(pieces[at]); at += step) {
      const next = pieces[at]!;
      if ((step < 0 ? next.end : next.start) !== edge) return undefined;
      edge = step < 0 ? next.start : next.end;
    }
    const neighbour = pieces[at];
    return neighbour && (step < 0 ? neighbour.end : neighbour.start) === edge
      ? neighbour
      : undefined;
  };
  const result: FieldAwarePiece[] = [];
  pieces.forEach((piece, index) => {
    const shaping = piece.style.shaping;
    if (!shaping || !JOINING_SCRIPTS.has(shaping.script)) {
      result.push(piece);
      return;
    }
    const previous = neighbourOf(index, -1);
    const next = neighbourOf(index, 1);
    // Nothing joins across whitespace, so a boundary with a space on either side needs none.
    const before =
      previous &&
      levelOf(previous) === shaping.level &&
      !BREAKS_JOINING.test(previous.text.slice(-1)) &&
      !BREAKS_JOINING.test(piece.text.slice(0, 1))
        ? previous.text.slice(-MAX_SHAPING_CONTEXT)
        : '';
    const after =
      next &&
      levelOf(next) === shaping.level &&
      !BREAKS_JOINING.test(piece.text.slice(-1)) &&
      !BREAKS_JOINING.test(next.text.slice(0, 1))
        ? next.text.slice(0, MAX_SHAPING_CONTEXT)
        : '';
    if (!before && !after) {
      result.push(piece);
      return;
    }
    // The outside context belongs to the edge WORD only. Every slice layout measures and
    // every span paint shapes inherits its piece's style, so a piece-wide context made the
    // later words of the piece shape as if joined to the neighbour run. The piece is split at
    // its first and last whitespace; the pieces between keep the plain style. A literal piece
    // splits freely: piece boundaries are not break opportunities.
    const text = piece.text;
    const slice = (from: number, to: number, context?: ShapingContext): void => {
      if (to <= from) return;
      result.push({
        ...piece,
        text: text.slice(from, to),
        start: piece.start + from,
        end: piece.start + to,
        style: context ? { ...piece.style, shaping: { ...shaping, context } } : piece.style,
      });
    };
    const first = text.search(BREAKS_JOINING);
    if (first === -1) {
      // One word: it reads both sides.
      slice(0, text.length, { before, after });
      return;
    }
    let last = text.length - 1;
    while (!BREAKS_JOINING.test(text[last]!)) last--;
    // Inside the piece, each edge word reads its real neighbours, which start or end with
    // the whitespace that stops the join.
    const head = before ? first : 0;
    const tail = after ? last + 1 : text.length;
    if (before) slice(0, head, { before, after: text.slice(head, head + MAX_SHAPING_CONTEXT) });
    slice(head, tail);
    if (after)
      slice(tail, text.length, {
        before: text.slice(Math.max(0, tail - MAX_SHAPING_CONTEXT), tail),
        after,
      });
  });
  return result;
}

/** Characters no joining script joins across. */
const BREAKS_JOINING = /\s/u;

/**
 * Where the line-end whitespace that UAX #9 L1 resets to the paragraph level starts in
 * `spans[start, end)`. With `pageBreaksIgnored`, page breaks directly after visible text are
 * not line-end whitespace when only breaks follow them: without the breaks that text ends the
 * line, so the breaks keep its level and stay beside it. When whitespace follows the breaks,
 * that whitespace starts at the break offset without them, so the breaks reset with it.
 */
function lineEndWhitespaceStart(
  spans: readonly StyleSpanRecord[],
  start: number,
  end: number,
  pageBreaksIgnored: boolean
): number {
  let trailing = end;
  while (
    trailing > start &&
    Array.from(spans[trailing - 1]!.text).every((character) =>
      ['WS', 'B', 'S'].includes(bidiAlgorithm.getBidiCharTypeName(character))
    )
  )
    trailing--;
  if (!pageBreaksIgnored || trailing === start) return trailing;
  let skipped = trailing;
  while (skipped < end && spans[skipped]!.text === PAGE_BREAK_CHAR) skipped++;
  return skipped === end ? skipped : trailing;
}

function bidiOrder(
  spans: readonly StyleSpanRecord[],
  levels: number[],
  start: number,
  end: number,
  rtl: boolean,
  pageBreaksIgnored: boolean
): number[] {
  for (
    let index = lineEndWhitespaceStart(spans, start, end, pageBreaksIgnored);
    index < end;
    index++
  )
    levels[index] = rtl ? 1 : 0;
  return visualOrderOfLevels(levels, start, end);
}

/** UAX #9 L2 over `levels[start, end)`: the source indices in visual (left-to-right) order. */
export function visualOrderOfLevels(
  levels: readonly number[],
  start = 0,
  end = levels.length
): number[] {
  const order = Array.from({ length: end - start }, (_, index) => start + index);
  let maximum = 0;
  let lowestOdd = Infinity;
  for (let index = start; index < end; index++) {
    maximum = Math.max(maximum, levels[index]!);
    if (levels[index]! % 2) lowestOdd = Math.min(lowestOdd, levels[index]!);
  }
  for (let level = maximum; level >= lowestOdd; level--) {
    for (let i = 0; i < order.length; ) {
      if (levels[order[i]!]! < level) {
        i++;
        continue;
      }
      let end = i + 1;
      while (end < order.length && levels[order[end]!]! >= level) end++;
      for (let left = i, right = end - 1; left < right; left++, right--)
        [order[left], order[right]] = [order[right]!, order[left]!];
      i = end;
    }
  }
  return order;
}

/** UAX #9 L1/L2 at the line boundary. Keep the array in source order for selection. */
export function reorderBidiSpans(
  spans: readonly StyleSpanRecord[],
  paragraphRtl = spans.some((span) => span.style.shaping?.baseLevel === 1),
  pageBreaksIgnored = false
): readonly StyleSpanRecord[] {
  if (!spans.some((s) => s.style.shaping)) return spans;
  // Exclusion passages have fixed physical gaps. Reorder only within each passage.
  if (spans.some((span, index) => index > 0 && (span.wrapAdvanceBefore ?? 0) > 0)) {
    const result: StyleSpanRecord[] = [];
    let start = 0;
    for (let end = 1; end <= spans.length; end++) {
      if (end < spans.length && !(spans[end]!.wrapAdvanceBefore! > 0)) continue;
      for (const span of reorderBidiSpans(spans.slice(start, end), paragraphRtl, pageBreaksIgnored))
        result.push(span);
      start = end;
    }
    return result;
  }
  const levels = spans.map((s) => s.style.shaping?.level ?? 0);
  const order: number[] = [];
  if (!spans.every((span) => span.style.shaping?.runDirection !== undefined)) {
    for (const index of bidiOrder(spans, levels, 0, spans.length, paragraphRtl, pageBreaksIgnored))
      order.push(index);
  } else {
    // L1 puts line-ending whitespace back in the paragraph context, outside
    // the run-direction group whose visible text precedes it.
    const trailing = lineEndWhitespaceStart(spans, 0, spans.length, pageBreaksIgnored);
    const directionAt = (index: number) =>
      index >= trailing ? paragraphRtl : spans[index]!.style.shaping?.runDirection === 'rtl';
    const groups: Array<{ start: number; end: number; rtl: boolean }> = [];
    for (let start = 0; start < spans.length; ) {
      const direction = directionAt(start);
      let end = start + 1;
      while (end < spans.length && directionAt(end) === direction) end++;
      groups.push({ start, end, rtl: direction });
      start = end;
    }
    // Word places direction groups in paragraph order, then resolves each group's
    // internal Unicode order. A numeric LTR group remains intact beside an RTL run.
    if (paragraphRtl) groups.reverse();
    for (const group of groups) {
      for (const index of bidiOrder(
        spans,
        levels,
        group.start,
        group.end,
        group.rtl,
        pageBreaksIgnored
      ))
        order.push(index);
    }
  }
  const result = [...spans];
  let x = spans.reduce((min, s) => Math.min(min, s.box.x), Infinity);
  const advances = spans.map(
    (s, i) =>
      s.box.width +
      Math.max(0, (spans[i + 1]?.box.x ?? s.box.x + s.box.width) - s.box.x - s.box.width)
  );
  for (const index of order) {
    const span = spans[index]!;
    const direction = levels[index]! % 2 ? 'rtl' : 'ltr';
    const gap = advances[index]! - span.box.width;
    const spaces = span.text.split(' ').length - 1;
    const wordSpacingPt = spaces > 0 ? gap / spaces : 0;
    result[index] = {
      ...span,
      style: span.style.shaping
        ? {
            ...span.style,
            shaping: {
              ...span.style.shaping,
              direction,
              ...(wordSpacingPt > 0 ? { wordSpacingPt } : {}),
            },
          }
        : span.style,
      box: { ...span.box, x, width: advances[index]! },
    };
    x += advances[index]!;
  }
  return result;
}

export function spanContentX(spans: readonly StyleSpanRecord[], fallback: number): number {
  return spans.length ? spans.reduce((x, s) => Math.min(x, s.box.x), Infinity) : fallback;
}

export function nearestBidiSpan(
  spans: readonly StyleSpanRecord[],
  x: number
): StyleSpanRecord | null {
  if (!spans.some((span) => span.style.shaping !== undefined)) return null;
  let chosen: StyleSpanRecord | null = null;
  let distance = Infinity;
  for (const span of spans) {
    const gap = Math.max(span.box.x - x, x - span.box.x - span.box.width, 0);
    if (gap < distance) {
      chosen = span;
      distance = gap;
    }
  }
  return chosen;
}

/** Split only after wrapping, so nonbreaking spaces cannot create new break opportunities. */
export function splitBidiTrailingWhitespace(
  spans: readonly StyleSpanRecord[],
  measurer: TextMeasurer
): readonly StyleSpanRecord[] {
  if (!spans.some((span) => span.style.shaping)) return spans;
  for (let index = spans.length - 1; index >= 0; index--) {
    const span = spans[index]!;
    let from = span.text.length;
    while (
      from > 0 &&
      ['WS', 'B', 'S'].includes(bidiAlgorithm.getBidiCharTypeName(span.text[from - 1]!))
    )
      from--;
    if (from === 0) continue;
    if (from === span.text.length) return spans;
    const tail = span.text.slice(from);
    const width = Math.min(
      span.box.width,
      measureDisplayText(tail, styleForFontSlot(span.style, span.fontSlot), measurer)
    );
    const textSpan = {
      ...span,
      text: span.text.slice(0, from),
      range: { ...span.range, end: span.range.start + from },
      box: { ...span.box, width: span.box.width - width },
    };
    const tailSpan = {
      ...span,
      text: tail,
      range: { ...span.range, start: span.range.start + from },
      box: { ...span.box, x: span.box.x + span.box.width - width, width },
    };
    return [...spans.slice(0, index), textSpan, tailSpan, ...spans.slice(index + 1)];
  }
  return spans;
}
