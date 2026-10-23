// The automatic layout of a whole chart: chart area, title, legend and plot area.
//
// Distances are in points and follow the layout Office gives a chart with nothing placed by
// hand: an 11 pt margin, the title centred at the top, the legend against its edge, and the
// plot area taking the rest. Elements with a manual layout keep their authored place.

import { paintCartesian } from './chart-cartesian.ts';
import { chartBaseText, elementText, titleParagraphs } from './chart-labels.ts';
import { legendEntries, paintLegend, placeLegend } from './chart-legend.ts';
import { child, childVal, readManualLayout, type ChartModel } from './chart-model.ts';
import { paintPie } from './chart-pie.ts';
import { ChartScene } from './chart-scene.ts';
import type { LookContext } from './chart-series.ts';
import {
  mergeStroke,
  readChartShapeProperties,
  themeColor,
  type ChartStroke,
} from './chart-style.ts';
import { bodyRotation, paragraphsHeight, paragraphsWidth, type ChartLabel } from './chart-text.ts';
import type { ShapeSchemeColorResolver } from './drawing-shape-color.ts';

const MARGIN = 11;
const DEFAULT_BORDER: ChartStroke = {
  hex: '898989',
  alpha: 1,
  widthPt: 0.5,
  cap: 'butt',
  dash: null,
};

export interface ChartRender {
  readonly scene: ChartScene;
  readonly labels: readonly ChartLabel[];
}

/** Lay out and paint `model` in a chart `width` by `height` points; null when unsupported. */
export function renderChart(
  model: ChartModel,
  width: number,
  height: number,
  resolveSchemeColor?: ShapeSchemeColorResolver
): ChartRender | null {
  const scene = new ChartScene();
  const labels: ChartLabel[] = [];
  const baseText = chartBaseText(model, resolveSchemeColor);
  const seriesCount = model.plots.reduce((sum, plot) => sum + plot.series.length, 0);
  const look: LookContext = { model, resolveSchemeColor, seriesCount };

  // Chart area.
  const area = readChartShapeProperties(model.spPr, resolveSchemeColor);
  const background =
    area.fill === undefined
      ? (themeColor('bg1', '', resolveSchemeColor) ?? { hex: 'FFFFFF', alpha: 1 })
      : area.fill;
  scene.rect(
    0,
    0,
    width,
    height,
    background,
    mergeStroke(area.line, model.spPr ? null : DEFAULT_BORDER)
  );

  const box = { l: MARGIN, t: MARGIN, r: width - MARGIN, b: height - MARGIN };

  // Title: authored, or the single series' name when the chart names none.
  const singleSeries =
    seriesCount === 1 ? model.plots.find((plot) => plot.series.length === 1)!.series[0]! : null;
  const showTitle = model.title !== null || (!model.autoTitleDeleted && singleSeries !== null);
  if (showTitle) {
    const titleElement = model.title;
    const style = elementText(baseText, child(titleElement, 'txPr'), resolveSchemeColor, {
      sizePt: baseText.sizePt * 1.8,
      bold: true,
    });
    const fallback = singleSeries?.name ?? (seriesCount > 1 ? 'Chart Title' : null);
    const paragraphs = titleElement
      ? titleParagraphs(titleElement, style, fallback, resolveSchemeColor)
      : fallback
        ? [[{ text: fallback, style }]]
        : [];
    if (paragraphs.length > 0) {
      const total = paragraphsHeight(paragraphs, style);
      const textWidth = paragraphsWidth(paragraphs);
      const frame = Math.min(width, textWidth * 1.3 + style.sizePt * 2);
      const manual = readManualLayout(child(titleElement, 'layout'));
      const overlay = childVal(titleElement, 'overlay') === '1';
      const rich = child(child(titleElement, 'tx'), 'rich');
      const top = manual ? manual.y * height : box.t - 3.4;
      const left = manual ? manual.x * width : width / 2 - frame / 2;
      labels.push({
        paragraphs,
        align: 'ctr',
        x: manual ? left - (frame - textWidth) / 2 : left,
        y: top,
        width: frame,
        height: total,
        rotation: bodyRotation(rich) ?? 0,
      });
      if (!manual && !overlay) box.t = top + total + 12.5;
    }
  }

  // Legend.
  const legendStyle = model.legend
    ? elementText(baseText, model.legend.txPr, resolveSchemeColor)
    : null;
  let legendLayout = null;
  if (model.legend && legendStyle) {
    const entries = legendEntries(model, model.legend, look);
    const placed = placeLegend(model.legend, entries, legendStyle, width, height, box);
    legendLayout = placed.layout;
    Object.assign(box, placed.plot);
  }

  const blanksRaw = childVal(child(model.chartSpace, 'chart'), 'dispBlanksAs');
  const blanks = blanksRaw === 'zero' || blanksRaw === 'span' ? blanksRaw : 'gap';
  const round = model.plots.filter((plot) => plot.kind === 'pie' || plot.kind === 'doughnut');
  const axial = model.plots.filter((plot) => plot.kind !== 'pie' && plot.kind !== 'doughnut');
  if (round.length > 0 && axial.length > 0) return null;
  if (axial.length > 0) {
    const painted = paintCartesian(axial, box, {
      model,
      look,
      scene,
      labels,
      baseText,
      blanks,
      chartWidth: width,
      chartHeight: height,
    });
    if (!painted) return null;
  } else {
    const plotBox = model.plotLayout
      ? {
          l: model.plotLayout.x * width,
          t: model.plotLayout.y * height,
          r: (model.plotLayout.x + model.plotLayout.w) * width,
          b: (model.plotLayout.y + model.plotLayout.h) * height,
        }
      : box;
    const area = readChartShapeProperties(model.plotSpPr, resolveSchemeColor);
    if (area.fill || area.line) {
      scene.rect(
        plotBox.l,
        plotBox.t,
        plotBox.r - plotBox.l,
        plotBox.b - plotBox.t,
        area.fill ?? null,
        area.line ?? null
      );
    }
    for (const plot of round) {
      paintPie(plot, plotBox, { look, scene, labels, baseText, date1904: model.date1904 });
    }
  }
  if (legendLayout && legendStyle) paintLegend(legendLayout, legendStyle, scene, labels);
  if (!scene.ok) return null;
  return { scene, labels };
}
