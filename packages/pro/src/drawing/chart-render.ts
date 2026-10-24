/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The automatic layout of a whole chart: chart area, title, legend and plot area.
//
// Distances are in points and follow the layout Office gives a chart with nothing placed by
// hand: an 11 pt margin, the title centred at the top, the legend against its edge, and the
// plot area taking the rest. Elements with a manual layout keep their authored place.

import { type ChartThemeFaces, type ShapeSchemeColorResolver } from '@docx-editor.dev/core/store';
import { is3DCartesian, paint3DCartesian, surfaceScale } from './chart-3d-cartesian.ts';
import { surfaceBands, type SurfaceBand } from './chart-3d-surface.ts';
import { paintPie3D } from './chart-3d-pie.ts';
import { paintCartesian } from './chart-cartesian.ts';
import { chartBaseText, elementText, titleParagraphs } from './chart-labels.ts';
import { legendEntries, paintLegend, placeLegend } from './chart-legend.ts';
import { child, childVal, readManualLayout, type ChartModel } from './chart-model.ts';
import { paintOfPie } from './chart-of-pie.ts';
import { paintPie } from './chart-pie.ts';
import { paintRadar } from './chart-radar.ts';
import { ChartScene } from './chart-scene.ts';
import type { LookContext } from './chart-series.ts';
import {
  mergeStroke,
  readChartShapeProperties,
  themeColor,
  type ChartStroke,
} from './chart-style.ts';
import { bodyRotation, paragraphsHeight, paragraphsWidth, type ChartLabel } from './chart-text.ts';

const MARGIN = 11;

/** A manual layout's box in chart points. */
function manualBox(
  layout: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  width: number,
  height: number
) {
  return {
    l: layout.x * width,
    t: layout.y * height,
    r: (layout.x + layout.w) * width,
    b: (layout.y + layout.h) * height,
  };
}
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
  resolveSchemeColor?: ShapeSchemeColorResolver,
  themeFaces?: ChartThemeFaces
): ChartRender | null {
  const scene = new ChartScene();
  const labels: ChartLabel[] = [];
  const baseText = chartBaseText(model, resolveSchemeColor, themeFaces);
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
  // Pie labels keep clear of the title's text, by a little more than a character either side.
  const avoid: { l: number; t: number; r: number; b: number }[] = [];

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
      const textWidth = paragraphsWidth(paragraphs);
      const manual = readManualLayout(child(titleElement, 'layout'));
      const overlay = childVal(titleElement, 'overlay') === '1';
      const rich = child(child(titleElement, 'tx'), 'rich');
      // An automatic title wraps past four fifths of the chart width.
      const wrapWidth = width * 0.8;
      const wraps = !manual && textWidth > wrapWidth;
      const frame = wraps ? wrapWidth : textWidth * 1.3 + style.sizePt * 2;
      const total =
        paragraphsHeight(paragraphs, style) * (wraps ? Math.ceil(textWidth / wrapWidth) : 1);
      const top = manual ? manual.y * height : box.t - 3.4;
      // A placed title's box starts at its authored corner; its lines centre in that box.
      const center = manual ? manual.x * width + textWidth / 2 : width / 2;
      labels.push({
        paragraphs,
        align: 'ctr',
        x: center - frame / 2,
        y: top,
        width: frame,
        height: total,
        rotation: bodyRotation(rich) ?? 0,
      });
      if (!manual && !overlay) box.t = top + total + 12.5;
      const reach = (wraps ? wrapWidth : textWidth) / 2 + style.sizePt * 0.66;
      avoid.push({ l: center - reach, r: center + reach, t: top, b: top + total });
    }
  }

  // Surface bands follow the value scale, which the legend lists: fix it first.
  const surfacePlots = model.plots.filter((plot) => plot.kind === 'surface');
  let bands: SurfaceBand[] | undefined;
  if (surfacePlots.length > 0) {
    const { scale, formatCode } = surfaceScale({ model, look, baseText }, surfacePlots, box);
    bands = surfaceBands(surfacePlots[0]!, scale, formatCode, { model, look });
  }

  // Legend.
  const legendStyle = model.legend
    ? elementText(baseText, model.legend.txPr, resolveSchemeColor)
    : null;
  let legendLayout = null;
  if (model.legend && legendStyle) {
    const entries = legendEntries(model, model.legend, look, bands);
    const placed = placeLegend(model.legend, entries, legendStyle, width, height, box);
    legendLayout = placed.layout;
    Object.assign(box, placed.plot);
  }

  const blanksRaw = childVal(child(model.chartSpace, 'chart'), 'dispBlanksAs');
  const blanks = blanksRaw === 'zero' || blanksRaw === 'span' ? blanksRaw : 'gap';
  const round = model.plots.filter((plot) => plot.kind === 'pie' || plot.kind === 'doughnut');
  const radar = model.plots.filter((plot) => plot.kind === 'radar');
  const ofPie = model.plots.filter((plot) => plot.kind === 'ofPie');
  const axial = model.plots.filter(
    (plot) => !round.includes(plot) && !radar.includes(plot) && !ofPie.includes(plot)
  );
  const groups = [round, radar, ofPie, axial].filter((group) => group.length > 0);
  if (groups.length !== 1) return null;
  if (radar.length > 0) {
    paintRadar(radar, model.plotLayout?.inner ? manualBox(model.plotLayout, width, height) : box, {
      model,
      look,
      scene,
      labels,
      baseText,
    });
  } else if (ofPie.length > 0) {
    if (ofPie.length !== 1) return null;
    paintOfPie(ofPie[0]!, box, {
      look,
      scene,
      labels,
      baseText,
      date1904: model.date1904,
      placed: false,
    });
  } else if (axial.length > 0 && axial.some((plot) => plot.threeD || plot.kind === 'surface')) {
    if (!is3DCartesian(axial)) return null;
    const painted = paint3DCartesian(
      axial,
      box,
      {
        model,
        look,
        scene,
        labels,
        baseText,
        blanks,
        chartWidth: width,
        chartHeight: height,
      },
      bands
    );
    if (!painted) return null;
  } else if (axial.length > 0) {
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
      if (plot.kind === 'pie' && plot.threeD) {
        paintPie3D(plot, plotBox, {
          model,
          look,
          scene,
          labels,
          baseText,
          date1904: model.date1904,
          placed: model.plotLayout?.inner === true,
          bounds: { l: 0, t: 0, r: width, b: height },
        });
        continue;
      }
      paintPie(plot, plotBox, {
        look,
        scene,
        labels,
        baseText,
        date1904: model.date1904,
        placed: model.plotLayout?.inner === true,
        avoid,
        bounds: { l: 0, t: 0, r: width, b: height },
      });
    }
  }
  if (legendLayout && legendStyle) paintLegend(legendLayout, legendStyle, scene, labels);
  if (!scene.ok) return null;
  return { scene, labels };
}
