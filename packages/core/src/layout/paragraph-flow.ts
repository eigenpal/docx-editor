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
  type FieldAwarePiece,
  type FieldPageContext,
  type PositionalTab,
  type HyperlinkProjector,
  type ModelRange,
  type RunPropertyCascader,
} from './field-projection.ts';
import {
  DEFAULT_REVISION_DISPLAY_MODE,
  type RevisionAttribution,
  type RevisionDisplayMode,
} from './revision-projection.ts';
import type { ParagraphLayoutCache } from './layout-cache.ts';
import {
  EMPTY_TAB_STOPS,
  nextTabDestination,
  tabAdvanceWidth,
  TAB_LEADER_GLYPH,
  type ResolvedTabStops,
  type TabLeader,
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
import type { LayoutBox, StyleSpanRecord, TextMeasurer } from './semantic-records.ts';
import {
  buildInlineDrawingRecord,
  inlineDrawingVerticalLayout,
  measureInlineDrawing,
  repositionInlineDrawingsForBaseline,
  shiftInlineDrawingRecord,
  anchoredDrawingAtomsInParagraph,
  drawingModelOffsetsInParagraph,
  type InlineDrawingLayoutContext,
  type InlineDrawingRecord,
} from './drawing-layout.ts';
import {
  mergeAvailableIntervalsAtY,
  remainingWidthAtX,
  snapXToAvailableInterval,
  synthesizeParagraphTopAndBottomZones,
  synthesizeParagraphWrapExclusionZones,
  topAndBottomSkipBeforeLine,
  type ExclusionZone,
} from './drawing-exclusion.ts';

/**
 * How far past the line's right edge a span may reach before it counts as overflow.
 *
 * A right/centre/decimal tab computes its advance in ABSOLUTE x — `destination - currentX -
 * segmentWidth` — while wrapping is decided in line-local width. Converting between the two
 * subtracts and re-adds the paragraph origin, so a segment the tab placed to end EXACTLY at
 * the edge lands a fraction of an ulp beyond it. Without a tolerance that hairline decides a
 * line break, and a right-aligned tab is built to reach the edge exactly. A thousandth of a
 * point is far below one device pixel, so nothing a reader could see wraps because of this.
 */
const OVERFLOW_TOLERANCE_PT = 0.001;

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
  /** Re-break only the unplaced suffix when an unequal-width column follows. */
  readonly startOffset?: number;
  /**
   * The containing text column — the page content box, or a table cell's — in the same
   * coordinates as `indentLeft`.
   *
   * `w:ptab/@w:relativeTo="margin"` measures against THIS, not against the paragraph's own
   * indented column: a contents line inside an indented paragraph still puts its page
   * number at the margin. Absent, a positional tab falls back to the paragraph's column,
   * which is the same answer whenever the paragraph carries no indents.
   */
  readonly marginExtent?: { readonly left: number; readonly right: number };
  /**
   * Turns a typed `w:hyperlink` into the sanitized record its spans carry.
   *
   * Supplied by the document layout, which is the level that can see the package's
   * relationships. Absent means link runs still measure and paint — they simply carry no
   * link, which is what a table-cell or furniture pass without a resolver gets.
   */
  readonly projectLink?: HyperlinkProjector;
  /**
   * Which revisions this break resolves away.
   *
   * A different mode is a different break — the proposed result drops deleted text, so lines
   * wrap elsewhere — so it belongs in the caller's cache key alongside line spacing.
   */
  readonly displayMode?: RevisionDisplayMode;
  /** Derived footnote/endnote marks for noteReference / noteRef projection. */
  readonly noteMarks?: import('./note-projection.ts').NoteMarkContext;
  /** Inline drawing projection + resource lookup for typed `w:drawing` nodes. */
  readonly inlineDrawingLayout?: InlineDrawingLayoutContext;
  /**
   * Left edge of the containing text column in paragraph-relative coordinates, for clipping
   * oversized inline extents at the content box without scaling them.
   */
  readonly contentLeft?: number;
  /** Right edge of the containing text column in paragraph-relative coordinates. */
  readonly contentRight?: number;
  /**
   * Horizontal origin of the active column within page-content coordinates.
   * Line x offsets are column-local; exclusion zones are page-wide.
   */
  readonly contentOriginX?: number;
  /** Page-content Y where this paragraph starts — for anchored wrap exclusion at break time. */
  readonly paragraphStartY?: number;
  /** Active exclusion zones on the current page while breaking. */
  readonly pageExclusionZones?: readonly ExclusionZone[];
  /** When breaking inside a table cell, the cell content box for anchored frame resolution. */
  readonly anchorCellBox?: LayoutBox | null;
  /**
   * Cross-paragraph TOC field begin/end paragraphs carry only `w:fldChar` / `w:instrText`
   * chrome with no measurable text. When set, an otherwise empty break returns no lines so
   * layout does not reserve the caret placeholder row ordinary empty paragraphs need.
   */
  readonly suppressEmptyPlaceholderLine?: boolean;
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
  /** When set, measure this instead of `text` (note-mark width reservation). */
  readonly measureText?: string;
  /** Note citation / mark navigation for paint. */
  readonly noteNav?: {
    readonly scopeId: string;
    readonly direction: 'to-note' | 'to-body';
  };
  /** Zero-width `w:ptab` destination metadata. */
  readonly positionalTab?: PositionalTab;
  readonly breakKind?: FieldAwarePiece['breakKind'];
  /** Sanitized hyperlink this piece belongs to. */
  readonly link?: import('./semantic-records.ts').SpanLinkRecord;
  /** Typed inline drawing occupying one UTF-16 model unit. */
  readonly inlineDrawing?: import('./drawing-layout.ts').InlineDrawingLayoutInput;
}

export function propertiesOf(container: OoxmlNode | undefined): OoxmlProperty[] {
  return propertiesOfRunContainer(container);
}

/**
 * Dashes a line may break AFTER, the way Word wraps "ALPHA-PRIME" as "ALPHA-" / "PRIME":
 * hyphen-minus, hyphen, en dash, em dash. U+2011 NON-BREAKING HYPHEN is deliberately
 * absent — its whole meaning is "no wrap here".
 */
const BREAK_AFTER_DASH = new Set(['-', '‐', '–', '—']);

/**
 * Break points inside a piece: after each run of spaces (words stay whole), after a dash
 * that sits between non-space text, and with each tab as its own atom so tab-stop
 * geometry can size `\t` independently of neighbouring text.
 *
 * A dash run breaks only after its LAST dash, mirroring how a run of spaces is one
 * boundary; a dash beside a space adds nothing the space boundary does not already give.
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
    } else if (
      BREAK_AFTER_DASH.has(ch) &&
      index > 0 &&
      text[index - 1] !== ' ' &&
      index + 1 < text.length &&
      text[index + 1] !== ' ' &&
      !BREAK_AFTER_DASH.has(text[index + 1]!)
    ) {
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

/**
 * Where a `w:ptab` sends the caret, in the same shape `nextTabDestination` answers with.
 *
 * ECMA-376 §17.3.3.16: the position is stated by `w:alignment` against the reference
 * `w:relativeTo` names, rather than looked up in `w:tabs`.
 *
 * ONLY `w:alignment` is honoured here; the reference is always the paragraph's own text
 * column (`indentLeft`..`rightEdge`), which is what `w:relativeTo="margin"` — the value
 * every contents field Word generates carries — means. `indent` differs from it only for
 * an indented paragraph and `leftMargin` only for a ptab pointing backwards, both of which
 * the clamp in `tabAdvanceWidth` already resolves to no advance. `positionalTabOf` still
 * validates the attribute so a hostile value cannot reach geometry if that changes.
 */
function positionalTabDestination(
  positional: PositionalTab,
  indentLeft: number,
  rightEdge: number,
  marginExtent: { readonly left: number; readonly right: number } | undefined
): { positionPt: number; alignment: 'left' | 'center' | 'right' | 'decimal'; leader?: TabLeader } {
  // `indent` measures against the paragraph's own column; `margin` and `leftMargin` against
  // the containing one. They differ exactly when the paragraph is indented — which is where
  // reading `w:relativeTo` and then ignoring it put the page number short of the margin by
  // the width of the indent.
  const column =
    positional.relativeTo === 'indent' || !marginExtent
      ? { left: indentLeft, right: rightEdge }
      : marginExtent;
  const positionPt =
    positional.alignment === 'right'
      ? column.right
      : positional.alignment === 'center'
        ? (column.left + column.right) / 2
        : column.left;
  return {
    positionPt,
    alignment: positional.alignment,
    ...(positional.leader ? { leader: positional.leader } : {}),
  };
}

export interface PendingLine {
  readonly spans: StyleSpanRecord[];
  readonly drawings: InlineDrawingRecord[];
  readonly start: number;
  end: number;
  width: number;
  height: number;
  baseline: number;
  /**
   * How much of {@link height} is line-spacing leading rather than glyphs.
   *
   * PUBLISHED, not re-derived. `applyLineSpacing` decides where the leading goes, and the
   * whole of it sits ABOVE the text, which is what moves `baseline` down. Paint used to
   * recover this by subtracting the tallest span height from the line box — an identity
   * that only holds while the spacing rule is the multiplying one, and that is already
   * false for an `exact` box clipped below its glyphs. Every consumer reads the one number
   * the spacing rule produced instead of guessing at it from the box.
   */
  leading: number;
  /** When true, layout must start a new page after this line is placed. */
  pageBreakAfter?: boolean;
  /** When true, layout must advance to the next authored section column. */
  columnBreakAfter?: boolean;
  /** Model ranges on this line covering deleted content; see {@link LineRecord.deletedRanges}. */
  deletedRanges?: readonly ModelRange[];
  /** Vertical gap inserted before this line to clear a topAndBottom exclusion band. */
  exclusionSkipBefore?: number;
}

/** Vertical extent of a pending line for flow/pagination budget checks (skip + box + optional tail). */
export function pendingLineFlowExtent(
  line: Pick<PendingLine, 'height' | 'exclusionSkipBefore'>,
  tail = 0
): number {
  return (line.exclusionSkipBefore ?? 0) + line.height + tail;
}

/** Recompute topAndBottom skip at placement time from live page zones and absolute line top. */
export function pendingLineFlowExtentAtPlacement(
  lineTopY: number,
  line: Pick<PendingLine, 'height' | 'exclusionSkipBefore'>,
  zones: readonly ExclusionZone[],
  tail = 0
): number {
  const skip =
    zones.length > 0
      ? topAndBottomSkipBeforeLine(lineTopY, line.height, zones)
      : (line.exclusionSkipBefore ?? 0);
  return skip + line.height + tail;
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
    drawings: line.drawings.map((drawing) =>
      Object.freeze({
        ...drawing,
        paintBounds: Object.freeze({ ...drawing.paintBounds }),
        hitBounds: Object.freeze({ ...drawing.hitBounds }),
      })
    ),
    start: line.start,
    end: line.end,
    width: line.width,
    height: line.height,
    baseline: line.baseline,
    leading: line.leading,
    ...(line.pageBreakAfter ? { pageBreakAfter: true } : {}),
    ...(line.columnBreakAfter ? { columnBreakAfter: true } : {}),
    ...(line.deletedRanges ? { deletedRanges: Object.freeze(line.deletedRanges) } : {}),
    ...(line.exclusionSkipBefore ? { exclusionSkipBefore: line.exclusionSkipBefore } : {}),
  }) as PendingLine;
}

/**
 * Soft ceiling on an indent, in twips (31_680 ≈ 22"), matching the paragraph-spacing and
 * tab-position bounds. `w:ind` is attacker-controlled and flows straight into `rightEdge`
 * and the available line width, so an unbounded value reaches paint geometry.
 */
export const MAX_PARAGRAPH_INDENT_TWIPS = 31_680;

export function indentTwips(raw: string | undefined): number | null {
  // Up to 9 digits so an oversized authored value reaches the clamp rather than being read
  // as a measurement; a longer digit string is garbage, and `Number` turns enough of them
  // into `Infinity`, which then poisons every width derived from it.
  if (raw === undefined || !/^-?\d{1,9}$/.test(raw)) return null;
  const twips = Number(raw);
  if (!Number.isFinite(twips)) return null;
  if (twips > MAX_PARAGRAPH_INDENT_TWIPS) return MAX_PARAGRAPH_INDENT_TWIPS;
  if (twips < -MAX_PARAGRAPH_INDENT_TWIPS) return -MAX_PARAGRAPH_INDENT_TWIPS;
  return twips;
}

export function paragraphIndent(props: readonly OoxmlProperty[]): {
  left: number;
  right: number;
} {
  let left = 0;
  let right = 0;
  for (const property of props) {
    if (property.localName !== 'ind') continue;
    // `w:start`/`w:end` are the ISO 29500 Strict spellings of `w:left`/`w:right`; the
    // physical name wins where a producer writes both.
    const rawLeft = property.attributes?.left ?? property.attributes?.start;
    const rawRight = property.attributes?.right ?? property.attributes?.end;
    const twipsLeft = indentTwips(rawLeft);
    const twipsRight = indentTwips(rawRight);
    if (twipsLeft !== null) left = twipsLeft / 20;
    if (twipsRight !== null) right = twipsRight / 20;
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
 * True when this span's trailing U+0020 is an inter-word slot Word can stretch.
 *
 * Paint reapplies justification as CSS `word-spacing` on those same spaces. Inserting layout
 * slack at every style-span boundary (tabs, run splits mid-phrase) put gaps where paint has
 * none and shifted every later span — caret mid-word drifted by a multiple of the step while
 * the highlight (DOM) stayed on the glyphs.
 */
function endsWithExpandableSpace(text: string): boolean {
  return text.endsWith(' ');
}

/**
 * Per-UTF-16 caret edges from the span origin, matching {@link TextMeasurer.measure} prefixes.
 *
 * Tabs and non-1:1 projections collapse to the published box endpoints — measuring `\t` or
 * projected ink would disagree with breakParagraph's reserved advance.
 */
function caretEdgesForSpan(span: StyleSpanRecord, measurer: TextMeasurer): readonly number[] {
  const length = span.range.end - span.range.start;
  if (length <= 0 || span.text === '\t' || span.projected || span.text.length !== length) {
    return Object.freeze([0, span.box.width]);
  }
  const edges: number[] = [0];
  for (let index = 1; index <= span.text.length; index += 1) {
    edges.push(measurer.measure(span.text.slice(0, index), span.style));
  }
  return Object.freeze(edges);
}

function withCaretEdges(
  spans: readonly StyleSpanRecord[],
  measurer: TextMeasurer
): readonly StyleSpanRecord[] {
  return spans.map((span) =>
    span.caretEdges ? span : { ...span, caretEdges: caretEdgesForSpan(span, measurer) }
  );
}

/**
 * Shift a line's spans to satisfy the paragraph alignment.
 *
 * Layout is the only geometry authority: hit testing and the caret read published span boxes
 * (and {@link StyleSpanRecord.caretEdges}). Paint starts the line at the first span's x and
 * flows inline — justification slack must therefore land on the same inter-word spaces
 * `word-spacing` expands, not on every style-span boundary.
 */
export function alignSpans(
  spans: readonly StyleSpanRecord[],
  measurer: TextMeasurer,
  indentLeft: number,
  available: number,
  alignment: Alignment,
  isLastLine: boolean,
  lineUsedWidth?: number
): readonly StyleSpanRecord[] {
  if (spans.length === 0) return spans;
  if (alignment === 'left') return withCaretEdges(spans, measurer);

  // Trailing whitespace hangs into the margin rather than pushing the text off-centre, which
  // is what Word does and what stops a line ending in a space from looking misaligned.
  const last = spans[spans.length - 1]!;
  const visible = last.text.replace(/\s+$/, '');
  const trailing =
    visible === last.text ? 0 : last.box.width - measurer.measure(visible, last.style);
  const used = lineUsedWidth ?? last.box.x - indentLeft + last.box.width - trailing;
  const slack = available - used;
  if (slack <= 0) return withCaretEdges(spans, measurer);

  // The last line of a justified paragraph is set flush left, never stretched.
  if (alignment === 'both') {
    if (isLastLine) return withCaretEdges(spans, measurer);
    // Only boundaries after an expandable space receive slack — the same slots paint stretches
    // with `word-spacing`. A uniform step across every span pair invented gaps before tabs and
    // run splits and drifted every later caret by N×step.
    const gapBefore: number[] = [];
    for (let index = 1; index < spans.length; index += 1) {
      if (endsWithExpandableSpace(spans[index - 1]!.text)) gapBefore.push(index);
    }
    if (gapBefore.length === 0) return withCaretEdges(spans, measurer);
    const step = slack / gapBefore.length;
    const gapSet = new Set(gapBefore);
    let shift = 0;
    return withCaretEdges(
      spans.map((span, index) => {
        if (gapSet.has(index)) shift += step;
        return shift === 0 ? span : { ...span, box: { ...span.box, x: span.box.x + shift } };
      }),
      measurer
    );
  }

  const offset = alignment === 'center' ? slack / 2 : slack;
  return withCaretEdges(
    spans.map((span) => ({ ...span, box: { ...span.box, x: span.box.x + offset } })),
    measurer
  );
}

/** Shift inline drawing boxes for paragraph alignment the same way {@link alignSpans} does. */
export function alignDrawings(
  drawings: readonly InlineDrawingRecord[],
  offset: number
): readonly InlineDrawingRecord[] {
  if (offset === 0 || drawings.length === 0) return drawings;
  return drawings.map((drawing) => shiftInlineDrawingRecord(drawing, offset, 0));
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

  // Model ranges the caret must step over. Collected during the piece walk rather than derived
  // from the emitted spans, because in the proposed result a deletion produces no span at all
  // and its offsets would otherwise look like ordinary empty positions.
  const deletedRanges: { start: number; end: number }[] = [];
  const allPieces = piecesOfParagraph(
    paragraph,
    inheritedRunProperties,
    pageContext,
    cascadeRuns,
    flow?.projectLink,
    flow?.noteMarks,
    flow?.displayMode ?? DEFAULT_REVISION_DISPLAY_MODE,
    deletedRanges,
    flow?.inlineDrawingLayout
  );
  const startOffset = Math.max(0, flow?.startOffset ?? 0);
  const pieces = allPieces.flatMap((piece): FieldAwarePiece[] => {
    if (piece.end <= startOffset) return [];
    if (piece.start >= startOffset) return [piece];
    const trim = startOffset - piece.start;
    return [
      {
        ...piece,
        text: piece.projected ? piece.text : piece.text.slice(trim),
        start: startOffset,
      },
    ];
  });
  if (pieces.length === 0 && flow?.suppressEmptyPlaceholderLine) {
    return [];
  }
  /** Carried onto every span so paint and the review surface read one attribution. */
  const revisionsOf = (piece: FieldAwarePiece): { revisions?: readonly RevisionAttribution[] } =>
    piece.revisions === undefined ? {} : { revisions: piece.revisions };
  const emptyStyle =
    inheritedRunProperties.length === 0
      ? DEFAULT_RUN_STYLE
      : resolveRunStyle(inheritedRunProperties);
  const rightEdge = indentLeft + available;
  const contentLeft = flow?.contentLeft ?? indentLeft;
  const contentRight = flow?.contentRight ?? rightEdge;
  const contentOriginX = flow?.contentOriginX ?? 0;
  const lines: PendingLine[] = [];
  let line: PendingLine = {
    spans: [],
    start: startOffset,
    end: startOffset,
    drawings: [],
    width: 0,
    height: 0,
    baseline: 0,
    leading: 0,
  };
  let topAndBottomSkipApplied = false;
  const anchorLineTopByModelStart = new Map<number, number>();

  const topAndBottomAnchorStarts = (() => {
    const starts = new Set<number>();
    if (!flow?.inlineDrawingLayout) return starts;
    const offsets = drawingModelOffsetsInParagraph(paragraph);
    for (const atom of anchoredDrawingAtomsInParagraph(paragraph, flow.inlineDrawingLayout)) {
      if (atom.projection.wrap !== 'topAndBottom') continue;
      const modelStart = offsets.get(atom.atomId);
      if (modelStart !== undefined) starts.add(modelStart);
    }
    return starts;
  })();

  const wrapAnchorStarts = (() => {
    const starts = new Set<number>();
    if (!flow?.inlineDrawingLayout) return starts;
    const offsets = drawingModelOffsetsInParagraph(paragraph);
    for (const atom of anchoredDrawingAtomsInParagraph(paragraph, flow.inlineDrawingLayout)) {
      if (atom.projection.anchor?.behindDocument) continue;
      if (
        atom.projection.wrap === 'topAndBottom' ||
        atom.projection.wrap === 'inline' ||
        atom.projection.wrap === 'behind' ||
        atom.projection.wrap === 'inFront'
      ) {
        continue;
      }
      const modelStart = offsets.get(atom.atomId);
      if (modelStart !== undefined) starts.add(modelStart);
    }
    return starts;
  })();

  const sameParagraphAnchorStarts = [
    ...(flow?.pageExclusionZones ?? [])
      .filter((zone) => zone.anchorParagraphId === paragraphId)
      .map((zone) => zone.anchorModelStart),
    ...topAndBottomAnchorStarts,
    ...wrapAnchorStarts,
  ];

  const anchorLineStartByOffset = (() => {
    const out = new Map<number, number>();
    if (sameParagraphAnchorStarts.length === 0) return out;
    let probeLineStart = 0;
    let probeWidth = 0;
    let probeLineIndex = 0;
    const probeLineOffset = (): number => (probeLineIndex === 0 ? firstLineOffset : 0);
    const probeLineAvail = (): number => Math.max(1, available - probeLineOffset());
    const closeProbeLine = (nextStart: number): void => {
      probeLineStart = nextStart;
      probeWidth = 0;
      probeLineIndex += 1;
    };
    for (const piece of pieces) {
      if (piece.inlineDrawing) {
        const width = measureInlineDrawing(piece.inlineDrawing.projection).totalWidth;
        if (probeWidth > 0 && probeWidth + width > probeLineAvail()) closeProbeLine(piece.start);
        if (sameParagraphAnchorStarts.includes(piece.start)) out.set(piece.start, probeLineStart);
        probeWidth += width;
        continue;
      }
      if (piece.text === '\n' || piece.text === PAGE_BREAK_CHAR) {
        closeProbeLine(piece.end);
        continue;
      }
      let consumed = 0;
      for (const boundary of wordBoundaries(piece.text)) {
        const candidate = piece.text.slice(consumed, boundary);
        if (candidate.length === 0) continue;
        const style = piece.style;
        const width = measurer.measure(candidate, style);
        const modelStart = piece.start + consumed;
        if (probeWidth > 0 && probeWidth + width > probeLineAvail()) closeProbeLine(modelStart);
        if (sameParagraphAnchorStarts.includes(modelStart)) out.set(modelStart, probeLineStart);
        if (sameParagraphAnchorStarts.includes(piece.start)) out.set(piece.start, probeLineStart);
        probeWidth += width;
        consumed = boundary;
      }
    }
    for (const anchorStart of sameParagraphAnchorStarts) {
      if (!out.has(anchorStart)) out.set(anchorStart, probeLineStart);
    }
    return out;
  })();

  for (const start of wrapAnchorStarts) {
    const lineStart = anchorLineStartByOffset.get(start);
    if (lineStart !== undefined) anchorLineTopByModelStart.set(start, lineStart);
  }

  const zoneApplies = (zone: ExclusionZone): boolean => {
    if (zone.anchorParagraphId !== paragraphId) return true;
    const anchorLineStart = anchorLineStartByOffset.get(zone.anchorModelStart);
    if (anchorLineStart !== undefined && line.start >= anchorLineStart) return true;
    if (line.end >= zone.anchorModelStart) return true;
    return false;
  };

  const activeExclusionZones = (): readonly ExclusionZone[] => {
    const pageZones =
      flow?.pageExclusionZones?.filter((zone) => {
        if (!zoneApplies(zone)) return false;
        // Anchor paragraph uses break-time synthesis; page zones are for inherited bands only.
        if (zone.anchorParagraphId === paragraphId) {
          if (zone.input.mode === 'topAndBottom') return false;
          if (flow?.anchorCellBox != null) return false;
        }
        return true;
      }) ?? [];
    const synthesizedWrap =
      flow?.inlineDrawingLayout && flow.anchorCellBox != null && anchorLineTopByModelStart.size > 0
        ? synthesizeParagraphWrapExclusionZones({
            paragraph,
            paragraphId,
            drawingLayout: flow.inlineDrawingLayout,
            contentLeft,
            contentRight,
            paragraphStartY: flow.paragraphStartY ?? 0,
            anchorLineTopByModelStart,
            anchorCellBox: flow.anchorCellBox,
          })
        : Object.freeze([]);
    const synthesized =
      flow?.inlineDrawingLayout && anchorLineTopByModelStart.size > 0
        ? synthesizeParagraphTopAndBottomZones({
            paragraph,
            paragraphId,
            drawingLayout: flow.inlineDrawingLayout,
            contentLeft,
            contentRight,
            paragraphStartY: flow?.paragraphStartY ?? 0,
            anchorLineTopByModelStart,
          })
        : Object.freeze([]);
    return Object.freeze([...pageZones, ...synthesizedWrap, ...synthesized]);
  };

  // Where the line being built starts, and how much room it has. Only the first differs.
  const lineOffset = (): number => (lines.length === 0 ? firstLineOffset : 0);
  const lineOrigin = (): number => contentOriginX + indentLeft + lineOffset();
  const baseLineAvailable = (): number => Math.max(1, available - lineOffset());

  const priorLineExtent = (): number =>
    lines.reduce((sum, prior) => sum + prior.height + (prior.exclusionSkipBefore ?? 0), 0);

  const currentLineTopY = (): number => (flow?.paragraphStartY ?? 0) + priorLineExtent();

  const recordTopAndBottomAnchorLineTop = (modelStart: number): void => {
    if (topAndBottomAnchorStarts.has(modelStart)) {
      anchorLineTopByModelStart.set(modelStart, priorLineExtent());
    }
  };

  const applyTopAndBottomSkipIfNeeded = (): void => {
    if (topAndBottomSkipApplied) return;
    const zones = activeExclusionZones();
    if (zones.length === 0) return;
    if (line.spans.length > 0 || line.drawings.length > 0) return;
    const metrics = measurer.lineMetrics(emptyStyle);
    const skip = topAndBottomSkipBeforeLine(
      currentLineTopY(),
      line.height > 0 ? line.height : metrics.height,
      zones
    );
    if (skip > 0.001) {
      topAndBottomSkipApplied = true;
      line.exclusionSkipBefore = skip;
    }
  };

  const exclusionProbeY = (): number => currentLineTopY() + 0.001;

  const snapLineToAvailableInterval = (): boolean => {
    const zones = activeExclusionZones();
    if (zones.length === 0) return true;
    applyTopAndBottomSkipIfNeeded();
    const intervals = mergeAvailableIntervalsAtY(
      exclusionProbeY(),
      zones,
      contentLeft,
      contentRight
    );
    const currentX = lineOrigin() + line.width;
    const snap = snapXToAvailableInterval(currentX, intervals);
    if (!snap) return false;
    if (snap.x > currentX + 0.001) {
      line.width = snap.x - lineOrigin();
    }
    return true;
  };

  const lineAvailable = (): number => {
    const base = baseLineAvailable();
    const zones = activeExclusionZones();
    if (zones.length === 0) return base;
    applyTopAndBottomSkipIfNeeded();
    if (!snapLineToAvailableInterval()) return 0;
    const intervals = mergeAvailableIntervalsAtY(
      exclusionProbeY(),
      zones,
      contentLeft,
      contentRight
    );
    const origin = lineOrigin() + line.width;
    const remaining = remainingWidthAtX(origin, intervals);
    if (remaining <= 0.001) return 0;
    return Math.min(base, remaining);
  };

  const tryAdvanceToNextPassage = (): boolean => {
    const zones = activeExclusionZones();
    if (zones.length === 0) return false;
    const pastAnchorOnLine = zones.some(
      (zone) => zone.anchorParagraphId === paragraphId && line.end > zone.anchorModelStart
    );
    if (!pastAnchorOnLine) return false;
    const intervals = mergeAvailableIntervalsAtY(
      exclusionProbeY(),
      zones,
      contentLeft,
      contentRight
    );
    const currentX = lineOrigin() + line.width;
    let foundCurrent = false;
    for (const interval of intervals) {
      if (!foundCurrent) {
        if (currentX >= interval.start - 0.000_001 && currentX < interval.end - 0.000_001) {
          foundCurrent = true;
        }
        continue;
      }
      if (interval.end - interval.start > 0.001) {
        line.width = interval.start - lineOrigin();
        return true;
      }
    }
    return false;
  };

  const advancePastAnchorExclusionForPlacement = (modelStart: number): void => {
    if (
      sameParagraphAnchorStarts.length === 0 ||
      modelStart < Math.min(...sameParagraphAnchorStarts)
    ) {
      return;
    }
    const zones = activeExclusionZones().filter(
      (zone) => zone.anchorParagraphId === paragraphId && modelStart >= zone.anchorModelStart
    );
    if (zones.length === 0) return;
    applyTopAndBottomSkipIfNeeded();
    const intervals = mergeAvailableIntervalsAtY(
      exclusionProbeY(),
      zones,
      contentLeft,
      contentRight
    );
    const currentX = lineOrigin() + line.width;
    let containingIndex = -1;
    for (let index = 0; index < intervals.length; index += 1) {
      const interval = intervals[index]!;
      if (currentX >= interval.start - 0.001 && currentX < interval.end - 0.001) {
        containingIndex = index;
        break;
      }
    }
    if (containingIndex >= 0 && containingIndex + 1 < intervals.length) {
      const next = intervals[containingIndex + 1]!;
      line.width = next.start - lineOrigin();
      return;
    }
    if (containingIndex >= 0) return;
    const snap = snapXToAvailableInterval(currentX, intervals);
    if (snap && snap.x > currentX + 0.001) {
      line.width = snap.x - lineOrigin();
    }
  };

  const closeForTopAndBottomAfterAnchor = (modelStart: number): void => {
    const zones = activeExclusionZones().filter(
      (zone) =>
        zone.input.mode === 'topAndBottom' &&
        zone.anchorParagraphId === paragraphId &&
        modelStart >= zone.anchorModelStart
    );
    if (zones.length === 0) return;
    if (line.spans.length > 0 || line.drawings.length > 0) closeLine();
    applyTopAndBottomSkipIfNeeded();
  };

  const ensurePlacementWidth = (width: number, depth = 0): boolean => {
    if (depth > 64) return lineAvailable() >= width;
    applyTopAndBottomSkipIfNeeded();
    if (!snapLineToAvailableInterval()) {
      if (line.spans.length > 0 || line.drawings.length > 0) {
        closeLine();
        return ensurePlacementWidth(width, depth + 1);
      }
      return true;
    }
    if (width <= lineAvailable() + 0.001) return true;
    if (line.spans.length > 0 || line.drawings.length > 0) {
      if (tryAdvanceToNextPassage() && width <= lineAvailable() + 0.001) return true;
      closeLine();
      return ensurePlacementWidth(width, depth + 1);
    }
    // Empty line still too narrow — place anyway (overflow) rather than stacking blank lines.
    return true;
  };

  /** The deleted ranges overlapping one line, clipped to it. */
  const deletedWithin = (start: number, end: number): ModelRange[] =>
    deletedRanges
      .filter((range) => range.start < end && range.end > start)
      .map((range) => ({ start: Math.max(range.start, start), end: Math.min(range.end, end) }));

  /**
   * Where the word currently being placed started on this line.
   *
   * A word can span RUNS — `<w:del>which</w:del><w:ins>that</w:ins>` is one word, so is
   * `<w:r><w:b/>un</w:r><w:r>breakable</w:r>` — and a run boundary is not a break opportunity.
   * Breaking there put half a word at the end of one line and half at the start of the next,
   * which no word processor does and which changed where every following line broke.
   *
   * `-1` means the line has no partial word: the next span may legally start a line.
   */
  let wordStartSpan = -1;
  let wordStartWidth = 0;
  let wordStartEnd = 0;
  /** The last character emitted, which decides whether the NEXT span may open a line. */
  let lastEmitted = '';

  const growLineMetricsForDrawing = (
    style: ResolvedRunStyle,
    measure: ReturnType<typeof measureInlineDrawing>
  ): { extentTopY: number } => {
    const textMetrics = measurer.lineMetrics(style);
    const layout = inlineDrawingVerticalLayout(
      textMetrics.baseline,
      line.height || textMetrics.height,
      measure
    );
    if (line.height === 0) {
      line.height = layout.lineHeight;
      line.baseline = layout.baseline;
    } else if (layout.lineHeight > line.height) {
      line.height = layout.lineHeight;
      line.baseline = Math.max(line.baseline, layout.baseline);
    } else {
      line.baseline = Math.max(line.baseline, layout.baseline);
    }
    return { extentTopY: layout.extentTopY };
  };

  const syncDrawingBaselinesBeforeSpacing = (): void => {
    if (line.drawings.length === 0) return;
    if (line.spans.length === 0) {
      line.baseline = Math.max(
        line.baseline,
        ...line.drawings.map((drawing) => drawing.y + drawing.height)
      );
    }
    const repositioned = repositionInlineDrawingsForBaseline(line.drawings, line.baseline);
    (line.drawings as InlineDrawingRecord[]).splice(0, line.drawings.length, ...repositioned);
    line.baseline = Math.max(
      line.baseline,
      ...line.drawings.map((drawing) => drawing.y + drawing.height)
    );
  };

  const repositionDrawingsToFinalBaseline = (): void => {
    if (line.drawings.length === 0) return;
    const repositioned = repositionInlineDrawingsForBaseline(line.drawings, line.baseline);
    (line.drawings as InlineDrawingRecord[]).splice(0, line.drawings.length, ...repositioned);
  };

  const growLineHeightForDrawingExtent = (): void => {
    if (line.drawings.length === 0) return;
    const drawingExtent = Math.max(
      0,
      ...line.drawings.map((drawing) => drawing.y + drawing.height + drawing.distB)
    );
    line.height = Math.max(line.height, drawingExtent);
  };

  const finalizeDrawingGeometry = (): void => {
    syncDrawingBaselinesBeforeSpacing();
    growLineHeightForDrawingExtent();
  };

  const closeLine = (): void => {
    const metrics = measurer.lineMetrics(emptyStyle);
    if (line.height === 0) {
      line.height = metrics.height;
      line.baseline = metrics.baseline;
    }
    finalizeDrawingGeometry();
    // Line spacing applies to the finished box, once, so a paragraph's rule governs every
    // line it produced regardless of which run happened to be tallest.
    const natural = line.height;
    const spaced = applyLineSpacing(lineSpacing, line.height, line.baseline);
    line.baseline = spaced.baseline;
    // Never negative: an `exact` box clipped below its glyphs adds no leading, it removes
    // box. Paint keys its baseline correction off this, and a negative would push the text
    // the wrong way rather than leaving the clipped line alone.
    line.leading = Math.max(0, spaced.height - natural);
    line.height = spaced.height;
    // Baseline shifts from line spacing must move inline drawings too, or authored distT/distB
    // and the text baseline drift apart. For `exact`, keep the authored box — tall drawings
    // clip/overflow per content-clip policy; auto/atLeast still grow to contain distB.
    repositionDrawingsToFinalBaseline();
    if (lineSpacing.rule !== 'exact') growLineHeightForDrawingExtent();
    const finalizeTopAndBottomClearance = (): void => {
      const zones = activeExclusionZones();
      if (zones.length === 0) return;
      const skip = topAndBottomSkipBeforeLine(currentLineTopY(), line.height, zones);
      if (skip > 0.001) line.exclusionSkipBefore = skip;
      else delete (line as { exclusionSkipBefore?: number }).exclusionSkipBefore;
    };
    finalizeTopAndBottomClearance();
    const deleted = deletedWithin(line.start, line.end);
    if (deleted.length > 0) line.deletedRanges = deleted;
    lines.push(line);
    wordStartSpan = -1;
    wordStartWidth = 0;
    topAndBottomSkipApplied = false;
    line = {
      spans: [],
      drawings: [],
      start: line.end,
      end: line.end,
      width: 0,
      height: 0,
      baseline: 0,
      leading: 0,
    };
    applyTopAndBottomSkipIfNeeded();
  };

  /** Whether the last thing placed was a line break, so the paragraph ends on a fresh line. */
  let trailingLineBreak = false;

  for (let pieceIndex = 0; pieceIndex < pieces.length; pieceIndex += 1) {
    const piece = pieces[pieceIndex]!;
    if (piece.breakKind === 'column') {
      const breakMetrics = measurer.lineMetrics(piece.style);
      line.spans.push({
        range: { paragraphId, start: piece.start, end: piece.end },
        text: piece.text,
        props: piece.props,
        style: piece.style,
        box: { x: lineOrigin() + line.width, y: 0, width: 0, height: breakMetrics.height },
        ...(piece.link ? { link: piece.link } : {}),
        ...revisionsOf(piece),
      });
      line.height = Math.max(line.height, breakMetrics.height);
      line.baseline = Math.max(line.baseline, breakMetrics.baseline);
      line.end = piece.end;
      closeLine();
      lines[lines.length - 1]!.columnBreakAfter = true;
      // Like a trailing hard break, NOT like a page break: Word still lays out the
      // paragraph's remainder after the column advance. The common authoring form
      // `<w:p><w:r><w:br w:type="column"/></w:r></w:p>` therefore opens one empty line
      // at the top of the next column before the following block — the paragraph mark
      // after the break. Suppressing that remainder put "After Column Break" flush with
      // the prior column's first line.
      trailingLineBreak = true;
      continue;
    }
    if (piece.projected && !piece.inlineDrawing && piece.text === '\uFFFC') {
      recordTopAndBottomAnchorLineTop(piece.start);
      line.end = piece.end;
      continue;
    }
    if (piece.inlineDrawing) {
      recordTopAndBottomAnchorLineTop(piece.start);
      const measure = measureInlineDrawing(piece.inlineDrawing.projection);
      const atomWidth = measure.totalWidth;
      const hasContent = line.spans.length > 0 || line.drawings.length > 0;
      if (hasContent && line.width + atomWidth > lineAvailable()) closeLine();
      if (!ensurePlacementWidth(atomWidth)) continue;
      const { extentTopY } = growLineMetricsForDrawing(piece.style, measure);
      const slotX = lineOrigin() + line.width;
      line.drawings.push(
        buildInlineDrawingRecord({
          input: piece.inlineDrawing,
          paragraphId,
          start: piece.start,
          slotX,
          y: extentTopY,
          baseline: line.baseline,
          contentLeft,
          contentRight,
        })
      );
      line.width += atomWidth;
      line.end = piece.end;
      wordStartSpan = -1;
      lastEmitted = '';
      continue;
    }
    if (piece.text === PAGE_BREAK_CHAR) {
      const breakMetrics = measurer.lineMetrics(piece.style);
      line.spans.push({
        range: { paragraphId, start: piece.start, end: piece.end },
        text: PAGE_BREAK_CHAR,
        props: piece.props,
        style: piece.style,
        box: { x: lineOrigin() + line.width, y: 0, width: 0, height: breakMetrics.height },
        ...(piece.link ? { link: piece.link } : {}),
        ...revisionsOf(piece),
      });
      line.height = Math.max(line.height, breakMetrics.height);
      line.baseline = Math.max(line.baseline, breakMetrics.baseline);
      line.end = piece.end;
      closeLine();
      lines[lines.length - 1]!.pageBreakAfter = true;
      // NOT `trailingLineBreak`, unlike the hard break / column break above. An empty
      // remainder publishes no line on the page the break opened: Word Online puts the
      // following block flush at the top of that page, which `paragraph-spacing-borders`
      // and `section-aware-pagination` pin against the comprehensive fixture. The caret
      // after such a break therefore has nowhere to go on the new page, which is why the
      // click that lands in the blank space beside the mark resolves BEFORE it — see
      // `hitTestSemantic`.
      trailingLineBreak = false;
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
        ...(piece.link ? { link: piece.link } : {}),
        ...revisionsOf(piece),
      });
      line.height = Math.max(line.height, breakMetrics.height);
      line.baseline = Math.max(line.baseline, breakMetrics.baseline);
      line.end = piece.end;
      closeLine();
      trailingLineBreak = true;
      continue;
    }
    trailingLineBreak = false;
    closeForTopAndBottomAfterAnchor(piece.start);
    if (
      sameParagraphAnchorStarts.length > 0 &&
      piece.start >= Math.min(...sameParagraphAnchorStarts)
    ) {
      advancePastAnchorExclusionForPlacement(piece.start);
    }
    const metrics = measurer.lineMetrics(piece.style);
    let consumed = 0;
    for (const boundary of wordBoundaries(piece.text)) {
      const candidate = piece.text.slice(consumed, boundary);
      if (candidate.length === 0) continue;
      // Projected PAGE/NUMPAGES digits publish the suppressed cached-result model range (or a
      // zero-width insertion point when the cache was empty) so surrounding source offsets
      // stay aligned with binding / paragraphTextOf.
      // A projected field publishes the model range it stands in for; a `w:ptab` publishes
      // its ZERO-WIDTH insertion point, because it contributes no text to the paragraph.
      // Defensive: any piece whose display length disagrees with its model range is also
      // layout-owned (inert DATE/TOC/REF/… cache before `projected` was set).
      const layoutOwned =
        Boolean(piece.projected) ||
        Boolean(piece.positionalTab) ||
        piece.end - piece.start !== piece.text.length;
      const spanRange = layoutOwned
        ? { paragraphId, start: piece.start, end: piece.end }
        : { paragraphId, start: piece.start + consumed, end: piece.start + boundary };

      if (candidate === '\t') {
        // A tab that cannot advance on this line wraps first, then reapplies — matching
        // Word's "tab past the right margin starts a new line" behaviour.
        if ((line.spans.length > 0 || line.drawings.length > 0) && line.width >= lineAvailable())
          closeLine();
        const currentX = lineOrigin() + line.width;
        const segment = measureFollowingTabSegment(pieces, pieceIndex, boundary, measurer);
        // A `w:ptab` states its own destination and leader, so it does NOT consult the
        // paragraph's tab stops — a table-of-contents line authored with one has none.
        // A positional tab whose destination is at or behind the caret cannot advance —
        // a left-aligned one almost never can, and it is also the fallback for a malformed
        // `w:alignment`. Falling back to the ordinary stop rule keeps the glyphs apart
        // instead of reproducing the very run-together text this element exists to prevent.
        const positional = piece.positionalTab
          ? positionalTabDestination(piece.positionalTab, indentLeft, rightEdge, flow?.marginExtent)
          : null;
        const destination =
          positional === null
            ? nextTabDestination(tabStops, currentX, rightEdge)
            : positional.positionPt > currentX
              ? positional
              : {
                  // The stop changes; the LEADER is the element's own and survives it.
                  ...nextTabDestination(tabStops, currentX, rightEdge),
                  ...(positional.leader ? { leader: positional.leader } : {}),
                };
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
          // destination rather than re-derived from the paragraph at paint time — and its
          // glyph is MEASURED here too, in this run's own face, because paint has no
          // measurer and a guessed advance cannot space the dots the way typing them would.
          ...(destination.leader
            ? {
                tabLeader: destination.leader,
                tabLeaderAdvancePt: measurer.measure(
                  TAB_LEADER_GLYPH.get(destination.leader) ?? '.',
                  piece.style
                ),
              }
            : {}),
          ...(piece.link ? { link: piece.link } : {}),
          // destination rather than re-derived from the paragraph at paint time.
          ...(destination.leader ? { tabLeader: destination.leader } : {}),
          ...(layoutOwned && !piece.positionalTab ? { projected: true as const } : {}),
          ...(piece.noteNav ? { noteNav: piece.noteNav } : {}),
          ...revisionsOf(piece),
        });
        line.width += width;
        line.height = Math.max(line.height, metrics.height);
        line.baseline = Math.max(line.baseline, metrics.baseline);
        line.end = layoutOwned ? piece.end : piece.start + boundary;
        // A tab is a break opportunity, so whatever follows it may open a line. Leaving the
        // previous word recorded here made the following text a CONTINUATION of it, and an
        // overflow then took the mid-word path: the word before the tab was carried onto the
        // next line together with the tab, whose advance was re-laid unchanged and no longer
        // reached its stop — a heading split mid-phrase with its page number stranded in the
        // middle of the line.
        lastEmitted = '\t';
        consumed = boundary;
        continue;
      }

      // Measured as DRAWN: `w:caps` changes the glyphs, so measuring the source text
      // would size the line for characters the reader never sees. Note marks may reserve
      // a wider measureText (eachPage) while painting the real digits.
      const measureSource = piece.measureText ?? candidate;
      const width = measurer.measure(displayText(measureSource, piece.style), piece.style);
      // A candidate may open a line only at a real break opportunity. Within a piece,
      // `wordBoundaries` cuts after spaces, dashes and tabs, so every candidate but the
      // first is one. The FIRST candidate of a piece continues whatever the previous piece
      // ended with, so it is a break opportunity only if that ended in whitespace \u2014 or in a
      // dash, which stays a break opportunity across run boundaries (a tracked change can
      // split "ALPHA-" and "PRIME" into different runs without gluing them).
      const opensWord =
        consumed > 0 ||
        lastEmitted === '' ||
        /[\s\u00a0]$/.test(lastEmitted) ||
        /^[\s\u00a0]/.test(candidate) ||
        (BREAK_AFTER_DASH.has(lastEmitted[lastEmitted.length - 1]!) &&
          !BREAK_AFTER_DASH.has(candidate[0]!));
      if (opensWord) {
        wordStartSpan = line.spans.length;
        wordStartWidth = line.width;
        wordStartEnd = line.end;
      }
      advancePastAnchorExclusionForPlacement(piece.start + consumed);
      if (
        line.width + width > lineAvailable() + OVERFLOW_TOLERANCE_PT &&
        (line.spans.length > 0 || line.drawings.length > 0)
      ) {
        if (opensWord || wordStartSpan <= 0) {
          if (tryAdvanceToNextPassage() && line.width + width <= lineAvailable() + 0.001) {
            // carry on in the next horizontal passage on this line
          } else {
            closeLine();
            if (!ensurePlacementWidth(width)) continue;
          }
        } else {
          // Mid-word overflow: carry the whole word to the next line rather than splitting it
          // at a run boundary. The spans already placed for it are lifted off this line, the
          // line is closed without them, and they are re-laid at the new origin.
          const carried = line.spans.splice(wordStartSpan);
          line.width = wordStartWidth;
          line.end = wordStartEnd;
          line.height = 0;
          line.baseline = 0;
          for (const span of line.spans) {
            const spanMetrics = measurer.lineMetrics(span.style);
            line.height = Math.max(line.height, spanMetrics.height);
            line.baseline = Math.max(line.baseline, spanMetrics.baseline);
          }
          closeLine();
          for (const span of carried) {
            const spanMetrics = measurer.lineMetrics(span.style);
            line.spans.push({
              ...span,
              box: { ...span.box, x: lineOrigin() + line.width },
            });
            line.width += span.box.width;
            line.height = Math.max(line.height, spanMetrics.height);
            line.baseline = Math.max(line.baseline, spanMetrics.baseline);
            line.end = span.range.end;
          }
          wordStartSpan = 0;
          wordStartWidth = 0;
        }
      } else if (
        line.spans.length === 0 &&
        line.drawings.length === 0 &&
        width > lineAvailable() + 0.001
      ) {
        if (!ensurePlacementWidth(width)) continue;
      }
      // A word wider than an EMPTY line has no boundary to wrap at, and Word breaks it at
      // the margin rather than letting it run past the right edge — or, in a table cell,
      // into the neighbouring cell. The longest fitting prefix closes each full line and
      // the tail falls through to ordinary placement. Layout-owned pieces stay whole:
      // every span they emit publishes the piece's model range, so cutting one would
      // publish the same range twice; `measureText` pieces reserve a width their sliced
      // text does not measure to.
      let remaining = candidate;
      let remainingStart = piece.start + consumed;
      let remainingWidth = width;
      if (!layoutOwned && piece.measureText === undefined) {
        while (
          line.spans.length === 0 &&
          remaining.length > 1 &&
          remainingWidth > lineAvailable()
        ) {
          let low = 1;
          let high = remaining.length - 1;
          let fitLength = 1;
          while (low <= high) {
            const mid = (low + high) >> 1;
            const midWidth = measurer.measure(
              displayText(remaining.slice(0, mid), piece.style),
              piece.style
            );
            if (midWidth <= lineAvailable()) {
              fitLength = mid;
              low = mid + 1;
            } else {
              high = mid - 1;
            }
          }
          const prefix = remaining.slice(0, fitLength);
          const prefixWidth = measurer.measure(displayText(prefix, piece.style), piece.style);
          line.spans.push({
            range: { paragraphId, start: remainingStart, end: remainingStart + fitLength },
            text: prefix,
            props: piece.props,
            style: piece.style,
            box: { x: lineOrigin() + line.width, y: 0, width: prefixWidth, height: metrics.height },
            ...(piece.link ? { link: piece.link } : {}),
            ...(piece.noteNav ? { noteNav: piece.noteNav } : {}),
            ...revisionsOf(piece),
          });
          line.width += prefixWidth;
          line.height = Math.max(line.height, metrics.height);
          line.baseline = Math.max(line.baseline, metrics.baseline);
          line.end = remainingStart + fitLength;
          closeLine();
          remaining = remaining.slice(fitLength);
          remainingStart += fitLength;
          remainingWidth = measurer.measure(displayText(remaining, piece.style), piece.style);
        }
      }
      line.spans.push({
        range: layoutOwned
          ? spanRange
          : { paragraphId, start: remainingStart, end: piece.start + boundary },
        text: remaining,
        props: piece.props,
        style: piece.style,
        box: { x: lineOrigin() + line.width, y: 0, width: remainingWidth, height: metrics.height },
        ...(piece.link ? { link: piece.link } : {}),
        ...(layoutOwned && !piece.positionalTab ? { projected: true as const } : {}),
        ...(piece.noteNav ? { noteNav: piece.noteNav } : {}),
        ...revisionsOf(piece),
      });
      line.width += remainingWidth;
      line.height = Math.max(line.height, metrics.height);
      line.baseline = Math.max(line.baseline, metrics.baseline);
      line.end = layoutOwned ? piece.end : piece.start + boundary;
      lastEmitted = candidate;
      consumed = boundary;
    }
  }
  // An empty paragraph still occupies one line, or it would have no caret target. So does
  // the line a TRAILING hard break opens: Shift+Enter at the end of a paragraph moves the
  // caret onto a new, empty line in Word, and without this the break closed the only line
  // there was and left nothing after it — the caret fell back to the end of the line the
  // break had just terminated, sitting a break's width to the right of the last glyph,
  // and the new line only appeared once something was typed into it.
  if (line.spans.length > 0 || line.drawings.length > 0 || lines.length === 0 || trailingLineBreak)
    closeLine();
  if (cacheKey !== null && cache) cache.set(cacheKey, lines.map(frozenLine));
  return lines;
}
