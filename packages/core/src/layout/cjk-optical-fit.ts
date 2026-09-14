// Demand-only line fitting, verified against native Word PDF glyph positions.
import type { FieldAwarePiece } from './field-pieces.ts';
import type { PendingLine } from './pending-line.ts';
import type { SourceRange, StyleSpanRecord, TextMeasurer } from './semantic-records.ts';
import { measureDisplayText } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import { segmentGraphemes } from './grapheme.ts';
import { isCjk, type CjkParagraphBreaks } from './cjk-paragraph-breaks.ts';
import { canHangCjkPunctuation } from './cjk-spacing.ts';
import { formatRevisionOf } from './revision-projection.ts';

const OPENING = /^[〈《「『【〔〖〘〚（［｛]$/u;
const CLOSING = /^[、。〉》」』】〕〗〙〛），．］｝]$/u;
const PUNCTUATION = /^[〈《「『【〔〖〘〚（［｛、。〉》」』】〕〗〙〛），．］｝：]$/u;
const HAS_PUNCTUATION = /[〈《「『【〔〖〘〚（［｛、。〉》」』】〕〗〙〛），．］｝：]/u;
const TOLERANCE = 0.001;
interface Cell {
  span: StyleSpanRecord;
  readonly sourceIndex: number;
  readonly natural: number;
  readonly alreadyReduced: number;
  readonly ink: { left: number; right: number } | undefined;
  reduction: number;
  shift: number;
}
export interface CjkOpticalFit {
  readonly candidate: readonly StyleSpanRecord[];
  readonly width: number;
  readonly spanStarts?: readonly number[];
}
function allowedStyle(span: Pick<StyleSpanRecord, 'style' | 'props' | 'revisions'>): boolean {
  const style = span.style;
  return (
    !span.revisions?.length &&
    !style.textOutline &&
    !style.underline &&
    !style.strike &&
    !style.doubleStrike &&
    !style.highlight &&
    !style.shading &&
    style.shaping?.direction !== 'rtl' &&
    !formatRevisionOf(span.props)
  );
}
/** Unsupported paragraphs retain their existing wrapping and whitespace path. */
export function canFitCjkOptically(pieces: readonly FieldAwarePiece[]): boolean {
  return pieces.every(
    (piece) =>
      allowedStyle(piece) &&
      !piece.projected &&
      !piece.fieldAtom &&
      !piece.equation &&
      !piece.positionalTab &&
      !piece.inlineDrawing &&
      piece.measureText === undefined &&
      piece.end - piece.start === piece.text.length &&
      segmentGraphemes(piece.text).every(
        (cluster) =>
          /^[ \n\f]$/u.test(cluster.text) ||
          isCjk(cluster.text.codePointAt(0)!) ||
          PUNCTUATION.test(cluster.text)
      )
  );
}
function allowed(span: StyleSpanRecord): boolean {
  return (
    allowedStyle(span) &&
    !span.projected &&
    !span.fieldAtom &&
    !span.equation &&
    !span.caretEdges &&
    !span.lineEndWhitespace &&
    !span.wrapAdvanceBefore &&
    span.range.end - span.range.start === span.text.length
  );
}
function cellsOf(
  spans: readonly StyleSpanRecord[],
  measurer: TextMeasurer,
  baselinePieces: readonly FieldAwarePiece[]
): Cell[] | undefined {
  const cells: Cell[] = [];
  let length = 0;
  for (const [sourceIndex, span] of spans.entries()) {
    length += span.text.length;
    if (length > 4096 || !allowed(span)) return undefined;
    const face = styleForFontSlot(span.style, span.fontSlot);
    let previous = 0;
    for (const cluster of segmentGraphemes(span.text)) {
      if (
        cluster.text !== ' ' &&
        !isCjk(cluster.text.codePointAt(0)!) &&
        !PUNCTUATION.test(cluster.text)
      )
        return undefined;
      const end =
        cluster.utf16To === span.text.length
          ? span.box.width
          : measureDisplayText(span.text.slice(0, cluster.utf16To), face, measurer);
      const width = end - previous;
      const modelStart = span.range.start + cluster.utf16From;
      let low = 0;
      let high = baselinePieces.length - 1;
      while (low < high) {
        const middle = (low + high + 1) >> 1;
        if (baselinePieces[middle]!.start <= modelStart) low = middle;
        else high = middle - 1;
      }
      const baseline = baselinePieces[low]!;
      cells.push({
        sourceIndex,
        alreadyReduced: Math.max(
          0,
          (baseline.style.characterSpacingPt - span.style.characterSpacingPt) * cluster.text.length
        ),
        natural: measureDisplayText(cluster.text, { ...face, characterSpacingPt: 0 }, measurer),
        ink: measurer.inkBounds?.(cluster.text, face),
        reduction: 0,
        shift: 0,
        span: {
          ...span,
          text: cluster.text,
          range: {
            ...span.range,
            start: span.range.start + cluster.utf16From,
            end: span.range.start + cluster.utf16To,
          },
          box: { ...span.box, x: span.box.x + previous, width },
        },
      });
      previous = end;
    }
  }
  return cells;
}
function finiteInk(cell: Cell): cell is Cell & { ink: { left: number; right: number } } {
  return (
    cell.ink !== undefined &&
    Number.isFinite(cell.ink.left) &&
    Number.isFinite(cell.ink.right) &&
    cell.ink.right >= cell.ink.left
  );
}

/** Try a complete protected group without changing the line when it cannot fit. */
function fitCjkOptically(
  line: PendingLine,
  candidates: readonly StyleSpanRecord[],
  available: number,
  measurer: TextMeasurer,
  baselinePieces: readonly FieldAwarePiece[]
): CjkOpticalFit | undefined {
  const width = candidates.reduce((sum, candidate) => sum + candidate.box.width, 0);
  let deficit = line.width + width - available;
  if (deficit <= TOLERANCE || !measurer.inkBounds || line.drawings.length) return undefined;
  if (
    !candidates.some((span) => HAS_PUNCTUATION.test(span.text)) &&
    !line.spans.some((span) => HAS_PUNCTUATION.test(span.text))
  )
    return undefined;
  // Do not redistribute spacing across separate float passages.
  for (let index = 1; index < line.spans.length; index++) {
    const previous = line.spans[index - 1]!;
    if (Math.abs(previous.box.x + previous.box.width - line.spans[index]!.box.x) > TOLERANCE)
      return undefined;
  }
  const sourceCount = line.spans.length;
  const cells = cellsOf([...line.spans, ...candidates], measurer, baselinePieces);
  if (!cells) return undefined;
  const first = cells.find((cell) => cell.sourceIndex === sourceCount)!;
  // Word only pulls another ordinary glyph when at least half of it fits already.
  // Its protected trailing punctuation remains part of the same candidate.
  if (
    isCjk(first.span.text.codePointAt(0)!) &&
    !PUNCTUATION.test(first.span.text) &&
    available - line.width + TOLERANCE < first.natural / 2
  )
    return undefined;

  const last = cells.at(-1)!;
  // The final closing bearing is removed first. Its measured ink must stay inside.
  if (CLOSING.test(last.span.text) && finiteInk(last)) {
    const extent = Math.max(last.natural / 2, last.ink.right + (last.span.glyphOffsetPt ?? 0));
    last.reduction = Math.min(deficit, Math.max(0, last.span.box.width - extent));
    deficit -= last.reduction;
  }
  const seams: { cell: Cell; capacity: number; left: boolean }[] = [];
  for (let index = 1; index < cells.length; index++) {
    const previous = cells[index - 1]!;
    const current = cells[index]!;
    const before = previous.span.text;
    const after = current.span.text;
    let cell: Cell;
    let left: boolean;
    if (OPENING.test(after) && isCjk(before.codePointAt(0)!) && !PUNCTUATION.test(before)) {
      cell = current;
      left = true;
    } else if (
      (before === '：' && OPENING.test(after)) ||
      (CLOSING.test(before) && isCjk(after.codePointAt(0)!) && !PUNCTUATION.test(after))
    ) {
      cell = previous;
      left = false;
    } else continue;
    if (!finiteInk(previous) || !finiteInk(current)) continue;
    const gap =
      previous.span.box.width +
      (current.span.glyphOffsetPt ?? 0) +
      current.ink.left -
      (previous.span.glyphOffsetPt ?? 0) -
      previous.ink.right;
    const capacity = Math.max(
      0,
      Math.min(
        cell.natural / 2 - cell.alreadyReduced,
        cell.span.box.width - cell.reduction,
        left ? current.ink.left + (current.span.glyphOffsetPt ?? 0) : Infinity,
        gap
      )
    );
    if (capacity > TOLERANCE) seams.push({ cell, capacity, left });
  }
  if (deficit > seams.reduce((sum, seam) => sum + seam.capacity, 0) + TOLERANCE) return undefined;
  // Equal reductions reproduce Word's ordinary/opening, closing/ordinary, and colon seams.
  let active = seams;
  while (deficit > TOLERANCE && active.length) {
    const share = deficit / active.length;
    const next: typeof active = [];
    for (const seam of active) {
      const amount = Math.min(share, seam.capacity);
      seam.cell.reduction += amount;
      if (seam.left) seam.cell.shift -= amount;
      deficit -= amount;
      if (seam.capacity - amount > TOLERANCE)
        next.push({ ...seam, capacity: seam.capacity - amount });
    }
    active = next;
  }
  const spans: StyleSpanRecord[] = [];
  const candidateSpans: StyleSpanRecord[] = [];
  const spanStarts: number[] = [];
  let x = line.spans[0]?.box.x ?? candidates[0]!.box.x;
  let candidateWidth = 0;
  for (const cell of cells) {
    const source = cell.span;
    const reduced = cell.reduction > 0;
    const span = {
      ...source,
      ...(reduced
        ? {
            style: {
              ...source.style,
              characterSpacingPt:
                source.style.characterSpacingPt - cell.reduction / source.text.length,
            },
            glyphOffsetPt: (source.glyphOffsetPt ?? 0) + cell.shift,
          }
        : {}),
      box: { ...source.box, x, width: source.box.width - cell.reduction },
    };
    x += span.box.width;
    if (cell.sourceIndex < sourceCount) {
      spanStarts[cell.sourceIndex] ??= spans.length;
      spans.push(span);
    } else {
      candidateSpans.push(span);
      candidateWidth += span.box.width;
    }
  }
  spanStarts[sourceCount] = spans.length;
  line.spans.length = 0;
  for (const span of spans) line.spans.push(span);
  line.width = available - candidateWidth;
  return { candidate: candidateSpans, width: candidateWidth, spanStarts };
}

/** Keep each protected group whole even when its source runs split its punctuation. */
export function createCjkOpticalFitter(
  pieces: readonly FieldAwarePiece[],
  breaks: CjkParagraphBreaks | null,
  measurer: TextMeasurer,
  overflowPunctuation: boolean
) {
  const queued = new Map<number, CjkOpticalFit>();
  return (
    line: PendingLine,
    pieceIndex: number,
    text: string,
    range: SourceRange,
    width: number,
    origin: number,
    available: number,
    allowNewFit: boolean
  ): CjkOpticalFit | undefined => {
    const pending = queued.get(range.start);
    if (pending) {
      queued.delete(range.start);
      return pending;
    }
    if (!allowNewFit || !measurer.inkBounds || !breaks) return undefined;
    const candidates: StyleSpanRecord[] = [];
    let currentIndex = pieceIndex;
    let currentText = text;
    let currentRange = range;
    let currentWidth = width;
    let x = origin;
    let length = 0;
    while (true) {
      const piece = pieces[currentIndex]!;
      if (
        piece.projected ||
        piece.measureText !== undefined ||
        piece.equation ||
        piece.positionalTab ||
        piece.inlineDrawing ||
        piece.revisions?.length
      )
        return undefined;
      length += currentText.length;
      if (length > 4096 || candidates.length >= 256) return undefined;
      candidates.push({
        text: currentText,
        range: currentRange,
        props: piece.props,
        style: piece.style,
        fontSlot: piece.fontSlot,
        glyphOffsetPt: piece.glyphOffsetPt,
        fieldAtom: piece.fieldAtom,
        box: {
          x,
          y: 0,
          width: currentWidth,
          height: measurer.lineMetrics(styleForFontSlot(piece.style, piece.fontSlot)).height,
        },
      });
      x += currentWidth;
      if (currentRange.end < piece.end) break;
      const next = pieces[currentIndex + 1];
      if (!next || breaks.decision(next, 0) === 'opens') break;
      currentIndex++;
      const boundary = breaks.boundaries(next)[0] ?? next.text.length;
      currentText = next.text.slice(0, boundary);
      currentRange = { ...range, start: next.start, end: next.start + boundary };
      currentWidth = measureDisplayText(
        currentText,
        styleForFontSlot(next.style, next.fontSlot),
        measurer
      );
    }
    // Match clipWordEnd across run seams: a fitting word does not compress only
    // to retain its trailing separator inside the margin.
    let trailingWidth = 0;
    let hasVisiblePrefix = false;
    for (let index = candidates.length - 1; index >= 0; index--) {
      const candidate = candidates[index]!;
      const visible = candidate.text.replace(/ +$/u, '');
      trailingWidth += measureDisplayText(
        candidate.text.slice(visible.length),
        styleForFontSlot(candidate.style, candidate.fontSlot),
        measurer
      );
      if (visible.length) {
        hasVisiblePrefix = true;
        break;
      }
    }
    if (
      trailingWidth > 0 &&
      hasVisiblePrefix &&
      x - origin - trailingWidth <= available - line.width + TOLERANCE
    )
      return undefined;
    if (
      overflowPunctuation &&
      canHangCjkPunctuation(
        candidates.map((candidate) => candidate.text).join(''),
        pieces[currentIndex]!,
        available - line.width,
        x - origin,
        measurer
      )
    )
      return undefined;
    const fitted = fitCjkOptically(line, candidates, available, measurer, pieces);
    if (!fitted) return undefined;
    let first: CjkOpticalFit | undefined;
    let offset = 0;
    for (const candidate of candidates) {
      const fragments: StyleSpanRecord[] = [];
      let advance = 0;
      while (
        offset < fitted.candidate.length &&
        fitted.candidate[offset]!.range.start < candidate.range.end
      ) {
        const fragment = fitted.candidate[offset++]!;
        fragments.push(fragment);
        advance += fragment.box.width;
      }
      const fit = { candidate: fragments, width: advance };
      if (!first) first = { ...fit, spanStarts: fitted.spanStarts };
      else queued.set(candidate.range.start, fit);
    }
    return first;
  };
}

export function appendOpticalCjkCandidate(
  target: StyleSpanRecord[],
  span: StyleSpanRecord,
  fit: CjkOpticalFit
): void {
  let x = span.box.x;
  for (const fragment of fit.candidate) {
    target.push({
      ...span,
      text: fragment.text,
      range: fragment.range,
      style: fragment.style,
      glyphOffsetPt: fragment.glyphOffsetPt,
      box: { ...span.box, x, width: fragment.box.width },
    });
    x += fragment.box.width;
  }
}
