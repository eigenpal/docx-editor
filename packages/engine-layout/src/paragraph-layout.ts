// Paragraph-wide tokenization, wrapping, and caret measurement (task 5.5).
// Run boundaries affect paint slices only — never line breaks, lineId, or caret edges.

import type { ParagraphRecord, RunRecord } from '@docx-editor.dev/engine-core';
import type { MetricsPort } from './metrics.ts';
import type { CaretEdgeItem, DisplayItem, TextItem, VisualLineIdentity } from './display-item.ts';
import { LineTracker } from './line-tracker.ts';
import { segmentGraphemes, utf16OffsetToGrapheme } from './grapheme.ts';
import { isCumulativeGeometryTrustedFromLineOrigin, isWholeGraphemeHorizontalBoundary } from './horizontal-boundary.ts';
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

type PlacedSlice = {
  readonly utf16From: number;
  readonly utf16To: number;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly line: VisualLineIdentity;
};

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

function runStyleAt(
  p: ParagraphRecord,
  utf16Offset: number,
): { bold: boolean; italic: boolean } {
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

function advanceRangeWidth(metrics: MetricsPort, p: ParagraphRecord, from: number, to: number): number {
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
  graphemeOffset: number,
): number {
  if (graphemeOffset >= segments.length) return fullTextLength;
  return segments[graphemeOffset]?.utf16From ?? fullTextLength;
}

function caretEdgeNavigable(
  metrics: MetricsPort,
  fullText: string,
  lineStartGraphemeOffset: number,
  graphemeOffset: number,
): boolean {
  return isCumulativeGeometryTrustedFromLineOrigin(metrics, fullText, lineStartGraphemeOffset, graphemeOffset);
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
  horizontalNavigable: boolean,
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
  options: { trailingNewLine?: boolean } = {},
): { x: number; y: number } {
  const fullText = paragraphFullText(p);
  // Segment the paragraph ONCE and keep the result for the whole layout. Every
  // per-character probe below reads from this array; none re-enters segmentation.
  const paragraphSegments = segmentGraphemes(fullText);
  const paragraphGraphemeCount = paragraphSegments.length;
  const tracker = new LineTracker(p.id);
  const tokens = tokenizeParagraph(fullText);
  const placed: PlacedSlice[] = [];
  let lineStartGraphemeOffset = 0;

  const pushEdge = (graphemeOffset: number) => {
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
      isWholeGraphemeHorizontalBoundary(metrics, fullText, graphemeOffset),
    );
  };

  pushEdge(0);

  for (const token of tokens) {
    if (token.kind === 'whitespace') {
      for (let i = token.utf16From; i < token.utf16To; i += 1) {
        pushEdge(utf16OffsetToGrapheme(fullText, i));
        const style = runStyleAt(p, i);
        cursor.x += metrics.advance(charAt(p, i), style.bold, style.italic);
      }
      pushEdge(utf16OffsetToGrapheme(fullText, token.utf16To));
      continue;
    }

    const width = advanceRangeWidth(metrics, p, token.utf16From, token.utf16To);
    if (cursor.x + width > contentRight && cursor.x > contentLeft) {
      lineStartGraphemeOffset = utf16OffsetToGrapheme(fullText, token.utf16From);
      tracker.wrap(sink.currentPageIndex());
      newLine();
      pushEdge(lineStartGraphemeOffset);
    }

    placed.push({
      utf16From: token.utf16From,
      utf16To: token.utf16To,
      text: token.text,
      x: cursor.x,
      y: cursor.y,
      line: tracker.identity(sink.currentPageIndex()),
    });
    emitPaintSlices(p, fullText, metrics, sink, [placed[placed.length - 1]!]);

    // Walk the PARAGRAPH's own segments inside this token's range rather than
    // segmenting `token.text`. Tokens split on whitespace, which is always a
    // grapheme boundary, so the paragraph's boundaries within a token are exactly
    // the token's own — and segmenting the token was what evicted the memo holding
    // the paragraph text, re-segmenting the whole paragraph once per token.
    let g = utf16OffsetToGrapheme(fullText, token.utf16From);
    while (g < paragraphGraphemeCount && paragraphSegments[g]!.utf16From < token.utf16To) {
      const seg = paragraphSegments[g]!;
      pushEdge(g);
      for (let utf16 = seg.utf16From; utf16 < seg.utf16To; utf16 += 1) {
        const style = runStyleAt(p, utf16);
        cursor.x += metrics.advance(charAt(p, utf16), style.bold, style.italic);
      }
      g += 1;
    }
    pushEdge(utf16OffsetToGrapheme(fullText, token.utf16To));
  }

  if (placed.length === 0) {
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
    pushEdge(0);
  }

  pushEdge(paragraphGraphemeCount);
  if (options.trailingNewLine !== false) newLine();
  return { x: cursor.x, y: cursor.y };
}

/**
 * Split positioned line tokens at run boundaries for paint-only TextItems.
 *
 * Takes `fullText` rather than rebuilding it: this runs once per placed slice, and
 * `paragraphFullText` joins every run, so rebuilding it here cost O(chars) per
 * slice — a second quadratic term independent of segmentation.
 */
function emitPaintSlices(
  p: ParagraphRecord,
  fullText: string,
  metrics: MetricsPort,
  sink: ParagraphLayoutSink,
  placed: readonly PlacedSlice[],
): void {
  for (const slice of placed) {
    let cursor = slice.utf16From;
    while (cursor < slice.utf16To) {
      const style = runStyleAt(p, cursor);
      let runEnd = slice.utf16To;
      for (let pos = cursor + 1; pos < slice.utf16To; pos += 1) {
        const next = runStyleAt(p, pos);
        if (next.bold !== style.bold || next.italic !== style.italic) {
          runEnd = pos;
          break;
        }
      }
      const prefixWidth = advanceRangeWidth(metrics, p, slice.utf16From, cursor);
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
      cursor = runEnd;
    }
  }
}
