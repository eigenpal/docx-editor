// Demand-only line fitting.
import type { FieldAwarePiece } from './field-pieces.ts';
import type { PendingLine } from './pending-line.ts';
import {
  eastAsianLanguage,
  kinsokuCharacters,
  type CjkParagraphTypography,
} from './cjk-typography.ts';
import type { SourceRange, StyleSpanRecord, TextMeasurer } from './semantic-records.ts';
import { measureDisplayText } from './run-style.ts';
import { automaticTextSpacingBefore } from './cjk-automatic-spacing.ts';
import {
  kanaFitCells,
  kanaCapacityOf,
  lineStartCharacter,
  takeFinalSoundMarkShare,
} from './kana-sound-mark-fit.ts';
import { styleForFontSlot } from './script-itemization.ts';
import { isDefaultGraphemeBoundary, segmentGraphemes, type GraphemeSegment } from './grapheme.ts';
import { isCjk, koreanText, type CjkParagraphBreaks } from './cjk-paragraph-breaks.ts';
import { hangingCjkPunctuationAdvance, hangsWithin } from './cjk-spacing.ts';
import { alternateLineEndWraps, hangsInBlankSides } from './hanging-mark-blanks.ts';
import { formatRevisionOf } from './revision-projection.ts';
import { createObjectPlacer, lineObjectsInFlow } from './cjk-optical-objects.ts';
import { withoutTrailingSpaces } from './trailing-spaces.ts';
import { memoized, type ClusterMemo } from './cjk-optical-memo.ts';
import {
  CLOSING,
  curlyRole,
  EAST_ASIAN_OPAQUE,
  finiteInk,
  fitNeighbour,
  HAS_PUNCTUATION,
  OPAQUE_TEXT,
  OPENING,
  PUNCTUATION,
  TOLERANCE,
  type Cell,
} from './cjk-optical-cell.ts';
import {
  exceedsLegacyAdmission,
  expansionGate,
  isFullWidthKana,
  kanaFitBound,
  kanaShare,
  legacyKoreanMarks,
  shareAmong,
  type KanaFitRules,
} from './cjk-optical-capacity.ts';
import {
  layoutDerivedSpacingStyleForEditing,
  withLayoutDerivedSpacing,
} from './layout-derived-spacing.ts';

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
export interface CjkOpticalFit {
  readonly candidate: readonly StyleSpanRecord[];
  readonly width: number;
  readonly spanStarts?: readonly number[];
  /** The candidate's final mark hangs past the margin; the rest of the line fills it. */
  readonly hangs?: true;
}
function allowedStyle(span: Pick<StyleSpanRecord, 'style' | 'props' | 'revisions'>): boolean {
  const style = span.style;
  // Highlight (`w:highlight`) and shading (`w:shd`) fill the fitted box, and fitting keeps ink
  // inside it. A shifted glyph paints transparent text, which drops underline (`w:u`) and strike
  // (`w:strike`, `w:dstrike`), and an outline (`w14:textOutline`) changes the ink.
  return (
    !span.revisions?.length &&
    !style.textOutline &&
    !style.underline &&
    !style.strike &&
    !style.doubleStrike &&
    style.shaping?.direction !== 'rtl' &&
    !formatRevisionOf(span.props)
  );
}
/**
 * Unsupported paragraphs retain their existing wrapping and whitespace path. A paragraph with an
 * inline drawing is not pure here: it fits through the mixed-line path, whose per-line fitter
 * keeps each object's advance (`lineObjectsInFlow` in `cjk-optical-objects.ts`).
 */
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
  // Authored run tracking (`w:rPr/w:spacing`) qualifies a line only while it holds East Asian
  // text, punctuation, and spaces alone: such a line fits as it would in a paragraph without
  // Latin text.
  let tracked = false;
  let foreign = false;
  for (const [sourceIndex, span] of spans.entries()) {
    length += span.text.length;
    if (length > 4096 || !allowed(span)) return undefined;
    const face = styleForFontSlot(span.style, span.fontSlot);
    // This narrower path applies only when the old paragraph-wide gate failed.
    // Keep authored scaling, complex lanes, and unqualified faces intact.
    if (requireLocalQualification) {
      const authored = layoutDerivedSpacingStyleForEditing(face);
      tracked ||= authored.characterSpacingPt !== 0;
      // A refused line stops before it measures the rest of its spans.
      if (
        (tracked && foreign) ||
        authored.horizontalScalePercent !== 100 ||
        authored.shaping !== undefined ||
        measurer.hasResolvedFont?.(face) !== true
      )
        return undefined;
      // Keep a qualified mathematical run opaque. Its existing shaped advance is
      // immutable, and neither adjacent boundary can supply compression capacity.
      if (/^\p{Sm}+$/u.test(span.text) && /[^\x00-\x7f]/u.test(span.text)) {
        foreign = true;
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
        // Latin-face text (`AV`, `Café`, `25℃`) stays whole and can guard an adjacent
        // EA-owned seam.
        // The whole shaped outline supplies its external ink; inkBounds answers
        // one grapheme and cannot qualify AV/fi or a numeric group as a whole.
        // The opaque cell itself can never lose advance or be split.
        const numberMarker = opaqueCjkNumberMarker(span);
        const printableAscii = /^[\x20-\x7e]+$/u.test(span.text);
        if (
          (!printableAscii &&
            !(OPAQUE_TEXT.test(span.text) && !HAS_PUNCTUATION.test(span.text)) &&
            !numberMarker) ||
          !Number.isFinite(span.box.width) ||
          span.box.width <= 0
        )
          return undefined;
        // An all-space group has no ink: it blocks adjacent seams without vetoing others. A word,
        // a symbol, or a Latin-face curly quote is a glyph that an adjacent blank side can face.
        const ordinaryOpaque = numberMarker || /[^\p{White_Space}\p{Cf}\p{M}]/u.test(span.text);
        foreign ||= ordinaryOpaque;
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
    // The paragraph path holds only CJK text and punctuation. On the local path, a digit,
    // symbol, or other punctuation becomes an opaque glyph below: it keeps its advance.
    const opaque = clusters.filter(
      (cluster) =>
        cluster.text !== ' ' &&
        !isCjk(cluster.text.codePointAt(0)!) &&
        !PUNCTUATION.test(cluster.text)
    );
    if (
      !opaque.every((cluster) => requireLocalQualification && EAST_ASIAN_OPAQUE.test(cluster.text))
    )
      return undefined;
    // An East Asian face symbol or a curly quote, like a Latin group, keeps a tracked line out.
    foreign ||= opaque.length > 0 || (curlyAllowed && clusters.some((c) => curlyRole(c.text)));
    // One prefix-width list per span text keeps the memo linear in the text length.
    const ends = memoized(memo, span, 'prefixEnds', span.text, () =>
      clusters.map((cluster) =>
        measureDisplayText(span.text.slice(0, cluster.utf16To), face, measurer)
      )
    );
    // Authored tracking is not a blank side; the rest of a narrower advance is already compressed.
    const authoredSpacing = memoized(
      memo,
      span,
      'authored',
      '',
      () => layoutDerivedSpacingStyleForEditing(face).characterSpacingPt
    );
    let previous = 0;
    for (const [index, cluster] of clusters.entries()) {
      const end = cluster.utf16To === span.text.length ? span.box.width : ends[index]!;
      const width = end - previous;
      const natural = memoized(memo, span, 'natural', cluster.text, () =>
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
      const opaqueGlyph =
        requireLocalQualification &&
        !qualifiedCurly &&
        !isCjk(cluster.text.codePointAt(0)!) &&
        !PUNCTUATION.test(cluster.text) &&
        cluster.text !== ' ';
      cells.push({
        sourceIndex,
        ...(qualifiedCurly ? { qualifiedCurly } : {}),
        ...(opaqueGlyph ? { opaqueGlyph: true as const } : {}),
        alreadyReduced: Math.max(
          0,
          (baseline.style.characterSpacingPt - span.style.characterSpacingPt) * cluster.text.length,
          natural + authoredSpacing * cluster.text.length - width
        ),
        natural,
        ink: memoized(memo, span, 'ink', cluster.text, () =>
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
  if (tracked && foreign) return undefined;
  return cells;
}

/** Try a complete protected group without changing the line when it cannot fit. */
interface FitContext {
  readonly measurer: TextMeasurer;
  readonly baselinePieces: readonly FieldAwarePiece[];
  readonly requireLocalQualification: boolean;
  /**
   * A legacy compatibility mode (`w:compatSetting` `compatibilityMode` 14 or earlier, or none)
   * limits what a candidate group may take from the line.
   */
  readonly legacyAdmission: boolean;
  readonly memo: ClusterMemo;
  /** The final mark keeps its blank half: the alternate line-break rules let it wrap only. */
  readonly finalKeepsBlank: boolean;
  /**
   * The cells of the current group's line, kept between its attempts: an attempt that fails
   * leaves the line unchanged, so the next attempt starts from copies of the same cells.
   */
  readonly cells: { value?: readonly Cell[] | null };
}
interface FitAttempt {
  /** The final mark may hang with this advance; the rest of the line fits without it. */
  readonly hangAdvance?: number;
  readonly kana?: KanaFitRules;
}
function lineCells(
  context: FitContext,
  line: PendingLine,
  candidates: readonly StyleSpanRecord[]
): Cell[] | undefined {
  // The first attempt takes the cells as built; a later one copies them with no compression.
  if (context.cells.value !== undefined)
    return context.cells.value?.map((cell) => ({ ...cell, reduction: 0, shift: 0 }));
  const cells = cellsOf(
    [...line.spans, ...candidates],
    context.measurer,
    context.baselinePieces,
    context.requireLocalQualification,
    context.memo
  );
  context.cells.value = cells ?? null;
  return cells;
}
function fitCjkOptically(
  line: PendingLine,
  candidates: readonly StyleSpanRecord[],
  available: number,
  context: FitContext,
  { hangAdvance, kana }: FitAttempt
): CjkOpticalFit | undefined {
  const { measurer, finalKeepsBlank } = context;
  const width = candidates.reduce((sum, candidate) => sum + candidate.box.width, 0);
  let deficit = line.width + width - available;
  if (deficit <= TOLERANCE || !measurer.inkBounds) return undefined;
  if (
    !kana &&
    !candidates.some((span) => HAS_PUNCTUATION.test(span.text)) &&
    !line.spans.some((span) => HAS_PUNCTUATION.test(span.text))
  )
    return undefined;
  // A kana fit is gated, and the gate needs room left on the line. Check that and an upper
  // bound on the capacity before the line is split into cells and measured for ink.
  if (
    kana &&
    ((!kana.ungated && available - line.width <= TOLERANCE) ||
      deficit > kanaFitBound(line, candidates))
  )
    return undefined;
  const objects = lineObjectsInFlow(line, candidates);
  if (!objects) return undefined;
  const sourceCount = line.spans.length;
  const cells = lineCells(context, line, candidates);
  if (!cells) return undefined;
  // A legacy mode compresses no Korean mark (`legacyKoreanMarks`); it keeps its advance.
  const held = context.legacyAdmission ? legacyKoreanMarks(cells) : undefined;
  const first = cells.find((cell) => cell.sourceIndex === sourceCount)!;
  const last = cells.at(-1)!;
  const beforeLast = cells.at(-2);
  // A hanging line-end mark keeps its hang advance past the margin, so the rest of the line
  // compresses only for the glyphs before it. A word keeps its final mark in its own cell.
  const hung =
    hangAdvance === undefined || last.sourceIndex < sourceCount
      ? 0
      : last.ordinaryOpaque
        ? hangAdvance
        : Math.min(hangAdvance, last.span.box.width);
  const hangsLast = hung > 0;
  const fullDeficit = deficit;
  deficit -= hung;
  // A final qualified closing quote drops its trailing blank after any glyph, a word included.
  const curlyFinal =
    last.qualifiedCurly === 'closing' && beforeLast !== undefined && fitNeighbour(beforeLast);
  // Otherwise the final closing bearing is removed first. A bracket's measured ink must stay
  // inside; a quote gives its whole trailing half even where its ink reaches past the middle.
  // A semicolon gives up its blank only inside the line.
  const closingFinal = CLOSING.test(last.span.text) && last.span.text !== '；';
  let deferredFinal = 0;
  if (
    !hangsLast &&
    !finalKeepsBlank &&
    (closingFinal || curlyFinal) &&
    finiteInk(last) &&
    !held?.has(last)
  ) {
    const inkEnd = curlyFinal ? 0 : last.ink.right + (last.span.glyphOffsetPt ?? 0);
    const extent = Math.max(last.natural / 2, inkEnd);
    const finalCapacity = Math.max(0, last.span.box.width - extent);
    // A kana fit keeps the final trailing half for last, unless that half alone fits the line.
    if (kana && !kana.finalHalfFirst && deficit > finalCapacity + TOLERANCE)
      deferredFinal = finalCapacity;
    else {
      last.reduction = Math.min(deficit, finalCapacity);
      deficit -= last.reduction;
    }
  }
  if (held && !kana && !hangsLast) {
    // A Latin closing quote that ends the group counts as a closing mark that gave its half; a
    // final apostrophe is the same character and counts the same way.
    const quote =
      /[’”]$/u.test(last.span.text) && last.ordinaryOpaque ? last.span.text.at(-1)! : '';
    const quoteAdvance = quote
      ? memoized(context.memo, last.span, 'natural', quote, () =>
          measureDisplayText(
            quote,
            { ...styleForFontSlot(last.span.style, last.span.fontSlot), characterSpacingPt: 0 },
            measurer
          )
        )
      : 0;
    if (exceedsLegacyAdmission(cells, sourceCount, deficit, held, quoteAdvance)) return undefined;
  }
  const kanaCells = kana ? kanaFitCells(cells, isFullWidthKana) : [];
  const kanaCapacity = kanaCells.reduce(
    (sum, cell) => sum + kanaCapacityOf(cell, kanaShare(cell)),
    0
  );
  // Check the expansion gate against an upper bound before any word is shaped for its ink.
  // The final mark's relief (its hang or its dropped trailing half) counts as capacity.
  const relief = fullDeficit - deficit;
  // A kana fit gates every group, a word that opens it included. An East Asian face symbol
  // joins like an ideograph.
  const gate =
    (kana !== undefined && !kana.ungated) ||
    (isCjk(first.span.text.codePointAt(0)!) && !PUNCTUATION.test(first.span.text)) ||
    first.opaqueGlyph === true ||
    OPENING.test(first.span.text)
      ? expansionGate(cells, sourceCount, available - line.width, fullDeficit)
      : undefined;
  if (gate && !gate.admits(gate.capacityBound + relief + kanaCapacity + deferredFinal))
    return undefined;
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
      (CLOSING.test(previous.span.text) ||
        previous.span.text === '：' ||
        previous.qualifiedCurly === 'closing') &&
      !held?.has(previous);
    const left =
      (OPENING.test(current.span.text) || current.qualifiedCurly === 'opening') &&
      !held?.has(current);
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
    // A later run's `w:highlight` or `w:shd` band covers ink past its own box: keep banded
    // seams inside.
    const band = [previous, current].some(({ span }) => span.style.highlight || span.style.shading);
    const leftBlank = (current.span.glyphOffsetPt ?? 0) + currentBoundary.ink.left;
    const rightBlank = previous.span.box.width - (previous.span.glyphOffsetPt ?? 0);
    // Both sides of one seam give at most half of the smaller glyph each.
    const pairHalf = right && left ? Math.min(previous.natural, current.natural) / 2 : Infinity;
    if (right) {
      const capacity = Math.max(
        0,
        Math.min(
          Math.min(previous.natural / 2, pairHalf) - previous.alreadyReduced,
          previous.span.box.width - previous.reduction,
          band ? Math.min(gap, rightBlank - previousBoundary.ink.right) : gap
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
          band ? Math.min(gap, leftBlank) : gap
        )
      );
      if (capacity > TOLERANCE) seams.push({ cell: current, capacity, left: true });
    }
  }
  const capacity = seams.reduce((sum, seam) => sum + seam.capacity, 0);
  const extra = kanaCapacity + deferredFinal;
  if (deficit > capacity + extra + TOLERANCE) return undefined;
  if (gate && !gate.admits(capacity + relief + extra)) return undefined;
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
  // Kana take what punctuation leaves. When they cannot take it all, the final mark first
  // gives its whole trailing half.
  if (kana && deficit > TOLERANCE) {
    deficit = takeFinalSoundMarkShare(last, deficit);
    if (deficit > kanaCapacity + TOLERANCE) {
      last.reduction += deferredFinal;
      deficit -= deferredFinal;
    }
    deficit = shareAmong(kanaCells, deficit);
  }
  const spans: StyleSpanRecord[] = [];
  const candidateSpans: StyleSpanRecord[] = [];
  const spanStarts: number[] = [];
  let x = line.spans[0]?.box.x ?? candidates[0]!.box.x;
  let candidateWidth = 0;
  // A kana fit rejoins neighbouring cells of one source span that keep their advances, or
  // that are kana with the same equal share: their letter spacing paints the same geometry,
  // and later stages measure one span instead of one per character.
  let previous: { span: StyleSpanRecord; cell: Cell } | undefined;
  const placer = createObjectPlacer(objects);
  for (const cell of cells) {
    const source = cell.span;
    x = placer.before(source.range.start, x);
    // Preserve witnessed inter-script advances; they are not compression capacity.
    if (cell.sourceIndex > 0 && cell.sourceIndex < sourceCount)
      x += automaticTextSpacingBefore(source);
    const reduced = cell.reduction > 0;
    const kanaShared = kana !== undefined && reduced && cell.shift === 0 && isFullWidthKana(cell);
    const joinable =
      kana !== undefined && source.glyphOffsetPt === undefined && (!reduced || kanaShared);
    if (
      joinable &&
      previous &&
      previous.cell.sourceIndex === cell.sourceIndex &&
      previous.cell.reduction === cell.reduction &&
      previous.span.range.end === source.range.start
    ) {
      const span = previous.span as { -readonly [K in keyof StyleSpanRecord]: StyleSpanRecord[K] };
      span.text += source.text;
      span.range = { ...span.range, end: source.range.end };
      span.box = { ...span.box, width: span.box.width + source.box.width - cell.reduction };
      x += source.box.width - cell.reduction;
      if (cell.sourceIndex >= sourceCount) candidateWidth += source.box.width - cell.reduction;
      continue;
    }
    const span = {
      ...source,
      ...(reduced
        ? {
            style: withLayoutDerivedSpacing(
              source.style,
              source.style.characterSpacingPt - cell.reduction / source.text.length
            ),
            ...(kanaShared ? {} : { glyphOffsetPt: (source.glyphOffsetPt ?? 0) + cell.shift }),
          }
        : {}),
      box: { ...source.box, x, width: source.box.width - cell.reduction },
    };
    previous = joinable ? { span, cell } : undefined;
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
  placer.commit(line);
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
  // Compression (`w:characterSpacingControl`) fits a line only when the document defaults name
  // an East Asian face, and the paragraph is justified (`w:jc` `both`) or a legacy compatibility
  // mode fits lines at every alignment.
  const opticalPolicy =
    (justified || typography.settings?.legacyLineEndPunctuation === true) &&
    typography.settings?.sourceEastAsianFont === true &&
    typography.settings.compression !== undefined &&
    typography.settings.compression !== 'doNotCompress' &&
    !hasPageExclusions &&
    measurer.inkBounds !== undefined;
  // Kana compression may also fit a line in a distributed paragraph whatever the defaults, and
  // at every alignment in a legacy mode (`kanaLineFit`). There it fits only kana groups.
  const kanaPolicy =
    typography.kanaLineFit === true && !hasPageExclusions && measurer.inkBounds !== undefined;
  const opticalParagraph = opticalPolicy && canFitCjkOptically(allPieces);
  const kanaParagraph = kanaPolicy && (opticalParagraph || canFitCjkOptically(allPieces));
  const localOpticalParagraph =
    (opticalPolicy || kanaPolicy) && typography.settings?.punctuationKerning !== false;
  return {
    opticalParagraph,
    opticalCompression:
      (opticalParagraph || kanaParagraph || localOpticalParagraph) && !preserveColonAdvances,
    fitCjkOptically: createCjkOpticalFitter(pieces, breaks, measurer, {
      hangingPunctuation: typography.hangingPunctuation ?? typography.overflowPunctuation,
      requireLocalQualification: !(opticalParagraph || kanaParagraph),
      policy: typography,
      ...(kanaPolicy
        ? {
            kana: {
              rules: { finalHalfFirst: !typography.overflowPunctuation },
              only: !opticalPolicy,
            },
          }
        : {}),
    }),
  };
}

/** How {@link createCjkOpticalFitter} fits a protected group. */
export interface CjkOpticalFitterOptions {
  /** A final mark that may hang past the margin needs no fit for itself. */
  readonly hangingPunctuation: boolean;
  /**
   * Fit only text in qualified faces without authored scaling (`w:w`). Authored tracking
   * (`w:rPr/w:spacing`) qualifies only on a line of East Asian text, punctuation, and spaces.
   */
  readonly requireLocalQualification?: boolean;
  /** The paragraph typography, for the line-start rules of hanging and kana fits. */
  readonly policy?: CjkParagraphTypography;
  /**
   * Kana compression (`compressPunctuationAndJapaneseKana`). With `only`, the fitter tries
   * kana fits alone, for a paragraph that fits no other punctuation.
   */
  readonly kana?: { readonly rules: KanaFitRules; readonly only: boolean };
}

/** Keep each protected group whole even when its source runs split its punctuation. */
export function createCjkOpticalFitter(
  pieces: readonly FieldAwarePiece[],
  breaks: CjkParagraphBreaks | null,
  measurer: TextMeasurer,
  {
    hangingPunctuation,
    requireLocalQualification = false,
    policy,
    kana: kanaFit,
  }: CjkOpticalFitterOptions
) {
  const queued = new Map<number, CjkOpticalFit>();
  const memo: ClusterMemo = new Map();
  const legacy = policy?.settings?.legacyLineEndPunctuation === true;
  const languages = new WeakMap<FieldAwarePiece, string>();
  const languageOf = (piece: FieldAwarePiece): string => {
    let language = languages.get(piece);
    if (language === undefined)
      languages.set(piece, (language = eastAsianLanguage(piece.props) ?? 'ja-jp'));
    return language;
  };
  /**
   * The kana rules for a group that ends with a character the line-start list forbids at a
   * line start, whatever the paragraph kinsoku switch, or undefined. Korean text and modern
   * Traditional Chinese text keep their own punctuation rules. A legacy mode fits a lone mark
   * after a full line without the expansion gate.
   */
  const kanaRulesFor = (
    candidates: readonly StyleSpanRecord[],
    piece: FieldAwarePiece
  ): KanaFitRules | undefined => {
    if (!kanaFit) return undefined;
    const last = candidates.at(-1)!;
    // A single code unit is its own grapheme unless a combining mark could follow it.
    const tail =
      last.text.length === 1 || !/[\p{M}\u200d\ud800-\udfff]/u.test(last.text)
        ? last.text.at(-1)
        : segmentGraphemes(last.text).at(-1)?.text;
    if (!tail) return undefined;
    const language = languageOf(piece);
    if (/^ko(?:-|$)/.test(language)) return undefined;
    if (/^zh-(tw|hk|mo|hant)(-|$)/.test(language) && !legacy) return undefined;
    const lineStart = legacy ? tail : lineStartCharacter(tail, last);
    if (!kinsokuCharacters(language, policy?.settings).before.includes(lineStart)) return undefined;
    const lone = candidates.length === 1 && tail.length === last.text.length;
    return lone && legacy ? { ...kanaFit.rules, ungated: true } : kanaFit.rules;
  };
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
    // A group that fits needs no fit, and no fit can change a line it does not overflow.
    if (line.width + x - origin - available <= TOLERANCE) return undefined;
    // A legacy mode compresses no group with Korean text, by language (`w:lang` `w:eastAsia`)
    // or Hangul, to fit a line.
    for (let index = pieceIndex; legacy && index <= currentIndex; index++)
      if (koreanText(candidates[index - pieceIndex]!.text, languageOf(pieces[index]!)))
        return undefined;
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
    const groupText = candidates.map((candidate) => candidate.text).join('');
    const finalPiece = pieces[currentIndex]!;
    const hangAdvance = hangingPunctuation
      ? hangingCjkPunctuationAdvance(groupText, finalPiece, measurer, { policy })
      : undefined;
    // Kana compress to pull a line-start-prohibited character onto the line before it may
    // hang, unless its overflow fits in its blank sides. A group that hangs at its natural width
    // needs no other fit; one that does not may still hang once the rest of the line compresses.
    const context: FitContext = {
      measurer,
      baselinePieces: pieces,
      requireLocalQualification,
      legacyAdmission: legacy,
      memo,
      finalKeepsBlank:
        hangingPunctuation &&
        alternateLineEndWraps(groupText.at(-1) ?? '', eastAsianLanguage(finalPiece.props), policy),
      cells: {},
    };
    const overflow = line.width + x - origin - available;
    const blank = { line, measurer, overflow, advance: hangAdvance };
    const kanaRules = hangsInBlankSides(candidates, finalPiece, blank, policy)
      ? undefined
      : kanaRulesFor(candidates, finalPiece);
    let fitted = kanaRules
      ? fitCjkOptically(line, candidates, available, context, { kana: kanaRules })
      : undefined;
    if (!fitted && kanaFit?.only) return undefined;
    if (!fitted && hangsWithin(hangAdvance, available - line.width, x - origin)) return undefined;
    fitted ??= fitCjkOptically(line, candidates, available, context, {
      ...(hangAdvance !== undefined ? { hangAdvance } : {}),
    });
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
