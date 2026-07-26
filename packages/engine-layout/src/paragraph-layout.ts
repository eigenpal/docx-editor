// Paragraph-wide tokenization, wrapping, and caret measurement (task 5.5).
// Run boundaries affect paint slices only — never line breaks, lineId, or caret edges.

import type { ParagraphRecord, RunRecord } from '@docx-editor.dev/engine-core';
import type { MetricsPort } from './metrics.ts';
import type { CaretEdgeItem, DisplayItem, TextItem, VisualLineIdentity } from './display-item.ts';
import { LineTracker } from './line-tracker.ts';
import { segmentGraphemes, utf16OffsetToGrapheme } from './grapheme.ts';
import {
  isCumulativeGeometryTrustedFromLineOrigin,
  isWholeGraphemeHorizontalBoundary,
} from './horizontal-boundary.ts';
import { capsuleToggle } from './capsule-run-style.ts';

export interface ParagraphLayoutSink {
  push(item: DisplayItem): void;
  currentPageIndex(): number;
}

type FlowToken = {
  readonly kind: 'word' | 'whitespace';
  readonly utf16From: number;
  readonly utf16To: number;
  readonly text: string;
};

/** One visual line's worth of positioned text, before it is split at style boundaries. */
type PlacedLine = {
  readonly utf16From: number;
  readonly utf16To: number;
  readonly x: number;
  readonly y: number;
  readonly line: VisualLineIdentity;
};

/** `w:tab` parses to U+0009; see `emitPaintSlices` for why it ends a paint run. */
const TAB = '\t';

function paragraphFullText(p: ParagraphRecord): string {
  return p.runs.map((r) => r.text).join('');
}

function tokenizeParagraph(fullText: string): FlowToken[] {
  const tokens: FlowToken[] = [];
  const parts = fullText.split(/(\s+)/);
  let offset = 0;
  for (const part of parts) {
    if (part.length === 0) continue;
    tokens.push({
      kind: /^\s+$/.test(part) ? 'whitespace' : 'word',
      utf16From: offset,
      utf16To: offset + part.length,
      text: part,
    });
    offset += part.length;
  }
  return tokens;
}

/**
 * Resolved bold/italic per RunRecord, memoized.
 *
 * `runStyleAt` is called once per UTF-16 code unit during layout, and a
 * preserved run's `rPrCapsule` is verbatim file bytes with no size bound.
 * Resolving the capsule inside that loop made layout cost `chars x capsuleBytes`,
 * and the zip limits admit a ~32 MB capsule inside a ~160 KB .docx. A WeakMap
 * keyed on the run makes it once per run instead.
 *
 * The property that matters is that the capsule cost is now CONSTANT in paragraph
 * length, not that it is small. Measured at this commit with an ~8 MB capsule, the
 * added cost is flat across a 20x range of text: 300 chars +402 ms, 1,200 chars
 * +406 ms, 6,000 chars +402 ms. An 8 MB capsule still costs ~400 ms once, which is
 * a real but bounded cost paid per distinct run.
 *
 * Earlier revisions of this comment and of `layout-cost.test.ts` carried pre-fix
 * figures that cannot both be true (144,956 ms at 2 MB versus 990 ms at 8 MB —
 * four times the data for 1/146th the time). Neither is reproducible now and
 * neither is relied on; the numbers above were measured directly.
 */
const runStyleCache = new WeakMap<RunRecord, { bold: boolean; italic: boolean }>();

function resolveRunStyle(run: RunRecord): { bold: boolean; italic: boolean } {
  const cached = runStyleCache.get(run);
  if (cached) return cached;
  // A preserved run carries its formatting verbatim in rPrCapsule rather than in
  // props, so reading props alone paints every reopened run unstyled.
  const resolved = {
    bold: run.props?.bold === true || capsuleToggle(run.rPrCapsule, 'w:b'),
    italic: run.props?.italic === true || capsuleToggle(run.rPrCapsule, 'w:i'),
  };
  runStyleCache.set(run, resolved);
  return resolved;
}

/**
 * Per-paragraph run start offsets, so locating the run covering a UTF-16 offset
 * is a binary search rather than a walk from run 0.
 *
 * `runStyleAt` and `charAt` are each called once per code unit, and both used to
 * scan `p.runs` from the beginning, making layout O(chars x runs) on top of the
 * segmentation amplifier. Keyed on the paragraph record, which is immutable.
 */
const runIndexCache = new WeakMap<ParagraphRecord, { starts: Int32Array }>();

function runStartsOf(p: ParagraphRecord): Int32Array {
  const cached = runIndexCache.get(p);
  if (cached) return cached.starts;
  const starts = new Int32Array(p.runs.length + 1);
  let cursor = 0;
  for (let i = 0; i < p.runs.length; i += 1) {
    starts[i] = cursor;
    cursor += p.runs[i]!.text.length;
  }
  starts[p.runs.length] = cursor;
  runIndexCache.set(p, { starts });
  return starts;
}

/** Index of the run covering `utf16Offset`, or -1 when past the end. */
function runIndexAt(p: ParagraphRecord, utf16Offset: number): number {
  const starts = runStartsOf(p);
  // `Number.isInteger` first: `NaN < 0` and `NaN >= total` are BOTH false, so a
  // non-finite offset fell through this guard and returned run 0. With an empty
  // `p.runs` that made `runStyleAt` dereference `p.runs[0]`, throwing where the
  // pre-fix linear scan had returned a neutral style. Not reachable from a current
  // call site (every offset is a derived integer), fixed as defence in depth.
  if (!Number.isInteger(utf16Offset)) return -1;
  if (utf16Offset < 0 || utf16Offset >= starts[p.runs.length]!) return -1;
  let lo = 0;
  let hi = p.runs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= utf16Offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function runStyleAt(p: ParagraphRecord, utf16Offset: number): { bold: boolean; italic: boolean } {
  const i = runIndexAt(p, utf16Offset);
  if (i === -1) return { bold: false, italic: false };
  return resolveRunStyle(p.runs[i]!);
}

function charAt(p: ParagraphRecord, utf16Offset: number): string {
  const i = runIndexAt(p, utf16Offset);
  if (i !== -1) {
    const run = p.runs[i]!;
    return run.text[utf16Offset - runStartsOf(p)[i]!] ?? ' ';
  }
  return ' ';
}

function advanceRangeWidth(
  metrics: MetricsPort,
  p: ParagraphRecord,
  from: number,
  to: number
): number {
  let width = 0;
  for (let i = from; i < to; i += 1) {
    const style = runStyleAt(p, i);
    width += metrics.advance(charAt(p, i), style.bold, style.italic);
  }
  return width;
}

/**
 * UTF-16 offset of a grapheme boundary, read from the paragraph's already-computed
 * segments.
 *
 * Takes the segments rather than re-deriving them: this is called once per caret
 * edge, i.e. once per character, and re-entering `segmentGraphemes` here is what
 * made layout quadratic once the memo holding the paragraph text was evicted.
 *
 * Reads `utf16From`, not `index`. It previously returned `index` — the grapheme
 * index — into a field named `utf16Offset`. The two coincide for ASCII, so the
 * whole test corpus agreed; they diverge for any astral or combining text, which
 * published a wrong UTF-16 offset on every caret edge of such a paragraph.
 */
function utf16AtGraphemeBoundary(
  segments: readonly { readonly utf16From: number }[],
  fullTextLength: number,
  graphemeOffset: number
): number {
  if (graphemeOffset >= segments.length) return fullTextLength;
  return segments[graphemeOffset]?.utf16From ?? fullTextLength;
}

function caretEdgeNavigable(
  metrics: MetricsPort,
  fullText: string,
  lineStartGraphemeOffset: number,
  graphemeOffset: number
): boolean {
  return isCumulativeGeometryTrustedFromLineOrigin(
    metrics,
    fullText,
    lineStartGraphemeOffset,
    graphemeOffset
  );
}

function pushCaretEdge(
  sink: ParagraphLayoutSink,
  paragraphId: string,
  segments: readonly { readonly utf16From: number }[],
  fullTextLength: number,
  graphemeOffset: number,
  x: number,
  y: number,
  height: number,
  line: VisualLineIdentity,
  navigable: boolean,
  horizontalNavigable: boolean
): void {
  sink.push({
    type: 'caretEdge',
    x,
    y,
    height,
    paragraphId,
    graphemeOffset,
    utf16Offset: utf16AtGraphemeBoundary(segments, fullTextLength, graphemeOffset),
    affinity: graphemeOffset === 0 ? 'downstream' : 'upstream',
    line,
    navigable,
    horizontalNavigable,
    shaping: navigable ? 'per-grapheme-advance' : 'unsupported',
  } satisfies CaretEdgeItem);
}

/** Lay out one paragraph: measure/wrap as one sequence; runs slice paint output only. */
export function layoutParagraphInBox(
  p: ParagraphRecord,
  cursor: { x: number; y: number },
  contentLeft: number,
  contentRight: number,
  metrics: MetricsPort,
  sink: ParagraphLayoutSink,
  newLine: () => void,
  options: { trailingNewLine?: boolean } = {}
): { x: number; y: number } {
  const fullText = paragraphFullText(p);
  // Segment the paragraph ONCE and keep the result for the whole layout. Every
  // per-character probe below reads from this array; none re-enters segmentation.
  const paragraphSegments = segmentGraphemes(fullText);
  const paragraphGraphemeCount = paragraphSegments.length;
  const tracker = new LineTracker(p.id);
  const tokens = tokenizeParagraph(fullText);
  let lineStartGraphemeOffset = 0;
  // Paint runs are clipped to VISUAL LINES, not to words.
  //
  // This used to emit one paint slice per word token and nothing at all for whitespace
  // tokens, so element count scaled with word count and painted text contained no spaces.
  // A line's text is contiguous in UTF-16 — wrapping only ever happens BETWEEN tokens —
  // so accumulating `[lineStartUtf16, wrapPoint)` and flushing once per line both collapses
  // the element count to (lines x style changes) and carries whitespace along as real text.
  //
  // Wrapping is unchanged: `tokens` still decides where lines break, and the flush happens
  // BEFORE `tracker.wrap()`/`newLine()` so the emitted item carries the line identity, y and
  // page index of the line it belongs to rather than the one about to start.
  let lineStartUtf16 = 0;
  let lineStartX = cursor.x;
  // A paragraph with no VISIBLE glyph still owns its whole line.
  //
  // The line-area placeholder used to be emitted whenever nothing was painted, which
  // before grouping included a whitespace-only paragraph — whitespace painted nothing.
  // Grouping paints those spaces, so keying the placeholder on "nothing painted" silently
  // dropped it, and with it the full-width box that `enrichOwnershipRegions` unions into
  // paragraph and trailing ownership. Independent review measured the consequence on
  // `'   '`: clicking anywhere past the first ~12 px of a blank spacer line stopped
  // placing a caret at all, where it used to place one everywhere on the line.
  //
  // Keyed on "no visible glyph" instead, so an empty AND a whitespace-only paragraph both
  // keep it. It is pushed BEFORE the line's painted text so it takes a lower paint order:
  // the measured whitespace clusters win where they exist and the placeholder answers the
  // rest of the line. It carries no runs, so it is invisible to paint and to the wrapping
  // signature, and it deliberately does NOT re-emit a caret edge — the duplicate offset-0
  // edge that used to produce was what stopped a whitespace-only paragraph deriving a
  // whitespace box at all.
  const hasVisibleGlyph = /\S/u.test(fullText);
  if (!hasVisibleGlyph) {
    sink.push({
      type: 'text',
      x: contentLeft,
      y: cursor.y,
      width: Math.max(1, contentRight - contentLeft),
      height: metrics.lineHeight,
      text: '',
      bold: false,
      italic: false,
      anchor: { paragraphId: p.id, offset: 0 },
      line: tracker.identity(sink.currentPageIndex()),
    });
  }
  // Highest grapheme offset an edge was emitted for on the CURRENT line. Reset at
  // each wrap, because a wrap deliberately emits an edge at the same offset on the
  // new line — that pair is how the two sides of a soft break are addressable.
  // Within a line it prevents a straddling cluster being emitted twice.
  let lastEdgeGrapheme = -1;

  const pushEdge = (graphemeOffset: number) => {
    lastEdgeGrapheme = Math.max(lastEdgeGrapheme, graphemeOffset);
    pushCaretEdge(
      sink,
      p.id,
      paragraphSegments,
      fullText.length,
      graphemeOffset,
      cursor.x,
      cursor.y,
      metrics.lineHeight,
      tracker.identity(sink.currentPageIndex()),
      caretEdgeNavigable(metrics, fullText, lineStartGraphemeOffset, graphemeOffset),
      isWholeGraphemeHorizontalBoundary(metrics, fullText, graphemeOffset)
    );
  };

  /** Flush `[lineStartUtf16, utf16To)` as this line's paint runs, split at style changes. */
  const emitLine = (utf16To: number) => {
    if (utf16To <= lineStartUtf16) return;
    emitPaintSlices(p, fullText, metrics, sink, {
      utf16From: lineStartUtf16,
      utf16To,
      x: lineStartX,
      y: cursor.y,
      line: tracker.identity(sink.currentPageIndex()),
    });
  };

  pushEdge(0);

  for (const token of tokens) {
    if (token.kind === 'whitespace') {
      for (let i = token.utf16From; i < token.utf16To; i += 1) {
        const g = utf16OffsetToGrapheme(fullText, i);
        if (g > lastEdgeGrapheme) pushEdge(g);
        const style = runStyleAt(p, i);
        cursor.x += metrics.advance(charAt(p, i), style.bold, style.italic);
      }
      // Clamped for the same straddle reason as the word branch below: when a
      // cluster begins in this whitespace token and continues into the next word,
      // `token.utf16To` maps back to THIS cluster and would emit a duplicate edge.
      const trailing = utf16OffsetToGrapheme(fullText, token.utf16To);
      if (trailing > lastEdgeGrapheme) pushEdge(trailing);
      continue;
    }

    const width = advanceRangeWidth(metrics, p, token.utf16From, token.utf16To);
    if (cursor.x + width > contentRight && cursor.x > contentLeft) {
      // Flush the finished line before the tracker and cursor move to the next one.
      emitLine(token.utf16From);
      lineStartGraphemeOffset = utf16OffsetToGrapheme(fullText, token.utf16From);
      tracker.wrap(sink.currentPageIndex());
      newLine();
      lineStartUtf16 = token.utf16From;
      lineStartX = cursor.x;
      lastEdgeGrapheme = -1; // a new line re-addresses the wrap offset
      pushEdge(lineStartGraphemeOffset);
    }

    // Walk the PARAGRAPH's own segments inside this token's range rather than
    // segmenting `token.text` — segmenting the token is what evicted the memo
    // holding the paragraph text and made layout quadratic.
    //
    // A grapheme cluster CAN straddle a token boundary. An earlier version of this
    // loop asserted the opposite ("whitespace is always a grapheme boundary"),
    // which is false: `space + U+0301` is a single cluster and `/(\s+)/` splits
    // inside it. The cluster then began in the whitespace token, whose branch had
    // already advanced the space, and this loop restarted at `seg.utf16From` — the
    // space again — double-counting one advance. Independent review measured the
    // result as a changed line count (6 lines to 7 on a 300-character paragraph
    // with 24 such sequences), i.e. different wrapping and pagination, reachable
    // from any .docx carrying an orphaned combining mark after whitespace.
    //
    // `advanceFromUtf16` is therefore clamped to code units this token actually
    // owns, and an edge already emitted for a straddling cluster is not re-emitted.
    let g = utf16OffsetToGrapheme(fullText, token.utf16From);
    while (g < paragraphGraphemeCount && paragraphSegments[g]!.utf16From < token.utf16To) {
      const seg = paragraphSegments[g]!;
      if (g > lastEdgeGrapheme) pushEdge(g);
      // BOTH bounds are clamped to code units this token owns.
      //
      // The first version clamped only the lower bound, which fixed a cluster that
      // starts in a whitespace token and continues into a word, and left the mirror
      // case open: a cluster that starts in a WORD token and ends in the following
      // whitespace still ran to `seg.utf16To`, past `token.utf16To`, and the
      // whitespace branch then advanced those same code units again. Round-5 review
      // measured `ab<U+0600> cd` at 708 against a ground-truth 648 — one whole space
      // advance — and 10 lines versus 7 for the control at pageWidth 4780. Reachable
      // with any GCB=Prepend code point before whitespace (U+0600-0605, U+06DD,
      // U+070F, U+0890, U+0891, U+08E2, U+0D4E, U+110BD, U+110CD), all confirmed to
      // cluster forward across every Unicode space separator.
      const advanceFromUtf16 = Math.max(seg.utf16From, token.utf16From);
      const advanceToUtf16 = Math.min(seg.utf16To, token.utf16To);
      for (let utf16 = advanceFromUtf16; utf16 < advanceToUtf16; utf16 += 1) {
        const style = runStyleAt(p, utf16);
        cursor.x += metrics.advance(charAt(p, utf16), style.bold, style.italic);
      }
      g += 1;
    }
    const trailingEdge = utf16OffsetToGrapheme(fullText, token.utf16To);
    if (trailingEdge > lastEdgeGrapheme) pushEdge(trailingEdge);
  }

  emitLine(fullText.length);

  pushEdge(paragraphGraphemeCount);
  if (options.trailingNewLine !== false) newLine();
  return { x: cursor.x, y: cursor.y };
}

/**
 * Split one positioned visual line at run boundaries into paint-only TextItems.
 *
 * Grouping happens here and only here: consecutive code units whose RESOLVED paint
 * properties are equal become one item. A style change ends an item, so adjacent runs
 * can neither merge nor inherit each other's formatting.
 *
 * A TAB also ends an item, and that is a paint-correctness rule rather than a style one.
 * `w:tab` parses to U+0009, and layout gives it a FIXED advance like any other character.
 * Every paint backend sets `white-space: pre` and none sets `tab-size`, so once grouping
 * put a tab inside painted text the browser advanced to its own 8-column tab stop and
 * every glyph after the tab rendered somewhere layout never measured — independent review
 * measured `'ab\tcd'` painting `cd` 32 px into the span against a measured 24 px, with the
 * error compounding per tab and reaching any tab-separated line or TOC leader.
 *
 * Splitting there fixes it without weakening grouping or dropping the tab: each piece is
 * absolutely positioned at its own measured `x`, so CSS expansion inside the tab's own
 * piece cannot move the piece after it. The tab stays real text in its own item, tabs are
 * rare, and no other line pays for this.
 *
 * Takes `fullText` rather than rebuilding it: this runs once per line, and
 * `paragraphFullText` joins every run, so rebuilding it here cost O(chars) per
 * line — a second quadratic term independent of segmentation.
 */
function emitPaintSlices(
  p: ParagraphRecord,
  fullText: string,
  metrics: MetricsPort,
  sink: ParagraphLayoutSink,
  slice: PlacedLine
): void {
  let cursor = slice.utf16From;
  // Accumulated, not recomputed.
  //
  // This was `advanceRangeWidth(metrics, p, slice.utf16From, cursor)` — a fresh
  // measurement of the whole slice prefix for EVERY style segment inside it, i.e.
  // k^2*m/2 `metrics.advance` calls for k segments of m characters. Independent
  // security review measured a 4,039-byte .docx — one whitespace-free paragraph
  // with runs alternating bold every 23 characters — freezing `createEditor()`
  // for 45.2 s on open with zero clicks, at 736,460,001 `advance()` calls and a
  // measured growth exponent of 2.05 over four doublings. It re-runs per
  // keystroke, and a whitespace-free token is not exotic: CJK text has no
  // whitespace, so an entire CJK paragraph is one token.
  //
  // The prefix is exactly the sum of the segment widths already emitted, so
  // carrying it forward is both cheaper and simpler.
  //
  // This is the FOURTH iteration on this defect class, and the reason the earlier
  // three missed it is worth recording: each guard instrumented whatever the
  // previous fix had addressed. `layout-cost.test.ts` counts segmented characters,
  // which for this shape is exactly 1.0x linear, while `advance()` runs 4,003x per
  // character. A guard that counts the wrong quantity reads as coverage. The
  // companion test now counts `metrics.advance` calls.
  let prefixWidth = 0;
  while (cursor < slice.utf16To) {
    const style = runStyleAt(p, cursor);
    const startsOnTab = charAt(p, cursor) === TAB;
    let runEnd = slice.utf16To;
    for (let pos = cursor + 1; pos < slice.utf16To; pos += 1) {
      const next = runStyleAt(p, pos);
      if (
        next.bold !== style.bold ||
        next.italic !== style.italic ||
        (charAt(p, pos) === TAB) !== startsOnTab
      ) {
        runEnd = pos;
        break;
      }
    }
    const partWidth = advanceRangeWidth(metrics, p, cursor, runEnd);
    const item: TextItem = {
      type: 'text',
      x: slice.x + prefixWidth,
      y: slice.y,
      width: partWidth,
      height: metrics.lineHeight,
      text: fullText.slice(cursor, runEnd),
      bold: style.bold,
      italic: style.italic,
      anchor: { paragraphId: p.id, offset: cursor },
      line: slice.line,
    };
    sink.push(item);
    prefixWidth += partWidth;
    cursor = runEnd;
  }
}
