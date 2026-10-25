/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The frame of a chartex chart: chart area, title and legend, around the plot its layout
// paints (`chartex-layout.ts`).
//
// The automatic layout, in chart points: a 5.5 pt margin on every side but the right, which
// keeps 6.6 pt. The title sits at the top, centred; a top legend follows 3.84 pt below it,
// and the plot starts 5.41 pt below the last of them when its layout asks for that room
// (`ChartexLayout.roomAbovePlot`), for the half of the top value label that reaches above
// the plot. A legend box is one line plus 7 pt above and
// below; its keys are squares of about 7 pt, their text 10.8 pt after the key's left edge,
// the next entry 7.9 pt after the text, whatever the text size. A bottom legend sits on the bottom margin with
// the category labels 3.84 pt above it. A side legend lists one entry every two sizes,
// centred on the room below the title, 4.92 pt clear of the plot.

import {
  DRAWINGML_MAIN_NAMESPACE_URI,
  findDirectChild,
  isElement,
  type ChartThemeFaces,
  type OoxmlElement,
  type ShapeSchemeColorResolver,
} from '@docx-editor.dev/core/store';
import type { Box } from './chart-axes.ts';
import { ChartScene } from './chart-scene.ts';
import {
  applyRunLayer,
  estimateTextWidth,
  lineHeight,
  paragraphsHeight,
  paragraphsWidth,
  type ChartLabel,
  type ChartTextRun,
  type ChartTextStyle,
} from './chart-text.ts';
import {
  CHARTEX_PLOT_TOP_ROOM,
  type ChartexContext,
  type ChartexLayout,
  type ChartexLegendEntry,
} from './chartex-layout.ts';
import { cxChild, cxText, type ChartexModel, type ChartexSeries } from './chartex-model.ts';
import { chartexLayoutFor } from './chartex-registry.ts';
import { ChartexLook } from './chartex-style.ts';

const A = DRAWINGML_MAIN_NAMESPACE_URI;
const MARGIN = 5.5;
const RIGHT_MARGIN = 6.6;
const STACK_GAP = 3.84;
const LEGEND_PAD_Y = 7;
/** A top or bottom legend row: at least this tall, else its text line and this padding. */
const LEGEND_ROW_MIN = 24.98;
const LEGEND_ROW_PAD = 10.51;
const LEGEND_PAD_LEFT = 9;
const LEGEND_PAD_RIGHT = 5.8;
const LEGEND_PLOT_GAP = 4.92;
const LEGEND_KEY_TO_TEXT = 10.8;
const LEGEND_ENTRY_GAP = 7.9;
const MAX_TITLE_PARAGRAPHS = 16;
const MAX_TITLE_RUNS = 128;
const MAX_LEGEND_ENTRIES = 256;
/** The text a title without text of its own shows. */
const DEFAULT_TITLE = 'Chart Title';

export interface ChartexRender {
  readonly scene: ChartScene;
  readonly labels: readonly ChartLabel[];
}

/** The paragraphs of a chartex title: rich text, cached cell text, or the default caption. */
function titleParagraphs(title: OoxmlElement, style: ChartTextStyle, context: ChartexContext) {
  const tx = cxChild(title, 'tx');
  const rich = cxChild(tx, 'rich');
  const resolve = context.look.resolveSchemeColor;
  if (rich) {
    const paragraphs: ChartTextRun[][] = [];
    let runs = 0;
    for (const paragraph of rich.children) {
      if (!isElement(paragraph) || paragraph.namespaceUri !== A || paragraph.localName !== 'p')
        continue;
      if (paragraphs.length >= MAX_TITLE_PARAGRAPHS) break;
      const pPr = findDirectChild(paragraph.children, { namespaceUri: A, localName: 'pPr' });
      const defRPr = pPr
        ? findDirectChild(pPr.children, { namespaceUri: A, localName: 'defRPr' })
        : null;
      const base = applyRunLayer(style, defRPr, resolve);
      const current: ChartTextRun[] = [];
      for (const run of paragraph.children) {
        if (!isElement(run) || run.namespaceUri !== A || ++runs > MAX_TITLE_RUNS) continue;
        if (run.localName !== 'r' && run.localName !== 'fld') continue;
        const rPr = findDirectChild(run.children, { namespaceUri: A, localName: 'rPr' });
        const t = findDirectChild(run.children, { namespaceUri: A, localName: 't' });
        let text = '';
        for (const node of t?.children ?? []) if (node.kind === 'textValue') text += node.value;
        current.push({ text, style: applyRunLayer(base, rPr, resolve) });
      }
      paragraphs.push(current);
    }
    return paragraphs;
  }
  const cached = cxText(cxChild(cxChild(tx, 'txData'), 'v'));
  if (tx) return cached ? [[{ text: cached, style }]] : [];
  return [[{ text: DEFAULT_TITLE, style }]];
}

/** The side of a legend key: it grows only a little with the text. */
function legendKey(size: number): number {
  return 6.24 + 0.08 * size;
}

interface LegendItem {
  readonly entry: ChartexLegendEntry;
  readonly x: number;
  /** Centre line of the entry. */
  readonly y: number;
}

/** Place the legend and take its room from `box`; the items to paint. */
function placeLegend(
  model: ChartexModel,
  entries: readonly ChartexLegendEntry[],
  style: ChartTextStyle,
  box: Box,
  width: number,
  height: number
): LegendItem[] {
  const legend = model.legend!;
  const size = style.sizePt;
  const line = lineHeight(style);
  const keyText = LEGEND_KEY_TO_TEXT;
  const items: LegendItem[] = [];
  if (legend.position === 't' || legend.position === 'b') {
    const gap = LEGEND_ENTRY_GAP;
    const room = width - 2 * MARGIN - LEGEND_PAD_LEFT - LEGEND_PAD_RIGHT;
    const rows: { entry: ChartexLegendEntry; width: number }[][] = [[]];
    let rowWidth = 0;
    for (const entry of entries) {
      const entryWidth = keyText + estimateTextWidth(entry.text, style);
      const row = rows[rows.length - 1]!;
      if (row.length > 0 && rowWidth + gap + entryWidth > room) {
        rows.push([]);
        rowWidth = 0;
      }
      rowWidth += (rows[rows.length - 1]!.length > 0 ? gap : 0) + entryWidth;
      rows[rows.length - 1]!.push({ entry, width: entryWidth });
    }
    const pitch = 2 * size;
    // A row's box keeps a least height, and grows with text taller than that leaves room for.
    const rowBox = Math.max(LEGEND_ROW_MIN, line + LEGEND_ROW_PAD);
    const boxHeight = rowBox + (rows.length - 1) * pitch;
    const top = legend.position === 't' ? box.t : box.b - boxHeight;
    for (const [rowIndex, row] of rows.entries()) {
      const total = row.reduce((sum, item, index) => sum + item.width + (index > 0 ? gap : 0), 0);
      let x = width / 2 - (total + LEGEND_PAD_LEFT + LEGEND_PAD_RIGHT) / 2 + LEGEND_PAD_LEFT;
      for (const item of row) {
        items.push({ entry: item.entry, x, y: top + rowBox / 2 + rowIndex * pitch });
        x += item.width + gap;
      }
    }
    if (!legend.overlay) {
      if (legend.position === 't') box.t = top + boxHeight + STACK_GAP;
      else box.b = top - STACK_GAP;
    }
    return items;
  }
  const pitch = 2 * size;
  let widest = 0;
  for (const entry of entries) widest = Math.max(widest, estimateTextWidth(entry.text, style));
  const boxWidth = LEGEND_PAD_LEFT + keyText + widest + LEGEND_PAD_RIGHT;
  const fits = Math.max(1, Math.floor((height - 2 * MARGIN - line) / pitch) + 1);
  const shown = entries.slice(0, fits);
  const boxHeight = line + (shown.length - 1) * pitch + 2 * LEGEND_PAD_Y;
  const left = legend.position === 'l' ? MARGIN : width - MARGIN - boxWidth;
  const top = Math.max(box.t, (box.t + box.b) / 2 - boxHeight / 2);
  for (const [index, entry] of shown.entries()) {
    items.push({
      entry,
      x: left + LEGEND_PAD_LEFT,
      y: top + LEGEND_PAD_Y + line / 2 + index * pitch,
    });
  }
  if (!legend.overlay) {
    if (legend.position === 'l') box.l = left + boxWidth + LEGEND_PLOT_GAP;
    else box.r = left - LEGEND_PLOT_GAP;
  }
  return items;
}

function paintLegend(items: readonly LegendItem[], style: ChartTextStyle, context: ChartexContext) {
  const size = style.sizePt;
  const key = legendKey(size);
  const line = lineHeight(style);
  for (const { entry, x, y } of items) {
    if (entry.lineKey && entry.line) {
      context.scene.line(
        [
          { x, y },
          { x: x + key, y },
        ],
        entry.line
      );
    } else {
      context.scene.rect(x, y - key / 2, key, key, entry.fill, entry.line);
    }
    const estimate = estimateTextWidth(entry.text, style);
    context.labels.push({
      paragraphs: [[{ text: entry.text, style }]],
      align: 'l',
      x: x + LEGEND_KEY_TO_TEXT,
      y: y - line / 2,
      width: estimate * 1.3 + size * 2,
      height: line,
      rotation: 0,
    });
  }
}

/** The layout that paints the visible series, or null when they need more than one. */
function layoutOf(series: readonly ChartexSeries[]): ChartexLayout | null {
  const first = series[0];
  const layout = first ? chartexLayoutFor(first.layoutId) : null;
  if (!layout) return null;
  return series.every((item) => layout.layoutIds.includes(item.layoutId)) ? layout : null;
}

/** Lay out and paint a chartex chart `width` by `height` points; null when unsupported. */
export function renderChartex(
  model: ChartexModel,
  parts: { readonly style: OoxmlElement | null; readonly colors: OoxmlElement | null },
  width: number,
  height: number,
  resolveSchemeColor?: ShapeSchemeColorResolver,
  themeFaces?: ChartThemeFaces
): ChartexRender | null {
  const series = model.series.filter((item) => !item.hidden);
  const layout = layoutOf(series);
  if (!layout) return null;
  const look = new ChartexLook(parts, model.txPr, resolveSchemeColor, themeFaces);
  const context: ChartexContext = {
    model,
    look,
    scene: new ChartScene(),
    labels: [],
    chartWidth: width,
    chartHeight: height,
  };
  context.scene.rect(
    0,
    0,
    width,
    height,
    look.fill('chartArea', model.spPr),
    look.line('chartArea', model.spPr)
  );
  const box: Box = { l: MARGIN, t: MARGIN, r: width - RIGHT_MARGIN, b: height - MARGIN };

  if (model.title) {
    const style = look.text('title', cxChild(model.title.element, 'txPr'));
    const paragraphs = titleParagraphs(model.title.element, style, context);
    if (paragraphs.some((runs) => runs.some((run) => run.text.trim() !== ''))) {
      const textWidth = paragraphsWidth(paragraphs);
      const total = paragraphsHeight(paragraphs, style);
      const frame = Math.min(width, textWidth * 1.3 + style.sizePt * 2);
      const bottom = model.title.position === 'b';
      const top = bottom ? box.b - total : box.t;
      context.labels.push({
        paragraphs,
        align: 'ctr',
        x: width / 2 - frame / 2,
        y: top,
        width: frame,
        height: total,
        rotation: 0,
      });
      if (!model.title.overlay) {
        if (bottom) box.b = top - STACK_GAP;
        else box.t = top + total + STACK_GAP;
      }
    }
  }

  let legendItems: LegendItem[] = [];
  let legendStyle: ChartTextStyle | null = null;
  if (model.legend) {
    legendStyle = look.text('legend', model.legend.txPr);
    const entries = layout.legendEntries(series, context).slice(0, MAX_LEGEND_ENTRIES);
    if (entries.length > 0) {
      legendItems = placeLegend(model, entries, legendStyle, box, width, height);
    }
  }
  if (layout.roomAbovePlot) box.t += CHARTEX_PLOT_TOP_ROOM;

  if (!layout.paint(series, box, context)) return null;
  if (legendStyle) paintLegend(legendItems, legendStyle, context);
  if (!context.scene.ok) return null;
  return { scene: context.scene, labels: context.labels };
}
