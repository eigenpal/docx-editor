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
import { hangingCjkPunctuationAdvance, hangsWithin } from './cjk-spacing.ts';
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
// The fit gate weighs expansion in units of 1/64 of an advance (see `expansionGate`).
const EXPANSION_UNITS = 64;
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
  /** The candidate's final mark hangs past the margin; the rest of the line fills it. */
  readonly hangs?: true;
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
        // An all-space group has no ink: it blocks adjacent seams without vetoing others. A word
        // or a Latin-face curly quote is a glyph that an adjacent blank side can face.
        const ordinaryOpaque =
          (printableAscii && /[^ ]/u.test(span.text)) ||
          /^[A-Za-z0-9‘’“”]+$/u.test(span.text) ||
          numberMarker;
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
    // Authored tracking is not a blank side; the rest of a narrower advance is already compressed.
    const authoredSpacing = memoized(
      memo,
      span,
      'authored',
      () => layoutDerivedSpacingStyleForEditing(face).characterSpacingPt
    );
    let previous = 0;
    for (const [index, cluster] of clusters.entries()) {
      const end = cluster.utf16To === span.text.length ? span.box.width : ends[index]!;
      const width = end - previous;
      const natural = memoized(memo, span, `n:${cluster.text}`, () =>
        measureDisplayText(cluster.text, { ...face, characterSpacingPt: 0 }, measurer)
      );
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
          (baseline.style.characterSpacingPt - span.style.characterSpacingPt) * cluster.text.length,
          natural + authoredSpacing * cluster.text.length - width
        ),
        natural,
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
// A glyph a blank side can face: an ideograph, punctuation, a qualified quote, or a word. A space
// is not one.
function fitNeighbour(cell: Cell): boolean {
  const text = cell.span.text;
  return (
    cell.ordinaryOpaque === true ||
    cell.qualifiedCurly !== undefined ||
    PUNCTUATION.test(text) ||
    isCjk(text.codePointAt(0)!)
  );
}
function finiteInk(cell: Cell): cell is Cell & { ink: { left: number; right: number } } {
  return (
    cell.ink !== undefined &&
    Number.isFinite(cell.ink.left) &&
    Number.isFinite(cell.ink.right) &&
    cell.ink.right >= cell.ink.left
  );
}

const blankSided = (cell: Cell): boolean =>
  cell.qualifiedCurly !== undefined ||
  OPENING.test(cell.span.text) ||
  CLOSING.test(cell.span.text) ||
  cell.span.text === '：';
/**
 * A justified line takes another ordinary glyph by compression only when the share of the
 * compression capacity it spends is at most the expansion that leaving the glyph off would
 * need. Expansion counts in 1/64 of each advance before the line's last glyph: the advances
 * whose gaps the shorter line would spread its room over. A final mark that hangs or drops its
 * trailing half stays in the deficit and counts as capacity, and a candidate that opens with a
 * bracket is gated too.
 */
function expansionGate(
  cells: readonly Cell[],
  sourceCount: number,
  room: number,
  deficit: number
): { readonly capacityBound: number; admits(capacity: number): boolean } {
  let spread = 0;
  let capacityBound = 0;
  let lastLineCell: Cell | undefined;
  for (const cell of cells) {
    if (blankSided(cell)) capacityBound += cell.natural / 2;
    if (cell.sourceIndex >= sourceCount) continue;
    spread += cell.natural;
    lastLineCell = cell;
  }
  if (lastLineCell) spread -= lastLineCell.natural;
  return {
    capacityBound,
    admits: (capacity) =>
      room > TOLERANCE && deficit * spread <= room * capacity * EXPANSION_UNITS + TOLERANCE,
  };
}
/** Try a complete protected group without changing the line when it cannot fit. */
function fitCjkOptically(
  line: PendingLine,
  candidates: readonly StyleSpanRecord[],
  available: number,
  measurer: TextMeasurer,
  baselinePieces: readonly FieldAwarePiece[],
  requireLocalQualification: boolean,
  memo: ClusterMemo,
  hangAdvance: number | undefined
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
  const last = cells.at(-1)!;
  const beforeLast = cells.at(-2);
  // A hanging line-end mark keeps its whole advance past the margin, so the rest of the line
  // compresses only for the glyphs before it. A word keeps its final mark in its own cell.
  const hung =
    hangAdvance === undefined || last.sourceIndex < sourceCount
      ? 0
      : last.ordinaryOpaque
        ? hangAdvance
        : last.span.box.width;
  const hangsLast = hung > 0;
  const fullDeficit = deficit;
  deficit -= hung;
  // A final qualified closing quote drops its trailing blank after any glyph, a word included.
  const curlyFinal =
    last.qualifiedCurly === 'closing' && beforeLast !== undefined && fitNeighbour(beforeLast);
  // Otherwise the final closing bearing is removed first. A bracket's measured ink must stay
  // inside; a quote gives its whole trailing half even where its ink reaches past the middle.
  if (!hangsLast && (CLOSING.test(last.span.text) || curlyFinal) && finiteInk(last)) {
    const inkEnd = curlyFinal ? 0 : last.ink.right + (last.span.glyphOffsetPt ?? 0);
    const extent = Math.max(last.natural / 2, inkEnd);
    last.reduction = Math.min(deficit, Math.max(0, last.span.box.width - extent));
    deficit -= last.reduction;
  }
  // Check the expansion gate against an upper bound before any word is shaped for its ink.
  // The final mark's relief (its hang or its dropped trailing half) counts as capacity.
  const relief = fullDeficit - deficit;
  const gate =
    (isCjk(first.span.text.codePointAt(0)!) && !PUNCTUATION.test(first.span.text)) ||
    OPENING.test(first.span.text)
      ? expansionGate(cells, sourceCount, available - line.width, fullDeficit)
      : undefined;
  if (gate && !gate.admits(gate.capacityBound + relief)) return undefined;
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
  // A blank side compresses next to any glyph on the line: a closing mark's right side, a
  // colon's right side, and an opening mark's left side, each up to half its advance. A closing
  // mark or colon before an opening mark gives both sides.
  const seams: { cell: Cell; capacity: number; left: boolean }[] = [];
  for (let index = 1; index < cells.length; index++) {
    const previous = cells[index - 1]!;
    const current = cells[index]!;
    if (!fitNeighbour(previous) || !fitNeighbour(current)) continue;
    const right =
      CLOSING.test(previous.span.text) ||
      previous.span.text === '：' ||
      previous.qualifiedCurly === 'closing';
    const left = OPENING.test(current.span.text) || current.qualifiedCurly === 'opening';
    if (!right && !left) continue;
    if (
      (!previous.ordinaryOpaque && !finiteInk(previous)) ||
      (!current.ordinaryOpaque && !finiteInk(current))
    )
      continue;
    const previousBoundary = boundaryCell(previous);
    const currentBoundary = boundaryCell(current);
    if (!finiteInk(previousBoundary) || !finiteInk(currentBoundary)) continue;
    let gap =
      previous.span.box.width +
      (current.span.glyphOffsetPt ?? 0) +
      currentBoundary.ink.left -
      (previous.span.glyphOffsetPt ?? 0) -
      previousBoundary.ink.right;
    // Both sides of one seam give at most half of the smaller glyph each.
    const pairHalf = right && left ? Math.min(previous.natural, current.natural) / 2 : Infinity;
    if (right) {
      const capacity = Math.max(
        0,
        Math.min(
          Math.min(previous.natural / 2, pairHalf) - previous.alreadyReduced,
          previous.span.box.width - previous.reduction,
          gap
        )
      );
      gap -= capacity;
      if (capacity > TOLERANCE) seams.push({ cell: previous, capacity, left: false });
    }
    if (left) {
      const capacity = Math.max(
        0,
        Math.min(
          Math.min(current.natural / 2, pairHalf) - current.alreadyReduced,
          current.span.box.width - current.reduction,
          gap
        )
      );
      if (capacity > TOLERANCE) seams.push({ cell: current, capacity, left: true });
    }
  }
  const capacity = seams.reduce((sum, seam) => sum + seam.capacity, 0);
  if (deficit > capacity + TOLERANCE) return undefined;
  if (gate && !gate.admits(capacity + relief)) return undefined;
  // The shrink goes in equal shares to every blank side; a side that runs out passes the rest on.
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
  line.width = available + hung - candidateWidth;
  return {
    candidate: candidateSpans,
    width: candidateWidth,
    spanStarts,
    ...(hangsLast ? { hangs: true as const } : {}),
  };
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
  // Compression fits a line only when the paragraph is justified and the document defaults
  // name an East Asian face. A document without one compresses no punctuation to fit.
  const opticalPolicy =
    justified &&
    typography.settings?.sourceEastAsianFont === true &&
    typography.settings.compression !== undefined &&
    typography.settings.compression !== 'doNotCompress' &&
    !hasPageExclusions &&
    measurer.inkBounds !== undefined;
  const opticalParagraph = opticalPolicy && canFitCjkOptically(allPieces);
  const localOpticalParagraph = opticalPolicy && typography.settings?.punctuationKerning !== false;
  return {
    opticalParagraph,
    opticalCompression: (opticalParagraph || localOpticalParagraph) && !preserveColonAdvances,
    fitCjkOptically: createCjkOpticalFitter(
      pieces,
      breaks,
      measurer,
      typography.hangingPunctuation ?? typography.overflowPunctuation,
      !opticalParagraph
    ),
  };
}

/** Keep each protected group whole even when its source runs split its punctuation. */
export function createCjkOpticalFitter(
  pieces: readonly FieldAwarePiece[],
  breaks: CjkParagraphBreaks | null,
  measurer: TextMeasurer,
  hangingPunctuation: boolean,
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
    const hangAdvance = hangingPunctuation
      ? hangingCjkPunctuationAdvance(
          candidates.map((candidate) => candidate.text).join(''),
          pieces[currentIndex]!,
          measurer
        )
      : undefined;
    // A group that hangs at its natural width needs no fit; one that does not may still hang
    // its final mark once the rest of the line compresses.
    if (hangsWithin(hangAdvance, available - line.width, x - origin)) return undefined;
    const fitted = fitCjkOptically(
      line,
      candidates,
      available,
      measurer,
      pieces,
      requireLocalQualification,
      memo,
      hangAdvance
    );
    if (!fitted) return undefined;
    let first: CjkOpticalFit | undefined;
    let offset = 0;
    for (const [index, candidate] of candidates.entries()) {
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
      // Only the piece that holds the final mark hangs past the margin.
      const fit = {
        candidate: fragments,
        width: advance,
        ...(fitted.hangs && index === candidates.length - 1 ? { hangs: true as const } : {}),
      };
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
