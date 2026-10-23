// Demand-only line fitting, verified against native Word PDF glyph positions.
import type { FieldAwarePiece } from './field-pieces.ts';
import type { PendingLine } from './pending-line.ts';
import type { CjkParagraphTypography } from './cjk-typography.ts';
import type { SourceRange, StyleSpanRecord, TextMeasurer } from './semantic-records.ts';
import { measureDisplayText } from './run-style.ts';
import { automaticTextSpacingBefore } from './cjk-automatic-spacing.ts';
import { styleForFontSlot } from './script-itemization.ts';
import { isDefaultGraphemeBoundary, segmentGraphemes, type GraphemeSegment } from './grapheme.ts';
import { isCjk, type CjkParagraphBreaks } from './cjk-paragraph-breaks.ts';
import { canHangCjkPunctuation } from './cjk-spacing.ts';
import { formatRevisionOf } from './revision-projection.ts';
import { withoutTrailingSpaces } from './trailing-spaces.ts';
import {
  layoutDerivedSpacingStyleForEditing,
  withLayoutDerivedSpacing,
} from './layout-derived-spacing.ts';

const OPENING = /^[〈《「『【〔〖〘〚（［｛]$/u;
const CLOSING = /^[、。〉》」』】〕〗〙〛），．］｝]$/u;
const PUNCTUATION = /^[〈《「『【〔〖〘〚（［｛、。〉》」』】〕〗〙〛），．］｝：]$/u;
const HAS_PUNCTUATION = /[〈《「『【〔〖〘〚（［｛、。〉》」』】〕〗〙〛），．］｝：]/u;
const TOLERANCE = 0.001;
// A curly quote in the East Asian font slot fits like the matching bracket.
function curlyRole(text: string): 'opening' | 'closing' | undefined {
  if (text === '‘' || text === '“') return 'opening';
  if (text === '’' || text === '”') return 'closing';
  return undefined;
}
// Every fit attempt re-reads the whole line, so segmentation dominates its cost. In BMP East
// Asian, fullwidth, curly-quote, and space text without combining kana or tone marks, each
// code unit is one grapheme.
const SINGLE_UNIT_CLUSTERS =
  /^[ \u2018\u2019\u201c\u201d\u3000-\u3029\u3030-\u3098\u309b-\u9fff\uff00-\uff9d\uffa0-\uffef]*$/u;
export function fittingClusters(text: string): readonly GraphemeSegment[] {
  if (!isDefaultGraphemeBoundary() || !SINGLE_UNIT_CLUSTERS.test(text))
    return segmentGraphemes(text);
  const clusters: GraphemeSegment[] = [];
  for (let index = 0; index < text.length; index += 1)
    clusters.push({ index, text: text[index]!, utf16From: index, utf16To: index + 1 });
  return clusters;
}
/**
 * One fitter's cluster measurements by span style and font slot. Every attempt re-reads the
 * whole line with fresh span records, so ink and widths would otherwise be measured again.
 * Sound because a resolved run style is never mutated: a changed style is a new object, and
 * measurement reads only the style, the slot, the text, and the fitter's one measurer.
 */
type ClusterMemo = Map<StyleSpanRecord['style'], Map<string, unknown>>;
function memoized<T>(memo: ClusterMemo, span: StyleSpanRecord, key: string, measure: () => T): T {
  let byKey = memo.get(span.style);
  if (!byKey) memo.set(span.style, (byKey = new Map()));
  const slotKey = `${span.fontSlot ?? ''}:${key}`;
  if (byKey.has(slotKey)) return byKey.get(slotKey) as T;
  const value = measure();
  byKey.set(slotKey, value);
  return value;
}
interface Cell {
  span: StyleSpanRecord;
  readonly sourceIndex: number;
  readonly ordinaryOpaque?: true;
  readonly qualifiedCurly?: 'opening' | 'closing';
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
// A coalesced same-face list marker stays whole; it cannot veto unrelated EA seams.
function opaqueCjkNumberMarker(span: StyleSpanRecord): boolean {
  const family = span.style.fontFamilyEastAsia;
  return (
    span.fontSlot === undefined &&
    !!family &&
    family === span.style.fontFamily &&
    /^[0-9]+[、．]$/u.test(span.text)
  );
}
// A missing slot needs no face substitution when both declared families are identical.
function sameFaceImplicitEastAsian(span: StyleSpanRecord): boolean {
  const family = span.style.fontFamilyEastAsia;
  return (
    span.fontSlot === undefined &&
    !!family &&
    family === span.style.fontFamily &&
    span.text.length > 0 &&
    fittingClusters(span.text).every(
      (cluster) =>
        cluster.text === ' ' ||
        isCjk(cluster.text.codePointAt(0)!) ||
        PUNCTUATION.test(cluster.text)
    )
  );
}
function cellsOf(
  spans: readonly StyleSpanRecord[],
  measurer: TextMeasurer,
  baselinePieces: readonly FieldAwarePiece[],
  requireLocalQualification: boolean,
  memo: ClusterMemo
): Cell[] | undefined {
  const cells: Cell[] = [];
  let length = 0;
  for (const [sourceIndex, span] of spans.entries()) {
    length += span.text.length;
    if (length > 4096 || !allowed(span)) return undefined;
    const face = styleForFontSlot(span.style, span.fontSlot);
    // This narrower path applies only when the old paragraph-wide gate failed.
    // Keep authored tracking/scaling, complex lanes, and unqualified faces intact.
    if (requireLocalQualification) {
      const authored = layoutDerivedSpacingStyleForEditing(face);
      if (
        authored.characterSpacingPt !== 0 ||
        authored.horizontalScalePercent !== 100 ||
        authored.shaping !== undefined ||
        measurer.hasResolvedFont?.(face) !== true
      )
        return undefined;
      // Keep a qualified mathematical run opaque. Its existing shaped advance is
      // immutable, and neither adjacent boundary can supply compression capacity.
      if (/^\p{Sm}+$/u.test(span.text) && /[^\x00-\x7f]/u.test(span.text)) {
        if (!Number.isFinite(span.box.width) || span.box.width <= 0) return undefined;
        cells.push({
          sourceIndex,
          alreadyReduced: 0,
          natural: span.box.width,
          ink: undefined,
          reduction: 0,
          shift: 0,
          span,
        });
        continue;
      }
      if (span.fontSlot !== 'eastAsia' && !sameFaceImplicitEastAsian(span)) {
        // Ordinary base text may coexist with qualified EA punctuation. Keep its
        // complete measured span: splitting AV/fi would discard kerning/ligatures.
        // Only a complete ASCII word can guard an adjacent EA-owned seam.
        // The whole shaped outline supplies its external ink; inkBounds answers
        // one grapheme and cannot qualify AV/fi or a numeric group as a whole.
        // The opaque cell itself can never lose advance or be split.
        const numberMarker = opaqueCjkNumberMarker(span);
        const printableAscii = /^[\x20-\x7e]+$/u.test(span.text);
        if (
          (!printableAscii && !/^[A-Za-z0-9‘’“”]+$/u.test(span.text) && !numberMarker) ||
          !Number.isFinite(span.box.width) ||
          span.box.width <= 0
        )
          return undefined;
        // An all-space group has no ink: it blocks adjacent seams without vetoing others.
        const ordinaryOpaque = (printableAscii && /[^ ]/u.test(span.text)) || numberMarker;
        cells.push({
          sourceIndex,
          alreadyReduced: 0,
          natural: span.box.width,
          ...(ordinaryOpaque ? { ordinaryOpaque: true as const } : {}),
          ink: undefined,
          reduction: 0,
          shift: 0,
          span,
        });
        continue;
      }
    }
    // Only the qualified local path reaches here with a curly quote; the paragraph gate refuses it.
    const curlyAllowed = requireLocalQualification && span.fontSlot === 'eastAsia';
    const clusters = fittingClusters(span.text);
    if (
      clusters.some(
        (cluster) =>
          cluster.text !== ' ' &&
          !isCjk(cluster.text.codePointAt(0)!) &&
          !PUNCTUATION.test(cluster.text) &&
          !(curlyAllowed && curlyRole(cluster.text))
      )
    )
      return undefined;
    // One prefix-width list per span text keeps the memo linear in the text length.
    const ends = memoized(memo, span, `w:${span.text}`, () =>
      clusters.map((cluster) =>
        measureDisplayText(span.text.slice(0, cluster.utf16To), face, measurer)
      )
    );
    let previous = 0;
    for (const [index, cluster] of clusters.entries()) {
      const end = cluster.utf16To === span.text.length ? span.box.width : ends[index]!;
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
      const qualifiedCurly = curlyAllowed ? curlyRole(cluster.text) : undefined;
      cells.push({
        sourceIndex,
        ...(qualifiedCurly ? { qualifiedCurly } : {}),
        alreadyReduced: Math.max(
          0,
          (baseline.style.characterSpacingPt - span.style.characterSpacingPt) * cluster.text.length
        ),
        natural: memoized(memo, span, `n:${cluster.text}`, () =>
          measureDisplayText(cluster.text, { ...face, characterSpacingPt: 0 }, measurer)
        ),
        ink: memoized(memo, span, `i:${cluster.text}`, () =>
          measurer.inkBounds?.(cluster.text, face)
        ),
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
  baselinePieces: readonly FieldAwarePiece[],
  requireLocalQualification: boolean,
  memo: ClusterMemo
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
    const current = line.spans[index]!;
    const gap = automaticTextSpacingBefore(current);
    if (
      !Number.isFinite(gap) ||
      gap < 0 ||
      Math.abs(previous.box.x + previous.box.width + gap - current.box.x) > TOLERANCE
    )
      return undefined;
  }
  const sourceCount = line.spans.length;
  const cells = cellsOf(
    [...line.spans, ...candidates],
    measurer,
    baselinePieces,
    requireLocalQualification,
    memo
  );
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
  const beforeLast = cells.at(-2);
  // A final curly quote needs an East Asian character before it; other neighbours have no measured pair.
  const curlyFinal =
    last.qualifiedCurly === 'closing' &&
    beforeLast !== undefined &&
    isCjk(beforeLast.span.text.codePointAt(0)!) &&
    !PUNCTUATION.test(beforeLast.span.text);
  if ((CLOSING.test(last.span.text) || curlyFinal) && finiteInk(last)) {
    const extent = Math.max(last.natural / 2, last.ink.right + (last.span.glyphOffsetPt ?? 0));
    last.reduction = Math.min(deficit, Math.max(0, last.span.box.width - extent));
    deficit -= last.reduction;
  }
  // Shape only a word beside an eligible EA seam, once per cell in this fit.
  // Cache missing outlines too; unrelated opaque text needs no outline at all.
  const opaqueBoundaryInk = new Map<Cell, Cell['ink']>();
  const boundaryCell = (cell: Cell): Cell => {
    if (!cell.ordinaryOpaque) return cell;
    if (!opaqueBoundaryInk.has(cell)) {
      const face = styleForFontSlot(cell.span.style, cell.span.fontSlot);
      opaqueBoundaryInk.set(cell, measurer.textOutline?.(cell.span.text, face)?.ink);
    }
    return { ...cell, ink: opaqueBoundaryInk.get(cell) };
  };
  const seams: { cell: Cell; capacity: number; left: boolean }[] = [];
  for (let index = 1; index < cells.length; index++) {
    const previous = cells[index - 1]!;
    const current = cells[index]!;
    const before = previous.span.text;
    const after = current.span.text;
    let cell: Cell;
    let left: boolean;
    // Curly quotes join only the ideograph and colon seams; nothing measures their other pairs.
    if (
      (OPENING.test(after) &&
        (CLOSING.test(before) ||
          ((isCjk(before.codePointAt(0)!) || previous.ordinaryOpaque === true) &&
            !PUNCTUATION.test(before)))) ||
      (current.qualifiedCurly === 'opening' &&
        isCjk(before.codePointAt(0)!) &&
        !PUNCTUATION.test(before))
    ) {
      cell = current;
      left = true;
    } else if (
      (before === '：' && (OPENING.test(after) || current.qualifiedCurly === 'opening')) ||
      (CLOSING.test(before) &&
        (isCjk(after.codePointAt(0)!) || current.ordinaryOpaque === true) &&
        !PUNCTUATION.test(after)) ||
      (previous.qualifiedCurly === 'closing' &&
        isCjk(after.codePointAt(0)!) &&
        !PUNCTUATION.test(after))
    ) {
      cell = previous;
      left = false;
    } else continue;
    if (
      (!previous.ordinaryOpaque && !finiteInk(previous)) ||
      (!current.ordinaryOpaque && !finiteInk(current))
    )
      continue;
    const previousBoundary = boundaryCell(previous);
    const currentBoundary = boundaryCell(current);
    if (!finiteInk(previousBoundary) || !finiteInk(currentBoundary)) continue;
    const gap =
      previous.span.box.width +
      (current.span.glyphOffsetPt ?? 0) +
      currentBoundary.ink.left -
      (previous.span.glyphOffsetPt ?? 0) -
      previousBoundary.ink.right;
    const capacity = Math.max(
      0,
      Math.min(
        cell.natural / 2 - cell.alreadyReduced,
        cell.span.box.width - cell.reduction,
        left ? currentBoundary.ink.left + (current.span.glyphOffsetPt ?? 0) : Infinity,
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
    // Preserve witnessed inter-script advances; they are not compression capacity.
    if (cell.sourceIndex > 0 && cell.sourceIndex < sourceCount)
      x += automaticTextSpacingBefore(source);
    const reduced = cell.reduction > 0;
    const span = {
      ...source,
      ...(reduced
        ? {
            style: withLayoutDerivedSpacing(
              source.style,
              source.style.characterSpacingPt - cell.reduction / source.text.length
            ),
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

/** Share paragraph policy and local face qualification without changing the pure CJK path. */
export function createParagraphCjkOpticalFitter(
  allPieces: readonly FieldAwarePiece[],
  pieces: readonly FieldAwarePiece[],
  breaks: CjkParagraphBreaks | null,
  measurer: TextMeasurer,
  typography: CjkParagraphTypography,
  hasPageExclusions: boolean,
  preserveColonAdvances: boolean,
  justified: boolean
) {
  // Compression fits a line only when the paragraph is justified.
  const opticalPolicy =
    justified &&
    typography.settings?.compression !== undefined &&
    typography.settings.compression !== 'doNotCompress' &&
    !hasPageExclusions &&
    measurer.inkBounds !== undefined;
  const opticalParagraph = opticalPolicy && canFitCjkOptically(allPieces);
  const localOpticalParagraph =
    opticalPolicy &&
    typography.settings?.punctuationKerning !== false &&
    typography.settings?.sourceEastAsianFont === true;
  return {
    opticalParagraph,
    opticalCompression: (opticalParagraph || localOpticalParagraph) && !preserveColonAdvances,
    fitCjkOptically: createCjkOpticalFitter(
      pieces,
      breaks,
      measurer,
      typography.overflowPunctuation,
      typography.overflowFullwidthPunctuation !== false,
      !opticalParagraph
    ),
  };
}

/** Keep each protected group whole even when its source runs split its punctuation. */
export function createCjkOpticalFitter(
  pieces: readonly FieldAwarePiece[],
  breaks: CjkParagraphBreaks | null,
  measurer: TextMeasurer,
  overflowPunctuation: boolean,
  allowFullwidth = true,
  requireLocalQualification = false
) {
  const queued = new Map<number, CjkOpticalFit>();
  const memo: ClusterMemo = new Map();
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
      if (!next || breaks.decision(next, 0, currentText, next.text) === 'opens') break;
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
      const visible = withoutTrailingSpaces(candidate.text);
      if (visible.length < candidate.text.length)
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
        measurer,
        allowFullwidth
      )
    )
      return undefined;
    const fitted = fitCjkOptically(
      line,
      candidates,
      available,
      measurer,
      pieces,
      requireLocalQualification,
      memo
    );
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
