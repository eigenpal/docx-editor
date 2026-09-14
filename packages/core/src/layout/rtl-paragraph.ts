import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import { coalesceBidiPieces } from './bidi-piece-coalescing.ts';
import { bidiAlgorithm } from './bidi.ts';
import type { FieldAwarePiece } from './field-pieces.ts';
import { itemizeScriptFontSlots } from './script-itemization.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';
import { measureDisplayText } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';

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

/** Resolve paragraph-wide levels before wrapping; source offsets remain logical. */
export function bidiPieces(
  pieces: readonly FieldAwarePiece[],
  rtl: boolean,
  sourceBoundaries?: ReadonlySet<number>
): readonly FieldAwarePiece[] {
  const text = pieces.map((piece) => piece.text).join('');
  if (
    !rtl &&
    !/[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/u.test(text) &&
    !pieces.some((piece) => runIsRtl(piece.props))
  )
    return pieces;
  // Atom and tab placement have separate advances and are not ordinary text runs.
  if (
    pieces.some(
      (p) =>
        p.projected ||
        p.inlineDrawing ||
        p.equation ||
        p.positionalTab ||
        p.measureText !== undefined ||
        p.end - p.start !== p.text.length ||
        p.text.includes('\t')
    )
  )
    return pieces;
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
      return pieces;
    }
    for (const item of items) {
      const style = {
        ...piece.style,
        shaping: {
          script: item.script,
          direction: item.direction,
          level: item.bidiLevel,
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

function bidiOrder(
  spans: readonly StyleSpanRecord[],
  levels: number[],
  start: number,
  end: number,
  rtl: boolean
): number[] {
  for (
    let index = end - 1;
    index >= start &&
    Array.from(spans[index]!.text).every((character) =>
      ['WS', 'B', 'S'].includes(bidiAlgorithm.getBidiCharTypeName(character))
    );
    index--
  )
    levels[index] = rtl ? 1 : 0;
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
  paragraphRtl = spans.some((span) => span.style.shaping?.baseLevel === 1)
): readonly StyleSpanRecord[] {
  if (!spans.some((s) => s.style.shaping)) return spans;
  // Exclusion passages have fixed physical gaps. Reorder only within each passage.
  if (spans.some((span, index) => index > 0 && (span.wrapAdvanceBefore ?? 0) > 0)) {
    const result: StyleSpanRecord[] = [];
    let start = 0;
    for (let end = 1; end <= spans.length; end++) {
      if (end < spans.length && !(spans[end]!.wrapAdvanceBefore! > 0)) continue;
      for (const span of reorderBidiSpans(spans.slice(start, end), paragraphRtl)) result.push(span);
      start = end;
    }
    return result;
  }
  const levels = spans.map((s) => s.style.shaping?.level ?? 0);
  const order: number[] = [];
  if (!spans.every((span) => span.style.shaping?.runDirection !== undefined)) {
    for (const index of bidiOrder(spans, levels, 0, spans.length, paragraphRtl)) order.push(index);
  } else {
    // L1 puts line-ending whitespace back in the paragraph context, outside
    // the run-direction group whose visible text precedes it.
    let trailing = spans.length;
    while (
      trailing > 0 &&
      Array.from(spans[trailing - 1]!.text).every((character) =>
        ['WS', 'B', 'S'].includes(bidiAlgorithm.getBidiCharTypeName(character))
      )
    )
      trailing--;
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
      for (const index of bidiOrder(spans, levels, group.start, group.end, group.rtl))
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
