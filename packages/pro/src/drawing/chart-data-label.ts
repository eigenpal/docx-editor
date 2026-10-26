/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The text and size of one data label: its own text when the file writes one, otherwise the
// generated text, wrapped at a fifth of the chart's width.

import {
  DRAWINGML_MAIN_NAMESPACE_URI,
  findDirectChild,
  schemaAttributeValue,
  type ShapeSchemeColorResolver,
} from '@docx-editor.dev/core/store';
import type { Box } from './chart-axes.ts';
import {
  dataLabelField,
  dataLabelText,
  titleParagraphs,
  type DataLabelMove,
  type DataLabelSpec,
  type DataLabelValues,
} from './chart-labels.ts';
import { child } from './chart-model.ts';
import {
  estimateTextWidth,
  lineHeight,
  type ChartTextRun,
  type ChartTextStyle,
} from './chart-text.ts';

const A = DRAWINGML_MAIN_NAMESPACE_URI;
const EMU_PER_POINT = 12_700;
/** A data label wraps at this share of the chart's width, its insets included. */
const WRAP_SHARE = 0.2;
/** Side insets of a data label whose text body names none, in points. */
const DEFAULT_INSET = 3;
const MAX_LINES = 16;

export interface DataLabelBlock {
  readonly paragraphs: readonly (readonly ChartTextRun[])[];
  /** Estimated width of the widest line once wrapped. */
  readonly width: number;
  readonly height: number;
  /** Width of the frame the text is set in: the wrap width when the text wraps. */
  readonly frame: number;
}

/** A body property of the label: its own text's `a:bodyPr` first, then its text style's. */
function bodyAttribute(spec: DataLabelSpec, name: string): string | undefined {
  for (const body of [child(child(spec.custom, 'tx'), 'rich'), spec.txPr]) {
    const bodyPr = body
      ? findDirectChild(body.children, { namespaceUri: A, localName: 'bodyPr' })
      : null;
    const value = bodyPr ? schemaAttributeValue(bodyPr.attributes, name) : undefined;
    if (value !== undefined) return value;
  }
  return undefined;
}

function inset(spec: DataLabelSpec, name: string): number {
  const raw = bodyAttribute(spec, name);
  return raw !== undefined && /^\d{1,8}$/.test(raw) ? Number(raw) / EMU_PER_POINT : DEFAULT_INSET;
}

/** The width a label's text wraps at, or null when the chart's width is not known. */
function wrapWidth(spec: DataLabelSpec, chartWidth: number | null): number | null {
  if (chartWidth === null || !(chartWidth > 0)) return null;
  if (bodyAttribute(spec, 'wrap') === 'none') return null;
  return chartWidth * WRAP_SHARE - inset(spec, 'lIns') - inset(spec, 'rIns');
}

/** The lines of paragraphs, a line break inside a run starting a new one. */
function linesOf(paragraphs: readonly (readonly ChartTextRun[])[]): ChartTextRun[][] {
  const out: ChartTextRun[][] = [];
  for (const runs of paragraphs) {
    let current: ChartTextRun[] = [];
    for (const run of runs) {
      for (const [index, part] of run.text.split(/\r\n|\r|\n/).entries()) {
        if (index > 0) {
          out.push(current);
          current = [];
        }
        if (part !== '') current.push({ text: part, style: run.style });
      }
    }
    out.push(current);
  }
  return out.slice(0, MAX_LINES);
}

/** Lines one line of runs wraps into at `limit`, the widest of them, and the widest word. */
function wrapLine(
  runs: readonly ChartTextRun[],
  limit: number | null
): { count: number; widest: number; word: number } {
  const words: { width: number; space: number }[] = [];
  for (const run of runs) {
    for (const piece of run.text.match(/\S+|\s+/g) ?? []) {
      const width = estimateTextWidth(piece, run.style);
      if (/^\s/.test(piece)) {
        if (words.length > 0) words[words.length - 1]!.space += width;
      } else {
        words.push({ width, space: 0 });
      }
    }
  }
  if (words.length === 0) return { count: 1, widest: 0, word: 0 };
  let count = 1;
  let widest = 0;
  let line = 0;
  let pending = 0;
  let longest = 0;
  for (const word of words) {
    longest = Math.max(longest, word.width);
    if (line > 0 && limit !== null && line + pending + word.width > limit) {
      widest = Math.max(widest, line);
      count += 1;
      line = word.width;
    } else {
      line += pending + word.width;
    }
    pending = word.space;
  }
  return { count, widest: Math.max(widest, line), word: longest };
}

/**
 * A data label's paragraphs and size: its own text, with its fields filled from `values`, or
 * the parts it shows in `style`.
 */
export function dataLabelBlock(
  spec: DataLabelSpec,
  values: DataLabelValues,
  style: ChartTextStyle,
  chartWidth: number | null,
  resolveSchemeColor?: ShapeSchemeColorResolver
): DataLabelBlock {
  const text = dataLabelText(spec, values);
  const paragraphs: readonly (readonly ChartTextRun[])[] = spec.custom
    ? titleParagraphs(
        spec.custom,
        style,
        text,
        resolveSchemeColor,
        (type, saved) => dataLabelField(spec, values, type) ?? saved
      )
    : [[{ text, style }]];
  const limit = wrapWidth(spec, chartWidth);
  let width = 0;
  let height = 0;
  let wraps = false;
  let word = 0;
  for (const line of linesOf(paragraphs)) {
    const wrapped = wrapLine(line, limit);
    width = Math.max(width, wrapped.widest);
    word = Math.max(word, wrapped.word);
    wraps ||= wrapped.count > 1;
    const tallest = Math.max(lineHeight(style), ...line.map((run) => lineHeight(run.style)));
    height += wrapped.count * tallest;
  }
  // A label that fits keeps a frame wider than its estimate, so a misestimate never breaks
  // a line; one that wraps is set at the wrap width, never narrower than its widest word.
  const frame = limit !== null && wraps ? Math.max(limit, word) : width * 1.3 + style.sizePt * 2;
  return { paragraphs, width, height, frame };
}

/**
 * The centre of a label moved by hand, per axis: an offset of shares of the chart's size from
 * its natural centre (`x`, `y`), or in edge mode its left or top side at that share.
 */
export function movedLabel(
  move: DataLabelMove | null,
  chart: Box | undefined,
  x: number,
  y: number,
  width: number,
  height: number
): { x: number; y: number; moved: boolean } {
  if (!move || !chart) return { x, y, moved: false };
  const w = chart.r - chart.l;
  const h = chart.b - chart.t;
  return {
    x: move.xEdge ? chart.l + move.x * w + width / 2 : x + move.x * w,
    y: move.yEdge ? chart.t + move.y * h + height / 2 : y + move.y * h,
    moved: true,
  };
}

/** A label centre moved so that its text and side insets stay inside the chart. */
export function keepInChart(
  spec: DataLabelSpec,
  centre: { readonly x: number; readonly y: number },
  width: number,
  height: number,
  chart: Box | undefined
): { x: number; y: number } {
  if (!chart) return centre;
  const half = width / 2 + Math.max(inset(spec, 'lIns'), inset(spec, 'rIns'));
  const clamp = (value: number, low: number, high: number) =>
    low > high ? (low + high) / 2 : Math.min(Math.max(value, low), high);
  return {
    x: clamp(centre.x, chart.l + half, chart.r - half),
    y: clamp(centre.y, chart.t + height / 2, chart.b - height / 2),
  };
}
