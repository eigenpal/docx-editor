// Paragraph measuring and breaking, shared between the body flow and table cells.
//
// Extracted from `semantic-layout.ts` unchanged so a cell paragraph breaks exactly like a
// body paragraph: same pieces, same word boundaries, same cache discipline. The BREAK is
// position-independent — span x offsets are relative to the paragraph origin — which is
// what lets one cached break serve the same content at any x (body or any cell).

import {
  PAGE_BREAK_CHAR,
  type OoxmlNode,
  type OoxmlProperty,
} from '@docx-editor.dev/core-contract/store';
import {
  piecesOfParagraph,
  propertiesOfRunContainer,
  type FieldPageContext,
  type RunPropertyCascader,
} from './field-projection.ts';
import type { ParagraphLayoutCache } from './layout-cache.ts';
import {
  EMPTY_TAB_STOPS,
  nextTabDestination,
  tabAdvanceWidth,
  type ResolvedTabStops,
} from './paragraph-tabs.ts';
import {
  SINGLE_LINE_SPACING,
  applyLineSpacing,
  type ParagraphLineSpacing,
} from './paragraph-style.ts';
import {
  DEFAULT_RUN_STYLE,
  displayText,
  resolveRunStyle,
  type ResolvedRunStyle,
} from './run-style.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';

/**
 * Per-paragraph geometry the BREAK depends on, beyond width.
 *
 * Both change where lines start and how tall they are, so both belong in the caller's
 * cache key — a paragraph re-broken at a different line spacing is a different break.
 */
export interface ParagraphFlowOptions {
  readonly lineSpacing?: ParagraphLineSpacing;
  /** First-line offset from the paragraph indent: `w:firstLine` right, `w:hanging` left. */
  readonly firstLineOffset?: number;
}

/** One measurable piece of a paragraph: text carrying one property set. */
interface Piece {
  readonly text: string;
  readonly props: readonly OoxmlProperty[];
  /** Resolved once here, so nothing downstream re-derives it. */
  readonly style: ResolvedRunStyle;
  readonly start: number;
  readonly end: number;
  /** Live PAGE/NUMPAGES projection — model range covers suppressed cached result (or zero-width if empty). */
  readonly projected?: boolean;
}

export function propertiesOf(container: OoxmlNode | undefined): OoxmlProperty[] {
  return propertiesOfRunContainer(container);
}

/**
 * Break points inside a piece: after each run of spaces (words stay whole), and with each
 * tab as its own atom so tab-stop geometry can size `\t` independently of neighbouring text.
 */
function wordBoundaries(text: string): number[] {
  const boundaries: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index]!;
    if (ch === '\t') {
      if (index > 0 && boundaries[boundaries.length - 1] !== index) boundaries.push(index);
      boundaries.push(index + 1);
    } else if (ch === ' ') {
      boundaries.push(index + 1);
    }
  }
  if (boundaries[boundaries.length - 1] !== text.length) boundaries.push(text.length);
  return boundaries;
}

/**
 * Measure text following a tab until the next tab or hard break, across mixed-style pieces.
 * Also reports the advance to the first decimal point for decimal-aligned stops.
 */
function measureFollowingTabSegment(
  pieces: readonly Piece[],
  pieceIndex: number,
  offsetInPiece: number,
  measurer: TextMeasurer
): { width: number; decimalOffset: number } {
  let width = 0;
  let decimalOffset = 0;
  let sawDecimal = false;
  for (let index = pieceIndex; index < pieces.length; index += 1) {
    const piece = pieces[index]!;
    const from = index === pieceIndex ? offsetInPiece : 0;
    for (let cursor = from; cursor < piece.text.length; ) {
      const ch = piece.text[cursor]!;
      if (ch === '\t' || ch === '\n' || ch === PAGE_BREAK_CHAR) {
        return { width, decimalOffset: sawDecimal ? decimalOffset : width };
      }
      // Walk one code unit; surrogate pairs measure as two units under the fixed measurer
      // contract (UTF-16), matching how source offsets are counted elsewhere.
      const next = cursor + 1;
      const glyph = piece.text.slice(cursor, next);
      const advance = measurer.measure(displayText(glyph, piece.style), piece.style);
      if (!sawDecimal && ch === '.') {
        sawDecimal = true;
        // Decimal point itself sits ON the stop — offset is the advance before it.
      } else if (!sawDecimal) {
        decimalOffset += advance;
      }
      width += advance;
      cursor = next;
    }
  }
  return { width, decimalOffset: sawDecimal ? decimalOffset : width };
}

export interface PendingLine {
  readonly spans: StyleSpanRecord[];
  readonly start: number;
  end: number;
  width: number;
  height: number;
  baseline: number;
  /** When true, layout must start a new page after this line is placed. */
  pageBreakAfter?: boolean;
}

/**
 * A cached line, safe to hand back on every later hit.
 *
 * Placement copies span boxes rather than mutating them, but a cache entry outlives the
 * layout that produced it — freezing means a future change to the placement path cannot
 * quietly corrupt every subsequent reuse.
 */
export function frozenLine(line: PendingLine): PendingLine {
  return Object.freeze({
    spans: line.spans.map((span) =>
      Object.freeze({ ...span, box: Object.freeze({ ...span.box }) })
    ),
    start: line.start,
    end: line.end,
    width: line.width,
    height: line.height,
    baseline: line.baseline,
    ...(line.pageBreakAfter ? { pageBreakAfter: true } : {}),
  }) as PendingLine;
}

export function paragraphIndent(props: readonly OoxmlProperty[]): {
  left: number;
  right: number;
} {
  let left = 0;
  let right = 0;
  for (const property of props) {
    if (property.localName !== 'ind') continue;
    const rawLeft = property.attributes?.left ?? property.attributes?.start;
    const rawRight = property.attributes?.right ?? property.attributes?.end;
    if (rawLeft && /^-?\d+$/.test(rawLeft)) left = Number(rawLeft) / 20;
    if (rawRight && /^-?\d+$/.test(rawRight)) right = Number(rawRight) / 20;
  }
  return { left, right };
}

/** Horizontal alignment of a paragraph (`w:jc`, ECMA-376 §17.3.1.13). */
export type Alignment = 'left' | 'center' | 'right' | 'both';

export function paragraphAlignment(props: readonly OoxmlProperty[]): Alignment {
  let alignment: Alignment = 'left';
  for (const property of props) {
    if (property.localName !== 'jc') continue;
    switch (property.attributes?.val) {
      // `start`/`end` are the direction-relative spellings; this lane is left-to-right only,
      // so they resolve to left/right rather than being ignored as unknown.
      case 'center':
        alignment = 'center';
        break;
      case 'right':
      case 'end':
        alignment = 'right';
        break;
      case 'both':
      case 'distribute':
        alignment = 'both';
        break;
      default:
        alignment = 'left';
    }
  }
  return alignment;
}

/**
 * Shift a line's spans to satisfy the paragraph alignment.
 *
 * Layout is the only geometry authority, so alignment has to move the published span boxes
 * rather than being left to CSS: the painter positions each span absolutely, and hit testing
 * and the caret read the same boxes. Delegating this to `text-align` would put the caret
 * where no glyph is.
 */
export function alignSpans(
  spans: readonly StyleSpanRecord[],
  measurer: TextMeasurer,
  indentLeft: number,
  available: number,
  alignment: Alignment,
  isLastLine: boolean
): readonly StyleSpanRecord[] {
  if (spans.length === 0 || alignment === 'left') return spans;

  // Trailing whitespace hangs into the margin rather than pushing the text off-centre, which
  // is what Word does and what stops a line ending in a space from looking misaligned.
  const last = spans[spans.length - 1]!;
  const visible = last.text.replace(/\s+$/, '');
  const trailing =
    visible === last.text ? 0 : last.box.width - measurer.measure(visible, last.style);
  const used = last.box.x - indentLeft + last.box.width - trailing;
  const slack = available - used;
  if (slack <= 0) return spans;

  // The last line of a justified paragraph is set flush left, never stretched.
  if (alignment === 'both') {
    const gaps = spans.length - 1;
    if (isLastLine || gaps <= 0) return spans;
    const step = slack / gaps;
    return spans.map((span, index) =>
      index === 0 ? span : { ...span, box: { ...span.box, x: span.box.x + step * index } }
    );
  }

  const offset = alignment === 'center' ? slack / 2 : slack;
  return spans.map((span) => ({ ...span, box: { ...span.box, x: span.box.x + offset } }));
}

/**
 * Measure and break one paragraph into pending lines at `available` width.
 *
 * Verbatim behaviour of the pre-extraction main-loop body: cache hit short-circuits the
 * measurement entirely; a miss measures pieces, breaks greedily at word boundaries, and
 * stores the frozen result under `cacheKey`. Span x offsets are relative to the paragraph
 * origin (`indentLeft` from the paragraph's own properties), never to the page.
 */
export function breakParagraph(
  paragraph: OoxmlNode,
  paragraphId: string,
  indentLeft: number,
  available: number,
  measurer: TextMeasurer,
  cache: ParagraphLayoutCache<readonly PendingLine[]> | undefined,
  cacheKey: string | null,
  inheritedRunProperties: readonly OoxmlProperty[] = [],
  tabStops: ResolvedTabStops = EMPTY_TAB_STOPS,
  pageContext?: FieldPageContext,
  cascadeRuns?: RunPropertyCascader,
  flow?: ParagraphFlowOptions
): readonly PendingLine[] {
  const cached = cacheKey !== null && cache ? cache.get(cacheKey) : undefined;
  if (cached) return cached;

  const lineSpacing = flow?.lineSpacing ?? SINGLE_LINE_SPACING;
  // The first line starts `firstLineOffset` from the paragraph's left indent — right for
  // `w:firstLine`, left (negative) for `w:hanging`. Every later line starts at the indent.
  const firstLineOffset = flow?.firstLineOffset ?? 0;

  const pieces = piecesOfParagraph(paragraph, inheritedRunProperties, pageContext, cascadeRuns);
  const emptyStyle =
    inheritedRunProperties.length === 0
      ? DEFAULT_RUN_STYLE
      : resolveRunStyle(inheritedRunProperties);
  const rightEdge = indentLeft + available;
  const lines: PendingLine[] = [];
  let line: PendingLine = { spans: [], start: 0, end: 0, width: 0, height: 0, baseline: 0 };

  // Where the line being built starts, and how much room it has. Only the first differs.
  const lineOffset = (): number => (lines.length === 0 ? firstLineOffset : 0);
  const lineOrigin = (): number => indentLeft + lineOffset();
  const lineAvailable = (): number => Math.max(1, available - lineOffset());

  const closeLine = (): void => {
    const metrics = measurer.lineMetrics(emptyStyle);
    if (line.height === 0) {
      line.height = metrics.height;
      line.baseline = metrics.baseline;
    }
    // Line spacing applies to the finished box, once, so a paragraph's rule governs every
    // line it produced regardless of which run happened to be tallest.
    const spaced = applyLineSpacing(lineSpacing, line.height, line.baseline);
    line.height = spaced.height;
    line.baseline = spaced.baseline;
    lines.push(line);
    line = {
      spans: [],
      start: line.end,
      end: line.end,
      width: 0,
      height: 0,
      baseline: 0,
    };
  };

  for (let pieceIndex = 0; pieceIndex < pieces.length; pieceIndex += 1) {
    const piece = pieces[pieceIndex]!;
    if (piece.text === PAGE_BREAK_CHAR) {
      const breakMetrics = measurer.lineMetrics(piece.style);
      line.spans.push({
        range: { paragraphId, start: piece.start, end: piece.end },
        text: PAGE_BREAK_CHAR,
        props: piece.props,
        style: piece.style,
        box: { x: lineOrigin() + line.width, y: 0, width: 0, height: breakMetrics.height },
      });
      line.height = Math.max(line.height, breakMetrics.height);
      line.baseline = Math.max(line.baseline, breakMetrics.baseline);
      line.end = piece.end;
      closeLine();
      lines[lines.length - 1]!.pageBreakAfter = true;
      continue;
    }
    if (piece.text === '\n') {
      // A hard break ends the line without ending the paragraph — and it OCCUPIES a model
      // offset. Emitting no span for it meant the text reconstructed from the records was
      // shorter than the model: Select All stopped short and left residue, a copied break
      // came back as a space, and Delete before a trailing break merged the next paragraph
      // instead of removing the break. A zero-width span keeps the two in step.
      const breakMetrics = measurer.lineMetrics(piece.style);
      line.spans.push({
        range: { paragraphId, start: piece.start, end: piece.end },
        text: '\n',
        props: piece.props,
        style: piece.style,
        box: { x: lineOrigin() + line.width, y: 0, width: 0, height: breakMetrics.height },
      });
      line.height = Math.max(line.height, breakMetrics.height);
      line.baseline = Math.max(line.baseline, breakMetrics.baseline);
      line.end = piece.end;
      closeLine();
      continue;
    }
    const metrics = measurer.lineMetrics(piece.style);
    let consumed = 0;
    for (const boundary of wordBoundaries(piece.text)) {
      const candidate = piece.text.slice(consumed, boundary);
      if (candidate.length === 0) continue;
      // Projected PAGE/NUMPAGES digits publish the suppressed cached-result model range (or a
      // zero-width insertion point when the cache was empty) so surrounding source offsets
      // stay aligned with binding / paragraphTextOf.
      const spanRange = piece.projected
        ? { paragraphId, start: piece.start, end: piece.end }
        : { paragraphId, start: piece.start + consumed, end: piece.start + boundary };

      if (candidate === '\t') {
        // A tab that cannot advance on this line wraps first, then reapplies — matching
        // Word's "tab past the right margin starts a new line" behaviour.
        if (line.spans.length > 0 && line.width >= lineAvailable()) closeLine();
        const currentX = lineOrigin() + line.width;
        const segment = measureFollowingTabSegment(pieces, pieceIndex, boundary, measurer);
        const destination = nextTabDestination(tabStops, currentX, rightEdge);
        const width = tabAdvanceWidth(
          destination.alignment,
          currentX,
          destination.positionPt,
          segment.width,
          segment.decimalOffset
        );
        line.spans.push({
          range: spanRange,
          text: '\t',
          props: piece.props,
          style: piece.style,
          box: { x: currentX, y: 0, width, height: metrics.height },
          // The leader belongs to the stop that was REACHED, so it is resolved here with the
          // destination rather than re-derived from the paragraph at paint time.
          ...(destination.leader ? { tabLeader: destination.leader } : {}),
        });
        line.width += width;
        line.height = Math.max(line.height, metrics.height);
        line.baseline = Math.max(line.baseline, metrics.baseline);
        line.end = piece.projected ? piece.end : piece.start + boundary;
        consumed = boundary;
        continue;
      }

      // Measured as DRAWN: `w:caps` changes the glyphs, so measuring the source text
      // would size the line for characters the reader never sees.
      const width = measurer.measure(displayText(candidate, piece.style), piece.style);
      if (line.width + width > lineAvailable() && line.spans.length > 0) closeLine();
      line.spans.push({
        range: spanRange,
        text: candidate,
        props: piece.props,
        style: piece.style,
        box: { x: lineOrigin() + line.width, y: 0, width, height: metrics.height },
      });
      line.width += width;
      line.height = Math.max(line.height, metrics.height);
      line.baseline = Math.max(line.baseline, metrics.baseline);
      line.end = piece.projected ? piece.end : piece.start + boundary;
      consumed = boundary;
    }
  }
  // An empty paragraph still occupies one line, or it would have no caret target.
  if (line.spans.length > 0 || lines.length === 0) closeLine();
  if (cacheKey !== null && cache) cache.set(cacheKey, lines.map(frozenLine));
  return lines;
}
