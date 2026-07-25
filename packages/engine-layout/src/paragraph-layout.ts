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
 * Resolving the capsule inside that loop made layout cost `chars x capsuleBytes`:
 * independent review measured a 600-character paragraph taking 124 ms with no
 * capsule, 338 ms at 2 MB, and 990 ms at 8 MB, and showed that the zip limits
 * admit a ~32 MB capsule inside a ~160 KB .docx — roughly 27 s of frozen main
 * thread on open, zero clicks. A WeakMap keyed on the run makes it once per run.
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

function runStyleAt(
  p: ParagraphRecord,
  utf16Offset: number,
): { bold: boolean; italic: boolean } {
  let cursor = 0;
  for (const run of p.runs) {
    const end = cursor + run.text.length;
    if (utf16Offset < end) {
      return resolveRunStyle(run);
    }
    cursor = end;
  }
  return { bold: false, italic: false };
}

function charAt(p: ParagraphRecord, utf16Offset: number): string {
  let cursor = 0;
  for (const run of p.runs) {
    const end = cursor + run.text.length;
    if (utf16Offset < end) return run.text[utf16Offset - cursor] ?? ' ';
    cursor = end;
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

function utf16AtGraphemeBoundary(fullText: string, graphemeOffset: number): number {
  const segments = segmentGraphemes(fullText);
  if (graphemeOffset >= segments.length) return fullText.length;
  return segments[graphemeOffset]?.index ?? fullText.length;
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
  fullText: string,
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
    utf16Offset: utf16AtGraphemeBoundary(fullText, graphemeOffset),
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
  const paragraphGraphemeCount = segmentGraphemes(fullText).length;
  const tracker = new LineTracker(p.id);
  const tokens = tokenizeParagraph(fullText);
  const placed: PlacedSlice[] = [];
  let lineStartGraphemeOffset = 0;

  const pushEdge = (graphemeOffset: number) => {
    pushCaretEdge(
      sink,
      p.id,
      fullText,
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
    emitPaintSlices(p, metrics, sink, [placed[placed.length - 1]!]);

    const graphemes = segmentGraphemes(token.text);
    for (const seg of graphemes) {
      pushEdge(utf16OffsetToGrapheme(fullText, token.utf16From + seg.utf16From));
      for (let ci = 0; ci < seg.text.length; ci += 1) {
        const utf16 = token.utf16From + seg.utf16From + ci;
        const style = runStyleAt(p, utf16);
        cursor.x += metrics.advance(charAt(p, utf16), style.bold, style.italic);
      }
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

/** Split positioned line tokens at run boundaries for paint-only TextItems. */
function emitPaintSlices(
  p: ParagraphRecord,
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
        text: paragraphFullText(p).slice(cursor, runEnd),
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
